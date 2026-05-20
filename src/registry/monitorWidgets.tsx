import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import {
  BTC_POLY,
  ETH_POLY,
  FIXED_TENOR_VAR,
  IMP_DIST,
  IVR_HIST,
  OPTIONS_SKEW,
  SKEW_COLS,
  SKEW_DATA,
  SKEW_ROWS,
  SMILE,
  SMILE_LABELS,
  VOL,
  VOL_CONE,
  VRP_HIST,
} from '../features/monitor/data/mock';

// ── SVG helpers ───────────────────────────────────────────────────────────────

function mapPts(data: number[], W: number, H: number, lo: number, hi: number, px = 0, py = 0): [number, number][] {
  const range = hi - lo || 1;
  return data.map((v, i) => [
    px + (i / Math.max(data.length - 1, 1)) * (W - 2 * px),
    (H - py) - ((v - lo) / range) * (H - 2 * py),
  ]);
}
function poly(pts: [number, number][]) {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]; const [cx, cy] = pts[i];
    const dx = (cx - px) * 0.45;
    d += ` C ${(px+dx).toFixed(1)} ${py.toFixed(1)},${(cx-dx).toFixed(1)} ${cy.toFixed(1)},${cx.toFixed(1)} ${cy.toFixed(1)}`;
  }
  return d;
}
function area(pts: [number, number][], H: number, padY = 0) {
  if (!pts.length) return '';
  const bot = H - padY;
  return `${smooth(pts)} L ${pts[pts.length-1][0].toFixed(1)} ${bot} L ${pts[0][0].toFixed(1)} ${bot} Z`;
}

const GRIDLINE = 'var(--monitor-gridline)';
const TEXT_MUTED = 'var(--color-text-muted)';

// ── Shared sub-components ─────────────────────────────────────────────────────

const CoinTabs = ({ v, set }: { v: Coin; set: (c: Coin) => void }) => (
  <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
    {(['BTC', 'ETH'] as Coin[]).map(c => (
      <button key={c} onClick={() => set(c)}
        className={cn('text-[11px] font-bold px-2.5 py-0.5 rounded-[18px] transition-colors outline-none',
          v === c
            ? (c === 'BTC' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400')
            : 'text-slate-600 hover:text-slate-400'
        )}>
        {c}
      </button>
    ))}
  </div>
);

function ivrColor(r: number) { return r <= 30 ? '#1EC98C' : r <= 70 ? '#F59E0B' : '#FF4D6A'; }
function ivrLabel(r: number) { return r <= 20 ? '极低' : r <= 40 ? '偏低' : r <= 60 ? '中性' : r <= 80 ? '偏高' : '极高'; }
function pcrColor(p: number) { return p < 0.7 ? '#1EC98C' : p < 1.0 ? '#F59E0B' : '#FF4D6A'; }
function pcrLabel(p: number) { return p < 0.7 ? '偏多' : p < 1.0 ? '中性' : '偏空'; }

// ── Base chart components (take coin as prop) ─────────────────────────────────

const SmileChart = ({
  coin,
  onPick,
}: {
  coin: Coin;
  onPick?: (p: { tenor: '7D' | '30D' | '90D'; label: string; value: number }) => void;
}) => {
  const data = SMILE[coin];
  const W = 320, H = 150, px = 28, py = 16;
  const allV = Object.values(data).flat();
  const lo = Math.floor(Math.min(...allV) / 5) * 5;
  const hi = Math.ceil(Math.max(...allV) / 5) * 5;
  const lines = [
    { key: '7D', color: '#4D7CFF', dash: '' },
    { key: '30D', color: '#1EC98C', dash: '4,2' },
    { key: '90D', color: '#F59E0B', dash: '2,2' },
  ] as const;
  const yGrids = [lo, lo+(hi-lo)*0.25, lo+(hi-lo)*0.5, lo+(hi-lo)*0.75, hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {yGrids.map((v, i) => {
        const y = (H-py) - ((v-lo)/(hi-lo)) * (H-2*py);
        return <React.Fragment key={i}>
          <line x1={px} y1={y} x2={W-4} y2={y} stroke={GRIDLINE} strokeWidth={0.5} />
          <text x={px-4} y={y+3.5} textAnchor="end" fontSize={7} fill={TEXT_MUTED}>{v.toFixed(0)}</text>
        </React.Fragment>;
      })}
      {SMILE_LABELS.map((lbl, i) => {
        const x = px + (i/(SMILE_LABELS.length-1)) * (W-px-8);
        return <text key={i} x={x} y={H-3} textAnchor="middle" fontSize={7} fill={TEXT_MUTED}>{lbl}</text>;
      })}
      {lines.map(({ key, color, dash }) => {
        const pts = mapPts(data[key], W, H, lo, hi, px, py);
        const tenorData = data[key];
        return (
          <g key={key}>
            <polyline
              points={poly(pts)}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray={dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {pts.map(([x, y], idx) => (
              <circle
                key={idx}
                cx={x}
                cy={y}
                r={10}
                fill="transparent"
                className={onPick ? 'cursor-pointer' : undefined}
                onClick={() => {
                  if (!onPick) return;
                  onPick({ tenor: key, label: SMILE_LABELS[idx]!, value: tenorData[idx]! });
                }}
              />
            ))}
          </g>
        );
      })}
      {lines.map(({ key, color, dash }, i) => <React.Fragment key={key}>
        <line x1={px + i*60} y1={8} x2={px+10 + i*60} y2={8} stroke={color} strokeWidth={1.5} strokeDasharray={dash} />
        <text x={px+13 + i*60} y={11} fontSize={7} fill={TEXT_MUTED}>{key}</text>
      </React.Fragment>)}
    </svg>
  );
};

const VRPChart = ({ coin }: { coin: Coin }) => {
  const data = VRP_HIST[coin];
  const W = 320, H = 130, px = 28, py = 12;
  const ivs = data.map(d => d.iv); const rvs = data.map(d => d.rv);
  const lo = Math.floor(Math.min(...rvs) / 5) * 5 - 2;
  const hi = Math.ceil(Math.max(...ivs) / 5) * 5 + 2;
  const ivPts = mapPts(ivs, W, H, lo, hi, px, py);
  const rvPts = mapPts(rvs, W, H, lo, hi, px, py);
  const vrpFill = `${smooth(ivPts)} L ${rvPts.slice().reverse().map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')} Z`;
  const yTicks = [lo, lo+(hi-lo)*0.33, lo+(hi-lo)*0.66, hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {yTicks.map((v, i) => {
        const y = (H-py) - ((v-lo)/(hi-lo)) * (H-2*py);
        return <React.Fragment key={i}>
          <line x1={px} y1={y} x2={W-4} y2={y} stroke="#1A1A22" strokeWidth={0.5} />
          <text x={px-4} y={y+3.5} textAnchor="end" fontSize={7} fill="#374151">{v.toFixed(0)}</text>
        </React.Fragment>;
      })}
      <path d={vrpFill} fill="rgba(77,124,255,0.08)" />
      <path d={area(rvPts, H, py)} fill="rgba(30,201,140,0.06)" />
      <polyline points={poly(rvPts)} fill="none" stroke="#1EC98C" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={poly(ivPts)} fill="none" stroke="#4D7CFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={px} y1={8} x2={px+10} y2={8} stroke="#4D7CFF" strokeWidth={1.5} />
      <text x={px+13} y={11} fontSize={7} fill="#6B7280">IV</text>
      <line x1={px+36} y1={8} x2={px+46} y2={8} stroke="#1EC98C" strokeWidth={1.2} />
      <text x={px+49} y={11} fontSize={7} fill="#6B7280">RV</text>
      <text x={px+72} y={11} fontSize={7} fill="#4D7CFF80">■ VRP</text>
    </svg>
  );
};

const IVRankChart = ({ coin }: { coin: Coin }) => {
  const data = IVR_HIST[coin];
  const W = 320, H = 130, px = 28, py = 12;
  const lo = 0, hi = 100;
  const linePts = mapPts(data, W, H, lo, hi, px, py);
  const y30 = (H-py) - (30/100) * (H-2*py);
  const y70 = (H-py) - (70/100) * (H-2*py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x={px} y={py} width={W-px-4} height={y70-py} fill="rgba(255,77,106,0.04)" />
      <rect x={px} y={y30} width={W-px-4} height={H-py-y30} fill="rgba(30,201,140,0.04)" />
      {[0,25,50,75,100].map(v => {
        const y = (H-py) - (v/100) * (H-2*py);
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W-4} y2={y} stroke="#1A1A22" strokeWidth={0.5} />
          <text x={px-4} y={y+3.5} textAnchor="end" fontSize={7} fill="#374151">{v}</text>
        </React.Fragment>;
      })}
      <line x1={px} y1={y30} x2={W-4} y2={y30} stroke="#1EC98C" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.4} />
      <line x1={px} y1={y70} x2={W-4} y2={y70} stroke="#FF4D6A" strokeWidth={0.8} strokeDasharray="3,2" opacity={0.4} />
      <path d={area(linePts, H, py)} fill="rgba(77,124,255,0.07)" />
      <polyline points={poly(linePts)} fill="none" stroke="#4D7CFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {(() => { const [x,y] = linePts[linePts.length-1]; const c = ivrColor(data[data.length-1]);
        return <circle cx={x} cy={y} r={3} fill={c} stroke="#0A0A0D" strokeWidth={1} />; })()}
      <text x={px+4} y={y30-3} fontSize={7} fill="#1EC98C80">30</text>
      <text x={px+4} y={y70-3} fontSize={7} fill="#FF4D6A80">70</text>
    </svg>
  );
};

const VolConeChart = ({ coin }: { coin: Coin }) => {
  const d = VOL_CONE[coin];
  const W = 320, H = 160, px = 28, py = 14;
  const lo = 0; const hi = Math.ceil(Math.max(...d.p90) / 10) * 10 + 5;
  function fy(v: number) { return (H-py) - ((v-lo)/(hi-lo)) * (H-2*py); }
  const n = d.tenors.length;
  function fx(i: number) { return px + (i/(n-1)) * (W-2*px); }
  const currPts = d.curr.map((v,i): [number,number] => [fx(i), fy(v)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0,25,50,75,100].filter(v=>v<=hi).map(v => {
        const y = fy(v);
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W-px} y2={y} stroke="#1A1A22" strokeWidth={0.5} />
          <text x={px-4} y={y+3.5} textAnchor="end" fontSize={7} fill="#374151">{v}</text>
        </React.Fragment>;
      })}
      {d.tenors.map((t,i) => {
        const x = fx(i);
        const y10=fy(d.p10[i]), y25=fy(d.p25[i]), y50=fy(d.p50[i]), y75=fy(d.p75[i]), y90=fy(d.p90[i]);
        return <React.Fragment key={t}>
          <rect x={x-7} y={y90} width={14} height={y10-y90} rx={2} fill="rgba(77,124,255,0.07)" />
          <rect x={x-7} y={y75} width={14} height={y25-y75} rx={2} fill="rgba(77,124,255,0.18)" />
          <line x1={x-7} y1={y50} x2={x+7} y2={y50} stroke="rgba(77,124,255,0.6)" strokeWidth={1.5} />
          <text x={x} y={H-3} textAnchor="middle" fontSize={7} fill="#374151">{t}</text>
        </React.Fragment>;
      })}
      <polyline points={poly(currPts)} fill="none" stroke="#F59E0B" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {currPts.map(([x,y],i) => <circle key={i} cx={x} cy={y} r={2.5} fill="#F59E0B" />)}
      <rect x={px} y={6} width={8} height={6} rx={1} fill="rgba(77,124,255,0.18)" />
      <text x={px+11} y={11} fontSize={7} fill="#6B7280">历史RV区间</text>
      <line x1={px+70} y1={9} x2={px+80} y2={9} stroke="#F59E0B" strokeWidth={1.5} />
      <text x={px+83} y={11} fontSize={7} fill="#6B7280">当前IV</text>
    </svg>
  );
};

const FixedTenorChart = ({ coin }: { coin: Coin }) => {
  const d = FIXED_TENOR_VAR[coin];
  const W = 320, H = 140, px = 28, py = 14;
  const allV = [...d.varSwap, ...d.rv];
  const lo = 0; const hi = Math.ceil(Math.max(...allV) / 10) * 10 + 5;
  function fy(v: number) { return (H-py) - ((v-lo)/(hi-lo)) * (H-2*py); }
  const n = d.tenors.length;
  const barW = (W - 2*px) / n;
  const bw = barW * 0.3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0,15,30,45,60].filter(v=>v<=hi).map(v => {
        const y = fy(v);
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W-px} y2={y} stroke="#1A1A22" strokeWidth={0.5} />
          <text x={px-4} y={y+3.5} textAnchor="end" fontSize={7} fill="#374151">{v}</text>
        </React.Fragment>;
      })}
      {d.tenors.map((t,i) => {
        const cx = px + i*barW + barW/2;
        const vsY = fy(d.varSwap[i]), rvY = fy(d.rv[i]), baseY = fy(0);
        return <React.Fragment key={t}>
          <rect x={cx-bw-1} y={vsY} width={bw} height={baseY-vsY} rx={1.5} fill="rgba(77,124,255,0.5)" />
          <rect x={cx+1}    y={rvY} width={bw} height={baseY-rvY}  rx={1.5} fill="rgba(30,201,140,0.4)" />
          <text x={cx} y={H-3} textAnchor="middle" fontSize={7} fill="#374151">{t}</text>
        </React.Fragment>;
      })}
      <rect x={px} y={5} width={8} height={6} rx={1} fill="rgba(77,124,255,0.5)" />
      <text x={px+11} y={10} fontSize={7} fill="#6B7280">方差互换 IV²</text>
      <rect x={px+75} y={5} width={8} height={6} rx={1} fill="rgba(30,201,140,0.4)" />
      <text x={px+86} y={10} fontSize={7} fill="#6B7280">已实现方差 RV²</text>
    </svg>
  );
};

const ImpliedDistChart = ({ coin }: { coin: Coin }) => {
  const data = IMP_DIST[coin];
  const S = coin === 'BTC' ? 70124 : 3740;
  const W = 320, H = 140, px = 8, py = 12;
  const xs = data.map(d => d.x); const ys = data.map(d => d.y);
  const lo = Math.min(...xs); const hi = Math.max(...xs);
  const yLo = 0; const yHi = Math.max(...ys) * 1.1;
  function fx(x: number) { return px + ((x-lo)/(hi-lo)) * (W-2*px); }
  function fy(y: number) { return (H-py) - ((y-yLo)/(yHi-yLo)) * (H-2*py); }
  const curvePts: [number,number][] = data.map(d => [fx(d.x), fy(d.y)]);
  const aFill = `${smooth(curvePts)} L ${curvePts[curvePts.length-1][0].toFixed(1)} ${fy(0)} L ${curvePts[0][0].toFixed(1)} ${fy(0)} Z`;
  const sigma = (coin === 'BTC' ? 58.4 : 68.2) / 100 * Math.sqrt(30/365) * S;
  const x1lo = fx(S - sigma); const x1hi = fx(S + sigma); const xS = fx(S);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <path d={`M ${x1lo} ${py} L ${x1lo} ${H-py} L ${x1hi} ${H-py} L ${x1hi} ${py} Z`} fill="rgba(77,124,255,0.06)" />
      <line x1={px} y1={H-py} x2={W-px} y2={H-py} stroke="#1E1E26" strokeWidth={0.5} />
      <path d={aFill} fill="rgba(77,124,255,0.10)" />
      <path d={smooth(curvePts)} fill="none" stroke="#4D7CFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={x1lo} y1={py} x2={x1lo} y2={H-py} stroke="rgba(77,124,255,0.3)" strokeWidth={0.8} strokeDasharray="3,2" />
      <line x1={x1hi} y1={py} x2={x1hi} y2={H-py} stroke="rgba(77,124,255,0.3)" strokeWidth={0.8} strokeDasharray="3,2" />
      <line x1={xS} y1={py} x2={xS} y2={H-py} stroke="#F59E0B" strokeWidth={1} strokeDasharray="2,2" />
      {[-2,-1,0,1,2].map(k => {
        const x = fx(S + k*sigma); const lbl = k === 0 ? 'S' : `${k > 0 ? '+' : ''}${k}σ`;
        return <text key={k} x={x} y={H-3} textAnchor="middle" fontSize={7} fill={k===0 ? '#F59E0B' : '#374151'}>{lbl}</text>;
      })}
    </svg>
  );
};

// ── Standalone widget wrappers (with own coin state) ──────────────────────────

type CoinControlProps = {
  coin?: Coin;
  onCoinChange?: (c: Coin) => void;
};

function useCoinControl({ coin: coinProp, onCoinChange }: CoinControlProps) {
  const [localCoin, setLocalCoin] = useState<Coin>(coinProp ?? 'BTC');

  // header 切换时同步卡片
  useEffect(() => {
    if (coinProp !== undefined) setLocalCoin(coinProp);
  }, [coinProp]);

  const coin = localCoin;
  const setCoin = (c: Coin) => {
    setLocalCoin(c);
    onCoinChange?.(c);
  };
  return { coin, setCoin };
}

const WidgetShell = ({ children, coin, setCoin }: { children: React.ReactNode; coin: Coin; setCoin: (c: Coin) => void }) => {
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {children}
      </div>
    </div>
  );
};

export const VolOverviewWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  const d = VOL[coin];
  const ivrc = ivrColor(d.ivRank);
  const pcrc = pcrColor(d.pcr);
  const termMin = Math.min(...d.term.map(t => t.iv));
  const termRange = Math.max(...d.term.map(t => t.iv)) - termMin || 1;
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">波动率概览</span>
      </div>
      <div className="mx-2 mb-2 rounded-[8px] bg-surface-1/40 border border-surface-4/50 overflow-hidden shrink-0">
        <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-surface-2/80">
          <span className="text-[13px] font-bold text-slate-100">{coin} DVOL</span>
          <div className="flex items-baseline gap-1">
            <span className="text-[22px] font-mono font-bold tnum text-slate-100 leading-none">{d.dvol.toFixed(1)}</span>
            <span className="text-[11px] text-slate-600">%</span>
            <span className={cn('text-[11px] font-mono tnum font-bold ml-1', d.dvolChange < 0 ? 'text-rose-400' : 'text-emerald-400')}>
              {d.dvolChange > 0 ? '+' : ''}{d.dvolChange.toFixed(1)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-surface-2/80">
          <div className="py-2">
            <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase mb-1">IV Rank</div>
            <div className="text-[16px] font-mono font-bold tnum leading-none mb-1" style={{ color: ivrc }}>{d.ivRank}</div>
            <div className="h-1 rounded-full bg-surface-2/80 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${d.ivRank}%`, backgroundColor: ivrc }} /></div>
            <div className="text-[9px] font-mono mt-0.5" style={{ color: ivrc }}>{ivrLabel(d.ivRank)}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase mb-1">VRP</div>
            <div className="text-[16px] font-mono font-bold tnum leading-none text-amber-400 mb-0.5">+{d.vrp.toFixed(1)}<span className="text-[10px] text-slate-600 font-normal ml-0.5">pp</span></div>
            <div className="text-[9px] font-mono text-slate-600">IV {d.iv30.toFixed(1)} − RV {d.rv30.toFixed(1)}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase mb-1">PCR</div>
            <div className="text-[16px] font-mono font-bold tnum leading-none mb-0.5" style={{ color: pcrc }}>{d.pcr.toFixed(2)}</div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-mono" style={{ color: pcrc }}>{pcrLabel(d.pcr)}</span>
              <span className={cn('text-[9px] font-mono', d.pcrChange < 0 ? 'text-rose-400/70' : 'text-emerald-400/70')}>
                {d.pcrChange > 0 ? '+' : ''}{d.pcrChange.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        <div className="border-t border-surface-2/80 px-3 pt-2 pb-2.5">
          <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase mb-2">期限结构</div>
          <div className="flex gap-0.5 items-end h-[40px]">
            {d.term.map((t, i) => {
              const barH = Math.round(8 + ((t.iv - termMin) / termRange) * 26);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[8px] font-mono tnum text-slate-600 leading-none">{t.iv.toFixed(0)}</span>
                  <div className="w-full rounded-t-[2px]" style={{ height: barH, background: 'linear-gradient(to top,rgba(77,124,255,.55),rgba(77,124,255,.2))' }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-0.5 mt-0.5">
            {d.term.map((t, i) => <div key={i} className="flex-1 flex justify-center"><span className="text-[8px] text-slate-700">{t.t}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
};

export const VolSmileWidget = ({
  coin: coinProp,
  onCoinChange,
  onPickSmilePoint,
}: CoinControlProps & {
  onPickSmilePoint?: (p: { coin: Coin; tenor: '7D' | '30D' | '90D'; label: string; value: number }) => void;
}) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  return (
    <WidgetShell coin={coin} setCoin={setCoin}>
      <SmileChart
        coin={coin}
        onPick={(p) => onPickSmilePoint?.({ coin, ...p })}
      />
    </WidgetShell>
  );
};

export const VRPHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  return <WidgetShell coin={coin} setCoin={setCoin}><VRPChart coin={coin} /></WidgetShell>;
};

export const IVRankHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  return <WidgetShell coin={coin} setCoin={setCoin}><IVRankChart coin={coin} /></WidgetShell>;
};

export const VolConeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  return <WidgetShell coin={coin} setCoin={setCoin}><VolConeChart coin={coin} /></WidgetShell>;
};

export const FixedTenorWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  return <WidgetShell coin={coin} setCoin={setCoin}><FixedTenorChart coin={coin} /></WidgetShell>;
};

export const ImpliedDistWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  return <WidgetShell coin={coin} setCoin={setCoin}><ImpliedDistChart coin={coin} /></WidgetShell>;
};

export const IVSurfaceWidget = ({
  coin: coinProp,
  onCoinChange,
  onPickCell,
}: CoinControlProps & {
  onPickCell?: (p: { coin: Coin; row: string; col: string; value: number }) => void;
}) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  return (
    <div className="overflow-hidden rounded-[18px]" style={{ backgroundColor: 'rgba(77,124,255,0.04)' }}>
      <div className="w-full overflow-auto">
        <table className="w-full text-[11px]">
        <thead>
          <tr>
            <th className="text-left px-2 py-1.5 text-slate-600 font-bold">Δ / Exp</th>
            {SKEW_COLS.map(c => <th key={c} className="px-2 py-1.5 text-slate-600 font-bold text-right">{c}</th>)}
          </tr>
        </thead>
          <tbody>
            {SKEW_ROWS.map((row, ri) => {
              const data = SKEW_DATA[coin];
              const allV = data.flat();
              const lo = Math.min(...allV); const hi = Math.max(...allV);
              return (
                <tr key={row} className={ri === 2 ? 'border-t border-b border-border-subtle' : ''}>
                  <td className={cn('px-2 py-1.5 font-mono font-bold', ri === 2 ? 'text-slate-300' : 'text-slate-500')}>{row}</td>
                  {data[ri].map((v, ci) => (
                    <td
                      key={ci}
                      role={onPickCell ? 'button' : undefined}
                      tabIndex={onPickCell ? 0 : undefined}
                      className={cn(
                        'px-2 py-1.5 text-right font-mono tnum text-slate-200 font-bold',
                        onPickCell && 'cursor-pointer hover:brightness-110',
                      )}
                      style={{
                        backgroundColor: `rgba(77,124,255,${(0.05 + (v - lo) / (hi - lo) * 0.35).toFixed(2)})`,
                      }}
                      onClick={() => onPickCell?.({ coin, row, col: SKEW_COLS[ci]!, value: v })}
                      onKeyDown={(e) => {
                        if (!onPickCell) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPickCell({ coin, row, col: SKEW_COLS[ci]!, value: v });
                        }
                      }}
                    >
                      {v.toFixed(1)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          </table>
      </div>
    </div>
  );
};

export const OptionsSkewWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  const rows = OPTIONS_SKEW[coin];
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border-subtle">
              {['到期', 'ATM', '25d RR', '25d BF', '10d RR', '10d BF'].map(h => (
                <th key={h} className="px-2 py-1.5 text-slate-600 font-bold text-right first:text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-2 transition-colors">
                <td className="px-2 py-1.5 font-mono font-bold text-slate-400">{r.exp}</td>
                <td className="px-2 py-1.5 text-right font-mono tnum text-slate-200 font-bold">{r.atm.toFixed(1)}</td>
                <td className={cn('px-2 py-1.5 text-right font-mono tnum font-bold', r.rr25 < 0 ? 'text-rose-400' : 'text-emerald-400')}>{r.rr25.toFixed(1)}</td>
                <td className="px-2 py-1.5 text-right font-mono tnum text-amber-400 font-bold">{r.bf25.toFixed(1)}</td>
                <td className={cn('px-2 py-1.5 text-right font-mono tnum font-bold', r.rr10 < 0 ? 'text-rose-400/70' : 'text-emerald-400/70')}>{r.rr10.toFixed(1)}</td>
                <td className="px-2 py-1.5 text-right font-mono tnum text-amber-400/70 font-bold">{r.bf10.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const PolymarketWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  const markets = coin === 'BTC' ? BTC_POLY : ETH_POLY;
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="flex items-center px-3 pt-2 pb-1.5 shrink-0">
        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Polymarket</span>
      </div>
      {markets.map((m, i) => {
        const yc = m.yes >= 50 ? '#1EC98C' : '#F59E0B';
        return (
          <div key={i} className="px-3 py-2.5 border-t border-surface-4 hover:bg-surface-2 transition-colors cursor-pointer">
            <p className="text-[11px] text-slate-300 leading-snug mb-2">{m.q}</p>
            <div className="flex h-1 rounded-full overflow-hidden bg-surface-4 mb-1.5">
              <div className="h-full" style={{ width: `${m.yes}%`, backgroundColor: yc }} />
              <div className="h-full flex-1 bg-rose-500/20" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <span className="text-[10px] font-mono font-bold tnum" style={{ color: yc }}>YES {m.yes}%</span>
                <span className="text-[10px] font-mono font-bold tnum text-rose-400/60">NO {100 - m.yes}%</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[9px] text-slate-700">{m.vol}</span>
                <span className="text-[9px] font-mono text-slate-700">{m.end}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
