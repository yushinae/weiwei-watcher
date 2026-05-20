import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Plotly from 'plotly.js-dist';
import { cn } from '../../lib/utils';

const PRESETS: Record<string, { spot: number; iv: number; strikeStep: number }> = {
  BTC: { spot: 65000, iv: 0.55, strikeStep: 1000 },
  ETH: { spot: 3000, iv: 0.7, strikeStep: 50 },
  SOL: { spot: 150, iv: 0.85, strikeStep: 5 },
};

function normCdf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + (x < 0 ? -1 : 1) * y);
}
function normPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
function hoursToYears(h: number) { return h / (24 * 365); }

function bsPrice(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) return Math.max(0, type === 'call' ? S - K : K - S);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return type === 'call' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}

function bsGreeks(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) {
    let delta = 0;
    if (type === 'call') delta = S > K ? 1 : 0;
    else delta = S < K ? -1 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const pdf = normPdf(d1);
  let delta: number;
  if (type === 'call') { delta = normCdf(d1); } else { delta = normCdf(d1) - 1; }
  const theta = (-S * pdf * sigma / (2 * sqrtT)) / 365;
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100;
  return { delta, gamma, theta, vega };
}

interface Leg {
  id: number;
  side: 1 | -1;
  type: 'call' | 'put';
  K: number;
  qty: number;
  hoursToExpiry: number;
  entryPremium: number;
}

const N_POINTS = 120;
const TRACE = { GREEN_FILL: 0, RED_FILL: 1, EXPIRY: 2, CURRENT: 3, MARKER: 4, BREAKEVEN: 5 };

function formatHours(h: number) {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h - d * 24;
  return rh === 0 ? `${d}d` : `${d}d${rh}h`;
}

function roundStrike(price: number, step: number) {
  return Math.round(price / step) * step;
}

const TEMPLATES: Record<string, (spot: number, step: number, nextId: () => number) => Leg[]> = {
  longCall: (spot, step, nextId) => [{ id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 }],
  longPut: (spot, step, nextId) => [{ id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 }],
  coveredCall: (spot, step, nextId) => [{ id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.05, step), qty: 1, hoursToExpiry: 24 * 30, entryPremium: 0 }],
  bullCallSpread: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.10, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  bearPutSpread: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.90, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  longStraddle: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
  ],
  shortStrangle: (spot, step, nextId) => [
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.90, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.10, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  ironCondor: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot * 0.85, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.92, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.08, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot * 1.15, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  calendar: (spot, step, nextId) => [
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 30, entryPremium: 0 },
  ],
};

function Panel({ title, subtitle, actions, noPadding, noScroll, children }: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  noPadding?: boolean;
  noScroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full flex flex-col rounded-[14px] overflow-hidden bg-white/[0.025] border border-white/[0.07]">
      <div className="flex items-center px-3 py-2 border-b border-white/[0.06] shrink-0">
        <span className="text-[12px] text-white/65 shrink-0">{title}</span>
        {subtitle && <div className="ml-3 min-w-0 flex-1 text-[10px] text-white/30">{subtitle}</div>}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <div className={cn(
        'min-h-0',
        noScroll ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden',
        !noPadding && 'p-3',
      )}>
        {children}
      </div>
    </div>
  );
}

export function PositionBuilder() {
  const [symbol, setSymbol] = useState('BTC');
  const [spot, setSpot] = useState(PRESETS.BTC.spot);
  const [baseIv, setBaseIv] = useState(PRESETS.BTC.iv);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [nextId, setNextId] = useState(1);
  const [hoursForward, setHoursForward] = useState(0);
  const [ivAdjust, setIvAdjust] = useState(0);
  const [spotPctOffset, setSpotPctOffset] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInitialized = useRef(false);

  const currentS = spot * (1 + spotPctOffset / 100);
  const sigma = Math.max(0.01, baseIv + ivAdjust);
  const maxHours = useMemo(() => legs.reduce((m, l) => Math.max(m, l.hoursToExpiry), 0), [legs]);

  const repriceEntry = useCallback((leg: Leg) => {
    const T = hoursToYears(leg.hoursToExpiry);
    return { ...leg, entryPremium: bsPrice(spot, leg.K, T, baseIv, leg.type) };
  }, [spot, baseIv]);

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
      return repriceEntry(updated);
    }));
  }, [repriceEntry]);

  const applyTemplate = useCallback((key: string) => {
    const fn = TEMPLATES[key];
    if (!fn) return;
    let idCounter = 1;
    const newLegs = fn(spot, PRESETS[symbol].strikeStep, () => idCounter++);
    const priced = newLegs.map(repriceEntry);
    setLegs(priced);
    setNextId(idCounter);
  }, [spot, symbol, repriceEntry]);

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

  const changeSymbol = useCallback((newSymbol: string) => {
    const p = PRESETS[newSymbol];
    setSymbol(newSymbol);
    setSpot(p.spot);
    setBaseIv(p.iv);
    setLegs([]);
    setNextId(1);
  }, []);

  function legCurrentValue(leg: Leg, S: number, hf: number, ivAdj: number) {
    const remH = Math.max(0, leg.hoursToExpiry - hf);
    const T = hoursToYears(remH);
    const sig = Math.max(0.01, baseIv + ivAdj);
    return bsPrice(S, leg.K, T, sig, leg.type);
  }

  function legPL(leg: Leg, S: number, hf: number, ivAdj: number) {
    const cur = legCurrentValue(leg, S, hf, ivAdj);
    return leg.side * leg.qty * (cur - leg.entryPremium);
  }

  function positionPL(S: number, hf: number, ivAdj: number) {
    return legs.reduce((sum, l) => sum + legPL(l, S, hf, ivAdj), 0);
  }

  function positionGreeks(S: number, hf: number, ivAdj: number) {
    let d = 0, g = 0, t = 0, v = 0;
    const sig = Math.max(0.01, baseIv + ivAdj);
    for (const leg of legs) {
      const remH = Math.max(0, leg.hoursToExpiry - hf);
      const T = hoursToYears(remH);
      const grk = bsGreeks(S, leg.K, T, sig, leg.type);
      d += leg.side * leg.qty * grk.delta;
      g += leg.side * leg.qty * grk.gamma;
      t += leg.side * leg.qty * grk.theta;
      v += leg.side * leg.qty * grk.vega;
    }
    return { delta: d, gamma: g, theta: t, vega: v };
  }

  const chartXs = useMemo(() => {
    const lo = spot * 0.5;
    const hi = spot * 1.5;
    return Array.from({ length: N_POINTS + 1 }, (_, i) => lo + (hi - lo) * i / N_POINTS);
  }, [spot]);

  const expiryPL = useMemo(() => {
    const maxH = legs.reduce((m, l) => Math.max(m, l.hoursToExpiry), 0);
    return chartXs.map(x => positionPL(x, maxH, 0));
  }, [legs, chartXs, baseIv]);

  const currentPL = useMemo(() => {
    return chartXs.map(x => positionPL(x, hoursForward, ivAdjust));
  }, [legs, chartXs, hoursForward, ivAdjust, baseIv]);

  const grk = useMemo(() => positionGreeks(currentS, hoursForward, ivAdjust), [legs, currentS, hoursForward, ivAdjust, baseIv]);
  const pl = useMemo(() => positionPL(currentS, hoursForward, ivAdjust), [legs, currentS, hoursForward, ivAdjust, baseIv]);

  useEffect(() => {
    if (!chartRef.current || legs.length === 0) return;

    const breakevens: number[] = [];
    for (let i = 1; i < chartXs.length; i++) {
      if (expiryPL[i - 1] * expiryPL[i] < 0) {
        const x = chartXs[i - 1] + (chartXs[i] - chartXs[i - 1]) * (-expiryPL[i - 1]) / (expiryPL[i] - expiryPL[i - 1]);
        breakevens.push(x);
      }
    }

    const currentY = positionPL(currentS, hoursForward, ivAdjust);
    const expiryForFill = expiryPL;

    const shapes: any[] = [
      { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: '#2a3447', width: 1 } },
      { type: 'line', x0: spot, x1: spot, yref: 'paper', y0: 0, y1: 1, line: { color: '#8a93a6', width: 1, dash: 'dot' } },
    ];
    const seen = new Set<string>();
    legs.forEach(leg => {
      const k = `${leg.K}-${leg.type}`;
      if (seen.has(k)) return;
      seen.add(k);
      shapes.push({
        type: 'line', x0: leg.K, x1: leg.K, yref: 'paper', y0: 0, y1: 0.06,
        line: { color: leg.type === 'call' ? '#4ea1ff' : '#fbbf24', width: 1.5 },
      });
    });

    const traces = [
      { x: chartXs, y: expiryForFill.map(v => Math.max(0, v)), type: 'scatter', mode: 'lines', line: { color: 'rgba(0,0,0,0)' }, fill: 'tozeroy', fillcolor: 'rgba(52,211,153,0.10)', hoverinfo: 'skip', showlegend: false },
      { x: chartXs, y: expiryForFill.map(v => Math.min(0, v)), type: 'scatter', mode: 'lines', line: { color: 'rgba(0,0,0,0)' }, fill: 'tozeroy', fillcolor: 'rgba(248,113,113,0.10)', hoverinfo: 'skip', showlegend: false },
      { x: chartXs, y: expiryPL, type: 'scatter', mode: 'lines', name: '到期 P/L', line: { color: '#aaa', dash: 'dash', width: 1.5 }, hovertemplate: '标的 %{x:.2f}<br>到期 P/L %{y:.2f}<extra></extra>' },
      { x: chartXs, y: currentPL, type: 'scatter', mode: 'lines', name: '当前 P/L', line: { color: '#4ea1ff', width: 2.5 }, hovertemplate: '标的 %{x:.2f}<br>当前 P/L %{y:.2f}<extra></extra>' },
      { x: [currentS], y: [currentY], type: 'scatter', mode: 'markers', marker: { size: 10, color: '#fbbf24', line: { color: '#fff', width: 2 } }, name: '情景点', hovertemplate: '当前点<br>标的 %{x:.2f}<br>P/L %{y:.2f}<extra></extra>' },
      { x: breakevens, y: breakevens.map(() => 0), type: 'scatter', mode: 'markers', marker: { size: 8, color: '#34d399', symbol: 'diamond', line: { color: '#0b0f17', width: 1 } }, name: '盈亏平衡', hovertemplate: '盈亏平衡 %{x:.2f}<extra></extra>' },
    ];

    const layout = {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
      font: { color: '#e5e9f0', size: 12 },
      margin: { l: 60, r: 20, t: 10, b: 40 },
      xaxis: { title: `${symbol} 价格`, gridcolor: '#1a2233', zerolinecolor: '#2a3447', tickfont: { size: 11 } },
      yaxis: { title: 'P/L (USDT)', gridcolor: '#1a2233', zerolinecolor: '#2a3447', tickfont: { size: 11 } },
      shapes,
      showlegend: false,
      hovermode: 'x unified' as const,
    };

    Plotly.react(chartRef.current, traces as any, layout as any, { displayModeBar: false, responsive: true });
    chartInitialized.current = true;
  }, [legs, chartXs, expiryPL, currentPL, symbol, spot, baseIv]);

  useEffect(() => {
    if (!chartInitialized.current || legs.length === 0) return;
    const currentY = positionPL(currentS, hoursForward, ivAdjust);
    Plotly.restyle(chartRef.current!, { y: [currentPL] }, [TRACE.CURRENT]);
    Plotly.restyle(chartRef.current!, { x: [[currentS]], y: [[currentY]] }, [TRACE.MARKER]);
  }, [hoursForward, ivAdjust, spotPctOffset]);

  const gClass = (val: number) => val > 0 ? 'text-[var(--nexus-green)]' : (val < 0 ? 'text-[var(--nexus-red)]' : 'text-white/40');

  const inputCls = 'bg-white/[0.05] border border-white/[0.08] rounded-[8px] px-2 py-1 text-[13px] text-white/80 outline-none focus:border-white/20 w-full';
  const selectCls = 'bg-white/[0.05] border border-white/[0.08] rounded-[8px] px-2 py-1 text-[13px] text-white/80 outline-none focus:border-white/20 cursor-pointer w-full';

  return (
    <div className="absolute inset-0">
      <header className="glass-nav px-4 py-3 flex items-center gap-4 sticky top-0 z-10" style={{ background: 'var(--base-dim)' }}>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[16px] text-white/90">头寸压力测试</span>
          <span className="text-[11px] text-white/25 uppercase tracking-[0.08em]">U 本位 · 策略训练沙盒</span>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/30 uppercase tracking-[0.06em]">标的</span>
            <select value={symbol} onChange={e => changeSymbol(e.target.value)} className={cn(selectCls, '!w-24')}>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="SOL">SOL</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/30 uppercase tracking-[0.06em]">入场基准价</span>
            <input
              type="number"
              value={spot}
              onChange={e => { const v = parseFloat(e.target.value); if (v > 0) { setSpot(v); setLegs(prev => prev.map(l => repriceEntry(l))); } }}
              className={cn(inputCls, '!w-28')}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/30 uppercase tracking-[0.06em]">基础 IV</span>
            <input
              type="number"
              value={(baseIv * 100).toFixed(0)}
              onChange={e => { const v = parseFloat(e.target.value); if (v > 0) { setBaseIv(v / 100); setLegs(prev => prev.map(l => repriceEntry(l))); } }}
              className={cn(inputCls, '!w-20')}
            />
            <span className="text-[11px] text-white/30">%</span>
          </div>
        </div>

      </header>

      <div className="overflow-y-auto">
        <div className="px-2 pb-2">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-4">
              <Panel title="策略组合" subtitle="期权腿组合">
                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <select onChange={e => { if (e.target.value) { applyTemplate(e.target.value); e.target.value = ''; } }}
                      className={cn(selectCls, 'flex-1 text-xs')}>
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
                      className="px-3 py-1.5 rounded-[8px] bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[12px] font-semibold transition-colors shrink-0">
                      清空
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    {legs.length === 0 ? (
                      <div className="py-6 text-center text-[12px] text-white/25 italic">
                        还没有腿。点 "+ 添加一腿" 或选择上方模板。
                      </div>
                    ) : legs.map((leg, idx) => {
                      const remH = Math.max(0, leg.hoursToExpiry - hoursForward);
                      const T = hoursToYears(remH);
                      const g = bsGreeks(currentS, leg.K, T, sigma, leg.type);
                      const d = leg.side * leg.qty * g.delta;
                      const gm = leg.side * leg.qty * g.gamma;
                      const th = leg.side * leg.qty * g.theta;
                      const v = leg.side * leg.qty * g.vega;
                      return (
                        <div key={leg.id} className="bg-white/[0.03] border border-white/[0.06] rounded-[12px] p-3">
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-white/25">#{idx + 1}</span>
                              <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full',
                                leg.side === 1 ? 'bg-[var(--nexus-green)]/15 text-[var(--nexus-green)]' : 'bg-[var(--nexus-red)]/15 text-[var(--nexus-red)]')}>
                                {leg.side === 1 ? '买入' : '卖出'}
                              </span>
                              <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full',
                                leg.type === 'call' ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]' : 'bg-[var(--nexus-yellow)]/15 text-[var(--nexus-yellow)]')}>
                                {leg.type === 'call' ? 'Call' : 'Put'}
                              </span>
                            </div>
                            <button onClick={() => removeLeg(leg.id)}
                              className="w-6 h-6 flex items-center justify-center rounded-[6px] text-white/25 hover:text-rose-400 hover:bg-rose-500/15 transition-colors text-[14px]">
                              ×
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="text-[9px] uppercase tracking-[0.06em] text-white/20 block mb-1">方向</label>
                              <select value={leg.side} onChange={e => updateLeg(leg.id, { side: parseInt(e.target.value) as 1 | -1 })} className={selectCls}>
                                <option value="1">买入 (Long)</option>
                                <option value="-1">卖出 (Short)</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] uppercase tracking-[0.06em] text-white/20 block mb-1">类型</label>
                              <select value={leg.type} onChange={e => updateLeg(leg.id, { type: e.target.value as 'call' | 'put' })} className={selectCls}>
                                <option value="call">看涨 Call</option>
                                <option value="put">看跌 Put</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] uppercase tracking-[0.06em] text-white/20 block mb-1">行权价</label>
                              <input type="number" step="any" value={leg.K} onChange={e => updateLeg(leg.id, { K: parseFloat(e.target.value) })} className={inputCls} />
                            </div>
                            <div>
                              <label className="text-[9px] uppercase tracking-[0.06em] text-white/20 block mb-1">数量</label>
                              <input type="number" step="0.1" min="0.1" value={leg.qty} onChange={e => updateLeg(leg.id, { qty: parseFloat(e.target.value) })} className={inputCls} />
                            </div>
                            <div>
                              <label className="text-[9px] uppercase tracking-[0.06em] text-white/20 block mb-1">到期 (小时)</label>
                              <input type="number" step="1" min="1" value={leg.hoursToExpiry} onChange={e => updateLeg(leg.id, { hoursToExpiry: Math.max(1, Math.round(parseFloat(e.target.value))) })} className={inputCls} />
                            </div>
                            <div>
                              <label className="text-[9px] uppercase tracking-[0.06em] text-white/20 block mb-1">入场权利金 (自动)</label>
                              <div className="text-[14px] font-mono tnum text-white/80 pt-1">{leg.entryPremium.toFixed(2)}</div>
                            </div>
                          </div>
                          <div className="text-[11px] text-white/25 mb-2">
                            ≈ {formatHours(leg.hoursToExpiry)} · 入场总额 {(leg.side * leg.qty * leg.entryPremium).toFixed(2)}
                          </div>
                          <div className="flex gap-3 text-[11px] pt-2 border-t border-white/[0.05]">
                            <span className="text-white/25">δ</span><span className="font-mono tnum"><span className={gClass(d)}>{d.toFixed(3)}</span></span>
                            <span className="text-white/25">γ</span><span className="font-mono tnum"><span className={gClass(gm)}>{gm.toFixed(5)}</span></span>
                            <span className="text-white/25">θ</span><span className="font-mono tnum"><span className={gClass(th)}>{th.toFixed(2)}</span></span>
                            <span className="text-white/25">ν</span><span className="font-mono tnum"><span className={gClass(v)}>{v.toFixed(2)}</span></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button onClick={() => addLeg()}
                    className="w-full py-2 rounded-[10px] bg-white/[0.04] border border-white/[0.08] text-[13px] font-semibold text-white/60 hover:bg-white/[0.07] hover:text-white/80 hover:border-white/[0.12] transition-colors">
                    + 添加一腿
                  </button>

                  <p className="text-[11px] text-white/20 leading-relaxed pt-1 border-t border-white/[0.04]">
                    入场价按当前 标的/IV 用 Black-Scholes 估算。修改腿参数后会重算入场价；之后调"入场基准价/IV/时间"滑块只改变浮盈浮亏，不动入场价。
                  </p>
                </div>
              </Panel>
            </div>

            <div className="col-span-8 flex flex-col gap-2">
              <Panel title="损益曲线" noPadding noScroll
                  subtitle={
                    <span className="flex items-center gap-3 text-[11px] text-white/30">
                      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-[2px] bg-[#4ea1ff]" />当前</span>
                      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed border-white/30" />到期</span>
                    </span>
                  }
                >
                  <div ref={chartRef} className="w-full h-full" style={{ minHeight: 200 }} />
                </Panel>

              <Panel title="情景参数"
                actions={
                  <button onClick={resetScenario}
                    className="flex items-center gap-1 px-3 py-1 rounded-[8px] bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/50 hover:bg-white/[0.07] hover:text-white/70 transition-colors">
                    <span>↺</span> 重置情景
                  </button>
                }>
                  <div className="grid grid-cols-3 gap-4 pt-1">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                         <span className="text-[11px] text-white/50">时间快进</span>
                        <span className="font-mono tnum text-[11px] text-white/50">{formatHours(hoursForward)}</span>
                      </div>
                      <input type="range" min="0" max={Math.max(1, maxHours)} value={hoursForward}
                        onChange={e => setHoursForward(parseInt(e.target.value))} className="w-full range-slider" />
                      <p className="text-[10px] text-white/20 mt-1.5 leading-snug">把"当前"时间点向前推，看 theta 怎么吃仓位</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                         <span className="text-[11px] text-white/50">IV 偏移</span>
                        <span className="font-mono tnum text-[11px] text-white/50">{(ivAdjust * 100).toFixed(0) >= '0' ? '+' : ''}{(ivAdjust * 100).toFixed(0)}%</span>
                      </div>
                      <input type="range" min="-30" max="50" value={ivAdjust * 100}
                        onChange={e => setIvAdjust(parseInt(e.target.value) / 100)} className="w-full range-slider" />
                      <p className="text-[10px] text-white/20 mt-1.5 leading-snug">基础 IV 上的加减，测 vega 敏感度</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                         <span className="text-[11px] text-white/50">标的价偏移</span>
                        <span className="font-mono tnum text-[11px] text-white/50">{spotPctOffset >= 0 ? '+' : ''}{spotPctOffset}%</span>
                      </div>
                      <input type="range" min="-40" max="40" value={spotPctOffset}
                        onChange={e => setSpotPctOffset(parseInt(e.target.value))} className="w-full range-slider" />
                      <p className="text-[10px] text-white/20 mt-1.5 leading-snug">假设标的从入场基准价涨跌 X%</p>
                    </div>
                  </div>
                </Panel>

              <Panel title="希腊字母"
                  subtitle={legs.length > 0 ? (
                    <span className="text-[11px] text-white/40">
                      情景 P/L <span className={cn('font-mono tnum', pl > 0 ? 'text-[var(--nexus-green)]' : pl < 0 ? 'text-[var(--nexus-red)]' : 'text-white/50')}>
                        {pl >= 0 ? '+' : ''}{pl.toFixed(2)} USDT
                      </span>
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
                      <div key={label} className="bg-white/[0.03] border border-white/[0.05] rounded-[10px] p-3">
                        <div className="text-[9px] uppercase tracking-[0.06em] text-white/20 mb-1">{label}</div>
                        <div className={cn('text-[18px] font-mono tnum mb-1', legs.length === 0 ? 'text-white/20' : gClass(val))}>
                          {legs.length === 0 ? '—' : `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}`}
                        </div>
                        <div className="text-[10px] text-white/20 leading-snug">{desc}</div>
                      </div>
                    ))}
                  </div>
                </Panel>
            </div>
          </div>
        </div>

        <footer className="px-4 py-3 text-[11px] text-white/20 text-center border-t border-white/[0.04] mt-2">
          训练用工具 · 仅供学习 · 不构成任何投资建议
        </footer>

        <style>{`
          .range-slider { -webkit-appearance: none; width: 100%; height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; outline: none; }
          .range-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--nexus-accent); border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.4); }
          input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
          input[type="number"] { -moz-appearance: textfield; }
          select option { background: #1a1a24; color: rgba(255,255,255,0.8); }
        `}</style>
      </div>
    </div>
  );
}

export default PositionBuilder;
