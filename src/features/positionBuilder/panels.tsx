// Right-rail analysis panels for the position builder. Each is a presentational
// component driven by one memoized dataset from PositionBuilder.

import { cn } from '../../lib/utils';
import { Panel } from './Panel';
import { SPOT_OFFSETS, IV_OFFSETS, HEATMAP_SPOT, HEATMAP_IV, formatHours, gClass } from './constants';

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
