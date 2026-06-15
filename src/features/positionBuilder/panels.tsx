// Right-rail analysis panels for the position builder. Each is a presentational
// component driven by one memoized dataset from PositionBuilder.

import type { Dispatch, SetStateAction, Ref } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import echarts from '../../components/echart/echartsCore';
import { cn } from '../../lib/utils';
import { Panel } from './Panel';
import { SPOT_OFFSETS, IV_OFFSETS, HEATMAP_SPOT, HEATMAP_IV, INPUT_CLS, SELECT_CLS, formatHours, gClass } from './constants';
import { bsGreeks, hoursToYears } from './greeks';
import type { Leg, ExpiryGroup } from './types';

interface VaRStats { var95: number; var99: number; cvar95: number; cvar99: number }

// Expiry P/L heat-matrix across spot offset × IV offset; click a cell to jump there.
export function ScenarioMatrixPanel({
  scenarioMatrix, matrixAbsMax, spotPctOffset, ivAdjust, setSpotPctOffset, setIvAdjust,
  rho, volBeta, correlatedMode,
}: {
  scenarioMatrix: number[][];
  matrixAbsMax: number;
  spotPctOffset: number;
  ivAdjust: number;
  setSpotPctOffset: (n: number) => void;
  setIvAdjust: (n: number) => void;
  rho: number;
  volBeta: number;
  correlatedMode: boolean;
}) {
  return (
    <Panel title="情景矩阵" subtitle="到期 P/L (USDT) · spot 偏移 × IV 偏移">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-[11px]">
          <thead>
            <tr>
              <th className="text-left text-white/55 font-normal pb-1 pr-2 whitespace-nowrap">IV \ 价格</th>
              {SPOT_OFFSETS.map(s => (
                <th key={s} className={cn(
                  'text-center font-mono font-normal pb-1 px-1',
                  s === 0 ? 'text-white/60' : s < 0 ? 'text-[var(--nexus-red)]/60' : 'text-[var(--nexus-green)]/60',
                )}>
                  {s >= 0 ? '+' : ''}{s}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IV_OFFSETS.map((ivOff, ri) => (
              <tr key={ivOff}>
                <td className={cn(
                  'text-right pr-2 font-mono whitespace-nowrap',
                  ivOff === 0 ? 'text-white/60' : 'text-white/65',
                )}>
                  {ivOff >= 0 ? '+' : ''}{(ivOff * 100).toFixed(0)}%
                </td>
                {SPOT_OFFSETS.map((spotOff, ci) => {
                  const val = scenarioMatrix[ri][ci];
                  const intensity = Math.min(0.72, Math.abs(val) / matrixAbsMax * 0.72);
                  const isActive = Math.abs(spotOff - spotPctOffset) < 5.5
                                && Math.abs(ivOff - ivAdjust) < 0.08;
                  // Correlated path: for this spot column, the "realistic" IV row
                  const correlatedIv = -rho * volBeta * spotOff / 100;
                  const isCorrelated = correlatedMode
                    && Math.abs(ivOff - correlatedIv) === Math.min(
                      ...IV_OFFSETS.map(iv => Math.abs(iv - correlatedIv))
                    );
                  return (
                    <td key={spotOff}
                      style={{
                        backgroundColor: val > 0
                          ? `rgba(52,211,153,${intensity})`
                          : val < 0
                          ? `rgba(248,113,113,${intensity})`
                          : 'transparent',
                      }}
                      className={cn(
                        'text-center py-1 px-1.5 font-mono rounded-[4px] cursor-pointer transition-all',
                        val > 0 ? 'text-green-200' : val < 0 ? 'text-red-200' : 'text-white/55',
                        isActive && 'ring-1 ring-[var(--nexus-accent)]/70 ring-inset',
                        isCorrelated && !isActive && 'ring-1 ring-[var(--nexus-yellow)]/50 ring-inset',
                      )}
                      onClick={() => { setSpotPctOffset(spotOff); setIvAdjust(ivOff); }}
                      title={`spot ${spotOff >= 0 ? '+' : ''}${spotOff}% / IV ${ivOff >= 0 ? '+' : ''}${(ivOff * 100).toFixed(0)}%${isCorrelated ? ' ← 相关路径' : ''}`}
                    >
                      {val >= 0 ? '+' : ''}{val.toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-white/55 mt-2">点击任意格子跳转到该情景 · 高亮格 = 当前情景参数</p>
    </Panel>
  );
}

// Greeks across a ±15% spot ladder at the current scenario; click a row to jump.
export function GreeksLadderPanel({
  greeksLadder, symbol, hoursForward, spotPctOffset, setSpotPctOffset,
}: {
  greeksLadder: { pct: number; S: number; pl: number; delta: number; gamma: number; theta: number }[];
  symbol: string;
  hoursForward: number;
  spotPctOffset: number;
  setSpotPctOffset: (n: number) => void;
}) {
  return (
    <Panel title="希腊字母价格阶梯" subtitle={`当前情景设置 · Spot 偏移 ±15% · ${formatHours(hoursForward)} 时间快进`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-separate border-spacing-y-[2px]">
          <thead>
            <tr className="text-white/55 text-[10px] uppercase tracking-[0.06em]">
              <th className="text-left pb-2 font-normal">价格偏移</th>
              <th className="text-right pb-2 font-normal pr-2">{symbol} 价格</th>
              <th className="text-right pb-2 font-normal pr-2">P/L</th>
              <th className="text-right pb-2 font-normal pr-2">Delta</th>
              <th className="text-right pb-2 font-normal pr-2">Gamma</th>
              <th className="text-right pb-2 font-normal">Theta/天</th>
            </tr>
          </thead>
          <tbody>
            {greeksLadder.map(row => {
              const isCurrent = row.pct === 0;
              const isNearCurrent = Math.abs(row.pct - spotPctOffset) < 3;
              return (
                <tr key={row.pct}
                  className={cn(
                    'rounded-[4px] cursor-pointer transition-colors',
                    isCurrent ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]',
                    isNearCurrent && !isCurrent && 'ring-1 ring-inset ring-[var(--nexus-accent)]/35',
                  )}
                  onClick={() => setSpotPctOffset(row.pct)}
                >
                  <td className={cn('pl-2 py-1.5 rounded-l-[4px] font-mono',
                    row.pct < 0 ? 'text-[var(--nexus-red)]/70' : row.pct > 0 ? 'text-[var(--nexus-green)]/70' : 'text-white/50',
                  )}>
                    {row.pct >= 0 ? '+' : ''}{row.pct}%
                  </td>
                  <td className="text-right pr-2 font-mono text-white/55">
                    {row.S.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </td>
                  <td className={cn('text-right pr-2 font-mono font-semibold', gClass(row.pl))}>
                    {row.pl >= 0 ? '+' : ''}{row.pl.toFixed(2)}
                  </td>
                  <td className={cn('text-right pr-2 font-mono', gClass(row.delta))}>
                    {row.delta >= 0 ? '+' : ''}{row.delta.toFixed(3)}
                  </td>
                  <td className={cn('text-right pr-2 font-mono', gClass(row.gamma))}>
                    {row.gamma.toFixed(5)}
                  </td>
                  <td className={cn('text-right pr-2 rounded-r-[4px] font-mono', gClass(row.theta))}>
                    {row.theta.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-white/55 mt-1.5">点击行跳转到对应 Spot 偏移情景</p>
    </Panel>
  );
}

// Structure tab: daily theta bars + cumulative P/L line over the position's life.
export function ThetaCalendarPanel({ thetaCalendar }: {
  thetaCalendar: { day: number; daily: number; cumPL: number }[];
}) {
  return (
    <Panel title="每日 Theta 日历" subtitle={`以情景基准价为锚 · ${thetaCalendar.length} 天 · 柱 = 日收益 / 线 = 累计 P/L`}>
      {(() => {
        const W = 560, H = 130, PAD = { l: 38, r: 10, t: 8, b: 22 };
        const innerW = W - PAD.l - PAD.r;
        const innerH = H - PAD.t - PAD.b;
        const n = thetaCalendar.length;
        const barW = Math.max(1, innerW / n - 1);

        const dailyMin = Math.min(...thetaCalendar.map(r => r.daily));
        const dailyMax = Math.max(...thetaCalendar.map(r => r.daily));
        const cumMin   = Math.min(...thetaCalendar.map(r => r.cumPL), 0);
        const cumMax   = Math.max(...thetaCalendar.map(r => r.cumPL), 0);

        // Normalise two independent scales
        const dRange = dailyMax - dailyMin || 1;
        const cRange = cumMax - cumMin || 1;
        const zero_y = PAD.t + innerH * (dailyMax / dRange);

        const sy  = (v: number) => PAD.t + innerH * (1 - (v - dailyMin) / dRange);
        const scy = (v: number) => PAD.t + innerH * (1 - (v - cumMin)   / cRange);
        const sx  = (i: number) => PAD.l + (i + 0.5) * (innerW / n);

        const cumPath = thetaCalendar.map((r, i) =>
          `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${scy(r.cumPL).toFixed(1)}`
        ).join(' ');

        // Tick marks: every 7 days or every 30
        const tickStep = n <= 60 ? 7 : 30;

        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
            {/* Zero baseline */}
            <line x1={PAD.l} x2={W - PAD.r} y1={zero_y} y2={zero_y} stroke="#2e2e2e" strokeWidth="1" />
            {/* Daily theta bars */}
            {thetaCalendar.map((r, i) => {
              const barH = Math.abs(sy(r.daily) - zero_y);
              const barY = r.daily >= 0 ? zero_y - barH : zero_y;
              return (
                <rect key={i}
                  x={PAD.l + i * (innerW / n)}
                  y={barY} width={barW} height={Math.max(1, barH)}
                  fill={r.daily >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.55)'}
                >
                  <title>Day {r.day}: {r.daily >= 0 ? '+' : ''}{r.daily.toFixed(2)} / 累计 {r.cumPL.toFixed(2)}</title>
                </rect>
              );
            })}
            {/* Cumulative P/L line (right scale) */}
            <path d={cumPath} fill="none" stroke="#FEBC2E" strokeWidth="1.5" strokeOpacity="0.8" />
            {/* X-axis tick labels */}
            {thetaCalendar.filter((_, i) => i % tickStep === tickStep - 1).map((r, _) => (
              <text key={r.day} x={sx(r.day - 1)} y={H - 4}
                textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.25)">
                D{r.day}
              </text>
            ))}
            {/* Left y-axis label */}
            <text x="3" y={H / 2} fontSize="7" fill="rgba(255,255,255,0.2)"
              textAnchor="middle" transform={`rotate(-90,7,${H / 2})`}>日θ</text>
            {/* Right y-axis label */}
            <text x={W - 3} y={H / 2} fontSize="7" fill="rgba(251,191,36,0.4)"
              textAnchor="middle" transform={`rotate(90,${W - 5},${H / 2})`}>累计</text>
          </svg>
        );
      })()}
      <div className="flex gap-4 mt-1.5 text-[10px] text-white/55 flex-wrap">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-[rgba(52,211,153,0.55)]" />每日正收益（卖方）</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-[rgba(248,113,113,0.55)]" />每日 Theta 损耗（买方）</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-[#FEBC2E] opacity-60" />累计 P/L（右轴）</span>
        <span className="ml-auto">总 Theta 衰减 {thetaCalendar[thetaCalendar.length - 1].cumPL.toFixed(2)} USDT</span>
      </div>
    </Panel>
  );
}

// Greeks tab: Δ/Γ/ν heat-grid across spot × IV offsets, with a metric toggle.
export function GreeksHeatmapPanel({
  greeksHeatmapData, heatmapMetric, setHeatmapMetric, spotPctOffset, ivAdjust,
}: {
  greeksHeatmapData: number[][];
  heatmapMetric: 'delta' | 'gamma' | 'vega';
  setHeatmapMetric: (m: 'delta' | 'gamma' | 'vega') => void;
  spotPctOffset: number;
  ivAdjust: number;
}) {
  return (
    <Panel title="Greeks 热力图"
      subtitle={`${heatmapMetric === 'delta' ? 'Delta' : heatmapMetric === 'gamma' ? 'Gamma' : 'Vega'} · Spot 偏移 × IV 偏移（以入场时间为基点）`}
      actions={
        <div className="flex gap-1">
          {(['delta', 'gamma', 'vega'] as const).map(m => (
            <button key={m} onClick={() => setHeatmapMetric(m)}
              className={cn(
                'px-2 py-0.5 rounded-[5px] text-[11px] border transition-colors',
                heatmapMetric === m
                  ? 'bg-[var(--nexus-accent)]/15 border-[var(--nexus-accent)]/30 text-[var(--nexus-accent)]/80'
                  : 'bg-white/[0.03] border-white/[0.07] text-white/55 hover:text-white/60',
              )}>
              {m === 'delta' ? 'Δ Delta' : m === 'gamma' ? 'Γ Gamma' : 'ν Vega'}
            </button>
          ))}
        </div>
      }
    >
      {(() => {
        const absMax = Math.max(1e-8, ...greeksHeatmapData.flat().map(Math.abs));
        const fmt = (v: number) => heatmapMetric === 'gamma' ? v.toFixed(4) : v.toFixed(3);
        return (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-[3px] text-[11px]">
              <thead>
                <tr>
                  <th className="text-left text-white/55 font-normal pb-1 pr-2 whitespace-nowrap">IV \ Spot</th>
                  {HEATMAP_SPOT.map(s => (
                    <th key={s} className={cn(
                      'text-center font-mono font-normal pb-1 px-1',
                      s === 0 ? 'text-white/60' : s < 0 ? 'text-[var(--nexus-red)]/60' : 'text-[var(--nexus-green)]/60',
                    )}>
                      {s >= 0 ? '+' : ''}{s}%
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HEATMAP_IV.map((ivOff, ri) => (
                  <tr key={ivOff}>
                    <td className={cn('text-right pr-2 font-mono whitespace-nowrap', ivOff === 0 ? 'text-white/60' : 'text-white/65')}>
                      {ivOff >= 0 ? '+' : ''}{(ivOff * 100).toFixed(0)}%
                    </td>
                    {greeksHeatmapData[ri].map((val, ci) => {
                      const intensity = Math.min(0.75, Math.abs(val) / absMax * 0.75);
                      const nearSpot = Math.abs(HEATMAP_SPOT[ci] - spotPctOffset) < 11;
                      const nearIv   = Math.abs(ivOff - ivAdjust) < 0.12;
                      return (
                        <td key={ci}
                          style={{ backgroundColor: val > 0 ? `rgba(52,211,153,${intensity})` : val < 0 ? `rgba(248,113,113,${intensity})` : 'transparent' }}
                          className={cn(
                            'text-center py-1 px-1.5 font-mono rounded-[4px]',
                            val > 0 ? 'text-green-200' : val < 0 ? 'text-red-200' : 'text-white/55',
                            nearSpot && nearIv && 'ring-1 ring-[var(--nexus-accent)]/70 ring-inset',
                          )}
                          title={`Spot ${HEATMAP_SPOT[ci] >= 0 ? '+' : ''}${HEATMAP_SPOT[ci]}% / IV ${ivOff >= 0 ? '+' : ''}${(ivOff * 100).toFixed(0)}%  →  ${heatmapMetric}=${fmt(val)}`}
                        >
                          {fmt(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
      <p className="text-[11px] text-white/55 mt-1.5">
        {heatmapMetric === 'delta' ? 'Delta 越大说明方向性敞口越强，绿 = 净多 / 红 = 净空'
         : heatmapMetric === 'gamma' ? 'Gamma 集中处是凸性最强的区域 — 绿 = 正 Gamma（买方）/ 红 = 负 Gamma（卖方）'
         : 'Vega 越大说明 IV 变动影响越强 — 绿 = 正 Vega（buy vol）/ 红 = 负 Vega（sell vol）'}
      </p>
    </Panel>
  );
}

// Risk tab: Monte-Carlo VaR/CVaR cards + P/L histogram + optional Merton jump risk.
export function VaRPanel({
  varCvar, setVarSeed, showJumpRisk, setShowJumpRisk,
  jumpLambda, setJumpLambda, jumpMuPct, setJumpMuPct, jumpSigPct, setJumpSigPct, jumpVaR,
}: {
  varCvar: VaRStats & { baseS: number; histEdges: number[]; histCounts: number[]; hWidth: number };
  setVarSeed: Dispatch<SetStateAction<number>>;
  showJumpRisk: boolean;
  setShowJumpRisk: Dispatch<SetStateAction<boolean>>;
  jumpLambda: number;
  setJumpLambda: Dispatch<SetStateAction<number>>;
  jumpMuPct: number;
  setJumpMuPct: Dispatch<SetStateAction<number>>;
  jumpSigPct: number;
  setJumpSigPct: Dispatch<SetStateAction<number>>;
  jumpVaR: VaRStats | null;
}) {
  return (
    <Panel title="风险价值 VaR / CVaR"
      subtitle={<span>1日 · 对数正态 MC 5000条路径 · 基准价 {varCvar.baseS.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>}
      actions={
        <button onClick={() => setVarSeed(s => s + 1)}
          className="flex items-center gap-1 px-2 py-1 rounded-[7px] bg-[#2B2D35] text-[11px] text-white/55 hover:text-white/70 hover:bg-[#3A3B40] transition-colors">
          ↺ 重算
        </button>
      }
    >
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'VaR 95%',  val: varCvar.var95,  hint: '5% 最差情形 P/L 下限' },
          { label: 'CVaR 95%', val: varCvar.cvar95, hint: '最差 5% 情形均值（尾部期望）' },
          { label: 'VaR 99%',  val: varCvar.var99,  hint: '1% 最差情形 P/L 下限' },
          { label: 'CVaR 99%', val: varCvar.cvar99, hint: '最差 1% 均值（Expected Shortfall）' },
        ].map(({ label, val, hint }) => (
          <div key={label} className="bg-[var(--color-surface-2)] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1">{label}</div>
            <div className={cn('text-[16px] font-mono tnum mb-1', val < 0 ? 'text-[var(--nexus-red)]' : 'text-[var(--nexus-green)]')}>
              {val >= 0 ? '+' : ''}{val.toFixed(2)}
            </div>
            <div className="text-[10px] text-white/55 leading-snug">{hint}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-white/55 mt-2">对数正态路径 · IV = 全局基础 IV · 仅腿位/Spot/IV 变化时自动刷新 · 点「重算」强制重新采样</p>

      {/* P/L distribution histogram */}
      {varCvar.histEdges.length > 0 && (() => {
        const { histEdges, histCounts, hWidth } = varCvar;
        const n = histCounts.length;
        const hMin = histEdges[0], hMax = histEdges[n - 1] + hWidth;
        const maxCount = Math.max(...histCounts);
        const W = 560, H = 80, PAD = { l: 36, r: 10, t: 4, b: 22 };
        const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
        const barW = innerW / n;
        const sx = (v: number) => PAD.l + ((v - hMin) / (hMax - hMin)) * innerW;
        const zeroX = sx(0), v95X = sx(varCvar.var95), v99X = sx(varCvar.var99);
        return (
          <div className="mt-3 pt-3 border-t border-white/[0.05]">
            <p className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-2">P/L 分布（5000 路径 · 1 日）</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
              {histCounts.map((count, i) => {
                const x = PAD.l + i * barW;
                const bh = maxCount > 0 ? (count / maxCount) * innerH : 0;
                const edge = histEdges[i];
                return (
                  <rect key={i} x={x + 0.5} y={PAD.t + innerH - bh}
                    width={Math.max(0.5, barW - 0.5)} height={bh}
                    fill={edge >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.55)'}>
                    <title>{edge.toFixed(0)}–{(edge + hWidth).toFixed(0)}: {count}条</title>
                  </rect>
                );
              })}
              {hMin < 0 && hMax > 0 && (
                <line x1={zeroX} x2={zeroX} y1={PAD.t} y2={PAD.t + innerH + 2}
                  stroke="#8a8a8a" strokeWidth="1" strokeDasharray="3,2" />
              )}
              <line x1={v95X} x2={v95X} y1={PAD.t} y2={PAD.t + innerH} stroke="#FEBC2E" strokeWidth="1.2" strokeDasharray="2,2" />
              <text x={v95X} y={PAD.t + innerH + 11} textAnchor="middle" fontSize="7" fill="rgba(251,191,36,0.65)">VaR95</text>
              <line x1={v99X} x2={v99X} y1={PAD.t} y2={PAD.t + innerH} stroke="#FF5F57" strokeWidth="1.2" strokeDasharray="2,2" />
              <text x={v99X} y={PAD.t + innerH + 11} textAnchor="middle" fontSize="7" fill="rgba(248,113,113,0.65)">VaR99</text>
              {[hMin, (hMin + hMax) / 2, hMax].map((v, i) => (
                <text key={i} x={sx(v)} y={H - 2} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)">
                  {v >= 0 ? '+' : ''}{v.toFixed(0)}
                </text>
              ))}
              <text x="4" y={H / 2 + 3} fontSize="7" fill="rgba(255,255,255,0.15)" textAnchor="middle" transform={`rotate(-90,7,${H / 2})`}>频率</text>
            </svg>
          </div>
        );
      })()}

      {/* Jump Risk (Merton model) */}
      <div className={cn(
        'mt-3 rounded-lg border p-3 transition-colors',
        showJumpRisk ? 'bg-[var(--nexus-yellow)]/[0.04] border-[var(--nexus-yellow)]/[0.18]' : 'bg-[var(--color-surface-2)] border-white/[0.06]',
      )}>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setShowJumpRisk(v => !v)}
            className={cn('w-8 h-4 rounded-full relative shrink-0 transition-colors', showJumpRisk ? 'bg-[var(--nexus-yellow)]/60' : 'bg-white/[0.1]')}>
            <span className={cn('absolute top-0.5 w-3 h-3 rounded-full transition-all', showJumpRisk ? 'left-[18px] bg-[var(--nexus-yellow)]' : 'left-0.5 bg-white/40')} />
          </button>
          <span className={cn('text-[12px] font-semibold', showJumpRisk ? 'text-[var(--nexus-yellow)]/80' : 'text-white/55')}>
            跳跃风险（Merton Jump-Diffusion）
          </span>
          {showJumpRisk && (
            <span className="text-[10px] text-[var(--nexus-yellow)]/50 ml-1">λ={jumpLambda}/年 · μ_J={jumpMuPct}% · σ_J={jumpSigPct}%</span>
          )}
        </div>
        {showJumpRisk && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[11px] text-white/55">跳跃频率 λ（/年）</span>
                  <span className="font-mono text-[11px] text-white/60">{jumpLambda.toFixed(1)}</span>
                </div>
                <input type="range" min="0" max="20" step="0.5" value={jumpLambda}
                  onChange={e => setJumpLambda(parseFloat(e.target.value))} className="w-full range-slider" />
                <p className="text-[10px] text-white/55 mt-1">加密典型值 2–5；极端年可达 10+</p>
              </div>
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[11px] text-white/55">均值跳幅 μ_J</span>
                  <span className="font-mono text-[11px] text-white/60">{jumpMuPct >= 0 ? '+' : ''}{jumpMuPct}%</span>
                </div>
                <input type="range" min="-50" max="30" value={jumpMuPct}
                  onChange={e => setJumpMuPct(parseInt(e.target.value))} className="w-full range-slider" />
                <p className="text-[10px] text-white/55 mt-1">负值 = 向下跳为主（加密典型）</p>
              </div>
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[11px] text-white/55">跳幅波动 σ_J</span>
                  <span className="font-mono text-[11px] text-white/60">{jumpSigPct}%</span>
                </div>
                <input type="range" min="1" max="40" value={jumpSigPct}
                  onChange={e => setJumpSigPct(parseInt(e.target.value))} className="w-full range-slider" />
                <p className="text-[10px] text-white/55 mt-1">每次跳跃幅度的标准差</p>
              </div>
            </div>
            {jumpVaR && (
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'VaR 95% (+跳)', val: jumpVaR.var95  },
                  { label: 'CVaR 95% (+跳)', val: jumpVaR.cvar95 },
                  { label: 'VaR 99% (+跳)', val: jumpVaR.var99  },
                  { label: 'CVaR 99% (+跳)', val: jumpVaR.cvar99 },
                ].map(({ label, val }) => (
                  <div key={label} className="bg-[var(--nexus-yellow)]/[0.05] border border-[var(--nexus-yellow)]/[0.12] rounded-[8px] p-2">
                    <div className="text-[10px] text-[var(--nexus-yellow)]/40 uppercase tracking-[0.05em] mb-1">{label}</div>
                    <div className={cn('text-[14px] font-mono tnum', val < 0 ? 'text-[var(--nexus-red)]' : 'text-[var(--nexus-green)]')}>
                      {val >= 0 ? '+' : ''}{val.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

// Risk tab: first-order P/L attribution to greeks + waterfall chart.
export function PLAttributionPanel({
  plAttribution, currentS, spot, hoursForward, ivAdjust,
}: {
  plAttribution: { plDelta: number; plGamma: number; plTheta: number; plVega: number; plResidual: number; plTotal: number };
  currentS: number;
  spot: number;
  hoursForward: number;
  ivAdjust: number;
}) {
  return (
    <Panel title="P/L 归因" subtitle="当前情景 P/L 拆解为各希腊字母贡献（一阶近似，以入场价为基点）">
      <div className="grid grid-cols-6 gap-2 text-[12px]">
        {[
          { label: 'Delta', val: plAttribution.plDelta, hint: `δ×ΔS (ΔS=${currentS > spot ? '+' : ''}${(currentS-spot).toFixed(0)})` },
          { label: 'Gamma', val: plAttribution.plGamma, hint: `½γΔS²` },
          { label: 'Theta', val: plAttribution.plTheta, hint: `θ×${(hoursForward/24).toFixed(1)}d` },
          { label: 'Vega',  val: plAttribution.plVega,  hint: `ν×${ivAdjust>=0?'+':''}${(ivAdjust*100).toFixed(0)}%` },
          { label: '残差',  val: plAttribution.plResidual, hint: '高阶效应 + 模型误差' },
          { label: '合计',  val: plAttribution.plTotal,    hint: '情景总 P/L' },
        ].map(({ label, val, hint }) => (
          <div key={label} className={cn(
            'rounded-[8px] p-2.5 border',
            label === '合计'
              ? 'bg-[#3A3F40] border-transparent'
              : 'bg-[var(--color-surface-2)] border-white/[0.05]',
          )}>
            <div className="text-[10px] uppercase tracking-[0.06em] text-white/55 mb-1">{label}</div>
            <div className={cn('text-[15px] font-mono tnum mb-0.5', gClass(val))}>
              {val >= 0 ? '+' : ''}{val.toFixed(2)}
            </div>
            <div className="text-[10px] text-white/55 leading-snug">{hint}</div>
          </div>
        ))}
      </div>
      {/* Waterfall chart */}
      {(() => {
        const { plDelta, plGamma, plTheta, plVega, plResidual, plTotal } = plAttribution;
        const segs = [
          { label: 'Δ', val: plDelta,    col: '#ff9c2e' },
          { label: 'Γ', val: plGamma,    col: '#a78bfa' },
          { label: 'Θ', val: plTheta,    col: '#FEBC2E' },
          { label: 'ν', val: plVega,     col: '#28C840' },
          { label: '残', val: plResidual, col: '#FF5F57' },
        ];
        const runs: number[] = [];
        let r = 0;
        for (const s of segs) { runs.push(r); r += s.val; }
        const W = 480, H = 90, PL = 10, PR = 10, PT = 8, PB = 22;
        const iW = W - PL - PR, iH = H - PT - PB;
        const totalCols = segs.length + 2;
        const cW = iW / totalCols, bW = cW * 0.68, bP = cW * 0.16;
        const allY = [...runs, ...segs.map((s, i) => runs[i] + s.val), 0, plTotal];
        const yMin = Math.min(...allY), yMax = Math.max(...allY);
        const yRng = yMax - yMin || 1;
        const sy = (v: number) => PT + iH * (1 - (v - yMin) / yRng);
        const zY = sy(0);
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible mt-2">
            <line x1={PL} x2={W - PR} y1={zY} y2={zY} stroke="#2e2e2e" strokeWidth="1" />
            {segs.map((seg, i) => {
              const x = PL + i * cW + bP;
              const y1 = sy(runs[i]), y2 = sy(runs[i] + seg.val);
              const bY = Math.min(y1, y2), bH = Math.max(1, Math.abs(y1 - y2));
              const alpha = seg.val >= 0 ? 'cc' : '88';
              return (
                <g key={i}>
                  <rect x={x} y={bY} width={bW} height={bH}
                    fill={seg.col + alpha} stroke={seg.col} strokeWidth="0.5" strokeOpacity="0.5">
                    <title>{seg.label}: {seg.val >= 0 ? '+' : ''}{seg.val.toFixed(2)}</title>
                  </rect>
                  {i < segs.length - 1 && (
                    <line x1={x + bW} x2={x + cW + bP} y1={sy(runs[i] + seg.val)} y2={sy(runs[i] + seg.val)}
                      stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2,2" />
                  )}
                  <text x={x + bW / 2} y={H - 4} textAnchor="middle" fontSize="8.5"
                    fill={seg.col} fillOpacity="0.8">{seg.label}</text>
                  <text x={x + bW / 2} y={seg.val >= 0 ? bY - 2 : bY + bH + 8}
                    textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.4)">
                    {seg.val >= 0 ? '+' : ''}{seg.val.toFixed(1)}
                  </text>
                </g>
              );
            })}
            {(() => {
              const x = PL + (segs.length + 1) * cW + bP;
              const y1 = sy(0), y2 = sy(plTotal);
              const bY = Math.min(y1, y2), bH = Math.max(1, Math.abs(y1 - y2));
              const fill = plTotal >= 0 ? 'rgba(52,211,153,0.75)' : 'rgba(248,113,113,0.75)';
              const stroke = plTotal >= 0 ? '#28C840' : '#FF5F57';
              return (
                <g>
                  <rect x={x} y={bY} width={bW} height={bH} fill={fill} stroke={stroke} strokeWidth="1">
                    <title>合计: {plTotal >= 0 ? '+' : ''}{plTotal.toFixed(2)}</title>
                  </rect>
                  <text x={x + bW / 2} y={H - 4} textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.55)">合计</text>
                  <text x={x + bW / 2} y={plTotal >= 0 ? bY - 2 : bY + bH + 8}
                    textAnchor="middle" fontSize="7" fill={plTotal >= 0 ? 'rgba(52,211,153,0.85)' : 'rgba(248,113,113,0.85)'}>
                    {plTotal >= 0 ? '+' : ''}{plTotal.toFixed(1)}
                  </text>
                </g>
              );
            })()}
            <text x="5" y={zY + 3} fontSize="7" fill="rgba(255,255,255,0.2)">0</text>
          </svg>
        );
      })()}
      <div className="flex gap-3 mt-1.5 flex-wrap text-[10px] text-white/65">
        {[
          { label: 'Delta', color: '#ff9c2e' },
          { label: 'Gamma', color: '#a78bfa' },
          { label: 'Theta', color: '#FEBC2E' },
          { label: 'Vega',  color: '#28C840' },
          { label: '残差',  color: '#FF5F57' },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: color, opacity: 0.7 }} />
            {label}
          </span>
        ))}
      </div>
    </Panel>
  );
}

// Structure tab: per-leg IV — skew (left, IV vs strike) + term structure (right).
export function IVSkewPanel({ ivSkewData, spot }: {
  ivSkewData: {
    expiries: { ts: number; label: string; points: { strike: number; iv: number; type: string }[] }[];
    termStructure: { label: string; iv: number }[];
  };
  spot: number;
}) {
  return (
    <Panel title="IV 结构" subtitle="各腿市场 IV — 偏斜（左）· 期限结构（右）">
      <div className="grid grid-cols-2 gap-4">
        {/* Skew chart: per-expiry IV vs strike */}
        <div>
          <p className="text-[10px] text-white/55 uppercase tracking-[0.06em] mb-2">IV 偏斜（各到期日）</p>
          <svg viewBox="0 0 240 120" className="w-full overflow-visible">
            {(() => {
              const allPts = ivSkewData.expiries.flatMap(e => e.points);
              if (allPts.length === 0) return null;
              const strikes = allPts.map(p => p.strike);
              const ivs = allPts.map(p => p.iv);
              const sMin = Math.min(...strikes), sMax = Math.max(...strikes);
              const ivMin = Math.max(0, Math.min(...ivs) - 5), ivMax = Math.max(...ivs) + 5;
              const sx = (s: number) => ((s - sMin) / (sMax - sMin || 1)) * 220 + 10;
              const sy = (iv: number) => 110 - ((iv - ivMin) / (ivMax - ivMin || 1)) * 100;
              const COLORS = ['#ff9c2e', '#28C840', '#FEBC2E', '#FF5F57', '#a78bfa'];
              return ivSkewData.expiries.map((exp, ei) => {
                if (exp.points.length === 0) return null;
                const color = COLORS[ei % COLORS.length];
                const pts = exp.points.map(p => `${sx(p.strike).toFixed(1)},${sy(p.iv).toFixed(1)}`).join(' ');
                return (
                  <g key={exp.ts}>
                    {exp.points.length > 1 && (
                      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.7" />
                    )}
                    {exp.points.map((p, pi) => (
                      <circle key={pi} cx={sx(p.strike)} cy={sy(p.iv)} r="3"
                        fill={color} fillOpacity="0.8">
                        <title>{exp.label} K={p.strike} IV={p.iv.toFixed(1)}%</title>
                      </circle>
                    ))}
                    {/* Spot line */}
                    <line x1={sx(spot)} x2={sx(spot)} y1="10" y2="115"
                      stroke="#8a8a8a" strokeWidth="0.8" strokeDasharray="3,3" strokeOpacity="0.4" />
                  </g>
                );
              });
            })()}
            {/* Axes labels */}
            <text x="125" y="120" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)">行权价</text>
            <text x="2" y="60" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)" transform="rotate(-90,5,60)">IV %</text>
          </svg>
          <div className="flex gap-2 flex-wrap mt-1">
            {ivSkewData.expiries.map((exp, ei) => {
              const COLORS = ['#ff9c2e', '#28C840', '#FEBC2E', '#FF5F57', '#a78bfa'];
              return (
                <span key={exp.ts} className="flex items-center gap-1 text-[10px] text-white/65">
                  <span className="inline-block w-2 h-0.5" style={{ backgroundColor: COLORS[ei % COLORS.length] }} />
                  {exp.label}
                </span>
              );
            })}
          </div>
        </div>
        {/* Term structure: ATM IV per expiry */}
        <div>
          <p className="text-[10px] text-white/55 uppercase tracking-[0.06em] mb-2">期限结构（ATM IV）</p>
          {ivSkewData.termStructure.length < 2 ? (
            <p className="text-[11px] text-white/55 italic pt-4">需要至少 2 个到期日的数据</p>
          ) : (
            <svg viewBox="0 0 240 120" className="w-full overflow-visible">
              {(() => {
                const ts = ivSkewData.termStructure;
                const ivMin = Math.max(0, Math.min(...ts.map(t => t.iv)) - 5);
                const ivMax = Math.max(...ts.map(t => t.iv)) + 5;
                const n = ts.length;
                const sx = (i: number) => (i / (n - 1)) * 220 + 10;
                const sy = (iv: number) => 100 - ((iv - ivMin) / (ivMax - ivMin || 1)) * 90;
                const pts = ts.map((t, i) => `${sx(i).toFixed(1)},${sy(t.iv).toFixed(1)}`).join(' ');
                return (
                  <g>
                    <polyline points={pts} fill="none" stroke="#28C840" strokeWidth="1.5" strokeOpacity="0.8" />
                    {ts.map((t, i) => (
                      <g key={i}>
                        <circle cx={sx(i)} cy={sy(t.iv)} r="3" fill="#28C840" fillOpacity="0.85">
                          <title>{t.label}  ATM IV {t.iv.toFixed(1)}%</title>
                        </circle>
                        <text x={sx(i)} y="115" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.25)">{t.label}</text>
                        <text x={sx(i)} y={sy(t.iv) - 5} textAnchor="middle" fontSize="7" fill="rgba(52,211,153,0.7)">{t.iv.toFixed(1)}%</text>
                      </g>
                    ))}
                  </g>
                );
              })()}
              <text x="2" y="55" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.2)" transform="rotate(-90,5,55)">IV %</text>
            </svg>
          )}
        </div>
      </div>
      <p className="text-[11px] text-white/55 mt-2">数据来源：各腿 Deribit mark_iv · 点击刷新按钮更新</p>
    </Panel>
  );
}

// Always-visible scenario controls: time fast-forward, IV offset, spot offset.
export function ScenarioSliders({
  hoursForward, setHoursForward, maxHours, correlatedMode,
  ivAdjust, setIvAdjust, spotPctOffset, setSpotPctOffset,
}: {
  hoursForward: number;
  setHoursForward: (n: number) => void;
  maxHours: number;
  correlatedMode: boolean;
  ivAdjust: number;
  setIvAdjust: (n: number) => void;
  spotPctOffset: number;
  setSpotPctOffset: (n: number) => void;
}) {
  return (
    <div className="bg-[#17181E] rounded-xl px-4 py-3 flex flex-wrap gap-x-6 gap-y-3 items-center">
      <div className="flex items-center gap-3 flex-1 min-w-[160px]">
        <span className="text-[11px] text-white/65 uppercase tracking-[0.06em] shrink-0 w-14">时间快进</span>
        <input type="range" min="0" max={maxHours || 720} step="1" value={hoursForward}
          onChange={e => setHoursForward(Number(e.target.value))}
          className="range-slider flex-1" />
        <span className="text-[12px] font-mono tnum text-white/55 shrink-0 w-12 text-right">{formatHours(hoursForward)}</span>
      </div>
      <div className="flex items-center gap-3 flex-1 min-w-[160px]">
        <span className={cn('text-[11px] uppercase tracking-[0.06em] shrink-0 w-14', correlatedMode ? 'text-[var(--nexus-yellow)]/50' : 'text-white/65')}>
          {correlatedMode ? 'IV (ρ)' : 'IV 偏移'}
        </span>
        <input type="range" min="-60" max="100" step="1" value={Math.round(ivAdjust * 100)}
          disabled={correlatedMode}
          onChange={e => setIvAdjust(Number(e.target.value) / 100)}
          className={cn('range-slider flex-1', correlatedMode && 'opacity-30')} />
        <span className={cn('text-[12px] font-mono tnum shrink-0 w-12 text-right', ivAdjust > 0 ? 'text-[var(--nexus-red)]' : ivAdjust < 0 ? 'text-[var(--nexus-green)]' : 'text-white/55')}>
          {ivAdjust >= 0 ? '+' : ''}{(ivAdjust * 100).toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center gap-3 flex-1 min-w-[160px]">
        <span className="text-[11px] text-white/65 uppercase tracking-[0.06em] shrink-0 w-14">价格偏移</span>
        <input type="range" min="-30" max="30" step="0.5" value={spotPctOffset}
          onChange={e => setSpotPctOffset(Number(e.target.value))}
          className="range-slider flex-1" />
        <span className={cn('text-[12px] font-mono tnum shrink-0 w-12 text-right', spotPctOffset > 0 ? 'text-[var(--nexus-green)]' : spotPctOffset < 0 ? 'text-[var(--nexus-red)]' : 'text-white/55')}>
          {spotPctOffset >= 0 ? '+' : ''}{spotPctOffset.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// 8-cell read-only summary strip above the chart (strategy, IV rank, PoP, etc.).
export function PositionSummaryStrip({
  strategyName, ivRankPct, probOfProfit, netPremium, maxProfit, maxLoss, grk, currentS, totalSlippage,
}: {
  strategyName: string | null;
  ivRankPct: number | null;
  probOfProfit: number | null;
  netPremium: number;
  maxProfit: number | null;
  maxLoss: number | null;
  grk: { delta: number };
  currentS: number;
  totalSlippage: number;
}) {
  return (
    <div className="grid grid-cols-8 gap-px bg-[var(--color-surface-2)] rounded-xl overflow-hidden text-center text-[11px]">
      {[
        {
          label: '策略',
          value: strategyName ?? '—',
          color: strategyName ? 'text-[var(--nexus-accent)]/75' : 'text-white/55',
          hint: '自动识别策略结构',
        },
        {
          label: 'IV Rank',
          value: ivRankPct !== null ? `${ivRankPct.toFixed(0)}%` : '—',
          color: ivRankPct === null ? 'text-white/55'
               : ivRankPct > 70 ? 'text-[var(--nexus-red)]'
               : ivRankPct < 30 ? 'text-[var(--nexus-green)]'
               : 'text-[var(--nexus-yellow)]',
          hint: 'IV 历史百分位（高 = 可考虑卖方；低 = 买方占优）',
        },
        {
          label: '到期PoP',
          value: probOfProfit !== null ? `${(probOfProfit * 100).toFixed(1)}%` : '—',
          color: probOfProfit !== null ? (probOfProfit >= 0.5 ? 'text-[var(--nexus-green)]' : 'text-[var(--nexus-red)]') : 'text-white/65',
          hint: '对数正态到期盈利概率（风险中性）',
        },
        {
          label: '净权利金',
          value: `${netPremium >= 0 ? '−' : '+'}${Math.abs(netPremium).toFixed(2)}`,
          color: netPremium < 0 ? 'text-[var(--nexus-green)]' : 'text-[var(--nexus-red)]',
          hint: netPremium >= 0 ? '净付出（借方价差）' : '净收取（贷方价差）',
        },
        {
          label: '最大盈利',
          value: maxProfit === null ? '—' : maxProfit > 9999 ? '+∞' : `+${maxProfit.toFixed(0)}`,
          color: maxProfit !== null && maxProfit > 0 ? 'text-[var(--nexus-green)]' : 'text-white/65',
          hint: '图表范围内到期最大 P/L',
        },
        {
          label: '最大亏损',
          value: maxLoss === null ? '—' : maxLoss < -9999 ? '−∞' : maxLoss.toFixed(0),
          color: maxLoss !== null && maxLoss < 0 ? 'text-[var(--nexus-red)]' : 'text-white/65',
          hint: '图表范围内到期最大亏损',
        },
        {
          label: 'Δ 敞口',
          value: `${grk.delta >= 0 ? '+' : ''}${grk.delta.toFixed(3)}`,
          color: grk.delta > 0.05 ? 'text-[var(--nexus-green)]' : grk.delta < -0.05 ? 'text-[var(--nexus-red)]' : 'text-white/50',
          hint: `Delta = ${(grk.delta * currentS).toFixed(0)} USDT 名义方向敞口`,
        },
        {
          label: '入场摩擦',
          value: totalSlippage > 0 ? `−${totalSlippage.toFixed(2)}` : '—',
          color: totalSlippage > 0 ? 'text-[var(--nexus-yellow)]' : 'text-white/55',
          hint: '半点差×数量（以市价入场相对于中间价的成本）',
        },
      ].map(({ label, value, color, hint }) => (
        <div key={label} className="bg-[var(--color-surface-2)] py-2 px-1" title={hint}>
          <div className="text-[10px] uppercase tracking-[0.05em] text-white/55 mb-1">{label}</div>
          <div className={cn('font-mono tnum font-semibold text-[14px]', color)}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// Chart tab: payoff curve (current scenario / expiry / live / breakeven).
export function PLCurvePanel({ legs, showTimeSlices, setShowTimeSlices, chartRef, option }: {
  legs: unknown[];
  showTimeSlices: boolean;
  setShowTimeSlices: Dispatch<SetStateAction<boolean>>;
  chartRef: Ref<ReactECharts>;
  option: EChartsOption;
}) {
  return (
    <Panel title="损益曲线" noPadding noScroll
      subtitle={
        <span className="flex items-center gap-3 flex-wrap text-[12px] text-white/65">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-[2px] bg-[var(--nexus-accent)]" />当前情景</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed border-white/30" />到期</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full border-2 border-white bg-transparent" />实时</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rotate-45 bg-[#28C840]" />盈亏平衡</span>
          {legs.length > 0 && (
            <button
              onClick={() => setShowTimeSlices(v => !v)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] border text-[11px] transition-colors',
                showTimeSlices
                  ? 'border-[var(--nexus-accent)]/40 text-[var(--nexus-accent)]/80 bg-[var(--nexus-accent)]/10'
                  : 'border-transparent bg-[#2B2D35] text-white/65 hover:bg-[#3A3B40] hover:text-white/80',
              )}
            >
              <span className="inline-block w-3 border-t border-dotted border-current" />
              时间切片
            </button>
          )}
        </span>
      }
    >
      <ReactECharts
        ref={chartRef}
        echarts={echarts}
        option={option}
        notMerge={true}
        style={{ width: '100%', height: 400 }}
        opts={{ renderer: 'canvas' }}
      />
    </Panel>
  );
}

// Chart tab: Delta (left axis) / Gamma (right axis) profile curves.
export function DeltaGammaPanel({ chartRef, option }: {
  chartRef: Ref<ReactECharts>;
  option: EChartsOption;
}) {
  return (
    <Panel title="Delta / Gamma 曲线" noPadding noScroll
      subtitle={
        <span className="flex items-center gap-3 text-[12px] text-white/65">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-[2px] bg-[var(--nexus-accent)]" />Delta（左轴）</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dotted border-[#a78bfa]" />Gamma（右轴）</span>
        </span>
      }
    >
      <ReactECharts
        ref={chartRef}
        echarts={echarts}
        option={option}
        notMerge={true}
        style={{ width: '100%', height: 220 }}
        opts={{ renderer: 'canvas' }}
      />
    </Panel>
  );
}

// Left panel: base params, template picker, and the per-leg editor (the strategy core).
export function StrategyComposer({
  legs, refreshAllTickers, spot, setSpot, setLegs, repriceEntry, baseIv, setBaseIv,
  applyTemplate, clearAll, hoursForward, currentS, ivAdjust, expiryGroups,
  fetchTicker, removeLeg, updateLeg, clearDeferred, defer, resolveInstrument,
  instrumentsLoading, legCurrentValue, addLeg,
}: {
  legs: Leg[];
  refreshAllTickers: () => void;
  spot: number;
  setSpot: (n: number) => void;
  setLegs: Dispatch<SetStateAction<Leg[]>>;
  repriceEntry: (leg: Leg) => Leg;
  baseIv: number;
  setBaseIv: (n: number) => void;
  applyTemplate: (key: string) => void;
  clearAll: () => void;
  hoursForward: number;
  currentS: number;
  ivAdjust: number;
  expiryGroups: ExpiryGroup[];
  fetchTicker: (legId: number, instrumentName: string) => void;
  removeLeg: (id: number) => void;
  updateLeg: (id: number, patch: Partial<Leg>) => void;
  clearDeferred: () => void;
  defer: (fn: () => void, ms: number) => void;
  resolveInstrument: (legId: number, leg: Leg) => void;
  instrumentsLoading: boolean;
  legCurrentValue: (leg: Leg, S: number, hf: number, ivAdj: number) => number;
  addLeg: (partial?: Partial<Leg>) => void;
}) {
  return (
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
  );
}
