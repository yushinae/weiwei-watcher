// Right-rail analysis panels for the position builder. Each is a presentational
// component driven by one memoized dataset from PositionBuilder.

import { cn } from '../../lib/utils';
import { Panel } from './Panel';
import { SPOT_OFFSETS, IV_OFFSETS } from './constants';

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
