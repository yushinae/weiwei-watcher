import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '../../components/echart/EChart';
import {
  POS_STORE, buildLiveFromCache, POS_TICKER_CACHE, subscribePositions,
  DERIBIT_WS, WS_FLUSH_MS,
  type UserPosition, type LivePosition,
} from '../../registry/monitorWidgetsBase';
import { useLiveSpot } from '../optionsChain/liveData';
import { useGlobalOptionBook } from '../optionsChain/optionBookStore';
import { fetchAllPositions } from '../accounts/sync';
import { getBook, subscribeBook } from '../accounts/bookStore';
import { ensureEnvAccounts, hydrateAccountsFromBackend } from '../accounts/store';
import { subscribeAccountPositionsRefresh } from '../accounts/positionRefresh';
import type { UnifiedPosition } from '../accounts/types';
import {
  fromDeribit, fromAccounts, fromSim, buildBooks, totals, portfolioScenarioPnL,
  type RiskPosition,
} from './aggregate';
import { captureSnapshot, loadSnapshots, buildAttribution } from './snapshot';

const UP = '#28C840';
const DOWN = '#FF5F57';
const MUTE = 'rgba(255,255,255,0.5)';

// 压力测试网格
const SPOT_SHOCKS = [20, 15, 10, 5, 0, -5, -10, -15, -20]; // 行（上→下：涨→跌）
const IV_SHOCKS = [-20, -10, 0, 10, 20, 30];               // 列
const KEY_CELL = { spot: -20, iv: 30 };                     // 重点情景：BTC −20% & IV +30%
const IV_LINE_CHOICES = [-20, -10, 10, 20, 30];
type RiskViewMode = 'all' | 'real' | 'sim' | 'group' | 'leg';

const fmtUsd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0);
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}$${s}`;
};
const sgnColor = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : MUTE);

// ── 小组件 ───────────────────────────────────────────────────────────────────

const GreekCell = ({ label, val, hint }: { label: string; val: number; hint: string }) => (
  <div className="flex flex-col gap-0.5" title={hint}>
    <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
    <span className="text-[15px] font-bold tabular-nums leading-none" style={{ color: sgnColor(val) }}>{fmtUsd(val)}</span>
  </div>
);

const Card = ({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <div className={`flex flex-col rounded-[8px] bg-[var(--color-bg-card)] ring-1 ring-inset ring-[var(--color-border-subtle)] shadow-[0_8px_22px_-14px_rgba(0,0,0,0.72)] ${className}`}>
    <div className="flex items-center px-4 pt-3 pb-2 shrink-0">
      <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    <div className="flex-1 min-h-0 px-3 pb-3">{children}</div>
  </div>
);

function mergeRealRisk(primary: RiskPosition[], legacy: RiskPosition[]): RiskPosition[] {
  const out = [...primary];
  const seen = new Set(primary.map(p => `${p.venue}:${p.instrument}:${p.qty}`));
  for (const p of legacy) {
    const key = `${p.venue}:${p.instrument}:${p.qty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function expiryOf(instrument: string): string {
  const expiry = instrument.split('-')[1];
  return expiry && /\d/.test(expiry) ? expiry : '现货/永续';
}

function sourceLabel(p: RiskPosition): string {
  return p.sim ? '模拟' : p.venue;
}

interface RiskGroup {
  key: string;
  label: string;
  positions: RiskPosition[];
}

function buildRiskGroups(positions: RiskPosition[]): RiskGroup[] {
  const map = new Map<string, RiskGroup>();
  for (const p of positions) {
    const source = sourceLabel(p);
    const expiry = expiryOf(p.instrument);
    const key = `${source}:${p.coin}:${expiry}`;
    const group = map.get(key) ?? { key, label: `${source} · ${p.coin} · ${expiry}`, positions: [] };
    group.positions.push(p);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => b.positions.length - a.positions.length || a.label.localeCompare(b.label));
}

// ── 主视图 ───────────────────────────────────────────────────────────────────

export const PortfolioRiskView = () => {
  // Deribit 实时持仓（直接订阅 ticker WS，非 subscribeData —— 不受 pauseMonitorPolling 冻结）
  const [positionsRaw, setPositionsRaw] = useState<UserPosition[]>([...POS_STORE]);
  const [live, setLive] = useState<LivePosition[]>(() => buildLiveFromCache([...POS_STORE]));
  const dirty = useRef(false);

  useEffect(() => subscribePositions(() => setPositionsRaw([...POS_STORE])), []);

  useEffect(() => {
    if (positionsRaw.length === 0) { setLive([]); return; }
    setLive(buildLiveFromCache(positionsRaw));
    const insts = Array.from(new Set<string>(positionsRaw.map(p => p.instrument)));
    const unsubs = insts.map(inst =>
      DERIBIT_WS.subscribe<Record<string, unknown>>(`ticker.${inst}.100ms`, d => {
        POS_TICKER_CACHE.set(inst, d);
        dirty.current = true;
      }),
    );
    const flush = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      setLive(buildLiveFromCache(positionsRaw));
    }, WS_FLUSH_MS);
    return () => { unsubs.forEach(u => u()); clearInterval(flush); };
  }, [positionsRaw]);

  const btcSpot = useLiveSpot('BTC');
  const ethSpot = useLiveSpot('ETH');

  // 真实账户持仓（HL/Bybit/Deribit，跨所）。期权链实盘下单成功后会触发刷新。
  const [acctPositions, setAcctPositions] = useState<UnifiedPosition[]>(() => getBook());
  const [syncingAccounts, setSyncingAccounts] = useState(false);
  const syncAccountPositions = useCallback(async () => {
    setSyncingAccounts(true);
    try {
      await hydrateAccountsFromBackend();
      ensureEnvAccounts();
      return await fetchAllPositions();
    } finally {
      setSyncingAccounts(false);
    }
  }, []);

  useEffect(() => subscribeBook(() => setAcctPositions(getBook())), []);

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const sync = () => {
      void syncAccountPositions().then(p => { if (alive) setAcctPositions(p); });
    };
    sync();
    const unsub = subscribeAccountPositionsRefresh(() => {
      sync();
      timers.push(setTimeout(sync, 2_500), setTimeout(sync, 10_000));
    });
    return () => {
      alive = false;
      timers.forEach(t => clearTimeout(t));
      unsub();
    };
  }, [syncAccountPositions]);
  const acctRisk = useMemo(
    () => fromAccounts(acctPositions, { BTC: btcSpot ?? 0, ETH: ethSpot ?? 0 }),
    [acctPositions, btcSpot, ethSpot],
  );

  const liveRisk = useMemo(() => fromDeribit(live), [live]);
  // 真实book = 账户实盘 + Deribit 手动录入（旧路径）；同一腿避免双算。
  const realRisk = useMemo(() => mergeRealRisk(acctRisk, liveRisk), [acctRisk, liveRisk]);
  const hasLive = realRisk.length > 0;

  // 模拟仓（期权链下单）→ 策略沙盒；默认并入，可关。
  // 必须读「全局」book（useSyncExternalStore + 持久化）——期权链下单写的就是它；
  // 早先误用 useLocalBook（组件级 useReducer，永远是空的独立实例）导致沙盒仓进不来。
  const sim = useGlobalOptionBook();
  const simRisk = useMemo(
    () => fromSim(sim.positions, { BTC: btcSpot ?? 0, ETH: ethSpot ?? 0 }),
    [sim.positions, btcSpot, ethSpot],
  );
  const allRisk = useMemo(() => [...realRisk, ...simRisk], [realRisk, simRisk]);
  const groups = useMemo(() => buildRiskGroups(allRisk), [allRisk]);
  const [viewMode, setViewMode] = useState<RiskViewMode>('all');
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [selectedLegId, setSelectedLegId] = useState('');
  const selectedGroup = groups.find(g => g.key === selectedGroupKey) ?? groups[0] ?? null;
  const selectedLeg = allRisk.find(p => p.id === selectedLegId) ?? allRisk[0] ?? null;

  useEffect(() => {
    if (!selectedGroupKey && groups[0]) setSelectedGroupKey(groups[0].key);
    else if (selectedGroupKey && groups.length > 0 && !groups.some(g => g.key === selectedGroupKey)) setSelectedGroupKey(groups[0].key);
  }, [groups, selectedGroupKey]);

  useEffect(() => {
    if (!selectedLegId && allRisk[0]) setSelectedLegId(allRisk[0].id);
    else if (selectedLegId && allRisk.length > 0 && !allRisk.some(p => p.id === selectedLegId)) setSelectedLegId(allRisk[0].id);
  }, [allRisk, selectedLegId]);

  const positions: RiskPosition[] = useMemo(() => {
    if (viewMode === 'real') return realRisk;
    if (viewMode === 'sim') return simRisk;
    if (viewMode === 'group') return selectedGroup?.positions ?? [];
    if (viewMode === 'leg') return selectedLeg ? [selectedLeg] : [];
    return allRisk;
  }, [viewMode, realRisk, simRisk, selectedGroup, selectedLeg, allRisk]);

  const scopeLabel = viewMode === 'real' ? '真实仓位'
    : viewMode === 'sim' ? '模拟仓位'
      : viewMode === 'group' ? selectedGroup?.label ?? '组合'
        : viewMode === 'leg' ? selectedLeg?.instrument ?? '单腿'
          : '全部仓位';

  const books = useMemo(() => buildBooks(positions), [positions]);
  const tot = useMemo(() => totals(books), [books]);
  // 快照只记真实仓，避免模拟污染每日希腊历史
  const realBooks = useMemo(() => buildBooks(realRisk), [realRisk]);

  // ── 每日希腊快照 → P&L 归因 ──
  const dvolRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const u1 = DERIBIT_WS.subscribe<{ volatility: number }>('deribit_volatility_index.btc_usd', d => { dvolRef.current.BTC = d.volatility; });
    const u2 = DERIBIT_WS.subscribe<{ volatility: number }>('deribit_volatility_index.eth_usd', d => { dvolRef.current.ETH = d.volatility; });
    return () => { u1(); u2(); };
  }, []);
  const [snaps, setSnaps] = useState(() => loadSnapshots());
  // 实盘 + 有持仓时，每天存一条（覆盖今天）。只记真实仓，不含模拟沙盒。
  useEffect(() => {
    if (!hasLive || !realBooks.length) return;
    const t = setTimeout(() => setSnaps(captureSnapshot(realBooks, dvolRef.current)), 1500); // 等 DVOL 到
    return () => clearTimeout(t);
  }, [hasLive, realBooks]);
  const realAttrib = useMemo(() => buildAttribution(snaps), [snaps]);
  const hasMeaningfulAttrib = useMemo(
    () => realAttrib.some(a => Math.abs(a.delta) + Math.abs(a.gamma) + Math.abs(a.vega) + Math.abs(a.theta) + Math.abs(a.total) > 1),
    [realAttrib],
  );
  const attribCum = useMemo(() => {
    let c = 0; return realAttrib.map(a => ({ ...a, cum: (c += a.total) }));
  }, [realAttrib]);

  const attribOption = useMemo<EChartsOption>(() => {
    const comps = [
      { name: 'Delta（方向）', key: 'delta' as const, color: '#ff9c2e' },
      { name: 'Gamma（凸性）', key: 'gamma' as const, color: '#25e889' },
      { name: 'Vega（波动）', key: 'vega' as const, color: '#a78bfa' },
      { name: 'Theta（时间）', key: 'theta' as const, color: '#FEBC2E' },
    ];
    return {
      grid: { left: 8, right: 12, top: 28, bottom: 22, containLabel: true },
      legend: { data: comps.map(c => c.name), textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 10 }, top: 0 },
      xAxis: { type: 'category', data: attribCum.map(a => a.date.slice(5)), axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, hideOverlap: true }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, formatter: (v: number) => fmtUsd(v) }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number | string) => (typeof v === 'number' ? fmtUsd(v) : String(v)) },
      series: [
        ...comps.map(c => ({ name: c.name, type: 'bar' as const, stack: 'attr', data: attribCum.map(a => +a[c.key].toFixed(0)), itemStyle: { color: c.color } })),
        { name: '累计', type: 'line' as const, data: attribCum.map(a => +a.cum.toFixed(0)), lineStyle: { color: 'rgba(255,255,255,0.8)', width: 2 }, symbol: 'none', z: 5 },
      ],
    };
  }, [attribCum]);

  // ── 压力测试矩阵（visualMap diverging）──
  const matrix = useMemo(() => {
    const cells: [number, number, number][] = [];
    let absMax = 1;
    SPOT_SHOCKS.forEach((sp, yi) => {
      IV_SHOCKS.forEach((iv, xi) => {
        const pnl = portfolioScenarioPnL(books, { spotPct: sp, ivPts: iv, dtDays: 0 });
        cells.push([xi, yi, Math.round(pnl)]);
        absMax = Math.max(absMax, Math.abs(pnl));
      });
    });
    return { cells, absMax };
  }, [books]);

  const matrixOption = useMemo<EChartsOption>(() => ({
    grid: { left: 56, right: 12, top: 8, bottom: 28, containLabel: true },
    tooltip: {
      position: 'top',
      axisPointer: { type: 'none' },
      formatter: (p: unknown) => {
        const raw = (p as { data: [number, number, number] | { value: [number, number, number] } }).data;
        const d = Array.isArray(raw) ? raw : raw.value;
        return `Spot ${SPOT_SHOCKS[d[1]] > 0 ? '+' : ''}${SPOT_SHOCKS[d[1]]}% · IV ${IV_SHOCKS[d[0]] > 0 ? '+' : ''}${IV_SHOCKS[d[0]]}pt<br/>组合 P&L <b style="color:${sgnColor(d[2])}">${fmtUsd(d[2])}</b>`;
      },
    },
    xAxis: {
      type: 'category', data: IV_SHOCKS.map(v => `${v > 0 ? '+' : ''}${v}`), name: 'IV 冲击 (pt)', nameLocation: 'middle', nameGap: 22,
      nameTextStyle: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false }, axisPointer: { show: false },
    },
    yAxis: {
      type: 'category', data: SPOT_SHOCKS.map(v => `${v > 0 ? '+' : ''}${v}%`),
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false }, axisPointer: { show: false },
    },
    visualMap: {
      min: -matrix.absMax, max: matrix.absMax, show: false,
      inRange: { color: ['#7a1f1f', '#3a1414', '#16181d', '#143a1e', '#1f7a35'] },
    },
    series: [{
      type: 'heatmap',
      data: matrix.cells.map(cell => (
        cell[0] === IV_SHOCKS.indexOf(KEY_CELL.iv) && cell[1] === SPOT_SHOCKS.indexOf(KEY_CELL.spot)
          ? {
              value: cell,
              itemStyle: {
                borderColor: 'rgba(254,188,46,0.72)',
                borderWidth: 1,
                shadowBlur: 8,
                shadowColor: 'rgba(254,188,46,0.20)',
              },
            }
          : cell
      )),
      label: {
        show: true, fontSize: 9, fontWeight: 'bold',
        formatter: (p: { data: [number, number, number] | { value: [number, number, number] } }) => {
          const d = Array.isArray(p.data) ? p.data : p.data.value;
          return fmtUsd(d[2]);
        },
        color: 'rgba(255,255,255,0.85)',
      },
      itemStyle: { borderColor: 'rgba(255,255,255,0.035)', borderWidth: 0.5, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: 'rgba(255,255,255,0.28)', borderWidth: 1 } },
    }],
  }), [matrix]);

  // ── P&L vs Spot 曲线（瞬时盯市，不含 theta 流逝）──
  const [ivLine, setIvLine] = useState(20);
  const curveOption = useMemo<EChartsOption>(() => {
    const xs: number[] = [];
    for (let p = -30; p <= 30; p += 2) xs.push(p);
    const base = xs.map(p => +portfolioScenarioPnL(books, { spotPct: p, ivPts: 0, dtDays: 0 }).toFixed(0));
    const shocked = xs.map(p => +portfolioScenarioPnL(books, { spotPct: p, ivPts: ivLine, dtDays: 0 }).toFixed(0));
    const shockName = `IV ${ivLine > 0 ? '+' : ''}${ivLine}pt`;
    const shockColor = ivLine < 0 ? '#28C840' : '#ff9c2e';
    return {
      grid: { left: 8, right: 14, top: 16, bottom: 24, containLabel: true },
      legend: {
        data: [{ name: 'IV 不变', icon: 'roundRect' }, { name: shockName, icon: 'roundRect' }],
        textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 10 }, right: 8, top: 0,
      },
      xAxis: {
        type: 'category', data: xs.map(p => `${p > 0 ? '+' : ''}${p}%`), boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, interval: 2 }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, formatter: (v: number) => fmtUsd(v) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; value: number; color: string; seriesName: string }>;
          return `<div style="font-weight:bold;margin-bottom:3px">Spot ${arr[0].axisValue}</div>` +
            arr.map(a => `<span style="color:${a.color}">●</span> ${a.seriesName}: <b style="color:${sgnColor(a.value)}">${fmtUsd(a.value)}</b>`).join('<br/>');
        },
      },
      series: [
        { name: 'IV 不变', type: 'line', smooth: 0.2, showSymbol: false, data: base,
          lineStyle: { color: 'rgba(255,255,255,0.5)', width: 1.5 },
          markLine: { symbol: 'none', silent: true, lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed', width: 1 }, data: [{ yAxis: 0 }, { xAxis: xs.indexOf(0) }] } },
        { name: shockName, type: 'line', smooth: 0.2, showSymbol: false, data: shocked,
          lineStyle: { color: shockColor, width: 2 }, areaStyle: { color: ivLine < 0 ? 'rgba(40,200,64,0.08)' : 'rgba(247,166,0,0.08)' } },
      ],
    };
  }, [books, ivLine]);

  const keyPnl = portfolioScenarioPnL(books, { spotPct: KEY_CELL.spot, ivPts: KEY_CELL.iv, dtDays: 0 });
  const worstPnl = Math.min(...matrix.cells.map(c => c[2]));
  const modeButtons: Array<{ mode: RiskViewMode; label: string; count: number }> = [
    { mode: 'all', label: '全部', count: allRisk.length },
    { mode: 'real', label: '真实', count: realRisk.length },
    { mode: 'sim', label: '模拟', count: simRisk.length },
    { mode: 'group', label: '组合', count: groups.length },
    { mode: 'leg', label: '单腿', count: allRisk.length },
  ];

  return (
    <div className="portfolio-risk-page absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* ── 提示条 ── */}
        <div className="flex items-center gap-2 flex-wrap shrink-0 text-[12px]">
          <span className="inline-flex h-[26px] items-center justify-center gap-1.5 rounded-md bg-[#28C840]/[0.12] px-2.5 text-[12px] font-semibold text-[#28C840] ring-1 ring-inset ring-[#28C840]/30 transition-colors duration-[120ms] hover:bg-[#28C840]/[0.16]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#28C840] animate-pulse" /> {scopeLabel} · {tot.count} 腿
          </span>
          <div className="inline-flex items-center gap-0.5 rounded-md bg-white/[0.05] p-0.5 ring-1 ring-inset ring-white/10">
            {modeButtons.map(b => {
              const active = viewMode === b.mode;
              return (
                <button key={b.mode} onClick={() => setViewMode(b.mode)} disabled={b.count === 0}
                  className={`h-[26px] rounded-md px-2.5 text-[12px] font-semibold transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'bg-[#3A3F40] text-[var(--nexus-accent)]' : 'bg-transparent text-white/50 hover:bg-[#3A3B40] hover:text-white/80'}`}>
                  {b.label}{b.count ? ` ${b.count}` : ''}
                </button>
              );
            })}
          </div>
          {viewMode === 'group' && groups.length > 0 && (
            <select value={selectedGroup?.key ?? ''} onChange={e => setSelectedGroupKey(e.target.value)}
              className="h-[26px] max-w-[260px] rounded-md bg-white/[0.06] px-2 text-[11px] font-semibold text-white/70 outline-none ring-1 ring-inset ring-white/10">
              {groups.map(g => <option key={g.key} value={g.key}>{g.label} · {g.positions.length}腿</option>)}
            </select>
          )}
          {viewMode === 'leg' && allRisk.length > 0 && (
            <select value={selectedLeg?.id ?? ''} onChange={e => setSelectedLegId(e.target.value)}
              className="h-[26px] max-w-[360px] rounded-md bg-white/[0.06] px-2 text-[11px] font-semibold text-white/70 outline-none ring-1 ring-inset ring-white/10">
              {allRisk.map(p => <option key={p.id} value={p.id}>{sourceLabel(p)} · {p.instrument} · {p.qty > 0 ? '+' : ''}{p.qty}</option>)}
            </select>
          )}
          <span className="ml-auto text-white/35">
            真实 {realRisk.length} · 模拟 {simRisk.length} · {syncingAccounts ? '账户同步中…' : '请对照交易所核对'}
          </span>
        </div>

        {/* ── 净美元希腊（总 + 分币种）── */}
        <Card title={`净美元希腊 · ${scopeLabel}`} className="shrink-0">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-6 px-3 py-2.5 rounded-[6px] bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)]">
              <span className="text-[11px] font-bold text-white/70 w-[40px]">合计</span>
              <GreekCell label="$Δ" val={tot.netDelta} hint="净美元 Delta（名义方向敞口）" />
              <GreekCell label="$Γ / 1%" val={tot.netGamma} hint="每 1% spot 的 Dollar Gamma" />
              <GreekCell label="$ν / 1% IV" val={tot.netVega} hint="每 1% IV 的 Dollar Vega（负=净空波动）" />
              <GreekCell label="$Θ / 日" val={tot.netTheta} hint="每日 Dollar Theta（正=收时间价值）" />
              <div className="ml-auto text-[11px] text-white/45">
                {tot.netVega < 0 ? '净空波动' : tot.netVega > 0 ? '净多波动' : '波动中性'} · {tot.netDelta > 0 ? '偏多' : tot.netDelta < 0 ? '偏空' : '方向中性'}
              </div>
            </div>
            {books.map(b => (
              <div key={b.coin} className="flex items-center gap-6 px-3 py-2 rounded-lg hover:bg-white/[0.02]">
                <span className="text-[11px] font-bold text-white/55 w-[40px]">{b.coin}</span>
                <GreekCell label="$Δ" val={b.netDelta} hint={`${b.coin} 净美元 Delta`} />
                <GreekCell label="$Γ / 1%" val={b.netGamma} hint={`${b.coin} Dollar Gamma`} />
                <GreekCell label="$ν / 1% IV" val={b.netVega} hint={`${b.coin} Dollar Vega`} />
                <GreekCell label="$Θ / 日" val={b.netTheta} hint={`${b.coin} Dollar Theta`} />
                <span className="ml-auto text-[10px] text-white/35 tabular-nums">{b.count} 腿 · spot {b.spot ? `$${b.spot.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</span>
              </div>
            ))}
            {positions.length === 0 && (
              <div className="flex h-[84px] items-center justify-center rounded-[6px] bg-[var(--color-surface-2)] text-[12px] font-semibold text-white/40">
                当前口径下暂无持仓
              </div>
            )}
          </div>
        </Card>

        {/* ── 压力测试 ── */}
        <div className="grid grid-cols-12 gap-3 shrink-0">
          <Card title="组合压力测试矩阵（Spot × IV，瞬时 P&L）" className="col-span-12 lg:col-span-7 h-[340px]"
            right={<span className="text-[10px] text-[#FEBC2E] font-semibold">重点：BTC −20% / IV +30%</span>}>
            <EChart option={matrixOption} notMerge />
          </Card>
          <Card title="组合 P&L vs Spot（瞬时盯市）" className="col-span-12 lg:col-span-5 h-[340px]"
            right={
              <div className="flex items-center gap-1">
                {IV_LINE_CHOICES.map(v => (
                  <button key={v} onClick={() => setIvLine(v)}
                    className={`px-1.5 h-[22px] rounded text-[10px] font-semibold ${ivLine === v ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)] ring-1 ring-inset ring-[var(--nexus-accent)]/35' : 'text-white/45 hover:text-white/75'}`}>
                    IV{v > 0 ? '+' : ''}{v}
                  </button>
                ))}
              </div>
            }>
            <EChart option={curveOption} notMerge />
            <div className="mt-1 text-[10px] text-white/35 leading-relaxed">
              这里是立即重估，不含时间流逝收益。空 Vega 仓位在 IV 上升时曲线会被压低；看 IV 回落收益可切到 IV-10 / IV-20。
            </div>
          </Card>
        </div>

        {/* ── 重点情景读数 ── */}
        <div className="flex items-stretch gap-3 shrink-0">
          <div className="flex-1 flex items-center gap-8 px-4 py-3 rounded-[8px] bg-[var(--color-surface-2)] ring-1 ring-inset ring-white/[0.06]">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.04em] text-white/38">重点情景</span>
              <span className="mt-0.5 text-[11px] font-semibold text-white/55">BTC/ETH −20% · IV +30pt</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.04em] text-white/38">瞬时 P&L</span>
              <span className="mt-0.5 text-[18px] font-bold tabular-nums leading-none" style={{ color: sgnColor(keyPnl) }}>{fmtUsd(keyPnl)}</span>
            </div>
            <div className="ml-auto flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-[0.04em] text-white/38">矩阵内最差</span>
              <span className="mt-0.5 text-[18px] font-bold tabular-nums leading-none" style={{ color: sgnColor(worstPnl) }}>{fmtUsd(worstPnl)}</span>
            </div>
          </div>
        </div>

        {/* ── P&L 归因（按希腊，每日累积）── */}
        <Card title="P&L 归因（按希腊字母，每日累积）" className="shrink-0 h-[300px]"
          right={!hasMeaningfulAttrib
            ? <span className="text-[10px] text-white/40 font-semibold">仅真实仓位 · 需要有效日变化</span>
            : <span className="text-[10px] text-[#28C840] font-semibold">本地累积 · {snaps.length} 天</span>}>
          {!hasMeaningfulAttrib ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <span className="text-[12px] font-semibold text-white/42">暂无有效归因数据</span>
              <span className="text-[10px] text-white/32">需要至少两天真实仓位快照，且 spot / DVOL 有变化；模拟仓不参与每日归因。</span>
            </div>
          ) : <EChart option={attribOption} notMerge />}
        </Card>
        <div className="text-[10px] text-white/35 leading-relaxed shrink-0 -mt-1">
          每日归因只统计真实仓位：Delta=方向、Gamma=凸性、Vega=波动、Theta=时间（用前一日希腊 × 当日 spot/DVOL 变化估算）。
          需跨交易日打开本页留下快照；只有当天或所有变化为 0 时不会画图。
        </div>

        {/* ── 持仓明细 ── */}
        <Card title={`持仓明细 · ${positions.length}`} className="flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                  <th className="text-left font-medium py-1.5 px-2">合约</th>
                  <th className="text-left font-medium py-1.5 px-2">来源</th>
                  <th className="text-right font-medium py-1.5 px-2">数量</th>
                  <th className="text-right font-medium py-1.5 px-2">$Δ</th>
                  <th className="text-right font-medium py-1.5 px-2">$Γ/1%</th>
                  <th className="text-right font-medium py-1.5 px-2">$ν/1%</th>
                  <th className="text-right font-medium py-1.5 px-2">$Θ/日</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.id} className="border-t border-white/[0.05] hover:bg-white/[0.025]">
                    <td className="py-1.5 px-2 font-mono text-white/80 whitespace-nowrap">
                      {p.sim && <span className="mr-1.5 text-[9px] font-bold px-1.5 py-[1px] rounded-full align-middle" style={{ background: 'rgba(254,188,46,0.16)', color: '#FEBC2E' }}>模拟</span>}
                      {p.instrument}
                    </td>
                    <td className="py-1.5 px-2 text-white/50">{p.sim ? '—' : p.venue}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: p.qty >= 0 ? UP : DOWN }}>{p.qty > 0 ? '+' : ''}{p.qty}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarDelta) }}>{fmtUsd(p.dollarDelta)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarGamma) }}>{fmtUsd(p.dollarGamma)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarVega) }}>{fmtUsd(p.dollarVega)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarTheta) }}>{fmtUsd(p.dollarTheta)}</td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[12px] font-semibold text-white/38">
                      当前口径下暂无持仓
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-white/35 leading-relaxed">
            压力测试为基于希腊字母的情景估算（Δ + ½Γ + Vega + Theta）；大幅冲击下忽略高阶项，仅作风险量级参考。
          </div>
        </Card>

      </div>
    </div>
  );
};

export default PortfolioRiskView;
