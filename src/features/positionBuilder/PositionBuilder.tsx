import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '../../components/echart/echartsCore';
import { cn } from '../../lib/utils';
import { DERIBIT_WS } from '../../registry/data/ws';
import { bsPrice, bsGreeks, hoursToYears } from './greeks';
import type { Leg, DeribitInstrument, ExpiryGroup, RightTab } from './types';
import {
  PRESETS, DERIBIT_INDEX, N_POINTS, SPOT_OFFSETS, IV_OFFSETS, SCENARIO_PRESETS,
  HEATMAP_SPOT, HEATMAP_IV, LADDER_OFFSETS, RIGHT_TABS, INPUT_CLS, SELECT_CLS,
  STORAGE_KEY, formatHours, roundStrike, TEMPLATES, gClass,
} from './constants';
import { Panel } from './Panel';
import { ScenarioMatrixPanel, GreeksLadderPanel, ThetaCalendarPanel, GreeksHeatmapPanel, VaRPanel, PLAttributionPanel, IVSkewPanel, ScenarioSliders, PositionSummaryStrip, PLCurvePanel, DeltaGammaPanel } from './panels';

// ── localStorage persistence bootstrap (constants/types/greeks/Panel now live in
//    ./constants, ./types, ./greeks, ./Panel) ─────────────────────────────────

const _saved = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.legs)) {
      const now = Date.now();
      parsed.legs = (parsed.legs as Leg[])
        .map(l => ({
          ...l,
          hoursToExpiry: l.expiryTs
            ? Math.max(1, (l.expiryTs - now) / 3_600_000)
            : (l.hoursToExpiry ?? 168),
          fetchingTicker: false,
        }))
        .filter(l => !l.expiryTs || l.expiryTs > now); // drop expired
    }
    return parsed as { symbol: string; spot: number; baseIv: number; legs: Leg[] };
  } catch { return null; }
})();
// ────────────────────────────────────────────────────────────────────────────

export function PositionBuilder() {
  const [symbol, setSymbol] = useState<string>(_saved?.symbol ?? 'BTC');
  const [spot,   setSpot]   = useState<number>(_saved?.spot   ?? PRESETS.BTC.spot);
  const [baseIv, setBaseIv] = useState<number>(_saved?.baseIv ?? PRESETS.BTC.iv);
  const [legs,   setLegs]   = useState<Leg[]>(_saved?.legs    ?? []);
  const [nextId, setNextId] = useState<number>(
    _saved?.legs?.length ? Math.max(..._saved.legs.map((l: Leg) => l.id)) + 1 : 1
  );
  const [hoursForward, setHoursForward] = useState(0);
  const [ivAdjust, setIvAdjust] = useState(0);
  const [spotPctOffset, setSpotPctOffset] = useState(0);
  const [showTimeSlices, setShowTimeSlices] = useState(false);

  // Correlated stress parameters
  const [correlatedMode, setCorrelatedMode] = useState(false);
  const [rho, setRho] = useState(-0.7);         // spot-vol correlation (typically negative for crypto)
  const [volBeta, setVolBeta] = useState(1.5);   // % IV change per 1% spot move

  const [instruments, setInstruments] = useState<DeribitInstrument[]>([]);
  const [instrumentsLoading, setInstrumentsLoading] = useState(false);

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const livePriceRef = useRef<number | null>(null);
  const [priceDir, setPriceDir] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const defer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    deferredTimersRef.current.push(id);
    return id;
  }, []);

  const clearDeferred = useCallback(() => {
    deferredTimersRef.current.forEach(clearTimeout);
    deferredTimersRef.current = [];
  }, []);

  useEffect(() => {
    livePriceRef.current = livePrice;
  }, [livePrice]);

  const plChartRef = useRef<ReactECharts>(null);
  const dgChartRef = useRef<ReactECharts>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Extended state ────────────────────────────────────────────────────────
  // IV Rank: manual 52-week historical range
  const [ivRankLow,  setIvRankLow]  = useState(20);
  const [ivRankHigh, setIvRankHigh] = useState(120);
  // Custom scenario save/load
  const [savedScenarios, setSavedScenarios] = useState<{ name: string; spotPct: number; ivAdj: number }[]>(() => {
    try { return JSON.parse(localStorage.getItem('pb_scenarios_v1') || '[]'); } catch { return []; }
  });
  const [scenarioName, setScenarioName] = useState('');
  // Jump-diffusion VaR (Merton model)
  const [jumpLambda,   setJumpLambda]   = useState(2.0);
  const [jumpMuPct,    setJumpMuPct]    = useState(-15);
  const [jumpSigPct,   setJumpSigPct]   = useState(10);
  const [showJumpRisk, setShowJumpRisk] = useState(false);
  // Greeks heatmap metric toggle
  const [heatmapMetric, setHeatmapMetric] = useState<'delta' | 'gamma' | 'vega'>('gamma');
  const [activeTab, setActiveTab] = useState<RightTab>('chart');
  // ─────────────────────────────────────────────────────────────────────────

  // ── Deribit index price — 共享 DERIBIT_WS 单例（复用连接 + 自动重连）。
  // tick ~10次/秒，但本组件极重：flush 节流到 1Hz，否则每个 tick 全量重渲染。
  useEffect(() => {
    const indexName = DERIBIT_INDEX[symbol];
    let latest: number | null = null;

    setLivePrice(null);
    prevPriceRef.current = null;

    const unsub = DERIBIT_WS.subscribe<{ price: number }>(
      `deribit_price_index.${indexName}`,
      d => { if (Number.isFinite(d?.price)) latest = d.price; },
    );

    const flush = setInterval(() => {
      if (latest === null) return;
      const newPrice = latest;
      setLivePrice(newPrice);
      if (prevPriceRef.current !== null && newPrice !== prevPriceRef.current) {
        const dir = newPrice > prevPriceRef.current ? 'up' : 'down';
        setPriceDir(dir);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setPriceDir(null), 700);
      }
      prevPriceRef.current = newPrice;
    }, 1000);

    return () => {
      unsub();
      clearInterval(flush);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [symbol]);
  // ───────────────────────────────────────────────────────────────────────────

  // ── Persist state to localStorage (debounced 600 ms) ────────────────────────
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, spot, baseIv, legs }));
      } catch { /* storage full / private mode */ }
    }, 600);
  }, [symbol, spot, baseIv, legs]);
  // ────────────────────────────────────────────────────────────────────────────

  // ── Correlated stress: auto-sync IV when spot moves ──────────────────────────
  useEffect(() => {
    if (!correlatedMode) return;
    // Δσ = −ρ × volBeta × ΔS/S
    setIvAdjust(-rho * volBeta * spotPctOffset / 100);
  }, [correlatedMode, rho, volBeta, spotPctOffset]);
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Deribit options chain ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setInstrumentsLoading(true);
      try {
        const res = await fetch(
          `https://www.deribit.com/api/v2/public/get_instruments?currency=${symbol}&kind=option&expired=false`
        );
        const json = await res.json();
        if (!cancelled) setInstruments(json.result ?? []);
      } catch {
        if (!cancelled) setInstruments([]);
      } finally {
        if (!cancelled) setInstrumentsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [symbol]);

  const expiryGroups = useMemo<ExpiryGroup[]>(() => {
    const map = new Map<number, ExpiryGroup>();
    for (const inst of instruments) {
      const ts = inst.expiration_timestamp;
      if (!map.has(ts)) {
        const label = inst.instrument_name.split('-')[1] ?? '';
        const d = new Date(ts);
        const displayLabel = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' });
        map.set(ts, { ts, deribitLabel: label, displayLabel, callByStrike: new Map(), putByStrike: new Map(), strikes: [] });
      }
      const g = map.get(ts)!;
      if (inst.option_type === 'call') g.callByStrike.set(inst.strike, inst.instrument_name);
      else g.putByStrike.set(inst.strike, inst.instrument_name);
      if (!g.strikes.includes(inst.strike)) g.strikes.push(inst.strike);
    }
    for (const g of map.values()) g.strikes.sort((a, b) => a - b);
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }, [instruments]);
  // Re-fetch tickers for saved/snapped legs once the chain is loaded
  useEffect(() => {
    if (expiryGroups.length === 0) return;
    legs.forEach(l => {
      if (l.instrumentName && !l.fetchingTicker) fetchTicker(l.id, l.instrumentName);
    });
    // Only fire when chain first populates — eslint-disable-next-line is intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiryGroups]);
  // ───────────────────────────────────────────────────────────────────────────

  const currentS = spot * (1 + spotPctOffset / 100);
  const sigma = Math.max(0.01, baseIv + ivAdjust);
  const maxHours = useMemo(() => legs.reduce((m, l) => Math.max(m, l.hoursToExpiry), 0), [legs]);

  const repriceEntry = useCallback((leg: Leg) => {
    // Real-instrument legs keep their fetched entry premium
    if (leg.instrumentName) return leg;
    const T = hoursToYears(leg.hoursToExpiry);
    return { ...leg, entryPremium: bsPrice(spot, leg.K, T, baseIv, leg.type) };
  }, [spot, baseIv]);

  const fetchTicker = useCallback(async (legId: number, instrumentName: string) => {
    setLegs(prev => prev.map(l => l.id === legId ? { ...l, fetchingTicker: true } : l));
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`
      );
      const json = await res.json();
      if (json.result) {
        const { mark_price, mark_iv, underlying_price, best_bid, best_ask } = json.result;
        const entryPremium = mark_price * underlying_price;
        const legIv = mark_iv / 100;
        const bid = typeof best_bid === 'number' ? best_bid * underlying_price : undefined;
        const ask = typeof best_ask === 'number' ? best_ask * underlying_price : undefined;
        setLegs(prev => prev.map(l =>
          l.id === legId ? { ...l, entryPremium, legIv, bid, ask, fetchingTicker: false } : l
        ));
      }
    } catch {
      setLegs(prev => prev.map(l => l.id === legId ? { ...l, fetchingTicker: false } : l));
    }
  }, []);

  const addLeg = useCallback((partial: Partial<Leg> = {}) => {
    const defaultK = roundStrike(spot, PRESETS[symbol].strikeStep);
    const leg: Leg = {
      id: nextId, side: 1, type: 'call', K: defaultK, qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0, ...partial,
    };
    const priced = repriceEntry(leg);
    setNextId(n => n + 1);
    setLegs(prev => [...prev, priced]);
  }, [spot, symbol, nextId, repriceEntry]);

  const removeLeg = useCallback((id: number) => {
    setLegs(prev => prev.filter(l => l.id !== id));
  }, []);

  const updateLeg = useCallback((id: number, patch: Partial<Leg>) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...patch };
      if (patch.expiryTs !== undefined) {
        updated.hoursToExpiry = Math.max(1, (patch.expiryTs - Date.now()) / (1000 * 3600));
        updated.instrumentName = undefined;
        updated.legIv = undefined;
        updated.entryPremium = 0;
      }
      return repriceEntry(updated);
    }));
  }, [repriceEntry]);

  // Resolve instrumentName and fetch ticker whenever expiryTs / K / type are all set
  const resolveInstrument = useCallback((legId: number, leg: Leg) => {
    if (!leg.expiryTs || !leg.K) return;
    const group = expiryGroups.find(g => g.ts === leg.expiryTs);
    if (!group) return;
    const map = leg.type === 'call' ? group.callByStrike : group.putByStrike;
    const name = map.get(leg.K);
    if (!name || name === leg.instrumentName) return;
    setLegs(prev => prev.map(l => l.id === legId ? { ...l, instrumentName: name } : l));
    fetchTicker(legId, name);
  }, [expiryGroups, fetchTicker]);

  const applyTemplate = useCallback((key: string) => {
    const fn = TEMPLATES[key];
    if (!fn) return;
    let idCounter = 1;
    const rawLegs = fn(spot, PRESETS[symbol].strikeStep, () => idCounter++);

    // If real chain is loaded, snap each leg to nearest real expiry + strike
    const snapped: Leg[] = rawLegs.map(leg => {
      if (expiryGroups.length === 0) return repriceEntry(leg);

      const targetTs = Date.now() + leg.hoursToExpiry * 3600 * 1000;
      const nearestGroup = expiryGroups.reduce((best, g) =>
        Math.abs(g.ts - targetTs) < Math.abs(best.ts - targetTs) ? g : best
      );
      const strikeMap = leg.type === 'call' ? nearestGroup.callByStrike : nearestGroup.putByStrike;
      const nearestK = nearestGroup.strikes.reduce((best, s) =>
        Math.abs(s - leg.K) < Math.abs(best - leg.K) ? s : best,
        nearestGroup.strikes[0] ?? leg.K
      );
      return {
        ...leg,
        K: nearestK,
        hoursToExpiry: Math.max(1, (nearestGroup.ts - Date.now()) / 3_600_000),
        expiryTs: nearestGroup.ts,
        instrumentName: strikeMap.get(nearestK),
        entryPremium: 0,
        legIv: undefined,
      };
    });

    setLegs(snapped);
    setNextId(idCounter);

    // Fetch tickers for snapped legs (defer to let React commit state first)
    clearDeferred();
    snapped.forEach(leg => {
      if (leg.instrumentName) defer(() => fetchTicker(leg.id, leg.instrumentName!), 50);
    });
  }, [spot, symbol, repriceEntry, expiryGroups, fetchTicker, clearDeferred, defer]);

  const refreshAllTickers = useCallback(() => {
    legs.forEach(leg => {
      if (leg.instrumentName) fetchTicker(leg.id, leg.instrumentName);
    });
  }, [legs, fetchTicker]);

  const clearAll = useCallback(() => {
    setLegs([]);
    setNextId(1);
    setHoursForward(0);
  }, []);

  const resetScenario = useCallback(() => {
    setHoursForward(0);
    setIvAdjust(0);
    setSpotPctOffset(0);
  }, []);

  const saveScenario = useCallback(() => {
    if (!scenarioName.trim()) return;
    setSavedScenarios(prev => {
      const next = [...prev, { name: scenarioName.trim(), spotPct: spotPctOffset, ivAdj: ivAdjust }];
      try { localStorage.setItem('pb_scenarios_v1', JSON.stringify(next)); } catch {}
      return next;
    });
    setScenarioName('');
  }, [scenarioName, spotPctOffset, ivAdjust]);

  const deleteScenario = useCallback((idx: number) => {
    setSavedScenarios(prev => {
      const next = prev.filter((_, i) => i !== idx);
      try { localStorage.setItem('pb_scenarios_v1', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const changeSymbol = useCallback((newSymbol: string) => {
    const p = PRESETS[newSymbol];
    setSymbol(newSymbol);
    setSpot(p.spot);
    setBaseIv(p.iv);
    setLegs([]);
    setNextId(1);
    setInstruments([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const legCurrentValue = useCallback((leg: Leg, S: number, hf: number, ivAdj: number) => {
    const remH = Math.max(0, leg.hoursToExpiry - hf);
    const T = hoursToYears(remH);
    const sig = Math.max(0.01, (leg.legIv ?? baseIv) + ivAdj);
    return bsPrice(S, leg.K, T, sig, leg.type);
  }, [baseIv]);

  const legPL = useCallback((leg: Leg, S: number, hf: number, ivAdj: number) => {
    const cur = legCurrentValue(leg, S, hf, ivAdj);
    return leg.side * leg.qty * (cur - leg.entryPremium);
  }, [legCurrentValue]);

  const positionPL = useCallback((S: number, hf: number, ivAdj: number) => {
    return legs.reduce((sum, l) => sum + legPL(l, S, hf, ivAdj), 0);
  }, [legs, legPL]);

  const positionGreeks = useCallback((S: number, hf: number, ivAdj: number) => {
    let d = 0, g = 0, t = 0, v = 0, va = 0, vo = 0, ch = 0, sp = 0;
    for (const leg of legs) {
      const remH = Math.max(0, leg.hoursToExpiry - hf);
      const T = hoursToYears(remH);
      const sig = Math.max(0.01, (leg.legIv ?? baseIv) + ivAdj);
      const grk = bsGreeks(S, leg.K, T, sig, leg.type);
      const scale = leg.side * leg.qty;
      d += scale * grk.delta;
      g += scale * grk.gamma;
      t += scale * grk.theta;
      v += scale * grk.vega;
      va += scale * grk.vanna;
      vo += scale * grk.volga;
      ch += scale * grk.charm;
      sp += scale * grk.speed;
    }
    return { delta: d, gamma: g, theta: t, vega: v, vanna: va, volga: vo, charm: ch, speed: sp };
  }, [baseIv, legs]);

  const chartXs = useMemo(() => {
    const strikes = legs.map(l => l.K).filter(k => k > 0);
    const lo = Math.min(spot * 0.55, ...strikes.map(k => k * 0.82));
    const hi = Math.max(spot * 1.45, ...strikes.map(k => k * 1.18));
    return Array.from({ length: N_POINTS + 1 }, (_, i) => lo + (hi - lo) * i / N_POINTS);
  }, [spot, legs]);

  const expiryPL = useMemo(() => {
    const maxH = legs.reduce((m, l) => Math.max(m, l.hoursToExpiry), 0);
    return chartXs.map(x => positionPL(x, maxH, 0));
  }, [legs, chartXs, positionPL]);

  const currentPL = useMemo(() => {
    return chartXs.map(x => positionPL(x, hoursForward, ivAdjust));
  }, [chartXs, hoursForward, ivAdjust, positionPL]);

  // Time slice curves: pure theta decay at entry spot range, no IV stress
  const timePL_25 = useMemo(() =>
    showTimeSlices && legs.length > 0
      ? chartXs.map(x => positionPL(x, maxHours * 0.25, 0))
      : [],
  [showTimeSlices, legs.length, chartXs, maxHours, positionPL]);

  const timePL_50 = useMemo(() =>
    showTimeSlices && legs.length > 0
      ? chartXs.map(x => positionPL(x, maxHours * 0.50, 0))
      : [],
  [showTimeSlices, legs.length, chartXs, maxHours, positionPL]);

  const timePL_75 = useMemo(() =>
    showTimeSlices && legs.length > 0
      ? chartXs.map(x => positionPL(x, maxHours * 0.75, 0))
      : [],
  [showTimeSlices, legs.length, chartXs, maxHours, positionPL]);

  // Delta and Gamma profiles (for the secondary chart)
  const deltaProfile = useMemo(() =>
    legs.length > 0 ? chartXs.map(x => positionGreeks(x, hoursForward, ivAdjust).delta) : [],
  [legs.length, chartXs, hoursForward, ivAdjust, positionGreeks]);

  const gammaProfile = useMemo(() =>
    legs.length > 0 ? chartXs.map(x => positionGreeks(x, hoursForward, ivAdjust).gamma) : [],
  [legs.length, chartXs, hoursForward, ivAdjust, positionGreeks]);

  // Daily theta calendar: P/L change each day from entry to max expiry (spot unchanged)
  const thetaCalendar = useMemo(() => {
    if (legs.length === 0 || maxHours <= 0) return null;
    const maxDays = Math.min(Math.ceil(maxHours / 24), 180);
    const rows = Array.from({ length: maxDays }, (_, d) => {
      const daily = positionPL(spot, (d + 1) * 24, 0) - positionPL(spot, d * 24, 0);
      const cumPL  = positionPL(spot, (d + 1) * 24, 0);
      return { day: d + 1, daily, cumPL };
    });
    return rows;
  }, [legs.length, spot, maxHours, positionPL]);

  const grk = useMemo(() => positionGreeks(currentS, hoursForward, ivAdjust), [currentS, hoursForward, ivAdjust, positionGreeks]);
  const pl  = useMemo(() => positionPL(currentS, hoursForward, ivAdjust), [currentS, hoursForward, ivAdjust, positionPL]);

  // Live mark-to-market P/L using real-time index price, no scenario offsets
  const livePL = useMemo(() => {
    if (livePrice === null || legs.length === 0) return null;
    return positionPL(livePrice, 0, 0);
  }, [livePrice, legs.length, positionPL]);

  // Max profit / max loss within chart range (expiry curve)
  const maxProfit = useMemo(() => legs.length === 0 ? null : Math.max(...expiryPL), [expiryPL, legs]);
  const maxLoss   = useMemo(() => legs.length === 0 ? null : Math.min(...expiryPL), [expiryPL, legs]);

  // Breakevens (expiry P/L zero-crossings) — shared with chart effect
  const breakevens = useMemo(() => {
    const bvs: number[] = [];
    for (let i = 1; i < chartXs.length; i++) {
      if (expiryPL[i - 1] * expiryPL[i] < 0) {
        const x = chartXs[i - 1] + (chartXs[i] - chartXs[i - 1]) * (-expiryPL[i - 1]) / (expiryPL[i] - expiryPL[i - 1]);
        bvs.push(x);
      }
    }
    return bvs;
  }, [chartXs, expiryPL]);

  // Net premium: positive = net paid (debit), negative = net received (credit)
  const netPremium = useMemo(
    () => legs.reduce((s, l) => s + l.side * l.qty * l.entryPremium, 0),
    [legs],
  );

  // VaR / CVaR: Monte Carlo simulation (log-normal, 1-day horizon, 5000 paths)
  // Seeded manually to prevent recalculating on every live price tick.
  // varSeed is bumped by the "重算" button OR whenever legs/spot/sigma change.
  const [varSeed, setVarSeed] = useState(0);

  const varCvar = useMemo(() => {
    if (legs.length === 0) return null;
    const baseS = livePriceRef.current ?? spot;
    const N = 5000;
    const T1 = hoursToYears(24);
    const sig = sigma;
    // Seeded LCG PRNG to avoid non-determinism across renders while still giving fresh numbers per seed
    let rngState = (varSeed * 1664525 + 1013904223 + legs.length * 6364136 + Math.round(sig * 1000)) >>> 0;
    function lcgRand() {
      rngState = (rngState * 1664525 + 1013904223) >>> 0;
      return rngState / 0x100000000;
    }
    const pls: number[] = new Array(N);
    const base0 = positionPL(baseS, 0, 0);
    for (let i = 0; i < N; i++) {
      const u1 = lcgRand() + 1e-15, u2 = lcgRand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const S1 = baseS * Math.exp((-sig * sig / 2) * T1 + sig * Math.sqrt(T1) * z);
      pls[i] = positionPL(S1, 24, 0) - base0;
    }
    pls.sort((a, b) => a - b);
    const var95 = pls[Math.floor(N * 0.05)];
    const var99 = pls[Math.floor(N * 0.01)];
    const cvar95 = pls.slice(0, Math.floor(N * 0.05)).reduce((s, v) => s + v, 0) / Math.floor(N * 0.05);
    const cvar99 = pls.slice(0, Math.floor(N * 0.01)).reduce((s, v) => s + v, 0) / Math.floor(N * 0.01);
    // Build P/L histogram (30 bins) for distribution chart
    const HIST_N = 30;
    const hMin = pls[0], hMax = pls[N - 1];
    const hWidth = (hMax - hMin) / HIST_N || 1;
    const histCounts = new Array(HIST_N).fill(0) as number[];
    for (const v of pls) {
      const bi = Math.min(HIST_N - 1, Math.floor((v - hMin) / hWidth));
      histCounts[bi]++;
    }
    const histEdges = Array.from({ length: HIST_N }, (_, i) => hMin + i * hWidth);
    return { var95, var99, cvar95, cvar99, baseS, histEdges, histCounts, hWidth };
  }, [legs.length, spot, sigma, varSeed, positionPL]);
  // Auto-bump seed when legs or spot change (but NOT on live price ticks)
  const prevLegsKey = useRef('');
  useEffect(() => {
    const key = legs.map(l => `${l.id}:${l.qty}:${l.K}:${l.hoursToExpiry}`).join('|') + `|${spot}|${sigma.toFixed(4)}`;
    if (key !== prevLegsKey.current) { prevLegsKey.current = key; setVarSeed(s => s + 1); }
  }, [legs, spot, sigma]);

  // Probability of Profit at expiry — analytical log-normal integration over chartXs
  const probOfProfit = useMemo(() => {
    if (legs.length === 0 || maxHours <= 0) return null;
    const T = hoursToYears(maxHours);
    const S0 = spot;
    const sig = sigma;
    if (T <= 0 || sig <= 0) return null;
    const sqrtT = Math.sqrt(T);
    let prob = 0;
    const n = chartXs.length;
    for (let i = 0; i < n; i++) {
      if (expiryPL[i] <= 0) continue;
      const S = chartXs[i];
      // Log-normal PDF (risk-neutral, r=0): f(S) = 1/(S·σ·√T·√2π) · exp(-½·z²)
      // where z = (ln(S/S0) + σ²T/2) / (σ√T)
      const z = (Math.log(S / S0) + (sig * sig / 2) * T) / (sig * sqrtT);
      const pdf = Math.exp(-0.5 * z * z) / (S * sig * sqrtT * Math.sqrt(2 * Math.PI));
      const dS = i < n - 1 ? chartXs[i + 1] - S : S - chartXs[i - 1];
      prob += pdf * dS;
    }
    return Math.min(0.999, Math.max(0.001, prob));
  }, [legs.length, chartXs, expiryPL, spot, sigma, maxHours]);

  // Greeks sensitivity ladder: P/L, Δ, Γ at ±15% spot levels
  const greeksLadder = useMemo(() => {
    if (legs.length === 0) return null;
    return LADDER_OFFSETS.map(pct => {
      const S = spot * (1 + pct / 100);
      const g = positionGreeks(S, hoursForward, ivAdjust);
      const p = positionPL(S, hoursForward, ivAdjust);
      return { pct, S, pl: p, delta: g.delta, gamma: g.gamma, theta: g.theta };
    });
  }, [legs.length, spot, hoursForward, ivAdjust, positionGreeks, positionPL]);

  // IV skew / term structure data from fetched leg IVs
  // Skew: legs with the same (approx) expiry grouped by strike
  // Term structure: ATM IV per expiry
  const ivSkewData = useMemo(() => {
    const withIv = legs.filter(l => l.legIv !== undefined && l.expiryTs !== undefined);
    if (withIv.length < 2) return null;
    // Group by expiry; within each expiry collect strike→IV points
    const byExpiry = new Map<number, { strike: number; iv: number; type: string }[]>();
    for (const leg of withIv) {
      if (!byExpiry.has(leg.expiryTs!)) byExpiry.set(leg.expiryTs!, []);
      byExpiry.get(leg.expiryTs!)!.push({ strike: leg.K, iv: leg.legIv! * 100, type: leg.type });
    }
    // For each expiry, sort by strike
    const expiries = Array.from(byExpiry.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, pts]) => ({
        ts,
        label: expiryGroups.find(g => g.ts === ts)?.displayLabel ?? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        points: pts.sort((a, b) => a.strike - b.strike),
      }));
    // Term structure: use ATM-ish IV for each expiry (closest strike to spot)
    const termStructure = expiries.map(e => {
      const atm = e.points.reduce((best, p) =>
        Math.abs(p.strike - spot) < Math.abs(best.strike - spot) ? p : best
      );
      return { label: e.label, iv: atm.iv };
    });
    return { expiries, termStructure };
  }, [legs, spot, expiryGroups]);

  // P&L attribution: decompose scenario P&L into Greek contributions
  const plAttribution = useMemo(() => {
    if (legs.length === 0) return null;
    const grkEntry = positionGreeks(spot, 0, 0);
    const dS = currentS - spot;
    const dT = hoursForward / 24;          // days elapsed
    const dSigma = ivAdjust * 100;         // IV change in percentage points
    const plDelta  = grkEntry.delta * dS;
    const plGamma  = 0.5 * grkEntry.gamma * dS * dS;
    const plTheta  = grkEntry.theta * dT;
    const plVega   = grkEntry.vega * dSigma;
    const plTotal  = pl;
    const plResidual = plTotal - plDelta - plGamma - plTheta - plVega;
    return { plDelta, plGamma, plTheta, plVega, plResidual, plTotal };
  }, [legs.length, spot, currentS, hoursForward, ivAdjust, pl, positionGreeks]);

  // ── Strategy auto-detection ───────────────────────────────────────────────
  const strategyName = useMemo(() => {
    if (legs.length === 0) return null;
    const lc = legs.filter(l => l.side ===  1 && l.type === 'call');
    const sc = legs.filter(l => l.side === -1 && l.type === 'call');
    const lp = legs.filter(l => l.side ===  1 && l.type === 'put');
    const sp = legs.filter(l => l.side === -1 && l.type === 'put');
    const sameExp = (a: Leg, b: Leg) => Math.abs(a.hoursToExpiry - b.hoursToExpiry) < 12;
    if (legs.length === 1) {
      const l = legs[0];
      if (l.side ===  1 && l.type === 'call') return 'Long Call';
      if (l.side ===  1 && l.type === 'put')  return 'Long Put';
      if (l.side === -1 && l.type === 'call') return 'Short Call';
      return 'Short Put';
    }
    if (legs.length === 2) {
      if (lc.length === 1 && lp.length === 1 && sameExp(lc[0], lp[0]))
        return lc[0].K === lp[0].K ? 'Long Straddle' : 'Long Strangle';
      if (sc.length === 1 && sp.length === 1 && sameExp(sc[0], sp[0]))
        return sc[0].K === sp[0].K ? 'Short Straddle' : 'Short Strangle';
      if (lc.length === 1 && sc.length === 1 && sameExp(lc[0], sc[0]))
        return lc[0].K < sc[0].K ? 'Bull Call Spread' : 'Bear Call Spread';
      if (lp.length === 1 && sp.length === 1 && sameExp(lp[0], sp[0]))
        return lp[0].K < sp[0].K ? 'Bull Put Spread' : 'Bear Put Spread';
      if (legs[0].K === legs[1].K && legs[0].type === legs[1].type && legs[0].side !== legs[1].side)
        return 'Calendar Spread';
    }
    if (legs.length === 3 && legs.every(l => l.type === legs[0].type))
      return legs[0].type === 'call' ? 'Call Butterfly' : 'Put Butterfly';
    if (legs.length === 4) {
      if (sp.length === 1 && lp.length === 1 && sc.length === 1 && lc.length === 1) {
        if (lp[0].K < sp[0].K && sc[0].K < lc[0].K) return 'Iron Condor';
        if (lp[0].K === sc[0].K && sp[0].K === lc[0].K) return 'Iron Butterfly';
      }
      if (legs.every(l => l.type === 'call') && lc.length === 2 && sc.length === 2) return 'Call Condor';
      if (legs.every(l => l.type === 'put')  && lp.length === 2 && sp.length === 2) return 'Put Condor';
    }
    return `${legs.length}腿自定义`;
  }, [legs]);

  // ── Dollar Greeks: scale to USD notional ─────────────────────────────────
  const dollarGreeks = useMemo(() => ({
    dollarDelta: grk.delta * currentS,                       // USDT directional exposure
    dollarGamma: grk.gamma * currentS * currentS / 100,      // USDT P/L for 1% spot move (2nd order)
  }), [grk, currentS]);

  // ── Per-leg Greeks breakdown table ────────────────────────────────────────
  const legGreeksTable = useMemo(() => {
    if (legs.length === 0) return null;
    return legs.map((leg, i) => {
      const remH = Math.max(0, leg.hoursToExpiry - hoursForward);
      const T    = hoursToYears(remH);
      const sig  = Math.max(0.01, (leg.legIv ?? baseIv) + ivAdjust);
      const g    = bsGreeks(currentS, leg.K, T, sig, leg.type);
      const sc   = leg.side * leg.qty;
      return {
        label:       `#${i + 1} ${leg.side === 1 ? 'L' : 'S'} ${leg.type[0].toUpperCase()} ${leg.K.toLocaleString()}`,
        delta:       sc * g.delta,
        dollarDelta: sc * g.delta * currentS,
        gamma:       sc * g.gamma,
        theta:       sc * g.theta,
        vega:        sc * g.vega,
      };
    });
  }, [legs, currentS, hoursForward, ivAdjust, baseIv]);

  // ── IV Rank: current IV percentile within user-supplied historical range ──
  const ivRankPct = useMemo(() => {
    const range = ivRankHigh - ivRankLow;
    if (range <= 0) return null;
    return Math.min(100, Math.max(0, (baseIv * 100 - ivRankLow) / range * 100));
  }, [baseIv, ivRankLow, ivRankHigh]);

  // ── Greeks Heatmap: 2D grid across HEATMAP_SPOT × HEATMAP_IV ─────────────
  const greeksHeatmapData = useMemo(() => {
    if (legs.length === 0) return null;
    return HEATMAP_IV.map(ivOff =>
      HEATMAP_SPOT.map(spotOff => {
        const S = spot * (1 + spotOff / 100);
        const g = positionGreeks(S, 0, ivOff);
        return heatmapMetric === 'delta' ? g.delta
             : heatmapMetric === 'gamma' ? g.gamma
             : g.vega;
      })
    );
  }, [legs.length, spot, heatmapMetric, positionGreeks]);

  // ── Jump-diffusion VaR (Merton: GBM + Poisson jumps) ─────────────────────
  const jumpVaR = useMemo(() => {
    if (!showJumpRisk || legs.length === 0) return null;
    const baseS = livePrice ?? spot;
    const N   = 5000;
    const T1  = hoursToYears(24);
    const sig = sigma;
    const lam = jumpLambda * T1;       // expected jumps in 1 day
    const muJ = jumpMuPct  / 100;
    const sjJ = jumpSigPct / 100;
    let rng = ((varSeed + 7919) * 1664525 + 1013904223 + Math.round(sig * 999)) >>> 0;
    const rand  = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0x100000000; };
    const randn = () => { const u1 = rand() + 1e-15, u2 = rand(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
    const base0 = positionPL(baseS, 0, 0);
    const pls: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const nj   = rand() < lam ? 1 : 0;  // Bernoulli approx (valid for small lam)
      const logJ = nj > 0 ? muJ + sjJ * randn() : 0;
      const S1   = baseS * Math.exp((-sig * sig / 2) * T1 + sig * Math.sqrt(T1) * randn() + logJ);
      pls[i] = positionPL(S1, 24, 0) - base0;
    }
    pls.sort((a, b) => a - b);
    return {
      var95:  pls[Math.floor(N * 0.05)],
      var99:  pls[Math.floor(N * 0.01)],
      cvar95: pls.slice(0, Math.floor(N * 0.05)).reduce((s, v) => s + v, 0) / Math.floor(N * 0.05),
      cvar99: pls.slice(0, Math.floor(N * 0.01)).reduce((s, v) => s + v, 0) / Math.floor(N * 0.01),
    };
  }, [showJumpRisk, legs.length, spot, sigma, varSeed, jumpLambda, jumpMuPct, jumpSigPct, livePrice, positionPL]);
  // ─────────────────────────────────────────────────────────────────────────

  // Entry friction: half-spread × qty per leg (cost vs mid-market to enter)
  const totalSlippage = useMemo(
    () => legs.reduce((s, l) =>
      l.bid !== undefined && l.ask !== undefined
        ? s + (l.ask - l.bid) / 2 * l.qty
        : s,
      0),
    [legs],
  );

  // 2-D scenario matrix: rows = IV offsets, cols = spot offsets
  const scenarioMatrix = useMemo(() => {
    if (legs.length === 0) return null;
    return IV_OFFSETS.map(ivOff =>
      SPOT_OFFSETS.map(spotOff => positionPL(spot * (1 + spotOff / 100), 0, ivOff))
    );
  }, [legs.length, spot, positionPL]);

  const matrixAbsMax = useMemo(() => {
    if (!scenarioMatrix) return 1;
    return Math.max(1, ...scenarioMatrix.flat().map(Math.abs));
  }, [scenarioMatrix]);

  // ── ECharts: P/L chart option ─────────────────────────────────────────────
  const axisStyle = {
    axisLine:  { lineStyle: { color: '#2A2F37' } },
    splitLine: { lineStyle: { color: '#1E232A' } },
    axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
    nameTextStyle: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  };

  const plOption = useMemo(() => {
    if (legs.length === 0) return {};
    // Build unique strike markLines (call=blue, put=yellow)
    const strikeMLines: any[] = [];
    const seen = new Set<string>();
    legs.forEach(l => {
      const k = `${l.K}-${l.type}`;
      if (seen.has(k)) return; seen.add(k);
      strikeMLines.push({ xAxis: l.K, lineStyle: { color: l.type === 'call' ? 'rgba(247,166,0,0.35)' : 'rgba(251,191,36,0.35)', width: 1, type: 'solid' as const }, label: { show: false } });
    });

    const tooltipFmt = (params: any[]) => {
      if (!Array.isArray(params)) return '';
      const visible = params.filter(p => !String(p.seriesName).startsWith('_'));
      const x = params[0]?.axisValue ?? params[0]?.value?.[0];
      let html = `<div style="color:rgba(255,255,255,0.4);font-size:10px;margin-bottom:3px">${symbol} ${Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>`;
      visible.forEach(p => {
        const y = Array.isArray(p.value) ? p.value[1] : p.data?.[1];
        if (y == null) return;
        const sign = Number(y) >= 0 ? '+' : '';
        const col  = Number(y) >= 0 ? '#28C840' : '#FF5F57';
        html += `<div style="display:flex;justify-content:space-between;gap:14px;line-height:1.6">
          <span style="color:${p.color}">${p.seriesName}</span>
          <span style="font-family:monospace;color:${col}">${sign}${Number(y).toFixed(2)}</span></div>`;
      });
      return html;
    };

    return {
      backgroundColor: 'transparent', animation: false,
      grid: { left: 58, right: 16, top: 8, bottom: 38 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed' }, crossStyle: { color: 'rgba(255,255,255,0.18)' }, label: { backgroundColor: '#17181E', color: '#ECEEF1', fontSize: 10 } },
        backgroundColor: 'rgba(11,15,23,0.92)', borderColor: 'rgba(255,255,255,0.1)',
        padding: [6, 10], textStyle: { color: '#ECEEF1', fontSize: 11 }, formatter: tooltipFmt,
      },
      xAxis: { type: 'value' as const, name: `${symbol} 价格`, nameLocation: 'middle' as const, nameGap: 26, min: chartXs[0], max: chartXs[chartXs.length - 1], ...axisStyle },
      yAxis: { type: 'value' as const, name: 'P/L (USDT)', nameLocation: 'middle' as const, nameGap: 44, ...axisStyle },
      series: [
        // 0-1: area fill (silent, hidden from legend/tooltip)
        { name: '_pos', type: 'line' as const, data: chartXs.map((x, i) => [x, Math.max(0, expiryPL[i])]), lineStyle: { width: 0, color: 'transparent' }, symbol: 'none', areaStyle: { color: 'rgba(52,211,153,0.10)', origin: 0 }, silent: true, legendHoverLink: false },
        { name: '_neg', type: 'line' as const, data: chartXs.map((x, i) => [x, Math.min(0, expiryPL[i])]), lineStyle: { width: 0, color: 'transparent' }, symbol: 'none', areaStyle: { color: 'rgba(248,113,113,0.10)', origin: 0 }, silent: true, legendHoverLink: false },
        // 2: Expiry P/L (carries all markLines)
        {
          name: '到期 P/L', type: 'line' as const,
          data: chartXs.map((x, i) => [x, expiryPL[i]]),
          lineStyle: { color: 'rgba(180,180,180,0.65)', type: 'dashed' as const, width: 1.5 }, symbol: 'none',
          markLine: { silent: true, symbol: ['none', 'none'], data: [
            { xAxis: spot, lineStyle: { color: '#8a8a8a', type: 'dotted' as const, width: 1 }, label: { show: false } },
            ...strikeMLines,
          ]},
        },
        // 3: Current P/L
        { name: '当前 P/L', type: 'line' as const, data: chartXs.map((x, i) => [x, currentPL[i]]), lineStyle: { color: '#ff9c2e', width: 2.5 }, symbol: 'none' },
        // 4: Breakevens
        { name: '盈亏平衡', type: 'scatter' as const, data: breakevens.map(b => [b, 0]), symbol: 'diamond', symbolSize: 10, itemStyle: { color: '#28C840', borderColor: '#16191E', borderWidth: 1.5 } },
        // 5: Scenario marker
        { name: '情景点', type: 'scatter' as const, data: [[currentS, pl]], symbol: 'circle', symbolSize: 12, itemStyle: { color: '#FEBC2E', borderColor: '#ffffff', borderWidth: 2 } },
        // 6: Live price marker
        { name: '实时', type: 'scatter' as const, data: livePrice !== null ? [[livePrice, positionPL(livePrice, 0, 0)]] : [], symbol: 'emptyCircle', symbolSize: 10, itemStyle: { borderColor: '#ffffff', borderWidth: 2, color: 'transparent' } },
        // 7-9: Time slices (always present, empty when off)
        { name: `T+${formatHours(maxHours * 0.25)}`, type: 'line' as const, data: showTimeSlices && timePL_25.length ? chartXs.map((x, i) => [x, timePL_25[i]]) : [], lineStyle: { color: 'rgba(255,255,255,0.55)', width: 1.5, type: 'dotted' as const }, symbol: 'none' },
        { name: `T+${formatHours(maxHours * 0.50)}`, type: 'line' as const, data: showTimeSlices && timePL_50.length ? chartXs.map((x, i) => [x, timePL_50[i]]) : [], lineStyle: { color: 'rgba(255,255,255,0.38)', width: 1.5, type: 'dotted' as const }, symbol: 'none' },
        { name: `T+${formatHours(maxHours * 0.75)}`, type: 'line' as const, data: showTimeSlices && timePL_75.length ? chartXs.map((x, i) => [x, timePL_75[i]]) : [], lineStyle: { color: 'rgba(255,255,255,0.22)', width: 1.5, type: 'dotted' as const }, symbol: 'none' },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, chartXs, expiryPL, currentPL, breakevens, currentS, pl, livePrice, symbol, spot, showTimeSlices, timePL_25, timePL_50, timePL_75, maxHours, baseIv, hoursForward, ivAdjust]);

  // ── ECharts: Delta / Gamma chart option ───────────────────────────────────
  const dgOption = useMemo(() => {
    if (legs.length === 0) return {};
    const tooltipFmt2 = (params: any[]) => {
      if (!Array.isArray(params)) return '';
      const x = params[0]?.axisValue ?? params[0]?.value?.[0];
      let html = `<div style="color:rgba(255,255,255,0.4);font-size:10px;margin-bottom:3px">${symbol} ${Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>`;
      params.forEach(p => {
        const y = Array.isArray(p.value) ? p.value[1] : null;
        if (y == null) return;
        const fmt = p.seriesName === 'Delta' ? y.toFixed(3) : y.toFixed(5);
        html += `<div style="display:flex;justify-content:space-between;gap:14px;line-height:1.6"><span style="color:${p.color}">${p.seriesName}</span><span style="font-family:monospace;color:rgba(255,255,255,0.7)">${fmt}</span></div>`;
      });
      return html;
    };
    return {
      backgroundColor: 'transparent', animation: false,
      grid: { left: 55, right: 55, top: 6, bottom: 38 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross', lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed' }, crossStyle: { color: 'rgba(255,255,255,0.18)' }, label: { backgroundColor: '#17181E', color: '#ECEEF1', fontSize: 10 } },
        backgroundColor: 'rgba(11,15,23,0.92)', borderColor: 'rgba(255,255,255,0.1)',
        padding: [6, 10], textStyle: { color: '#ECEEF1', fontSize: 11 }, formatter: tooltipFmt2,
      },
      legend: { show: false },
      xAxis: { type: 'value' as const, name: `${symbol} 价格`, nameLocation: 'middle' as const, nameGap: 26, min: chartXs[0], max: chartXs[chartXs.length - 1], ...axisStyle },
      yAxis: [
        { type: 'value' as const, name: 'Delta', nameLocation: 'middle' as const, nameGap: 40, position: 'left' as const, ...axisStyle },
        { type: 'value' as const, name: 'Gamma', nameLocation: 'middle' as const, nameGap: 44, position: 'right' as const, splitLine: { show: false }, axisLine: { lineStyle: { color: '#2e2e2e' } }, axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 10 }, nameTextStyle: { color: 'rgba(167,139,250,0.6)', fontSize: 10 } },
      ],
      series: [
        { name: 'Delta', type: 'line' as const, yAxisIndex: 0, data: chartXs.map((x, i) => [x, deltaProfile[i]]), lineStyle: { color: '#ff9c2e', width: 2 }, symbol: 'none',
          markLine: { silent: true, symbol: ['none', 'none'], data: [
            { yAxis: 0, lineStyle: { color: '#2e2e2e', width: 1 }, label: { show: false } },
            { xAxis: spot, lineStyle: { color: '#8a8a8a', type: 'dotted' as const, width: 1 }, label: { show: false } },
          ]}
        },
        { name: 'Gamma', type: 'line' as const, yAxisIndex: 1, data: chartXs.map((x, i) => [x, gammaProfile[i]]), lineStyle: { color: '#a78bfa', width: 2, type: 'dotted' as const }, symbol: 'none' },
        { name: '情景Δ', type: 'scatter' as const, yAxisIndex: 0, data: [[currentS, grk.delta]], symbol: 'circle',  symbolSize: 9, itemStyle: { color: '#ff9c2e', borderColor: '#fff', borderWidth: 2 } },
        { name: '情景Γ', type: 'scatter' as const, yAxisIndex: 1, data: [[currentS, grk.gamma]], symbol: 'diamond', symbolSize: 9, itemStyle: { color: '#a78bfa', borderColor: '#fff', borderWidth: 2 } },
      ],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, chartXs, deltaProfile, gammaProfile, symbol, spot, currentS, grk, baseIv, hoursForward, ivAdjust]);

  // ── Connect the two charts for synchronized crosshair ─────────────────────
  useEffect(() => {
    if (activeTab !== 'chart') return;
    const id = setTimeout(() => {
      const pl = plChartRef.current?.getEchartsInstance();
      const dg = dgChartRef.current?.getEchartsInstance();
      if (!pl || !dg) return;
      pl.group = 'posBuilder';
      dg.group = 'posBuilder';
      echarts.connect('posBuilder');
    }, 200);
    return () => clearTimeout(id);
  }, [activeTab]);
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="position-builder-page absolute inset-0 flex flex-col font-medium">
      <header className="glass-nav px-4 py-3 flex items-center gap-4 sticky top-0 z-10" style={{ background: 'var(--color-surface-3)' }}>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[17px] font-semibold text-white/90 tracking-[-0.01em]">头寸压力测试</span>
          <span className="text-[12px] text-white/55 uppercase tracking-[0.08em]">U 本位 · 策略训练沙盒</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-white/55 uppercase tracking-[0.06em]">{symbol} 指数</span>
          {livePrice !== null ? (
            <>
              <span className={cn(
                'font-mono tnum text-[15px] font-semibold transition-colors duration-150',
                priceDir === 'up' ? 'price-flash-up' : priceDir === 'down' ? 'price-flash-down' : 'text-white/80',
              )}>
                {livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={cn(
                'text-[12px] transition-opacity duration-150',
                priceDir === 'up' ? 'text-[var(--nexus-green)]' : priceDir === 'down' ? 'text-[var(--nexus-red)]' : 'opacity-0',
              )}>
                {priceDir === 'up' ? '▲' : '▼'}
              </span>
              <button
                onClick={() => { setSpot(livePrice); setLegs(prev => prev.map(l => repriceEntry(l))); }}
                className="px-2 py-0.5 rounded-[6px] bg-[#2B2D35] text-[11px] text-white/55 hover:text-white/70 hover:bg-[#3A3B40] transition-colors"
              >
                用实时价
              </button>
            </>
          ) : (
            <span className="text-[13px] text-white/55 animate-pulse">连接中…</span>
          )}
        </div>

        {livePL !== null && (
          <div className="flex items-center gap-2 shrink-0 pl-3 border-l border-white/[0.06]">
            <span className="text-[11px] text-white/55 uppercase tracking-[0.06em]">实时盯市</span>
            <span className={cn(
              'font-mono tnum text-[15px] font-semibold',
              livePL > 0 ? 'text-[var(--nexus-green)]' : livePL < 0 ? 'text-[var(--nexus-red)]' : 'text-white/55',
            )}>
              {livePL >= 0 ? '+' : ''}{livePL.toFixed(2)}
            </span>
            <span className="text-[11px] text-white/55">USDT</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-[12px] text-white/65 uppercase tracking-[0.06em]">标的</span>
          <select value={symbol} onChange={e => changeSymbol(e.target.value)} className={cn(SELECT_CLS, '!w-24')}>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="SOL">SOL</option>
          </select>
        </div>

      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="px-2 pb-2">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-4 h-[750px]">
              <Panel title="策略组合" subtitle="期权腿组合"
                actions={legs.some(l => l.instrumentName) ? (
                  <button onClick={refreshAllTickers}
                    className="flex items-center gap-1 px-2 py-1 rounded-[7px] bg-[#2B2D35] text-[11px] text-white/55 hover:text-white/70 hover:bg-[#3A3B40] transition-colors">
                    ↺ 刷新全部
                  </button>
                ) : undefined}
              >
                <div className="flex flex-col gap-3 pt-1">
                  {/* ── 基准参数 ───────────────────────────────────────────── */}
                  <div className="bg-[var(--color-surface-2)] rounded-lg p-2.5 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-white/65 uppercase tracking-[0.06em] w-14 shrink-0" title="情景分析的坐标原点。点「用实时价」可同步到当前市场指数价。">基准价</span>
                      <input
                        type="number"
                        value={spot}
                        onChange={e => { const v = parseFloat(e.target.value); if (v > 0) { setSpot(v); setLegs(prev => prev.map(l => repriceEntry(l))); } }}
                        className={cn(INPUT_CLS, 'flex-1')}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-white/65 uppercase tracking-[0.06em] w-14 shrink-0">基础 IV</span>
                      <input
                        type="number"
                        value={(baseIv * 100).toFixed(0)}
                        onChange={e => { const v = parseFloat(e.target.value); if (v > 0) { setBaseIv(v / 100); setLegs(prev => prev.map(l => repriceEntry(l))); } }}
                        className={cn(INPUT_CLS, 'flex-1')}
                      />
                      <span className="text-[12px] text-white/65 shrink-0">%</span>
                    </div>
                  </div>
                  {/* ── 模板 + 清空 ─────────────────────────────────────────── */}
                  <div className="flex items-center gap-2">
                    <select onChange={e => { if (e.target.value) { applyTemplate(e.target.value); e.target.value = ''; } }}
                      className={cn(SELECT_CLS, 'flex-1 text-xs')}>
                      <option value="">— 选择模板 —</option>
                      <option value="longCall">单腿看涨</option>
                      <option value="longPut">单腿看跌</option>
                      <option value="coveredCall">备兑看涨</option>
                      <option value="bullCallSpread">牛市价差</option>
                      <option value="bearPutSpread">熊市价差</option>
                      <option value="longStraddle">买入跨式</option>
                      <option value="shortStrangle">卖出宽跨</option>
                      <option value="ironCondor">铁鹰</option>
                      <option value="calendar">日历价差</option>
                    </select>
                    <button onClick={clearAll}
                      className="px-3 py-1.5 rounded-[8px] bg-[var(--nexus-red)]/10 text-[var(--nexus-red)] hover:bg-[var(--nexus-red)]/20 text-[13px] font-semibold transition-colors shrink-0">
                      清空
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    {legs.length === 0 ? (
                      <div className="py-6 text-center text-[13px] text-white/55 italic">
                        还没有腿。点 "+ 添加一腿" 或选择上方模板。
                      </div>
                    ) : legs.map((leg, idx) => {
                      const remH = Math.max(0, leg.hoursToExpiry - hoursForward);
                      const T = hoursToYears(remH);
                      const legSig = Math.max(0.01, (leg.legIv ?? baseIv) + ivAdjust);
                      const g = bsGreeks(currentS, leg.K, T, legSig, leg.type);
                      const d = leg.side * leg.qty * g.delta;
                      const gm = leg.side * leg.qty * g.gamma;
                      const th = leg.side * leg.qty * g.theta;
                      const v = leg.side * leg.qty * g.vega;

                      // Available strikes for this leg's selected expiry
                      const selGroup = expiryGroups.find(eg => eg.ts === leg.expiryTs);
                      const availStrikes = selGroup?.strikes ?? [];

                      return (
                        <div key={leg.id} className="bg-[var(--color-surface-2)] rounded-xl p-3">
                          {/* Header row */}
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] text-white/55">#{idx + 1}</span>
                              <span className={cn('text-[12px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
                                leg.side === 1 ? 'bg-[var(--nexus-green)]/15 text-[var(--nexus-green)]' : 'bg-[var(--nexus-red)]/15 text-[var(--nexus-red)]')}>
                                {leg.side === 1 ? '买入' : '卖出'}
                              </span>
                              <span className={cn('text-[12px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
                                leg.type === 'call' ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]' : 'bg-[var(--nexus-yellow)]/15 text-[var(--nexus-yellow)]')}>
                                {leg.type === 'call' ? 'Call' : 'Put'}
                              </span>
                              {leg.legIv !== undefined && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/55 font-mono">
                                  IV {(leg.legIv * 100).toFixed(1)}%
                                </span>
                              )}
                              {leg.fetchingTicker && (
                                <span className="text-[11px] text-white/55 animate-pulse">拉取中…</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {leg.instrumentName && (
                                <button
                                  onClick={() => fetchTicker(leg.id, leg.instrumentName!)}
                                  disabled={!!leg.fetchingTicker}
                                  className="w-6 h-6 flex items-center justify-center rounded-[6px] text-white/55 hover:text-white/60 hover:bg-white/[0.06] transition-colors text-[13px] disabled:opacity-30"
                                  title="刷新市价"
                                >
                                  ↺
                                </button>
                              )}
                              <button onClick={() => removeLeg(leg.id)}
                                className="w-6 h-6 flex items-center justify-center rounded-[6px] text-white/55 hover:text-[var(--nexus-red)] hover:bg-[var(--nexus-red)]/15 transition-colors text-[14px]">
                                ×
                              </button>
                            </div>
                          </div>

                          {/* Controls grid */}
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            {/* 方向 */}
                            <div>
                              <label className="text-[10px] uppercase tracking-[0.06em] text-white/55 block mb-1">方向</label>
                              <select value={leg.side}
                                onChange={e => updateLeg(leg.id, { side: parseInt(e.target.value) as 1 | -1 })}
                                className={SELECT_CLS}>
                                <option value="1">买入 (Long)</option>
                                <option value="-1">卖出 (Short)</option>
                              </select>
                            </div>
                            {/* 类型 */}
                            <div>
                              <label className="text-[10px] uppercase tracking-[0.06em] text-white/55 block mb-1">类型</label>
                              <select value={leg.type}
                                onChange={e => {
                                  const type = e.target.value as 'call' | 'put';
                                  updateLeg(leg.id, { type, instrumentName: undefined, legIv: undefined });
                                  clearDeferred();
                                  defer(() => resolveInstrument(leg.id, { ...leg, type }), 0);
                                }}
                                className={SELECT_CLS}>
                                <option value="call">看涨 Call</option>
                                <option value="put">看跌 Put</option>
                              </select>
                            </div>
                            {/* 到期日 */}
                            <div className="col-span-2">
                              <label className="text-[10px] uppercase tracking-[0.06em] text-white/55 block mb-1">
                                到期日 {instrumentsLoading && <span className="text-white/55 normal-case">（加载中…）</span>}
                              </label>
                              <select
                                value={leg.expiryTs ?? ''}
                                onChange={e => {
                                  const ts = parseInt(e.target.value);
                                  // Auto-snap to ATM strike for this expiry
                                  const group = expiryGroups.find(g => g.ts === ts);
                                  const atmK = group?.strikes.reduce((best, s) =>
                                    Math.abs(s - spot) < Math.abs(best - spot) ? s : best,
                                    group.strikes[0] ?? leg.K
                                  ) ?? leg.K;
                                  updateLeg(leg.id, { expiryTs: ts, K: atmK });
                                  clearDeferred();
                                  defer(() => resolveInstrument(leg.id, { ...leg, expiryTs: ts, K: atmK }), 0);
                                }}
                                className={SELECT_CLS}
                              >
                                <option value="">— 选择到期日 —</option>
                                {expiryGroups.map(eg => (
                                  <option key={eg.ts} value={eg.ts}>{eg.displayLabel}</option>
                                ))}
                              </select>
                            </div>
                            {/* 行权价 */}
                            <div>
                              <label className="text-[10px] uppercase tracking-[0.06em] text-white/55 block mb-1">行权价</label>
                              {availStrikes.length > 0 ? (
                                <select
                                  value={leg.K}
                                  onChange={e => {
                                    const K = parseFloat(e.target.value);
                                    updateLeg(leg.id, { K, instrumentName: undefined, legIv: undefined });
                                    clearDeferred();
                                    defer(() => resolveInstrument(leg.id, { ...leg, K }), 0);
                                  }}
                                  className={SELECT_CLS}
                                >
                                  {availStrikes.map(k => {
                                    const pct = ((k - spot) / spot * 100);
                                    const tag = Math.abs(pct) < 0.5
                                      ? ' · ATM'
                                      : ` · ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
                                    return (
                                      <option key={k} value={k}>
                                        {k.toLocaleString()}{tag}
                                      </option>
                                    );
                                  })}
                                </select>
                              ) : (
                                <input type="number" step="any" value={leg.K}
                                  onChange={e => updateLeg(leg.id, { K: parseFloat(e.target.value) })}
                                  className={INPUT_CLS} />
                              )}
                            </div>
                            {/* 数量 */}
                            <div>
                              <label className="text-[10px] uppercase tracking-[0.06em] text-white/55 block mb-1">数量</label>
                              <input type="number" step="0.1" min="0.1" value={leg.qty}
                                onChange={e => updateLeg(leg.id, { qty: parseFloat(e.target.value) })}
                                className={INPUT_CLS} />
                            </div>
                            {/* 入场权利金 */}
                            <div className="col-span-2 flex items-center justify-between pt-1">
                              <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">
                                入场权利金 {leg.instrumentName ? '· 市价' : '· BS 估算'}
                              </span>
                              <span className="text-[14px] font-mono tnum text-white/80">
                                {leg.entryPremium.toFixed(2)} USDT
                              </span>
                            </div>
                            {/* 买一 / 卖一 / 点差 */}
                            {leg.bid !== undefined && leg.ask !== undefined && (
                              <div className="col-span-2 flex items-center justify-between bg-[var(--color-surface-2)] rounded-[6px] px-2 py-1">
                                <span className="text-[10px] uppercase tracking-[0.06em] text-white/55">买一 / 卖一</span>
                                <span className="text-[11px] font-mono tnum">
                                  <span className="text-[var(--nexus-green)]/70">{leg.bid.toFixed(2)}</span>
                                  <span className="text-white/55"> / </span>
                                  <span className="text-[var(--nexus-red)]/70">{leg.ask.toFixed(2)}</span>
                                  <span className="ml-2 text-white/65">
                                    点差 {(leg.ask - leg.bid).toFixed(2)}
                                    <span className="ml-1 text-white/55">
                                      ({leg.entryPremium > 0 ? ((leg.ask - leg.bid) / leg.entryPremium * 50).toFixed(1) : '—'}%)
                                    </span>
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Summary + live P/L */}
                          <div className="text-[12px] text-white/55 mb-1.5">
                            ≈ {formatHours(leg.hoursToExpiry)} · 入场总额 {(leg.side * leg.qty * leg.entryPremium).toFixed(2)}
                          </div>
                          {(() => {
                            const curVal = legCurrentValue(leg, currentS, hoursForward, ivAdjust);
                            const legPlVal = leg.side * leg.qty * (curVal - leg.entryPremium);
                            return (
                              <div className="flex items-center justify-between text-[12px] mb-2">
                                <span className="text-white/55">情景盯市 {curVal.toFixed(2)}</span>
                                <span className={cn('font-mono tnum font-semibold', gClass(legPlVal))}>
                                  {legPlVal >= 0 ? '+' : ''}{legPlVal.toFixed(2)} USDT
                                </span>
                              </div>
                            );
                          })()}
                          {(() => {
                            const legGrk = bsGreeks(currentS, leg.K, T, legSig, leg.type);
                            return (
                              <>
                                <div className="flex gap-3 text-[12px] pt-2 border-t border-white/[0.05]">
                                  <span className="text-white/55">δ</span><span className="font-mono tnum"><span className={gClass(d)}>{d.toFixed(3)}</span></span>
                                  <span className="text-white/55">γ</span><span className="font-mono tnum"><span className={gClass(gm)}>{gm.toFixed(5)}</span></span>
                                  <span className="text-white/55">θ</span><span className="font-mono tnum"><span className={gClass(th)}>{th.toFixed(2)}</span></span>
                                  <span className="text-white/55">ν</span><span className="font-mono tnum"><span className={gClass(v)}>{v.toFixed(2)}</span></span>
                                </div>
                                <div className="flex gap-3 text-[12px] pt-1.5 flex-wrap" title="高阶希腊字母">
                                  {[
                                    { label: 'vanna', val: leg.side * leg.qty * legGrk.vanna, fmt: (v: number) => v.toFixed(4) },
                                    { label: 'volga', val: leg.side * leg.qty * legGrk.volga, fmt: (v: number) => v.toFixed(4) },
                                    { label: 'charm', val: leg.side * leg.qty * legGrk.charm, fmt: (v: number) => v.toFixed(4) },
                                    { label: 'speed', val: leg.side * leg.qty * legGrk.speed, fmt: (v: number) => v.toExponential(2) },
                                  ].map(({ label, val, fmt }) => (
                                    <span key={label} className="flex gap-1">
                                      <span className="text-white/55">{label}</span>
                                      <span className={cn('font-mono tnum text-[11px]', gClass(val))}>{fmt(val)}</span>
                                    </span>
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>

                  <button onClick={() => addLeg()}
                    className="w-full py-2 rounded-lg bg-[#2B2D35] text-[14px] font-semibold text-white/60 hover:bg-[#3A3B40] hover:text-white/80 transition-colors">
                    + 添加一腿
                  </button>

                  <p className="text-[12px] text-white/55 leading-relaxed pt-1 border-t border-white/[0.04]">
                    选择到期日 + 行权价后自动从 Deribit 拉取市价权利金和该合约 IV。每条腿独立使用自己的 IV 定价；IV 偏移滑块在各腿基础上叠加偏移。未选真实合约时用全局 IV + BS 估算。
                  </p>
                </div>
              </Panel>
            </div>

            <div className="col-span-8 flex flex-col gap-2">
              {/* ── Position Summary ─────────────────────────────────────── */}
              {legs.length > 0 && (
                <PositionSummaryStrip
                  strategyName={strategyName}
                  ivRankPct={ivRankPct}
                  probOfProfit={probOfProfit}
                  netPremium={netPremium}
                  maxProfit={maxProfit}
                  maxLoss={maxLoss}
                  grk={grk}
                  currentS={currentS}
                  totalSlippage={totalSlippage}
                />
              )}

              {activeTab === 'chart' && (
                <PLCurvePanel
                  legs={legs}
                  showTimeSlices={showTimeSlices}
                  setShowTimeSlices={setShowTimeSlices}
                  chartRef={plChartRef}
                  option={plOption}
                />
              )}

              {/* ── 始终可见：三滑杆 ──────────────────────────────────── */}
              <ScenarioSliders
                hoursForward={hoursForward}
                setHoursForward={setHoursForward}
                maxHours={maxHours}
                correlatedMode={correlatedMode}
                ivAdjust={ivAdjust}
                setIvAdjust={setIvAdjust}
                spotPctOffset={spotPctOffset}
                setSpotPctOffset={setSpotPctOffset}
              />

              {/* ── Tab 导航 ──────────────────────────────────────────── */}
              <div className="flex gap-1 px-1 pt-1 pb-0">
                {RIGHT_TABS.map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] transition-colors border',
                      activeTab === tab.id
                        ? 'bg-[#3A3F40] border-transparent text-[var(--nexus-accent)]'
                        : 'bg-transparent border-transparent text-white/55 hover:text-white/80 hover:bg-[#3A3B40]',
                    )}>
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {activeTab === 'chart' && (
                <DeltaGammaPanel chartRef={dgChartRef} option={dgOption} />
              )}

              {activeTab === 'scenario' && <Panel title="情景参数"
                actions={
                  <button onClick={resetScenario}
                    className="flex items-center gap-1 px-3 py-1 rounded-[8px] bg-[#2B2D35] text-[12px] text-white/50 hover:bg-[#3A3B40] hover:text-white/70 transition-colors">
                    <span>↺</span> 重置情景
                  </button>
                }>
                  {/* Correlated scenario presets */}
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {SCENARIO_PRESETS.map(p => (
                      <button
                        key={p.label}
                        onClick={() => { setSpotPctOffset(p.spotPct); setIvAdjust(p.ivAdj); }}
                        title={p.desc}
                        className={cn(
                          'px-3 py-1.5 rounded-[8px] border text-[12px] transition-colors',
                          p.historical
                            ? 'bg-[var(--nexus-yellow)]/[0.06] border-[var(--nexus-yellow)]/[0.15] text-[var(--nexus-yellow)]/60 hover:bg-[var(--nexus-yellow)]/[0.12] hover:text-[var(--nexus-yellow)]/80 hover:border-[var(--nexus-yellow)]/[0.25]'
                            : 'bg-[#2B2D35] border-transparent text-white/50 hover:bg-[#3A3B40] hover:text-white/75',
                        )}
                      >
                        {p.historical && <span className="mr-1 text-[10px] text-[var(--nexus-yellow)]/50">历史</span>}
                        {p.label}
                        <span className="ml-1.5 text-[10px] opacity-50">{p.desc}</span>
                      </button>
                    ))}
                  </div>

                  {/* ── Custom scenario save / load ───────────────────────── */}
                  {savedScenarios.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-1">
                      {savedScenarios.map((s, i) => (
                        <div key={i} className="flex items-center gap-0.5">
                          <button
                            onClick={() => { setSpotPctOffset(s.spotPct); setIvAdjust(s.ivAdj); }}
                            title={`spot ${s.spotPct >= 0 ? '+' : ''}${s.spotPct}% / IV ${s.ivAdj >= 0 ? '+' : ''}${(s.ivAdj * 100).toFixed(0)}%`}
                            className="px-2.5 py-1.5 rounded-[8px] bg-[var(--color-brand)]/[0.08] border border-[var(--color-brand)]/[0.20] text-[12px] text-[var(--color-brand)]/70 hover:bg-[var(--color-brand)]/[0.14] hover:text-[var(--color-brand)]/90 transition-colors"
                          >
                            {s.name}
                          </button>
                          <button onClick={() => deleteScenario(i)}
                            className="w-5 h-5 flex items-center justify-center text-[12px] text-white/55 hover:text-[var(--nexus-red)] rounded transition-colors">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      value={scenarioName}
                      onChange={e => setScenarioName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveScenario()}
                      placeholder="命名当前情景后保存…"
                      className={cn(INPUT_CLS, '!w-44 text-[12px]')}
                    />
                    <button
                      onClick={saveScenario}
                      disabled={!scenarioName.trim()}
                      className="px-3 py-1.5 rounded-[8px] bg-[#2B2D35] text-[12px] text-white/50 hover:text-white/70 hover:bg-[#3A3B40] disabled:opacity-30 transition-colors"
                    >
                      保存情景
                    </button>
                  </div>

                  {/* ── IV Rank range settings ──────────────────────────────── */}
                  <div className="flex items-center gap-3 mb-4 text-[12px]">
                    <span className="text-white/65 shrink-0">IV Rank 区间</span>
                    <span className="text-white/55 text-[11px] shrink-0">历史低</span>
                    <input type="number" value={ivRankLow}
                      onChange={e => setIvRankLow(parseFloat(e.target.value) || 0)}
                      className="w-14 bg-[#2B2D35] rounded-[6px] px-2 py-1 text-[12px] text-white/70 outline-none text-center focus:bg-[#3A3B40]" />
                    <span className="text-white/55">–</span>
                    <input type="number" value={ivRankHigh}
                      onChange={e => setIvRankHigh(parseFloat(e.target.value) || 0)}
                      className="w-14 bg-[#2B2D35] rounded-[6px] px-2 py-1 text-[12px] text-white/70 outline-none text-center focus:bg-[#3A3B40]" />
                    <span className="text-white/55 text-[11px]">% (52w 范围)</span>
                    {ivRankPct !== null && (
                      <div className="flex items-center gap-2 ml-2">
                        <div className="w-20 h-[4px] bg-white/[0.08] rounded-full overflow-hidden">
                          <div style={{ width: `${ivRankPct}%`, background: ivRankPct > 70 ? '#FF5F57' : ivRankPct < 30 ? '#28C840' : '#FEBC2E' }} className="h-full rounded-full" />
                        </div>
                        <span className={cn('font-mono tnum', ivRankPct > 70 ? 'text-[var(--nexus-red)]' : ivRankPct < 30 ? 'text-[var(--nexus-green)]' : 'text-[var(--nexus-yellow)]')}>
                          {ivRankPct.toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Correlated stress ──────────────────────────────────── */}
                  <div className={cn(
                    'mt-4 rounded-lg border p-3 transition-colors',
                    correlatedMode ? 'bg-[var(--nexus-yellow)]/[0.05] border-[var(--nexus-yellow)]/[0.20]' : 'bg-[var(--color-surface-2)] border-white/[0.06]',
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCorrelatedMode(v => !v)}
                          className={cn(
                            'w-8 h-4 rounded-full transition-colors relative shrink-0',
                            correlatedMode ? 'bg-[var(--nexus-yellow)]/60' : 'bg-white/[0.1]',
                          )}
                        >
                          <span className={cn(
                            'absolute top-0.5 w-3 h-3 rounded-full transition-all',
                            correlatedMode ? 'left-[18px] bg-[var(--nexus-yellow)]' : 'left-0.5 bg-white/40',
                          )} />
                        </button>
                        <span className={cn('text-[12px] font-semibold', correlatedMode ? 'text-[var(--nexus-yellow)]/80' : 'text-white/55')}>
                          相关性压力模式
                        </span>
                        {correlatedMode && (
                          <span className="text-[10px] text-[var(--nexus-yellow)]/50 ml-1">
                            Δσ = −ρ×β×ΔS/S = {(-rho * volBeta * spotPctOffset / 100 * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/55">开启后 IV 偏移由 ρ 和 ΔS 自动计算</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] text-white/55">相关系数 ρ</span>
                          <span className="font-mono tnum text-[11px] text-white/60">{rho.toFixed(2)}</span>
                        </div>
                        <input type="range" min="-100" max="100" value={Math.round(rho * 100)}
                          onChange={e => setRho(parseInt(e.target.value) / 100)}
                          className="w-full range-slider" />
                        <p className="text-[10px] text-white/55 mt-1">加密市场典型值 −0.6 ~ −0.8（下跌时 IV 急升）</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] text-white/55">vol 敏感度 β</span>
                          <span className="font-mono tnum text-[11px] text-white/60">{volBeta.toFixed(2)}</span>
                        </div>
                        <input type="range" min="0" max="400" value={Math.round(volBeta * 100)}
                          onChange={e => setVolBeta(parseInt(e.target.value) / 100)}
                          className="w-full range-slider" />
                        <p className="text-[10px] text-white/55 mt-1">每 1% 价格变动带来的 IV 变化百分点（1.5 = 典型）</p>
                      </div>
                    </div>
                  </div>
                </Panel>}

              {activeTab === 'greeks' && <Panel title="希腊字母"
                  subtitle={legs.length > 0 ? (
                    <span className="flex items-center gap-3 text-[12px] text-white/55 flex-wrap">
                      <span>
                        情景 P/L&nbsp;
                        <span className={cn('font-mono tnum', pl > 0 ? 'text-[var(--nexus-green)]' : pl < 0 ? 'text-[var(--nexus-red)]' : 'text-white/50')}>
                          {pl >= 0 ? '+' : ''}{pl.toFixed(2)}
                        </span>
                      </span>
                      <span className="text-white/55">·</span>
                      <span>
                        净权利金&nbsp;
                        <span className={cn('font-mono tnum', netPremium < 0 ? 'text-[var(--nexus-green)]' : 'text-[var(--nexus-red)]')}>
                          {netPremium >= 0 ? '−' : '+'}{Math.abs(netPremium).toFixed(2)}
                        </span>
                      </span>
                      {probOfProfit !== null && (
                        <>
                          <span className="text-white/55">·</span>
                          <span title="到期盈利概率：以情景基准价为中心的对数正态分布，积分盈利区间概率">
                            到期PoP&nbsp;
                            <span className={cn('font-mono tnum', probOfProfit >= 0.5 ? 'text-[var(--nexus-green)]' : 'text-[var(--nexus-red)]')}>
                              {(probOfProfit * 100).toFixed(1)}%
                            </span>
                          </span>
                        </>
                      )}
                      {totalSlippage > 0 && (
                        <>
                          <span className="text-white/55">·</span>
                          <span title="各腿半点差 × 数量之和，即以市价入场相对于中间价的摩擦成本">
                            入场摩擦&nbsp;
                            <span className="font-mono tnum text-[var(--nexus-yellow)]">
                              −{totalSlippage.toFixed(2)}
                            </span>
                          </span>
                        </>
                      )}
                      {breakevens.length > 0 && (
                        <>
                          <span className="text-white/55">·</span>
                          <span>
                            盈亏平衡&nbsp;
                            <span className="font-mono tnum text-[var(--nexus-green)]">
                              {breakevens.map(b => b.toLocaleString('en-US', { maximumFractionDigits: 0 })).join(' / ')}
                            </span>
                          </span>
                        </>
                      )}
                    </span>
                  ) : undefined}
                >
                  <div className="grid grid-cols-4 gap-3 pt-1">
                    {[
                      { label: 'Delta (Δ)', val: grk.delta, decimals: 3, desc: '标的涨 1 单位仓位变化' },
                      { label: 'Gamma (Γ)', val: grk.gamma, decimals: 5, desc: 'Delta 的变化率' },
                      { label: 'Theta (Θ) /天', val: grk.theta, decimals: 2, desc: '每天时间衰减' },
                      { label: 'Vega (ν) /1%', val: grk.vega, decimals: 2, desc: 'IV 涨 1 个百分点' },
                    ].map(({ label, val, decimals, desc }) => (
                      <div key={label} className="bg-[var(--color-surface-2)] rounded-lg p-3">
                        <div className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1">{label}</div>
                        <div className={cn('text-[18px] font-mono tnum mb-1', legs.length === 0 ? 'text-white/55' : gClass(val))}>
                          {legs.length === 0 ? '—' : `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}`}
                        </div>
                        <div className="text-[11px] text-white/55 leading-snug">{desc}</div>
                      </div>
                    ))}
                  </div>
                  {legs.length > 0 && (
                    <>
                      {/* Dollar Greeks strip */}
                      <div className="mt-2 flex items-center gap-4 flex-wrap px-3 py-2 rounded-[8px] bg-[var(--color-surface-2)] border border-white/[0.04] text-[12px]">
                        <span className="text-[11px] text-white/55 uppercase tracking-[0.06em] shrink-0">美元化</span>
                        <span className="text-white/65 shrink-0">$Δ</span>
                        <span className={cn('font-mono tnum shrink-0', gClass(dollarGreeks.dollarDelta))}>
                          {dollarGreeks.dollarDelta >= 0 ? '+' : ''}{dollarGreeks.dollarDelta.toFixed(0)}
                        </span>
                        <span className="text-white/55 text-[11px] shrink-0">USDT 名义敞口</span>
                        <span className="text-white/55 shrink-0">·</span>
                        <span className="text-white/65 shrink-0">$Γ /1%</span>
                        <span className={cn('font-mono tnum shrink-0', gClass(dollarGreeks.dollarGamma))}>
                          {dollarGreeks.dollarGamma >= 0 ? '+' : ''}{dollarGreeks.dollarGamma.toFixed(2)}
                        </span>
                        <span className="text-white/55 text-[11px] shrink-0">USDT 二阶 P/L</span>
                      </div>

                      {/* Per-leg Greeks table (only when 2+ legs) */}
                      {legGreeksTable && legGreeksTable.length >= 2 && (
                        <div className="mt-2 pt-2 border-t border-white/[0.04]">
                          <p className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1.5">逐腿 Greeks 贡献</p>
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-white/55 text-[10px] uppercase tracking-[0.05em]">
                                <th className="text-left font-normal pb-1.5 pr-2">腿</th>
                                <th className="text-right font-normal pb-1.5 pr-2">Δ</th>
                                <th className="text-right font-normal pb-1.5 pr-2">$Δ</th>
                                <th className="text-right font-normal pb-1.5 pr-2">Γ</th>
                                <th className="text-right font-normal pb-1.5 pr-2">Θ/天</th>
                                <th className="text-right font-normal pb-1.5">ν/1%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {legGreeksTable.map(row => (
                                <tr key={row.label} className="border-t border-white/[0.03]">
                                  <td className="py-1 pr-2 text-white/55 whitespace-nowrap">{row.label}</td>
                                  <td className={cn('text-right pr-2 font-mono', gClass(row.delta))}>{row.delta >= 0 ? '+' : ''}{row.delta.toFixed(3)}</td>
                                  <td className={cn('text-right pr-2 font-mono text-[10px]', gClass(row.dollarDelta))}>{row.dollarDelta >= 0 ? '+' : ''}{row.dollarDelta.toFixed(0)}</td>
                                  <td className={cn('text-right pr-2 font-mono', gClass(row.gamma))}>{row.gamma.toFixed(5)}</td>
                                  <td className={cn('text-right pr-2 font-mono', gClass(row.theta))}>{row.theta.toFixed(2)}</td>
                                  <td className={cn('text-right font-mono', gClass(row.vega))}>{row.vega.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="grid grid-cols-4 gap-3 mt-2">
                        {[
                          { label: 'Vanna /1% IV', val: grk.vanna, fmt: (v: number) => (v >= 0 ? '+' : '') + v.toFixed(4), desc: 'IV 涨 1% 带来的 delta 变化；方向-波动率交叉敞口' },
                          { label: 'Volga /1% IV', val: grk.volga, fmt: (v: number) => (v >= 0 ? '+' : '') + v.toFixed(4), desc: 'IV 涨 1% 带来的 vega 变化（IV 凸性）；正值受益于 IV 大幅移动' },
                          { label: 'Charm /天',    val: grk.charm, fmt: (v: number) => (v >= 0 ? '+' : '') + v.toFixed(4), desc: 'Delta 每天衰减量；临近到期时急速增大' },
                          { label: 'Speed',        val: grk.speed, fmt: (v: number) => v.toExponential(2),                 desc: '∂Γ/∂S：大幅移动时 gamma 的变化；绝对值越大模型越快失效' },
                        ].map(({ label, val, fmt, desc }) => (
                          <div key={label} className="bg-[var(--color-surface-2)] border border-white/[0.04] rounded-lg p-3">
                            <div className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1">{label}</div>
                            <div className={cn('text-[14px] font-mono tnum mb-1', gClass(val))}>{fmt(val)}</div>
                            <div className="text-[10px] text-white/55 leading-snug">{desc}</div>
                          </div>
                        ))}
                      </div>
                      {/* Delta hedge suggestion */}
                      <div className="mt-2 flex items-center gap-3 px-3 py-2 rounded-[8px] bg-[var(--color-surface-2)] border border-white/[0.04] text-[12px]">
                        <span className="text-white/55 shrink-0">Δ 对冲建议</span>
                        {Math.abs(grk.delta) < 0.001 ? (
                          <span className="text-white/55">仓位已近似 Delta 中性</span>
                        ) : (
                          <>
                            <span className={cn('font-mono tnum font-semibold', grk.delta > 0 ? 'text-[var(--nexus-red)]' : 'text-[var(--nexus-green)]')}>
                              {grk.delta > 0 ? '做空' : '做多'} {Math.abs(grk.delta).toFixed(4)} {symbol}
                            </span>
                            <span className="text-white/55">
                              (≈ {(Math.abs(grk.delta) * currentS).toFixed(0)} USDT 名义敞口)
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                  {(maxProfit !== null || maxLoss !== null) && (
                    <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-white/[0.04]">
                      <div className="bg-[var(--color-surface-2)] rounded-lg p-3">
                        <div className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1">最大盈利（到期）</div>
                        <div className={cn('text-[18px] font-mono tnum mb-1', maxProfit && maxProfit > 0 ? 'text-[var(--nexus-green)]' : 'text-white/65')}>
                          {maxProfit === null ? '—' : maxProfit > 9999 ? '+∞ *' : `+${maxProfit.toFixed(0)}`}
                        </div>
                        <div className="text-[11px] text-white/55">图表范围内最大值</div>
                      </div>
                      <div className="bg-[var(--color-surface-2)] rounded-lg p-3">
                        <div className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1">最大亏损（到期）</div>
                        <div className={cn('text-[18px] font-mono tnum mb-1', maxLoss && maxLoss < 0 ? 'text-[var(--nexus-red)]' : 'text-white/65')}>
                          {maxLoss === null ? '—' : maxLoss < -9999 ? '−∞ *' : `${maxLoss.toFixed(0)}`}
                        </div>
                        <div className="text-[11px] text-white/55">图表范围内最小值</div>
                      </div>
                    </div>
                  )}
                </Panel>}

              {activeTab === 'risk' && varCvar && (
                <VaRPanel
                  varCvar={varCvar}
                  setVarSeed={setVarSeed}
                  showJumpRisk={showJumpRisk}
                  setShowJumpRisk={setShowJumpRisk}
                  jumpLambda={jumpLambda}
                  setJumpLambda={setJumpLambda}
                  jumpMuPct={jumpMuPct}
                  setJumpMuPct={setJumpMuPct}
                  jumpSigPct={jumpSigPct}
                  setJumpSigPct={setJumpSigPct}
                  jumpVaR={jumpVaR}
                />
              )}

              {activeTab === 'risk' && plAttribution && (hoursForward > 0 || spotPctOffset !== 0 || ivAdjust !== 0) && (
                <PLAttributionPanel
                  plAttribution={plAttribution}
                  currentS={currentS}
                  spot={spot}
                  hoursForward={hoursForward}
                  ivAdjust={ivAdjust}
                />
              )}

              {activeTab === 'scenario' && scenarioMatrix && (
                <ScenarioMatrixPanel
                  scenarioMatrix={scenarioMatrix}
                  matrixAbsMax={matrixAbsMax}
                  spotPctOffset={spotPctOffset}
                  ivAdjust={ivAdjust}
                  setSpotPctOffset={setSpotPctOffset}
                  setIvAdjust={setIvAdjust}
                  rho={rho}
                  volBeta={volBeta}
                  correlatedMode={correlatedMode}
                />
              )}
              {activeTab === 'greeks' && greeksLadder && (
                <GreeksLadderPanel
                  greeksLadder={greeksLadder}
                  symbol={symbol}
                  hoursForward={hoursForward}
                  spotPctOffset={spotPctOffset}
                  setSpotPctOffset={setSpotPctOffset}
                />
              )}

              {activeTab === 'greeks' && greeksHeatmapData && (
                <GreeksHeatmapPanel
                  greeksHeatmapData={greeksHeatmapData}
                  heatmapMetric={heatmapMetric}
                  setHeatmapMetric={setHeatmapMetric}
                  spotPctOffset={spotPctOffset}
                  ivAdjust={ivAdjust}
                />
              )}

              {activeTab === 'structure' && thetaCalendar && (
                <ThetaCalendarPanel thetaCalendar={thetaCalendar} />
              )}

              {activeTab === 'structure' && ivSkewData && (
                <IVSkewPanel ivSkewData={ivSkewData} spot={spot} />
              )}
            </div>
          </div>
        </div>

        <footer className="px-4 py-3 text-[12px] text-white/55 text-center border-t border-white/[0.04] mt-2">
          训练用工具 · 仅供学习 · 不构成任何投资建议
        </footer>

        <style>{`
          .range-slider { -webkit-appearance: none; width: 100%; height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; outline: none; }
          .range-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--nexus-accent); border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.4); }
          input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          input[type="number"] { -moz-appearance: textfield; }
          select option { background: #17181E; color: rgba(255,255,255,0.85); }
          .price-flash-up { color: var(--nexus-green); }
          .price-flash-down { color: var(--nexus-red); }
        `}</style>
      </div>
    </div>
  );
}

export default PositionBuilder;
