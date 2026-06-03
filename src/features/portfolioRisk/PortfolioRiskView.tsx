import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { FlaskConical, AlertTriangle } from 'lucide-react';
import { EChart } from '../../components/echart/EChart';
import {
  POS_STORE, buildLiveFromCache, POS_TICKER_CACHE, subscribePositions,
  DERIBIT_WS, WS_FLUSH_MS,
  type UserPosition, type LivePosition,
} from '../../registry/monitorWidgetsBase';
import { useLiveSpot } from '../optionsChain/liveData';
import { fetchAllPositions } from '../accounts/sync';
import type { UnifiedPosition } from '../accounts/types';
import {
  fromDeribit, fromAccounts, buildBooks, totals, portfolioScenarioPnL, samplePositions,
  type RiskPosition,
} from './aggregate';

const UP = '#28C840';
const DOWN = '#FF5F57';
const MUTE = 'rgba(255,255,255,0.5)';

// 压力测试网格
const SPOT_SHOCKS = [20, 15, 10, 5, 0, -5, -10, -15, -20]; // 行（上→下：涨→跌）
const IV_SHOCKS = [-20, -10, 0, 10, 20, 30];               // 列
const KEY_CELL = { spot: -20, iv: 30 };                     // 重点情景：BTC −20% & IV +30%

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
  <div className={`flex flex-col rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] ${className}`}>
    <div className="flex items-center px-4 pt-3 pb-2 shrink-0">
      <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    <div className="flex-1 min-h-0 px-3 pb-3">{children}</div>
  </div>
);

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
      DERIBIT_WS.subscribe<Record<string, unknown>>(`ticker.${inst}.raw`, d => {
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

  // 真实账户持仓（HL/Bybit/Deribit，跨所），进页同步一次
  const [acctPositions, setAcctPositions] = useState<UnifiedPosition[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchAllPositions().then(p => { if (alive) setAcctPositions(p); });
    return () => { alive = false; };
  }, []);
  const acctRisk = useMemo(
    () => fromAccounts(acctPositions, { BTC: btcSpot ?? 0, ETH: ethSpot ?? 0 }),
    [acctPositions, btcSpot, ethSpot],
  );

  const liveRisk = useMemo(() => fromDeribit(live), [live]);
  // 真实book = 账户实盘 + Deribit 手动录入（旧路径）
  const realRisk = useMemo(() => [...acctRisk, ...liveRisk], [acctRisk, liveRisk]);
  const hasLive = realRisk.length > 0;

  const [forceSample, setForceSample] = useState(false);
  const usingSample = forceSample || !hasLive;

  const positions: RiskPosition[] = useMemo(
    () => (usingSample ? samplePositions(btcSpot ?? 67000, ethSpot ?? 3500) : realRisk),
    [usingSample, realRisk, btcSpot, ethSpot],
  );

  const books = useMemo(() => buildBooks(positions), [positions]);
  const tot = useMemo(() => totals(books), [books]);

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
      formatter: (p: unknown) => {
        const d = (p as { data: [number, number, number] }).data;
        return `Spot ${SPOT_SHOCKS[d[1]] > 0 ? '+' : ''}${SPOT_SHOCKS[d[1]]}% · IV ${IV_SHOCKS[d[0]] > 0 ? '+' : ''}${IV_SHOCKS[d[0]]}pt<br/>组合 P&L <b style="color:${sgnColor(d[2])}">${fmtUsd(d[2])}</b>`;
      },
    },
    xAxis: {
      type: 'category', data: IV_SHOCKS.map(v => `${v > 0 ? '+' : ''}${v}`), name: 'IV 冲击 (pt)', nameLocation: 'middle', nameGap: 22,
      nameTextStyle: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false },
    },
    yAxis: {
      type: 'category', data: SPOT_SHOCKS.map(v => `${v > 0 ? '+' : ''}${v}%`),
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false },
    },
    visualMap: {
      min: -matrix.absMax, max: matrix.absMax, show: false,
      inRange: { color: ['#7a1f1f', '#3a1414', '#16181d', '#143a1e', '#1f7a35'] },
    },
    series: [{
      type: 'heatmap', data: matrix.cells,
      label: {
        show: true, fontSize: 9, fontWeight: 'bold',
        formatter: (p: { data: [number, number, number] }) => fmtUsd(p.data[2]),
        color: 'rgba(255,255,255,0.85)',
      },
      itemStyle: { borderColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderRadius: 2 },
      emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1.5 } },
      markPoint: {
        symbol: 'rect', symbolSize: [1, 1], silent: true,
        data: [{
          xAxis: IV_SHOCKS.indexOf(KEY_CELL.iv), yAxis: SPOT_SHOCKS.indexOf(KEY_CELL.spot),
          itemStyle: { color: 'transparent', borderColor: '#FEBC2E', borderWidth: 2 },
          symbolSize: [Math.floor(640 / IV_SHOCKS.length), Math.floor(300 / SPOT_SHOCKS.length)],
        }],
      },
    }],
  }), [matrix]);

  // ── P&L vs Spot 曲线（当前 IV 与 IV+20）──
  const [ivLine, setIvLine] = useState(20);
  const curveOption = useMemo<EChartsOption>(() => {
    const xs: number[] = [];
    for (let p = -30; p <= 30; p += 2) xs.push(p);
    const base = xs.map(p => +portfolioScenarioPnL(books, { spotPct: p, ivPts: 0, dtDays: 0 }).toFixed(0));
    const shocked = xs.map(p => +portfolioScenarioPnL(books, { spotPct: p, ivPts: ivLine, dtDays: 0 }).toFixed(0));
    return {
      grid: { left: 8, right: 14, top: 16, bottom: 24, containLabel: true },
      legend: {
        data: [{ name: 'IV 不变', icon: 'roundRect' }, { name: `IV +${ivLine}pt`, icon: 'roundRect' }],
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
        { name: `IV +${ivLine}pt`, type: 'line', smooth: 0.2, showSymbol: false, data: shocked,
          lineStyle: { color: '#4ea1ff', width: 2 }, areaStyle: { color: 'rgba(78,161,255,0.08)' } },
      ],
    };
  }, [books, ivLine]);

  const keyPnl = portfolioScenarioPnL(books, { spotPct: KEY_CELL.spot, ivPts: KEY_CELL.iv, dtDays: 0 });
  const worstPnl = Math.min(...matrix.cells.map(c => c[2]));

  return (
    <div className="absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* ── 提示条 ── */}
        <div className="flex items-center gap-2 flex-wrap shrink-0 text-[11px]">
          {usingSample ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--nexus-yellow,#FEBC2E)]/[0.12] ring-1 ring-inset ring-[#FEBC2E]/30 text-[#FEBC2E] font-semibold">
              <FlaskConical size={13} /> 示例组合{!hasLive && '（无实时持仓）'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--nexus-green,#28C840)]/[0.12] ring-1 ring-inset ring-[#28C840]/30 text-[#28C840] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#28C840] animate-pulse" /> 实盘账户 · {tot.count} 持仓
            </span>
          )}
          {hasLive && (
            <button onClick={() => setForceSample(s => !s)}
              className="px-2.5 py-1 rounded-md bg-white/[0.06] text-white/65 ring-1 ring-inset ring-white/10 font-semibold hover:bg-white/[0.1] transition-colors">
              {forceSample ? '切回实时持仓' : '查看示例'}
            </button>
          )}
          <span className="ml-auto text-white/35">净希腊 = 各所实盘持仓（HL/Bybit/Deribit，1张=1币、$Δ=delta×现价）· 请对照交易所核对</span>
        </div>

        {/* ── 净美元希腊（总 + 分币种）── */}
        <Card title="全账户净美元希腊" className="shrink-0">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-6 px-3 py-2.5 rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]">
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
          </div>
        </Card>

        {/* ── 压力测试 ── */}
        <div className="grid grid-cols-12 gap-3 shrink-0">
          <Card title="组合压力测试矩阵（Spot × IV，瞬时 P&L）" className="col-span-12 lg:col-span-7 h-[340px]"
            right={<span className="text-[10px] text-[#FEBC2E] font-semibold">黄框 = BTC −20% & IV +30%</span>}>
            <EChart option={matrixOption} notMerge />
          </Card>
          <Card title="组合 P&L vs Spot" className="col-span-12 lg:col-span-5 h-[340px]"
            right={
              <div className="flex items-center gap-1">
                {[10, 20, 30].map(v => (
                  <button key={v} onClick={() => setIvLine(v)}
                    className={`px-1.5 h-[22px] rounded text-[10px] font-semibold ${ivLine === v ? 'bg-[#4ea1ff]/20 text-[#4ea1ff] ring-1 ring-inset ring-[#4ea1ff]/40' : 'text-white/45 hover:text-white/75'}`}>
                    IV+{v}
                  </button>
                ))}
              </div>
            }>
            <EChart option={curveOption} notMerge />
          </Card>
        </div>

        {/* ── 重点情景读数 ── */}
        <div className="flex items-stretch gap-3 shrink-0">
          <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#FEBC2E]/[0.06] ring-1 ring-inset ring-[#FEBC2E]/25">
            <AlertTriangle size={20} className="text-[#FEBC2E] shrink-0" />
            <div className="flex flex-col">
              <span className="text-[11px] text-white/55">重点情景：BTC/ETH −20% 且 IV +30pt（瞬时）</span>
              <span className="text-[20px] font-bold tabular-nums" style={{ color: sgnColor(keyPnl) }}>{fmtUsd(keyPnl)}</span>
            </div>
            <div className="ml-auto flex flex-col items-end">
              <span className="text-[11px] text-white/55">矩阵内最差</span>
              <span className="text-[16px] font-bold tabular-nums" style={{ color: sgnColor(worstPnl) }}>{fmtUsd(worstPnl)}</span>
            </div>
          </div>
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
                    <td className="py-1.5 px-2 font-mono text-white/80 whitespace-nowrap">{p.instrument}</td>
                    <td className="py-1.5 px-2 text-white/50">{p.venue}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: p.qty >= 0 ? UP : DOWN }}>{p.qty > 0 ? '+' : ''}{p.qty}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarDelta) }}>{fmtUsd(p.dollarDelta)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarGamma) }}>{fmtUsd(p.dollarGamma)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarVega) }}>{fmtUsd(p.dollarVega)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: sgnColor(p.dollarTheta) }}>{fmtUsd(p.dollarTheta)}</td>
                  </tr>
                ))}
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
