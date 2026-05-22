import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import { mapPts, poly, smooth, area } from '../lib/svg-utils';
import { useDeribitOptions } from './data-hooks';
import { subscribeData, SKEW_BUFFER } from './data-layer';
import type { FlowData } from './widgets-market';
import { useFlowData } from './widgets-market';
import {
  GRID, TXT, BRAND,
  CoinControlProps, useCoinControl, CoinTabs, LiveBadge, Skeleton,
} from './ui-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// FundingRateWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const FundingRateWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useFlowData(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.fundingHistory.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无资金费率数据</div>
  );

  const hist = data.fundingHistory;
  const pts = hist.slice(-90);
  const rates = pts.map(p => p.rate);
  const maxAbs = Math.max(Math.max(...rates.map(Math.abs)), 0.05);
  const W = 480, H = 120, PX = 6, PY = 10;
  const mid = H / 2;

  const mapY = (r: number) => mid - (r / maxAbs) * (mid - PY);
  const mapped: [number, number][] = rates.map((r, i) => [
    PX + (i / Math.max(rates.length - 1, 1)) * (W - 2 * PX),
    mapY(r),
  ]);

  const posArea = `M ${mapped[0][0].toFixed(1)} ${mid} ${mapped.map(([x, y]) => `L ${x.toFixed(1)} ${Math.min(y, mid).toFixed(1)}`).join(' ')} L ${mapped[mapped.length - 1][0].toFixed(1)} ${mid} Z`;
  const negArea = `M ${mapped[0][0].toFixed(1)} ${mid} ${mapped.map(([x, y]) => `L ${x.toFixed(1)} ${Math.max(y, mid).toFixed(1)}`).join(' ')} L ${mapped[mapped.length - 1][0].toFixed(1)} ${mid} Z`;

  const fmtRate = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(4)}%`;
  const fundColor = data.currentFunding8h >= 0 ? '#25e889' : '#f87171';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: '当前 8H 费率', val: fmtRate(data.currentFunding8h), color: fundColor },
          { label: '年化费率', val: `${data.annFunding >= 0 ? '+' : ''}${data.annFunding.toFixed(1)}%`, color: fundColor },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[13px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 px-3 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          <line x1={PX} y1={mid} x2={W - PX} y2={mid} stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
          <path d={posArea} fill="rgba(37,232,137,0.12)" />
          <path d={negArea} fill="rgba(248,113,113,0.12)" />
          <polyline
            points={mapped.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={fundColor}
            strokeWidth={1.5}
            opacity={0.85}
          />
          {[maxAbs, 0, -maxAbs].map(v => {
            const y = mapY(v);
            return (
              <text key={v} x={PX} y={y - 2} fontSize={8} fill={TXT}>{fmtRate(v)}</text>
            );
          })}
        </svg>
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        8小时资金费率（正值 = 多头付空头）· {coin}-PERPETUAL · Deribit
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// FuturesBasisWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const FuturesBasisWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useFlowData(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.basis.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无期货数据</div>
  );

  const { basis } = data;
  const maxBasis = Math.max(...basis.map(b => Math.abs(b.annBasis)), 1);
  const BAR_MAX = 180, ROW_H = 36, PAD_X = 12;

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="px-3 pt-2 pb-1 shrink-0">
        <span className="text-[10px] font-bold text-white/25 uppercase tracking-wider">年化基差（期货 vs 现货）</span>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-2">
        {basis.map((b, i) => {
          const barW = (Math.abs(b.annBasis) / maxBasis) * BAR_MAX;
          const color = b.annBasis >= 0 ? 'rgba(37,232,137,0.7)' : 'rgba(248,113,113,0.7)';
          const px = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
          return (
            <div key={i} className="flex items-center gap-3 py-1 border-b border-white/[0.04] last:border-0">
              <div className="w-[72px] shrink-0">
                <div className="text-[11px] font-mono font-semibold text-white/70">{b.label}</div>
                <div className="text-[9px] text-white/25">{b.daysToExp}天 · ${px(b.futurePx)}</div>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-[8px] bg-white/[0.04] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(barW / BAR_MAX) * 100}%`, background: color }}
                  />
                </div>
                <div className="w-[52px] text-right font-mono text-[11px] font-bold shrink-0" style={{ color }}>
                  {b.annBasis >= 0 ? '+' : ''}{b.annBasis.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        (期货价 / 现货价 − 1) × (365 / 剩余天数) · Deribit
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// OptionsFlowWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const OptionsFlowWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const callVol = data.callVol24h;
  const putVol  = data.putVol24h;
  const total   = callVol + putVol;
  const callPct = total > 0 ? (callVol / total) * 100 : 50;
  const putPct  = 100 - callPct;
  const volRatio = callVol > 0 ? putVol / callVol : 1;

  const fmtVol = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const sentiment = callPct > 55 ? { label: '看涨偏向', color: '#25e889' }
                  : callPct < 45 ? { label: '看跌偏向', color: '#f87171' }
                  : { label: '中性', color: '#F59E0B' };

  const expVol = (data.expiries.slice(0, 6)).map(e => ({
    label: e.label,
    callV: e.calls.reduce((s, o) => s + o.volume, 0),
    putV: e.puts.reduce((s, o) => s + o.volume, 0),
  }));
  const maxExpVol = Math.max(...expVol.map(e => e.callV + e.putV), 1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-2 shrink-0">
        {[
          { label: 'Call 成交量', val: fmtVol(callVol), color: '#25e889' },
          { label: 'Put 成交量', val: fmtVol(putVol), color: '#f87171' },
          { label: 'P/C 比', val: volRatio.toFixed(2), color: '#F59E0B' },
          { label: '方向', val: sentiment.label, color: sentiment.color },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="px-3 pb-2 shrink-0">
        <div className="flex items-center justify-between text-[9px] text-white/30 mb-1">
          <span>Call {callPct.toFixed(0)}%</span>
          <span>Put {putPct.toFixed(0)}%</span>
        </div>
        <div className="flex h-[6px] rounded-full overflow-hidden bg-white/[0.05]">
          <div className="h-full bg-[#25e889]/70 transition-all" style={{ width: `${callPct}%` }} />
          <div className="h-full bg-[#f87171]/70 flex-1" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1.5">按到期日拆分</div>
        {expVol.map((e, i) => {
          const total2 = e.callV + e.putV;
          const cPct = total2 > 0 ? (e.callV / total2) * 100 : 50;
          const barTotal = (total2 / maxExpVol) * 100;
          return (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <div className="w-[32px] text-[10px] font-mono text-white/40 shrink-0">{e.label}</div>
              <div className="flex-1 flex h-[12px] rounded-[3px] overflow-hidden bg-white/[0.04]" style={{ maxWidth: `${barTotal}%` }}>
                <div className="h-full bg-[#25e889]/60" style={{ width: `${cPct}%` }} />
                <div className="h-full bg-[#f87171]/60 flex-1" />
              </div>
              <div className="text-[9px] text-white/25 font-mono shrink-0 w-[28px] text-right">{fmtVol(total2)}</div>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        24H 期权成交量（合约数）· Deribit
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// FearGreedWidget
// ═══════════════════════════════════════════════════════════════════════════════

const FG_ZONES = [
  { min: 0,  max: 25,  label: '极度恐慌', color: '#ef4444' },
  { min: 25, max: 45,  label: '恐慌',     color: '#f97316' },
  { min: 45, max: 55,  label: '中性',     color: '#F59E0B' },
  { min: 55, max: 75,  label: '贪婪',     color: '#84cc16' },
  { min: 75, max: 100, label: '极度贪婪', color: '#22c55e' },
];
function fgColor(v: number) {
  return FG_ZONES.find(z => v >= z.min && v <= z.max)?.color ?? '#F59E0B';
}

export const FearGreedWidget = React.memo(() => {
  // Reuse the shared poller from useFlowData
  const [fearGreed, setFearGreed] = useState<{ value: number; label: string; ts: number }[]>([]);
  const [currentFG, setCurrentFG] = useState<number>(50);
  const [currentFGLabel, setCurrentFGLabel] = useState('Neutral');
  const [loading, setLoading] = useState(true);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData(
      'FG-direct',
      async () => {
        const resp = await fetch('https://api.alternative.me/fng/?limit=30');
        const json = await resp.json();
        const raw: Array<{ value: string; value_classification: string; timestamp: string }> = json?.data ?? [];
        const data = raw
          .map(d => ({ value: parseInt(d.value), label: d.value_classification, ts: parseInt(d.timestamp) * 1000 }))
          .reverse();
        return data;
      },
      60_000,
      (d: { value: number; label: string; ts: number }[]) => {
        if (!alive) return;
        setFearGreed(d);
        if (d.length) {
          setCurrentFG(d[d.length - 1].value);
          setCurrentFGLabel(d[d.length - 1].label);
        }
        setLoading(false);
      },
    );
    return () => { alive = false; unsub(); };
  }, []);

  useEffect(() => {
    setHeaderRight(fearGreed.length ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span> : null);
    return () => setHeaderRight(null);
  }, [setHeaderRight, fearGreed]);

  if (loading && !fearGreed.length) return <Skeleton />;
  if (!fearGreed.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无数据</div>
  );

  const vals = fearGreed.map(p => p.value);
  const W = 480, H2 = 100, PX = 6, PY = 8;
  const lo = 0, hi = 100;
  const pts2 = mapPts(vals, W, H2, lo, hi, PX, PY);
  const color = fgColor(currentFG);

  const GAUGE_R = 44, CX = 56, CY = 64;
  const angle = ((currentFG / 100) * 180 - 180) * (Math.PI / 180);
  const needleX = CX + GAUGE_R * Math.cos(angle);
  const needleY = CY + GAUGE_R * Math.sin(angle);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-stretch gap-2 px-3 pt-2 pb-1 shrink-0">
        <div className="shrink-0">
          <svg width={114} height={68} viewBox="0 0 114 68">
            {FG_ZONES.map((z, i) => {
              const startDeg = (z.min / 100) * 180 - 180;
              const endDeg   = (z.max / 100) * 180 - 180;
              const toRad = (d: number) => d * Math.PI / 180;
              const x1 = CX + GAUGE_R * Math.cos(toRad(startDeg));
              const y1 = CY + GAUGE_R * Math.sin(toRad(startDeg));
              const x2 = CX + GAUGE_R * Math.cos(toRad(endDeg));
              const y2 = CY + GAUGE_R * Math.sin(toRad(endDeg));
              const large = endDeg - startDeg > 180 ? 1 : 0;
              return (
                <path key={i}
                  d={`M ${CX} ${CY} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${GAUGE_R} ${GAUGE_R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`}
                  fill={z.color}
                  opacity={0.25}
                />
              );
            })}
            <path d={`M ${CX - GAUGE_R} ${CY} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${CX + GAUGE_R} ${CY}`} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
            <line x1={CX} y1={CY} x2={needleX.toFixed(1)} y2={needleY.toFixed(1)} stroke={color} strokeWidth={2} strokeLinecap="round" />
            <circle cx={CX} cy={CY} r={4} fill={color} />
            <text x={CX} y={CY + 16} textAnchor="middle" fontSize={14} fontWeight={700} fill={color}>{currentFG}</text>
            <text x={CX} y={CY + 26} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.35)">{currentFGLabel}</text>
          </svg>
        </div>

        <div className="flex flex-col justify-center gap-0.5 flex-1">
          {FG_ZONES.slice().reverse().map(z => (
            <div key={z.label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: z.color }} />
              <span className="text-[9px] text-white/30">{z.label}</span>
              <span className="text-[9px] text-white/15 ml-auto">{z.min}–{z.max}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-3 pb-1">
        <svg viewBox={`0 0 ${W} ${H2}`} width="100%" height="100%" preserveAspectRatio="none">
          {FG_ZONES.map(z => {
            const yTop = (H2 - PY) - ((z.max - lo) / (hi - lo)) * (H2 - 2 * PY);
            const yBot = (H2 - PY) - ((z.min - lo) / (hi - lo)) * (H2 - 2 * PY);
            return <rect key={z.label} x={PX} y={yTop} width={W - 2 * PX} height={yBot - yTop} fill={z.color} opacity={0.06} />;
          })}
          <path d={area(pts2, H2, PY)} fill={`${fgColor(currentFG)}18`} />
          <polyline points={poly(pts2)} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
          {[0, Math.floor(vals.length / 2), vals.length - 1].map(idx => {
            const x = PX + (idx / Math.max(vals.length - 1, 1)) * (W - 2 * PX);
            const label = idx === vals.length - 1 ? '今天' : idx === 0 ? '-30天' : '-15天';
            return <text key={idx} x={x} y={H2 - 1} textAnchor="middle" fontSize={8} fill={TXT}>{label}</text>;
          })}
        </svg>
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        数据来源：alternative.me · 30天历史
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// PCRHistoryWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const PCRHistoryWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时
        </span>
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  const currency = coin === 'BTC' ? 'BTC' : 'ETH';
  const buf = SKEW_BUFFER.get(currency) ?? [];

  if (buf.length < 2) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/20">
      <div className="text-[11px]">正在积累数据…</div>
      <div className="text-[9px]">每 30 秒更新一次</div>
    </div>
  );

  const pcrVals = buf.map(s => s.pcr);
  const currentPCR = pcrVals[pcrVals.length - 1];
  const W3 = 480, H3 = 110, PX2 = 8, PY2 = 14;

  const lo2 = Math.max(0.3, Math.min(...pcrVals) - 0.1);
  const hi2 = Math.min(3.0,  Math.max(...pcrVals) + 0.1);

  const pts3 = mapPts(pcrVals, W3, H3, lo2, hi2, PX2, PY2);
  const yAt = (v: number) => (H3 - PY2) - ((v - lo2) / (hi2 - lo2)) * (H3 - 2 * PY2);

  const REFS = [
    { v: 1.0, label: '中性', color: 'rgba(255,255,255,0.15)', dash: '4,3' },
    { v: 0.7, label: '偏多', color: 'rgba(37,232,137,0.2)',   dash: '4,3' },
    { v: 1.3, label: '偏空', color: 'rgba(248,113,113,0.2)',  dash: '4,3' },
  ].filter(r => r.v >= lo2 && r.v <= hi2);

  const pcrColor2 = currentPCR >= 1.3 ? '#f87171' : currentPCR <= 0.7 ? '#25e889' : '#F59E0B';
  const pcrLabel2 = currentPCR >= 1.3 ? '偏空' : currentPCR <= 0.7 ? '偏多' : '中性';

  const startPCR = pcrVals[0];
  const pcrDelta = currentPCR - startPCR;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: 'PCR 当前', val: currentPCR.toFixed(2), color: pcrColor2 },
          { label: '情绪', val: pcrLabel2, color: pcrColor2 },
          { label: '会话变化', val: `${pcrDelta >= 0 ? '+' : ''}${pcrDelta.toFixed(2)}`, color: pcrDelta > 0.05 ? '#f87171' : pcrDelta < -0.05 ? '#25e889' : 'rgba(255,255,255,0.4)' },
          { label: '样本数', val: `${buf.length}点`, color: 'rgba(255,255,255,0.3)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1">
            <div className="text-[9px] text-white/20 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 px-3 pb-1">
        <svg viewBox={`0 0 ${W3} ${H3}`} width="100%" height="100%" preserveAspectRatio="none">
          {REFS.map(r => (
            <g key={r.v}>
              <line x1={PX2} y1={yAt(r.v)} x2={W3 - PX2} y2={yAt(r.v)}
                stroke={r.color} strokeWidth={0.8} strokeDasharray={r.dash} />
              <text x={W3 - PX2 - 2} y={yAt(r.v) - 2} textAnchor="end" fontSize={7} fill={r.color}>{r.label}</text>
            </g>
          ))}
          {lo2 < 1.0 && hi2 > 1.0 && (
            <rect x={PX2} y={PY2} width={W3 - 2 * PX2} height={yAt(1.0) - PY2}
              fill="rgba(248,113,113,0.04)" />
          )}
          {lo2 < 0.7 && hi2 > 0.7 && (
            <rect x={PX2} y={yAt(0.7)} width={W3 - 2 * PX2} height={(H3 - PY2) - yAt(0.7)}
              fill="rgba(37,232,137,0.04)" />
          )}
          <path d={area(pts3, H3, PY2)} fill={`${pcrColor2}10`} />
          <polyline points={poly(pts3)} fill="none" stroke={pcrColor2} strokeWidth={1.5} opacity={0.9} />
          {pts3.length > 0 && (
            <circle cx={pts3[pts3.length - 1][0]} cy={pts3[pts3.length - 1][1]} r={2.5} fill={pcrColor2} />
          )}
          {[lo2, 1.0, hi2].filter(v => v >= lo2 && v <= hi2).map(v => (
            <text key={v} x={PX2} y={yAt(v) - 2} fontSize={7} fill={TXT}>{v.toFixed(1)}</text>
          ))}
        </svg>
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        Put/Call 持仓量比 · 每 30 秒一点 · &gt;1.3 看跌 / &lt;0.7 看涨 · Deribit
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// PremiumFlowWidget
// ═══════════════════════════════════════════════════════════════════════════════

interface RawOptionTrade {
  id: string;
  instrument: string;
  strike: number;
  expiry: string;
  optType: 'C' | 'P';
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  iv: number;
  indexPrice: number;
  premiumUSD: number;
  notionalUSD: number;
  ts: number;
}

const OPT_STREAM   = new Map<string, RawOptionTrade[]>();
const OPT_SEEN     = new Map<string, Set<string>>();
const OPT_LAST_F   = new Map<string, number>();
const OPT_FETCH_TTL = 10_000;

async function pollOptionTrades(coin: Coin): Promise<RawOptionTrade[]> {
  const now = Date.now();
  if ((OPT_LAST_F.get(coin) ?? 0) + OPT_FETCH_TTL > now) return OPT_STREAM.get(coin) ?? [];
  OPT_LAST_F.set(coin, now);

  const cur = coin === 'BTC' ? 'BTC' : 'ETH';
  try {
    const res = await fetch(
      `https://www.deribit.com/api/v2/public/get_last_trades_by_currency?currency=${cur}&kind=option&count=1000&sorting=desc`
    ).then(r => r.json());

    if (!OPT_SEEN.has(coin)) OPT_SEEN.set(coin, new Set());
    const seen = OPT_SEEN.get(coin)!;
    const newTrades: RawOptionTrade[] = [];

    for (const t of (res.result?.trades ?? [])) {
      if (seen.has(t.trade_id)) continue;
      seen.add(t.trade_id);
      const parts = (t.instrument_name as string).split('-');
      if (parts.length !== 4) continue;
      const ip: number  = t.index_price ?? 1;
      const amt: number = t.amount      ?? 0;
      const prc: number = t.price       ?? 0;
      newTrades.push({
        id: t.trade_id, instrument: t.instrument_name,
        strike: Number(parts[2]), expiry: parts[1],
        optType: parts[3] === 'C' ? 'C' : 'P',
        direction: t.direction === 'buy' ? 'buy' : 'sell',
        amount: amt, price: prc, iv: t.iv ?? 0, indexPrice: ip,
        premiumUSD: prc * amt * ip, notionalUSD: amt * ip,
        ts: t.timestamp,
      });
    }
    const updated = [...newTrades, ...(OPT_STREAM.get(coin) ?? [])].slice(0, 2000);
    OPT_STREAM.set(coin, updated);
    return updated;
  } catch {
    return OPT_STREAM.get(coin) ?? [];
  }
}

interface PFlowAcc { cumCallNet: number; cumPutNet: number }
const PFLOW_ACC2    = new Map<string, PFlowAcc>();
const PFLOW_SERIES2 = new Map<string, { ts: number; c: number; p: number }[]>();
const PFLOW_LAST2   = new Map<string, string>();

function processPremiumFlow(coin: Coin, trades: RawOptionTrade[]): void {
  if (!PFLOW_ACC2.has(coin)) PFLOW_ACC2.set(coin, { cumCallNet: 0, cumPutNet: 0 });
  if (!PFLOW_SERIES2.has(coin)) PFLOW_SERIES2.set(coin, []);

  const acc = PFLOW_ACC2.get(coin)!;
  const buf = PFLOW_SERIES2.get(coin)!;
  const lastId = PFLOW_LAST2.get(coin);

  const lastIdx = lastId ? trades.findIndex(t => t.id === lastId) : trades.length;
  const unprocessed = trades.slice(0, lastIdx).reverse();

  if (unprocessed.length === 0) return;
  for (const t of unprocessed) {
    const sign = t.direction === 'buy' ? 1 : -1;
    if (t.optType === 'C') acc.cumCallNet += sign * t.premiumUSD;
    else                    acc.cumPutNet  += sign * t.premiumUSD;
  }
  buf.push({ ts: Date.now(), c: acc.cumCallNet, p: acc.cumPutNet });
  if (buf.length > 360) buf.splice(0, buf.length - 360);
  PFLOW_LAST2.set(coin, trades[0]?.id ?? lastId ?? '');
}

export const PremiumFlowWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [series, setSeries] = useState<{ ts: number; c: number; p: number }[]>([]);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    const unsub = subscribeData<RawOptionTrade[]>(
      `trades-${coin}`,
      () => pollOptionTrades(coin),
      10_000,
      trades => {
        processPremiumFlow(coin, trades);
        if (alive) setSeries([...(PFLOW_SERIES2.get(coin) ?? [])]);
      },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  const W4 = 800; const H4 = 120;
  const cVals = series.map(s => s.c);
  const pVals = series.map(s => s.p);
  const allVals2 = [...cVals, ...pVals];
  const lo3 = Math.min(...allVals2, 0);
  const hi3 = Math.max(...allVals2, 0);
  const fmtM = (v: number) => `$${v >= 0 ? '+' : ''}${(v / 1e6).toFixed(2)}M`;
  const zero = H4 - ((0 - lo3) / (hi3 - lo3 || 1)) * H4;

  if (series.length < 2) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
      会话数据积累中…
    </div>
  );

  const cPts = mapPts(cVals, W4, H4, lo3, hi3);
  const pPts = mapPts(pVals, W4, H4, lo3, hi3);
  const latest = series[series.length - 1];

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[10px] font-mono" style={{ color: 'var(--nexus-green)' }}>
          ● Call净 {fmtM(latest?.c ?? 0)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--nexus-red)' }}>
          ● Put净 {fmtM(latest?.p ?? 0)}
        </span>
        <span className="text-[9px] text-slate-600 ml-auto">正=净买入 / 负=净卖出</span>
      </div>
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W4} ${H4}`} preserveAspectRatio="none" width="100%" height="100%">
          <line x1="0" y1={zero} x2={W4} y2={zero} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4,4" />
          <path d={area(cPts, H4)} fill="url(#wg-green-strong)" />
          <path d={smooth(cPts)} fill="none" stroke="var(--nexus-green)" strokeWidth="1.5" />
          <path d={area(pPts, H4)} fill="url(#wg-red)" />
          <path d={smooth(pPts)} fill="none" stroke="var(--nexus-red)" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// LargeTradeAlertWidget
// ═══════════════════════════════════════════════════════════════════════════════

const LARGE_BUF = new Map<string, RawOptionTrade[]>();
const LARGE_SEEN_IDS = new Map<string, Set<string>>();

function processLargeTrades(coin: Coin, trades: RawOptionTrade[], minUSD: number): void {
  if (!LARGE_SEEN_IDS.has(coin)) LARGE_SEEN_IDS.set(coin, new Set());
  const seen = LARGE_SEEN_IDS.get(coin)!;
  const buf  = LARGE_BUF.get(coin) ?? [];
  let dirty  = false;
  for (const t of trades) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.notionalUSD >= minUSD) { buf.unshift(t); dirty = true; }
  }
  if (dirty) {
    if (buf.length > 200) buf.splice(200);
    LARGE_BUF.set(coin, buf);
  }
}

export const LargeTradeAlertWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [trades, setTrades] = useState<RawOptionTrade[]>([]);
  const [threshold, setThreshold] = useState(500_000);
  const [filter, setFilter] = useState<'ALL' | 'C' | 'P'>('ALL');

  const thresholdRef = React.useRef(threshold);
  thresholdRef.current = threshold;

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <CoinTabs v={coin} set={setCoin} />
        <select
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
          className="text-[9px] bg-transparent border border-white/10 rounded px-1 text-slate-400">
          {[100_000, 250_000, 500_000, 1_000_000, 2_000_000].map(v => (
            <option key={v} value={v}>${(v / 1e6).toFixed(v < 1e6 ? 1 : 0)}M+</option>
          ))}
        </select>
        {(['ALL', 'C', 'P'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-1.5 py-0.5 rounded text-[9px] transition-colors"
            style={{
              background: filter === f ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: f === 'C' ? 'var(--nexus-green)' : f === 'P' ? 'var(--nexus-red)' : '#94a3b8',
            }}>{f}</button>
        ))}
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, threshold, filter]);

  useEffect(() => {
    let alive = true;
    const unsub = subscribeData<RawOptionTrade[]>(
      `trades-${coin}`,
      () => pollOptionTrades(coin),
      10_000,
      tradesSrc => {
        processLargeTrades(coin, tradesSrc, thresholdRef.current);
        if (alive) setTrades([...(LARGE_BUF.get(coin) ?? [])]);
      },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  const visible = trades.filter(t => filter === 'ALL' || t.optType === filter);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0">
        <span className="text-[9px] text-slate-600">{visible.length} 条记录（会话内）</span>
      </div>
      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          等待大单…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
          <div className="grid text-[8px] text-slate-600 uppercase tracking-wider pb-1 border-b border-white/6"
            style={{ gridTemplateColumns: '50px 72px 60px 36px 36px 40px 70px 70px' }}>
            <span>时间</span><span>到期</span><span className="text-right">行权价</span>
            <span>类型</span><span>方向</span><span className="text-right">IV</span>
            <span className="text-right">权利金</span><span className="text-right">名义</span>
          </div>
          {visible.map(t => {
            const dirColor = t.direction === 'buy' ? 'var(--nexus-green)' : 'var(--nexus-red)';
            const typeColor = t.optType === 'C' ? 'var(--nexus-green)' : 'var(--nexus-red)';
            const time = new Date(t.ts).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div key={t.id}
                className="grid items-center py-[3px] border-b border-white/4 hover:bg-white/2 transition-colors"
                style={{ gridTemplateColumns: '50px 72px 60px 36px 36px 40px 70px 70px' }}>
                <span className="text-[9px] font-mono text-slate-500">{time}</span>
                <span className="text-[9px] font-mono text-slate-400">{t.expiry}</span>
                <span className="text-[9px] font-mono text-slate-200 text-right">{t.strike.toLocaleString()}</span>
                <span className="text-[9px] font-bold text-center" style={{ color: typeColor }}>{t.optType}</span>
                <span className="text-[9px] font-bold text-center" style={{ color: dirColor }}>
                  {t.direction === 'buy' ? '买' : '卖'}
                </span>
                <span className="text-[9px] font-mono text-right text-slate-300">{t.iv.toFixed(1)}%</span>
                <span className="text-[9px] font-mono text-right" style={{ color: dirColor }}>
                  ${(t.premiumUSD / 1e3).toFixed(0)}K
                </span>
                <span className="text-[9px] font-mono text-right text-slate-400">
                  ${(t.notionalUSD / 1e6).toFixed(2)}M
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
)};