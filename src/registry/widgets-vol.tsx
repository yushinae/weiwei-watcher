import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import { mapPts, poly, smooth, area } from '../lib/svg-utils';
import { bsCall, bsVega, bsGamma, bsTheta } from '../lib/bs-math';
import type { DeribitData, HistoryData, ExpiryGroup, ParsedOption, SkewSnap, VolConeSlice } from './types';
import { useDeribitOptions, useDeribitHistory } from './data-hooks';
import { closestDeltaIV, SKEW_BUFFER } from './data-layer';
import {
  GRID, TXT, BRAND, RED, YELLOW, BLUE, PURPLE,
  CoinControlProps, useCoinControl, WidgetShell, CoinTabs, LiveBadge, Skeleton,
  pickExpiries,
} from './ui-helpers';
import {
  FIXED_TENOR_VAR, VOL_CONE as MOCK_VOL_CONE, VRP_HIST, IVR_HIST, VOL,
} from '../features/monitor/data/mock';

// ═══════════════════════════════════════════════════════════════════════════════
// Chart components
// ═══════════════════════════════════════════════════════════════════════════════

const VRPChart = ({ data: d }: { data: { iv: number; rv: number }[] }) => {
  const W = 320, H = 140, px = 28, py = 12;
  const allV = d.flatMap(r => [r.iv, r.rv]);
  const lo = Math.floor(Math.min(...allV) / 5) * 5;
  const hi = Math.ceil(Math.max(...allV) / 5) * 5;
  const ivPts  = mapPts(d.map(r => r.iv), W, H, lo, hi, px, py);
  const rvPts  = mapPts(d.map(r => r.rv), W, H, lo, hi, px, py);
  const vrpPts = mapPts(d.map(r => r.iv - r.rv), W, H, 0, Math.ceil(Math.max(...d.map(r => r.iv - r.rv)) / 5) * 5, px, py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[lo, lo + (hi - lo) / 2, hi].map(v => {
        const y = (H - py) - ((v - lo) / (hi - lo)) * (H - 2 * py);
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W - px} y2={y} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v.toFixed(0)}</text>
        </React.Fragment>;
      })}
      <path d={area(ivPts, H, py)} fill="url(#wg-green)" />
      <polyline points={poly(ivPts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={poly(rvPts)} fill="none" stroke={YELLOW} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4,2" />
      <line x1={px + 2} y1={9} x2={px + 14} y2={9} stroke={BRAND} strokeWidth={1.5} />
      <text x={px + 17} y={12} fontSize={7} fill={TXT}>IV</text>
      <line x1={px + 35} y1={9} x2={px + 47} y2={9} stroke={YELLOW} strokeWidth={1.2} strokeDasharray="4,2" />
      <text x={px + 50} y={12} fontSize={7} fill={TXT}>RV</text>
    </svg>
  );
};

const IVRankChart = ({ data: d }: { data: number[] }) => {
  const W = 320, H = 120, px = 24, py = 10;
  const pts = mapPts(d, W, H, 0, 100, px, py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0, 30, 70, 100].map(v => {
        const y = (H - py) - (v / 100) * (H - 2 * py);
        const col = v === 30 ? 'rgba(37,232,137,0.3)' : v === 70 ? 'rgba(202,63,100,0.3)' : GRID;
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W - px} y2={y} stroke={col} strokeWidth={v === 30 || v === 70 ? 0.8 : 0.5} strokeDasharray={v === 30 || v === 70 ? '3,2' : undefined} />
          <text x={px - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>;
      })}
      <path d={area(pts, H, py)} fill="url(#wg-green)" />
      <polyline points={poly(pts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const VolConeChart = ({
  cone,
  currIVs,
  tenorLabels,
}: {
  cone: VolConeSlice;
  currIVs: number[];
  tenorLabels: string[];
}) => {
  const W = 320, H = 160, px = 28, py = 14;
  const allVals = [...cone.p90, ...currIVs].filter(v => v > 0);
  if (!allVals.length) return <Skeleton />;
  const hi = Math.ceil(Math.max(...allVals) / 10) * 10 + 5;
  function fy(v: number) { return (H - py) - (v / hi) * (H - 2 * py); }
  const n = cone.tenors.length;
  function fx(i: number) { return px + (i / (n - 1)) * (W - 2 * px); }
  const currPts = currIVs.map((v, i): [number, number] => [fx(i), fy(v)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0, 25, 50, 75, 100].filter(v => v <= hi).map(v => (
        <React.Fragment key={v}>
          <line x1={px} y1={fy(v)} x2={W - px} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={fy(v) + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>
      ))}
      {cone.tenors.map((_, i) => {
        const x = fx(i);
        return (
          <React.Fragment key={i}>
            <rect x={x - 7} y={fy(cone.p90[i])} width={14} height={Math.max(0, fy(cone.p10[i]) - fy(cone.p90[i]))} rx={2} fill="rgba(37,232,137,0.07)" />
            <rect x={x - 7} y={fy(cone.p75[i])} width={14} height={Math.max(0, fy(cone.p25[i]) - fy(cone.p75[i]))} rx={2} fill="rgba(37,232,137,0.18)" />
            <line x1={x - 7} y1={fy(cone.p50[i])} x2={x + 7} y2={fy(cone.p50[i])} stroke="rgba(37,232,137,0.6)" strokeWidth={1.5} />
            <text x={x} y={H - 3} textAnchor="middle" fontSize={7} fill={TXT}>{tenorLabels[i] ?? `${cone.tenors[i]}D`}</text>
          </React.Fragment>
        );
      })}
      {currPts.length > 1 && (
        <polyline points={poly(currPts)} fill="none" stroke={YELLOW} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {currPts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={YELLOW} />)}
      <rect x={px} y={6} width={8} height={6} rx={1} fill="rgba(37,232,137,0.18)" />
      <text x={px + 11} y={11} fontSize={7} fill={TXT}>历史RV区间</text>
      <line x1={px + 70} y1={9} x2={px + 80} y2={9} stroke={YELLOW} strokeWidth={1.5} />
      <text x={px + 83} y={11} fontSize={7} fill={TXT}>当前IV</text>
    </svg>
  );
};

const FixedTenorChart = ({
  tenors,
  atmIVs,
  rvs,
}: {
  tenors: string[];
  atmIVs: number[];
  rvs: number[];
}) => {
  const W = 320, H = 140, px = 28, py = 14;
  const allV = [...atmIVs, ...rvs].filter(v => v > 0);
  if (!allV.length) return <Skeleton />;
  const hi = Math.ceil(Math.max(...allV) / 10) * 10 + 5;
  function fy(v: number) { return (H - py) - (v / hi) * (H - 2 * py); }
  const n = tenors.length;
  const barW = (W - 2 * px) / n;
  const bw = barW * 0.3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0, 15, 30, 45, 60].filter(v => v <= hi).map(v => (
        <React.Fragment key={v}>
          <line x1={px} y1={fy(v)} x2={W - px} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={fy(v) + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>
      ))}
      {tenors.map((t, i) => {
        const cx = px + i * barW + barW / 2;
        const iv = atmIVs[i] ?? 0;
        const rv = rvs[i] ?? 0;
        return (
          <React.Fragment key={t}>
            <rect x={cx - bw - 1} y={fy(iv)} width={bw} height={Math.max(0, fy(0) - fy(iv))} rx={1.5} fill="rgba(37,232,137,0.55)" />
            <rect x={cx + 1}      y={fy(rv)} width={bw} height={Math.max(0, fy(0) - fy(rv))} rx={1.5} fill="rgba(37,167,80,0.42)" />
            <text x={cx} y={H - 3} textAnchor="middle" fontSize={7} fill={TXT}>{t}</text>
          </React.Fragment>
        );
      })}
      <rect x={px} y={5} width={8} height={6} rx={1} fill="rgba(37,232,137,0.55)" />
      <text x={px + 11} y={10} fontSize={7} fill={TXT}>ATM IV</text>
      <rect x={px + 50} y={5} width={8} height={6} rx={1} fill="rgba(37,167,80,0.42)" />
      <text x={px + 61} y={10} fontSize={7} fill={TXT}>已实现 RV</text>
    </svg>
  );
};

function lnDistPts(S: number, iv: number, T: number, pts = 80) {
  const sigma = (iv / 100) * Math.sqrt(T / 365);
  const mu = Math.log(S) - 0.5 * sigma * sigma;
  return Array.from({ length: pts }, (_, i) => {
    const x = S * (0.55 + (i * 0.9) / (pts - 1));
    const z = (Math.log(x) - mu) / sigma;
    return { x, y: Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI)) };
  });
}

const ImpliedDistChart = ({ spot, iv30 }: { spot: number; iv30: number }) => {
  const data = lnDistPts(spot, iv30, 30);
  const W = 320, H = 140, px = 8, py = 12;
  const xs = data.map(d => d.x); const ys = data.map(d => d.y);
  const lo = Math.min(...xs); const hi = Math.max(...xs);
  const yHi = Math.max(...ys) * 1.1;
  function fx(x: number) { return px + ((x - lo) / (hi - lo)) * (W - 2 * px); }
  function fy(y: number) { return (H - py) - (y / yHi) * (H - 2 * py); }
  const curvePts: [number, number][] = data.map(d => [fx(d.x), fy(d.y)]);
  const aFill = `${smooth(curvePts)} L ${curvePts[curvePts.length - 1][0].toFixed(1)} ${fy(0)} L ${curvePts[0][0].toFixed(1)} ${fy(0)} Z`;
  const sigma = (iv30 / 100) * Math.sqrt(30 / 365) * spot;
  const xS = fx(spot);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <path d={`M ${fx(spot - sigma)} ${py} L ${fx(spot - sigma)} ${H - py} L ${fx(spot + sigma)} ${H - py} L ${fx(spot + sigma)} ${py} Z`} fill="rgba(37,232,137,0.06)" />
      <line x1={px} y1={H - py} x2={W - px} y2={H - py} stroke={GRID} strokeWidth={0.5} />
      <path d={aFill} fill="rgba(37,232,137,0.10)" />
      <path d={smooth(curvePts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={fx(spot - sigma)} y1={py} x2={fx(spot - sigma)} y2={H - py} stroke="rgba(37,232,137,0.3)" strokeWidth={0.8} strokeDasharray="3,2" />
      <line x1={fx(spot + sigma)} y1={py} x2={fx(spot + sigma)} y2={H - py} stroke="rgba(37,232,137,0.3)" strokeWidth={0.8} strokeDasharray="3,2" />
      <line x1={xS} y1={py} x2={xS} y2={H - py} stroke={YELLOW} strokeWidth={1} strokeDasharray="2,2" />
      {[-2, -1, 0, 1, 2].map(k => {
        const x = fx(spot + k * sigma);
        const lbl = k === 0 ? 'S' : `${k > 0 ? '+' : ''}${k}σ`;
        return <text key={k} x={x} y={H - 3} textAnchor="middle" fontSize={7} fill={k === 0 ? YELLOW : TXT}>{lbl}</text>;
      })}
    </svg>
  );
};

const SMILE_GRID = [0.10, 0.25, 0.50, 0.75, 0.90] as const;
const SMILE_LABELS_LIVE = ['10P', '25P', 'ATM', '25C', '10C'] as const;

interface SmileRow { label: string; values: number[] }

function buildSmileRows(expiries: ExpiryGroup[]): { rows: SmileRow[]; lines: { label: string; color: string }[] } {
  const lines: { label: string; color: string }[] = expiries.map((e, i) => ({
    label: e.label,
    color: [BRAND, YELLOW, BLUE][i] ?? TXT,
  }));
  const rows: SmileRow[] = SMILE_LABELS_LIVE.map((lbl, gi) => {
    const values = expiries.map(e => {
      if (lbl === 'ATM') return e.atmIV;
      const isCall = lbl.endsWith('C');
      const targetDelta = lbl.startsWith('10') ? 0.10 : 0.25;
      return closestDeltaIV(isCall ? e.calls : e.puts, targetDelta);
    });
    return { label: lbl, values };
  });
  return { rows, lines };
}

const SmileChartLive = ({
  expiries,
  onPick,
}: {
  expiries: ExpiryGroup[];
  onPick?: (p: { tenor: string; label: string; value: number }) => void;
}) => {
  if (!expiries.length) return <Skeleton />;
  const W = 320, H = 180, px = 28, py = 14;
  const { rows, lines } = buildSmileRows(expiries);

  const allIVs = rows.flatMap(r => r.values).filter(v => v > 0);
  if (!allIVs.length) return <Skeleton />;
  const lo = Math.floor(Math.min(...allIVs) / 5) * 5;
  const hi = Math.ceil(Math.max(...allIVs) / 5) * 5 + 5;

  function fy(v: number) { return (H - py) - ((v - lo) / (hi - lo)) * (H - 2 * py); }
  function fx(i: number) { return px + (i / (SMILE_LABELS_LIVE.length - 1)) * (W - 2 * px); }

  const yTicks = Array.from({ length: Math.round((hi - lo) / 5) + 1 }, (_, i) => lo + i * 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {yTicks.map(v => (
        <React.Fragment key={v}>
          <line x1={px} y1={fy(v)} x2={W - px} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={fy(v) + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>
      ))}
      {SMILE_LABELS_LIVE.map((lbl, i) => (
        <text key={lbl} x={fx(i)} y={H - 3} textAnchor="middle" fontSize={7} fill={TXT}>{lbl}</text>
      ))}
      {lines.map((line, li) => {
        const pts: [number, number][] = rows.map((row, ri) => [fx(ri), fy(row.values[li] || lo)]);
        return (
          <React.Fragment key={line.label}>
            <path d={smooth(pts)} fill="none" stroke={line.color} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
            {pts.map(([x, y], ri) => (
              <circle key={ri} cx={x} cy={y} r={2.5} fill={line.color}
                className={onPick ? 'cursor-pointer' : ''}
                onClick={() => onPick?.({ tenor: line.label, label: rows[ri].label, value: rows[ri].values[li] })}
              />
            ))}
          </React.Fragment>
        );
      })}
      {lines.map((line, i) => (
        <React.Fragment key={line.label}>
          <line x1={px + i * 60} y1={9} x2={px + i * 60 + 12} y2={9} stroke={line.color} strokeWidth={1.5} />
          <text x={px + i * 60 + 15} y={12} fontSize={7} fill={TXT}>{line.label}</text>
        </React.Fragment>
      ))}
    </svg>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGETS
// ═══════════════════════════════════════════════════════════════════════════════

export const VolSmileWidget = ({
  coin: coinProp, onCoinChange, onPickSmilePoint,
}: CoinControlProps & {
  onPickSmilePoint?: (p: { coin: Coin; tenor: string; label: string; value: number }) => void;
}) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);

  const expiries = data
    ? pickExpiries(data.expiries, [7, 30, 90])
    : [];

  return (
    <WidgetShell coin={coin} setCoin={setCoin}>
      {loading && !data
        ? <Skeleton />
        : <SmileChartLive
            expiries={expiries}
            onPick={p => onPickSmilePoint?.({ coin, ...p })}
          />
      }
    </WidgetShell>
  );
};

export const VRPHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const vrpData = histData?.vrp ?? VRP_HIST[coin];
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <VRPChart data={vrpData} />
      </div>
    </div>
  );
};

export const IVRankHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const ivrData = histData?.ivr ?? IVR_HIST[coin];
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <IVRankChart data={ivrData} />
      </div>
    </div>
  );
};

const CONE_TENOR_TARGETS = [7, 14, 30, 60, 90, 180];

export const VolConeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const { data: optData } = useDeribitOptions(coin);
  const mockCone = MOCK_VOL_CONE[coin];
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);

  const currIVs: number[] = CONE_TENOR_TARGETS.map(t => {
    if (optData?.expiries.length) {
      const closest = optData.expiries.reduce((best, e) =>
        Math.abs(e.daysToExp - t) < Math.abs(best.daysToExp - t) ? e : best
      );
      return closest.atmIV;
    }
    const idx = mockCone.tenors.indexOf(`${t}D` as any);
    return mockCone.curr[idx] ?? mockCone.curr[0];
  });

  const cone: VolConeSlice = histData?.volCone ?? {
    tenors: CONE_TENOR_TARGETS,
    p10: mockCone.p10, p25: mockCone.p25, p50: mockCone.p50,
    p75: mockCone.p75, p90: mockCone.p90,
  };
  const labels = CONE_TENOR_TARGETS.map(t => `${t}D`);

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {histData
          ? <VolConeChart cone={cone} currIVs={currIVs} tenorLabels={labels} />
          : <VolConeChart
              cone={cone}
              currIVs={mockCone.curr}
              tenorLabels={mockCone.tenors as unknown as string[]}
            />
        }
      </div>
    </div>
  );
};

const FIXED_TENORS_DAYS = [7, 14, 30, 60, 90, 180, 365] as const;
const FIXED_TENOR_LABELS = FIXED_TENORS_DAYS.map(d => `${d}D`);

export const FixedTenorWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const { data: optData } = useDeribitOptions(coin);
  const mock = FIXED_TENOR_VAR[coin];
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {(histData && optData) && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData, optData]);

  const hasReal = !!(histData && optData);

  const atmIVs: number[] = FIXED_TENORS_DAYS.map((days, i) => {
    if (optData?.expiries.length) {
      const e = optData.expiries.reduce((best, ex) =>
        Math.abs(ex.daysToExp - days) < Math.abs(best.daysToExp - days) ? ex : best
      );
      return e.atmIV;
    }
    return mock.varSwap[i] ?? 0;
  });

  const rvs: number[] = FIXED_TENORS_DAYS.map((_, i) =>
    histData?.rvByTenor[i] ?? mock.rv[i] ?? 0
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <FixedTenorChart
          tenors={hasReal ? FIXED_TENOR_LABELS : mock.tenors as string[]}
          atmIVs={hasReal ? atmIVs : mock.varSwap as number[]}
          rvs={hasReal ? rvs : mock.rv as number[]}
        />
      </div>
    </div>
  );
};

export const ImpliedDistWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const mock = VOL[coin];
  const spot = data?.spot ?? (coin === 'BTC' ? 95000 : 3200);
  const iv30 = data?.dvol30 ?? mock.iv30;
  return (
    <WidgetShell coin={coin} setCoin={setCoin}>
      <ImpliedDistChart spot={spot} iv30={iv30} />
    </WidgetShell>
  );
};

const SURFACE_ROWS: { label: string; type: 'C' | 'P'; delta: number }[] = [
  { label: '10P', type: 'P', delta: 0.10 },
  { label: '25P', type: 'P', delta: 0.25 },
  { label: 'ATM', type: 'C', delta: 0.50 },
  { label: '25C', type: 'C', delta: 0.25 },
  { label: '10C', type: 'C', delta: 0.10 },
];

export const IVSurfaceWidget = ({
  coin: coinProp, onCoinChange, onPickCell,
}: CoinControlProps & {
  onPickCell?: (p: { coin: Coin; row: string; col: string; value: number }) => void;
}) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) {
    return <div className="p-6"><Skeleton /></div>;
  }

  const cols = data
    ? pickExpiries(data.expiries, [7, 14, 30, 60, 90])
    : [];

  const tableData: number[][] = SURFACE_ROWS.map(row =>
    cols.map(exp => {
      if (row.label === 'ATM') return exp.atmIV;
      return closestDeltaIV(row.type === 'C' ? exp.calls : exp.puts, row.delta);
    })
  );
  const allVals = tableData.flat().filter(v => v > 0);
  const lo = allVals.length ? Math.min(...allVals) : 0;
  const hi = allVals.length ? Math.max(...allVals) : 100;

  return (
    <div className="overflow-hidden rounded-[18px]" style={{ backgroundColor: 'rgba(37,232,137,0.04)' }}>
      <div className="w-full overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-slate-600 font-bold">Δ / Exp</th>
              {cols.map(e => (
                <th key={e.label} className="px-2 py-1.5 text-slate-600 font-bold text-right">{e.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SURFACE_ROWS.map((row, ri) => (
              <tr key={row.label} className={ri === 2 ? 'border-t border-b border-border-subtle' : ''}>
                <td className={cn('px-2 py-1.5 font-mono font-bold', ri === 2 ? 'text-slate-300' : 'text-slate-500')}>
                  {row.label}
                </td>
                {tableData[ri].map((v, ci) => (
                  <td
                    key={ci}
                    role={onPickCell ? 'button' : undefined}
                    tabIndex={onPickCell ? 0 : undefined}
                    className={cn(
                      'px-2 py-1.5 text-right font-mono tnum text-slate-200 font-bold',
                      onPickCell && 'cursor-pointer hover:brightness-110',
                    )}
                    style={{ backgroundColor: `rgba(37,232,137,${(0.05 + (v - lo) / (hi - lo + 0.01) * 0.35).toFixed(2)})` }}
                    onClick={() => onPickCell?.({ coin, row: row.label, col: cols[ci]?.label ?? '', value: v })}
                    onKeyDown={e => {
                      if (!onPickCell) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickCell({ coin, row: row.label, col: cols[ci]?.label ?? '', value: v }); }
                    }}
                  >
                    {v > 0 ? v.toFixed(1) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const OptionsSkewWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  const rows = data
    ? pickExpiries(data.expiries, [7, 14, 30, 60, 90, 180]).map(e => ({
        exp: e.label,
        atm: e.atmIV,
        rr25: e.rr25,
        bf25: e.bf25,
        rr10: e.rr10,
        bf10: e.bf10,
      }))
    : [];

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      {loading && !data
        ? <Skeleton />
        : (
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
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-600 text-[11px]">暂无数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
};

// ── DVOLSeriesWidget ─────────────────────────────────────────────────────

export const DVOLSeriesWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);

  if (!histData) return <Skeleton />;

  const dvol = histData.dvolSeries;
  const rv30 = histData.rv30Series;
  if (!dvol.length) return <Skeleton />;

  const n = dvol.length;
  const allVals = [...dvol, ...rv30.filter(v => v > 0)];
  const lo = Math.floor(Math.min(...allVals) * 0.95);
  const hi = Math.ceil(Math.max(...allVals) * 1.05);
  const W = 480, H = 140, PX = 8, PY = 12;

  const dvolPts = mapPts(dvol, W, H, lo, hi, PX, PY);
  const rv30Aligned = rv30.length >= n ? rv30.slice(-n) : [...Array(n - rv30.length).fill(rv30[0] ?? lo), ...rv30];
  const rvPts = mapPts(rv30Aligned, W, H, lo, hi, PX, PY);

  const currDvol = dvol[dvol.length - 1];
  const currRv = rv30[rv30.length - 1];
  const vrp = currDvol - currRv;

  const gridVals = Array.from({ length: 5 }, (_, i) => lo + (i * (hi - lo)) / 4);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: 'DVOL 当前', val: `${currDvol.toFixed(1)}%`, color: BRAND },
          { label: 'RV30 当前', val: `${currRv.toFixed(1)}%`, color: BLUE },
          { label: 'VRP', val: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}%`, color: vrp >= 0 ? '#25e889' : '#f87171' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[13px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 px-3 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {gridVals.map(v => {
            const y = (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);
            return (
              <g key={v}>
                <line x1={PX} y1={y} x2={W - PX} y2={y} stroke={GRID} strokeWidth={0.5} />
                <text x={PX} y={y - 2} fontSize={8} fill={TXT}>{v.toFixed(0)}</text>
              </g>
            );
          })}
          <path d={area(rvPts, H, PY)} fill="url(#wg-blue)" />
          <polyline points={poly(rvPts)} fill="none" stroke={BLUE} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7} />
          <path d={area(dvolPts, H, PY)} fill="url(#wg-green)" />
          <polyline points={poly(dvolPts)} fill="none" stroke={BRAND} strokeWidth={1.5} opacity={0.9} />
        </svg>
      </div>

      <div className="flex items-center gap-4 px-3 pb-2 shrink-0">
        {[{ c: BRAND, l: 'DVOL (Deribit)' }, { c: BLUE, l: 'RV 30D', dash: true }].map(({ c, l, dash }) => (
          <div key={l} className="flex items-center gap-1.5">
            <svg width={16} height={4}><line x1={0} y1={2} x2={16} y2={2} stroke={c} strokeWidth={1.5} strokeDasharray={dash ? '3,2' : undefined} /></svg>
            <span className="text-[9px] text-white/30">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── SkewHistoryWidget ─────────────────────────────────────────────────────

const SKEW_TENOR_COLORS: Record<string, string> = {
  '7D': '#f87171', '14D': '#fb923c', '28D': '#F59E0B',
  '30D': '#F59E0B', '60D': '#84cc16', '90D': '#4ea1ff',
};

export const SkewHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [mode, setMode] = useState<'rr25' | 'rr10'>('rr25');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
          {(['rr25', 'rr10'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[18px] transition-colors',
                mode === m ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
              )}>
              {m === 'rr25' ? '25δ RR' : '10δ RR'}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时
        </span>
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, mode]);

  const currency = coin === 'BTC' ? 'BTC' : 'ETH';
  const buf = SKEW_BUFFER.get(currency) ?? [];

  if (buf.length < 2) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/20">
      <div className="text-[11px]">正在积累数据…</div>
      <div className="text-[9px]">每 30 秒更新一次，稍候片刻</div>
    </div>
  );

  const tenorSet = new Set<string>();
  buf.forEach(s => s.tenors.forEach(t => tenorSet.add(t.label)));
  const tenors = [...tenorSet].sort((a, b) => parseInt(a) - parseInt(b)).slice(0, 5);

  const W = 480, H = 120, PX = 6, PY = 12;
  const n = buf.length;

  const allVals = buf.flatMap(s => s.tenors.map(t => mode === 'rr25' ? t.rr25 : t.rr10)).filter(v => isFinite(v));
  if (!allVals.length) return <Skeleton />;
  const lo = Math.min(...allVals) - 0.5;
  const hi = Math.max(...allVals) + 0.5;

  const getVal = (snap: SkewSnap, label: string) => {
    const t = snap.tenors.find(t => t.label === label);
    return t ? (mode === 'rr25' ? t.rr25 : t.rr10) : null;
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-1.5 px-3 pt-2 pb-1.5 shrink-0 flex-wrap">
        {tenors.map(label => {
          const last = buf[buf.length - 1];
          const val = getVal(last, label);
          const color = SKEW_TENOR_COLORS[label] ?? '#a78bfa';
          return val !== null ? (
            <div key={label} className="flex items-center gap-1 bg-white/[0.025] border border-white/[0.06] rounded-[7px] px-2 py-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <span className="text-[9px] text-white/40">{label}</span>
              <span className="font-mono text-[11px] font-bold ml-1" style={{ color }}>
                {val >= 0 ? '+' : ''}{val.toFixed(2)}%
              </span>
            </div>
          ) : null;
        })}
      </div>

      <div className="flex-1 min-h-0 px-3 pb-1">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {lo < 0 && hi > 0 && (() => {
            const y = (H - PY) - ((0 - lo) / (hi - lo)) * (H - 2 * PY);
            return <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={0.8} strokeDasharray="4,3" />;
          })()}
          {[lo, (lo + hi) / 2, hi].map(v => {
            const y = (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);
            return <text key={v} x={PX} y={y - 2} fontSize={8} fill={TXT}>{v.toFixed(1)}</text>;
          })}
          {tenors.map(label => {
            const color = SKEW_TENOR_COLORS[label] ?? '#a78bfa';
            const pts: [number, number][] = buf
              .map((snap, i) => {
                const v = getVal(snap, label);
                if (v === null) return null;
                const x = PX + (i / Math.max(n - 1, 1)) * (W - 2 * PX);
                const y = (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);
                return [x, y] as [number, number];
              })
              .filter((p): p is [number, number] => p !== null);
            if (pts.length < 2) return null;
            return (
              <polyline key={label} points={poly(pts)} fill="none" stroke={color} strokeWidth={1.3} opacity={0.8} />
            );
          })}
        </svg>
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        会话内 Skew 追踪（每 30 秒一点）· {mode === 'rr25' ? '25δ Risk Reversal = Call25IV − Put25IV' : '10δ Risk Reversal = Call10IV − Put10IV'} · Deribit
      </div>
    </div>
  );
};

// ── VannaCharmWidget ──────────────────────────────────────────────────────

import { bsVanna, bsCharm, heatColor } from '../lib/bs-math';

export const VannaCharmWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [mode, setMode] = useState<'vanna' | 'charm'>('vanna');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
          {(['vanna', 'charm'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[18px] transition-colors',
                mode === m ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
              )}>
              {m === 'vanna' ? 'Vanna' : 'Charm'}
            </button>
          ))}
        </div>
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, mode]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const expiries = pickExpiries(data.expiries, [7, 14, 30, 60, 90]).slice(0, 5);

  const BIN = spot > 10000 ? 1000 : 100;
  const strikesRaw = new Set<number>();
  expiries.forEach(e => [...e.calls, ...e.puts].forEach(o => {
    if (o.strike >= spot * 0.85 && o.strike <= spot * 1.15) strikesRaw.add(o.strike);
  }));
  const strikes = [...strikesRaw].sort((a, b) => a - b);

  const grid: number[][] = strikes.map(k =>
    expiries.map(exp => {
      let total = 0;
      for (const o of [...exp.calls, ...exp.puts]) {
        if (o.strike !== k) continue;
        const g = mode === 'vanna'
          ? bsVanna(spot, k, o.T, o.iv, o.type)
          : bsCharm(spot, k, o.T, o.iv, o.type);
        total += g * o.oi;
      }
      return total;
    })
  );

  const allVals = grid.flat().filter(v => isFinite(v));
  const maxAbs = Math.max(Math.max(...allVals.map(Math.abs)), 1e-9);

  const fmtK = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
  const fmtVal = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}K`;
    if (abs >= 1)    return v.toFixed(1);
    return v.toFixed(3);
  };

  const CELL_H = 28, CELL_W = 70, LABEL_W = 66;
  const totalW = LABEL_W + expiries.length * CELL_W;
  const totalH = (strikes.length + 1) * CELL_H;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1.5 pb-1 shrink-0">
        <p className="text-[9px] text-white/25 leading-relaxed">
          {mode === 'vanna'
            ? 'Vanna = ∂Δ/∂σ · IV 每涨 1% 时 Delta 的变化 · 做市商 Vanna 对冲会推动行情沿高 Vanna 区加速'
            : 'Charm = ∂Δ/∂t · Delta 每日自然衰减量 · 近到期大 Charm 区是 Pin Risk 来源'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <svg viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} style={{ display: 'block' }}>
          {expiries.map((exp, j) => (
            <text key={exp.label}
              x={LABEL_W + j * CELL_W + CELL_W / 2}
              y={CELL_H / 2 + 4}
              textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)" fontWeight={600}
            >{exp.label}</text>
          ))}

          {strikes.map((k, i) => {
            const y = (i + 1) * CELL_H;
            const isSpot = Math.abs(k - spot) / spot < 0.006;
            return (
              <g key={k}>
                <text x={LABEL_W - 4} y={y + CELL_H / 2 + 3.5}
                  textAnchor="end" fontSize={9}
                  fill={isSpot ? '#F59E0B' : 'rgba(255,255,255,0.35)'}
                  fontWeight={isSpot ? 700 : 400}
                >{fmtK(k)}{isSpot ? ' ◆' : ''}</text>

                {expiries.map((_, j) => {
                  const val = grid[i][j];
                  const bg = heatColor(val, maxAbs);
                  return (
                    <g key={j}>
                      <rect
                        x={LABEL_W + j * CELL_W + 1}
                        y={y + 1}
                        width={CELL_W - 2}
                        height={CELL_H - 2}
                        fill={bg}
                        rx={3}
                      />
                      <text
                        x={LABEL_W + j * CELL_W + CELL_W / 2}
                        y={y + CELL_H / 2 + 3.5}
                        textAnchor="middle"
                        fontSize={8.5}
                        fill={Math.abs(val) / maxAbs > 0.4 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)'}
                        fontWeight={600}
                      >{fmtVal(val)}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        数值 = Σ({mode === 'vanna' ? 'Vanna' : 'Charm'} × OI) · 绿=正 红=负 · ◆现货 · Deribit
      </div>
    </div>
  );
};

// ── TermStructureDriftWidget ──────────────────────────────────────────────

export const TermStructureDriftWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />会话内
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

  const first = buf[0];
  const last  = buf[buf.length - 1];

  const tenorSet = new Set<string>();
  first.tenors.forEach(t => tenorSet.add(t.label));
  last.tenors.forEach(t => tenorSet.add(t.label));
  const tenors = [...tenorSet].sort((a, b) => parseInt(a) - parseInt(b));

  const getAtm = (snap: SkewSnap, label: string) =>
    snap.tenors.find(t => t.label === label)?.atm ?? null;

  const drifts = tenors.map(label => {
    const startIV = getAtm(first, label);
    const nowIV   = getAtm(last, label);
    if (startIV === null || nowIV === null) return null;
    return { label, startIV, nowIV, delta: nowIV - startIV };
  }).filter((d): d is NonNullable<typeof d> => d !== null);

  if (!drifts.length) return <Skeleton />;

  const maxAbsDelta = Math.max(...drifts.map(d => Math.abs(d.delta)), 0.5);
  const BAR_HALF = 140;

  const sessionMinutes = Math.round((last.ts - first.ts) / 60_000);
  const sessionStr = sessionMinutes < 60
    ? `${sessionMinutes}分钟`
    : `${Math.floor(sessionMinutes / 60)}h ${sessionMinutes % 60}m`;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3 pt-2 pb-1.5 shrink-0">
        <span className="text-[9px] text-white/25">会话时长 {sessionStr} · {buf.length} 个采样点</span>
        <span className="ml-auto text-[9px] text-white/20">起始 IV → 当前 IV · 差值</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        {drifts.map(d => {
          const barW = (Math.abs(d.delta) / maxAbsDelta) * BAR_HALF;
          const color = d.delta > 0 ? '#f87171' : d.delta < 0 ? '#25e889' : 'rgba(255,255,255,0.2)';
          const isPos = d.delta >= 0;
          return (
            <div key={d.label} className="flex items-center gap-2 py-1.5 border-b border-white/[0.025] last:border-0">
              <div className="w-[28px] shrink-0 text-[11px] font-mono font-bold text-white/50">{d.label}</div>
              <div className="w-[80px] shrink-0 flex items-center gap-1">
                <span className="font-mono text-[10px] text-white/30">{d.startIV.toFixed(1)}</span>
                <span className="text-[9px] text-white/15">→</span>
                <span className="font-mono text-[10px] text-white/60 font-bold">{d.nowIV.toFixed(1)}</span>
              </div>
              <div className="flex items-center" style={{ width: BAR_HALF * 2 + 2 }}>
                <div className="flex justify-end" style={{ width: BAR_HALF }}>
                  {!isPos && (
                    <div className="h-[7px] rounded-l-[2px]" style={{ width: barW, background: color }} />
                  )}
                </div>
                <div className="w-px h-[9px] bg-white/10 shrink-0" />
                <div className="flex justify-start" style={{ width: BAR_HALF }}>
                  {isPos && (
                    <div className="h-[7px] rounded-r-[2px]" style={{ width: barW, background: color }} />
                  )}
                </div>
              </div>
              <div className="w-[44px] text-right font-mono text-[10px] font-bold shrink-0" style={{ color }}>
                {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        绿=IV 下行 红=IV 上行 · 单位 vol pts · Deribit
      </div>
    </div>
  );
};

// ── DollarGreeksWidget ────────────────────────────────────────────────────

export const DollarGreeksWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const allOpts = data.expiries.flatMap(e => [...e.calls, ...e.puts]);

  let netDollarDelta = 0;
  let dollarVega     = 0;
  let dollarTheta    = 0;
  let dollarGamma    = 0;

  for (const o of allOpts) {
    if (o.oi <= 0 || o.T <= 0) continue;
    const S = spot, K = o.strike, T = o.T, iv = o.iv;

    netDollarDelta += o.delta * o.oi * spot;
    dollarVega += bsVega(S, K, T, iv) * o.oi;
    dollarTheta += bsTheta(S, K, T, iv) * o.oi;
    dollarGamma += bsGamma(S, K, T, iv) * o.oi * spot * spot / 100;
  }

  const fmtM = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (a >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };
  const sign = (v: number) => v >= 0 ? '+' : '';

  const stats = [
    {
      label: 'Net $Δ',
      val: `${sign(netDollarDelta)}${fmtM(netDollarDelta)}`,
      sub: netDollarDelta > 0 ? '市场净多头' : '市场净空头',
      color: netDollarDelta >= 0 ? '#25e889' : '#f87171',
      tip: 'OI加权净Delta，>0市场整体偏多',
    },
    {
      label: '$Vega / 1% IV',
      val: `${sign(dollarVega)}${fmtM(dollarVega)}`,
      sub: '全市场 IV 涨 1% 的盈亏',
      color: '#4ea1ff',
      tip: '隐含波动率每涨1%全体OI的价值变化',
    },
    {
      label: '$Θ / 天',
      val: `${fmtM(dollarTheta)}`,
      sub: '每日时间价值消耗',
      color: '#f87171',
      tip: '每过一个自然日市场OI总时间价值衰减',
    },
    {
      label: '$Γ / 1% 现货',
      val: `${sign(dollarGamma)}${fmtM(dollarGamma)}`,
      sub: dollarGamma >= 0 ? '正Gamma — 稳定' : '负Gamma — 加速',
      color: dollarGamma >= 0 ? '#25e889' : '#F59E0B',
      tip: '现货每涨1%时Delta变化引起的美元敞口',
    },
  ];

  return (
    <div className="w-full h-full flex items-stretch gap-2 px-3 py-2">
      {stats.map(s => (
        <div key={s.label}
          className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[10px] px-3 py-2 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/30">{s.label}</span>
          </div>
          <div className="font-mono text-[15px] font-bold leading-tight" style={{ color: s.color }}>
            {s.val}
          </div>
          <div className="text-[9px] text-white/25 mt-0.5 leading-snug">{s.sub}</div>
        </div>
      ))}
    </div>
  );
};

// ── RVvsIVTenorWidget ─────────────────────────────────────────────────────

const RV_IV_TENORS = [7, 14, 30, 60, 90, 180] as const;

export const RVvsIVTenorWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data }          = useDeribitOptions(coin);
  const { data: hist }    = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && hist && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, hist]);

  if (!data || !hist) return <Skeleton />;

  const currentIV: number[] = RV_IV_TENORS.map(t => {
    if (!data.expiries.length) return 0;
    const nearest = data.expiries.reduce((best, e) =>
      Math.abs(e.daysToExp - t) < Math.abs(best.daysToExp - t) ? e : best,
      data.expiries[0]
    );
    return nearest.atmIV;
  });

  const RV_HIST_TENORS = [7, 14, 30, 60, 90, 180, 365];
  const currentRV: number[] = RV_IV_TENORS.map(t => {
    const idx = RV_HIST_TENORS.indexOf(t);
    return idx >= 0 ? (hist.rvByTenor[idx] ?? 0) : 0;
  });

  const labels = RV_IV_TENORS.map(t => `${t}D`);
  const vrpByTenor = currentIV.map((iv, i) => iv - currentRV[i]);

  const allVals = [...currentIV, ...currentRV].filter(v => v > 0);
  if (!allVals.length) return <Skeleton />;

  const W = 520, H = 160, PX = 32, PY = 14;
  const lo = Math.floor(Math.min(...allVals) * 0.9 / 5) * 5;
  const hi = Math.ceil(Math.max(...allVals) * 1.1 / 5) * 5;
  const n = labels.length;

  const BAR_W = (W - 2 * PX) / n;
  const HALF = BAR_W * 0.28;

  const fy = (v: number) => (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);

  const gridVals = Array.from({ length: 5 }, (_, i) => lo + (i * (hi - lo)) / 4);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-1.5 px-3 pt-2 pb-1 shrink-0 flex-wrap">
        {labels.map((lbl, i) => {
          const vrp = vrpByTenor[i];
          const col = vrp >= 8 ? '#f87171' : vrp >= 3 ? '#F59E0B' : vrp <= 0 ? '#25e889' : 'rgba(255,255,255,0.4)';
          return (
            <div key={lbl} className="flex items-center gap-1 bg-white/[0.02] border border-white/[0.06] rounded-[6px] px-2 py-0.5">
              <span className="text-[9px] text-white/35">{lbl}</span>
              <span className="font-mono text-[10px] font-bold" style={{ color: col }}>
                VRP {vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 px-3 pb-1">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {gridVals.map(v => (
            <g key={v}>
              <line x1={PX} y1={fy(v)} x2={W - PX} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
              <text x={PX - 3} y={fy(v) + 3.5} textAnchor="end" fontSize={8} fill={TXT}>{v.toFixed(0)}</text>
            </g>
          ))}

          {labels.map((lbl, i) => {
            const cx = PX + (i + 0.5) * BAR_W;
            const ivY  = fy(currentIV[i]);
            const rvY  = fy(currentRV[i]);
            const botY = fy(lo);
            const ivH  = Math.max(botY - ivY, 1);
            const rvH  = Math.max(botY - rvY, 1);
            return (
              <g key={lbl}>
                <rect x={cx - HALF * 1.9} y={rvY} width={HALF} height={rvH}
                  fill={BLUE} opacity={0.5} rx={2} />
                <rect x={cx - HALF * 0.1} y={ivY} width={HALF} height={ivH}
                  fill={BRAND} opacity={0.7} rx={2} />
                <text x={cx} y={H - 2} textAnchor="middle" fontSize={8} fill={TXT}>{lbl}</text>
                <text x={cx - HALF * 0.1 + HALF / 2} y={ivY - 2} textAnchor="middle" fontSize={7} fill={BRAND}>
                  {currentIV[i].toFixed(0)}
                </text>
                <text x={cx - HALF * 1.9 + HALF / 2} y={rvY - 2} textAnchor="middle" fontSize={7} fill={BLUE}>
                  {currentRV[i].toFixed(0)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-4 px-3 pb-2 shrink-0">
        {[{ c: BRAND, l: '隐含波动率 IV（当前）' }, { c: BLUE, l: '已实现波动率 RV（历史）' }].map(({ c, l }) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-[2px]" style={{ background: c, opacity: 0.7 }} />
            <span className="text-[9px] text-white/30">{l}</span>
          </div>
        ))}
        <span className="ml-auto text-[9px] text-white/15">VRP = IV − RV · &gt;8pp 贵 · &lt;0 便宜</span>
      </div>
    </div>
  );
};

// ── CalendarSpreadWidget ──────────────────────────────────────────────────

export const CalendarSpreadWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

  interface SpreadRow { label: string; near: string; far: string; nearIV: number; farIV: number; spreadVol: number; spreadPct: number }
  const rows: SpreadRow[] = [];
  for (let i = 0; i < exps.length - 1; i++) {
    const n = exps[i]; const f = exps[i + 1];
    const spreadVol = f.atmIV - n.atmIV;
    const spreadPct = n.atmIV > 0 ? (spreadVol / n.atmIV) * 100 : 0;
    rows.push({ label: `${n.label} / ${f.label}`, near: n.label, far: f.label, nearIV: n.atmIV, farIV: f.atmIV, spreadVol, spreadPct });
  }
  const maxAbsVol = Math.max(...rows.map(r => Math.abs(r.spreadVol)), 1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        ATM IV 日历价差（近端 → 远端，vol pts）
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
        {rows.map(r => {
          const barW = (Math.abs(r.spreadVol) / maxAbsVol) * 100;
          const color = r.spreadVol >= 0 ? 'var(--nexus-accent)' : 'var(--nexus-red)';
          return (
            <div key={r.label} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-400">{r.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-slate-500">{r.nearIV.toFixed(1)}% → {r.farIV.toFixed(1)}%</span>
                  <span className="text-[11px] font-mono font-bold tnum w-[60px] text-right"
                    style={{ color }}>
                    {r.spreadVol >= 0 ? '+' : ''}{r.spreadVol.toFixed(1)}vp
                  </span>
                  <span className="text-[9px] font-mono w-[44px] text-right"
                    style={{ color: r.spreadPct >= 0 ? '#64748b' : 'var(--nexus-red)' }}>
                    {r.spreadPct >= 0 ? '+' : ''}{r.spreadPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-[5px] rounded-full overflow-hidden bg-white/4">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: color, opacity: 0.7 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── ForwardVolWidget ──────────────────────────────────────────────────────

export const ForwardVolWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

  interface FwdRow { pair: string; T1d: number; T2d: number; iv1: number; iv2: number; fwdVol: number; premium: number }
  const rows: FwdRow[] = [];
  for (let i = 0; i < exps.length - 1; i++) {
    const e1 = exps[i]; const e2 = exps[i + 1];
    const T1 = e1.daysToExp / 365; const T2 = e2.daysToExp / 365;
    const v1 = e1.atmIV / 100;     const v2 = e2.atmIV / 100;
    const variance = (v2 * v2 * T2 - v1 * v1 * T1) / (T2 - T1);
    const fwdVol = variance > 0 ? Math.sqrt(variance) * 100 : 0;
    const premium = fwdVol - e2.atmIV;
    rows.push({ pair: `${e1.label}→${e2.label}`, T1d: e1.daysToExp, T2d: e2.daysToExp, iv1: e1.atmIV, iv2: e2.atmIV, fwdVol, premium });
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        隐含远期波动率（σ_fwd）vs 即期 ATM IV
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal">区间</th>
              <th className="text-right pb-1.5 font-normal">近端IV</th>
              <th className="text-right pb-1.5 font-normal">远端IV</th>
              <th className="text-right pb-1.5 font-normal">远期σ</th>
              <th className="text-right pb-1.5 font-normal">溢价</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const premColor = r.premium > 2 ? 'var(--nexus-green)' : r.premium < -2 ? 'var(--nexus-red)' : '#94a3b8';
              return (
                <tr key={r.pair} className="border-t border-white/4">
                  <td className="py-1.5 text-slate-400 text-[9px]">{r.pair}</td>
                  <td className="py-1.5 text-right text-slate-400">{r.iv1.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-slate-400">{r.iv2.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold text-slate-200">{r.fwdVol.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: premColor }}>
                    {r.premium >= 0 ? '+' : ''}{r.premium.toFixed(1)}vp
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
