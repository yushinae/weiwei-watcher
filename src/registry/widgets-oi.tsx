import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import { heatColor, bsGamma } from '../lib/bs-math';
import type { DeribitData, ExpiryGroup, ParsedOption } from './types';
import { useDeribitOptions } from './data-hooks';
import { subscribeData } from './data-layer';
import {
  CoinControlProps, useCoinControl, CoinTabs, Skeleton,
} from './ui-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: maxPain and computeMaxPain
// ═══════════════════════════════════════════════════════════════════════════════

function computeMaxPain(
  calls: { strike: number; oi: number }[],
  puts:  { strike: number; oi: number }[],
  candidates: number[],
): number {
  let minPain = Infinity;
  let maxPainStrike = candidates[0] ?? 0;
  for (const P of candidates) {
    let pain = 0;
    for (const c of calls) pain += Math.max(0, P - c.strike) * c.oi;
    for (const p of puts)  pain += Math.max(0, p.strike - P) * p.oi;
    if (pain < minPain) { minPain = pain; maxPainStrike = P; }
  }
  return maxPainStrike;
}

function maxPain(exp: ExpiryGroup, spot: number): number {
  const strikes = [...new Set([...exp.calls, ...exp.puts].map(o => o.strike))].sort((a, b) => a - b);
  if (!strikes.length) return spot;

  let minPain = Infinity;
  let mpStrike = strikes[0];

  for (const s of strikes) {
    const callLoss = exp.calls.reduce((sum, o) => sum + o.oi * Math.max(0, s - o.strike), 0);
    const putLoss  = exp.puts.reduce((sum, o)  => sum + o.oi * Math.max(0, o.strike - s), 0);
    const pain = callLoss + putLoss;
    if (pain < minPain) { minPain = pain; mpStrike = s; }
  }
  return mpStrike;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OIByStrikeWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const OIByStrikeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = data?.expiries.slice(0, 8) ?? [];

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;

  const callOI = new Map<number, number>();
  const putOI  = new Map<number, number>();

  const targetExps = expFilter === 'all'
    ? expiries
    : expiries.filter(e => e.label === expFilter);

  for (const e of targetExps) {
    for (const o of e.calls) {
      callOI.set(o.strike, (callOI.get(o.strike) ?? 0) + o.oi);
    }
    for (const o of e.puts) {
      putOI.set(o.strike, (putOI.get(o.strike) ?? 0) + o.oi);
    }
  }

  const strikes = [...new Set([...callOI.keys(), ...putOI.keys()])]
    .filter(k => k >= spot * 0.65 && k <= spot * 1.35)
    .sort((a, b) => a - b);

  const callArr = strikes.map(k => ({ strike: k, oi: callOI.get(k) ?? 0 }));
  const putArr  = strikes.map(k => ({ strike: k, oi: putOI.get(k)  ?? 0 }));
  const maxPainStrike = computeMaxPain(callArr, putArr, strikes);

  const maxCallOI = Math.max(...strikes.map(k => callOI.get(k) ?? 0), 1);
  const maxPutOI  = Math.max(...strikes.map(k => putOI.get(k)  ?? 0), 1);
  const maxOI     = Math.max(maxCallOI, maxPutOI);

  const totalCallOI = callArr.reduce((s, o) => s + o.oi, 0);
  const totalPutOI  = putArr.reduce((s, o) => s + o.oi, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  const BAR_H = 16;
  const GAP = 2;
  const ROW_H = BAR_H + GAP;
  const LEFT_W = 120;
  const RIGHT_W = 120;
  const LABEL_W = 80;
  const TOTAL_W = LEFT_W + LABEL_W + RIGHT_W;
  const CHART_H = strikes.length * ROW_H;

  const fmtOI = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const fmtPrice = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-1 px-3 pt-2 pb-1.5 shrink-0 overflow-x-auto">
        <button
          onClick={() => setExpFilter('all')}
          className={cn(
            'px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0',
            expFilter === 'all'
              ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]'
              : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]',
          )}
        >全部</button>
        {expiries.map(e => (
          <button
            key={e.label}
            onClick={() => setExpFilter(e.label)}
            className={cn(
              'px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0',
              expFilter === e.label
                ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]'
                : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 px-3 pb-2 text-[10px] shrink-0">
        <span className="text-white/30">Call OI <span className="font-mono text-emerald-400/80">{fmtOI(totalCallOI)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">Put OI <span className="font-mono text-rose-400/80">{fmtOI(totalPutOI)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">PCR <span className="font-mono text-amber-400/80">{pcr.toFixed(2)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">最大痛点 <span className="font-mono text-[var(--nexus-accent)]/80">{maxPainStrike.toLocaleString()}</span></span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2">
        {strikes.length === 0
          ? <div className="py-8 text-center text-[11px] text-white/20">暂无持仓数据</div>
          : (
            <svg
              viewBox={`0 0 ${TOTAL_W} ${CHART_H}`}
              width="100%"
              style={{ height: Math.min(CHART_H, 600) }}
            >
              {strikes.map((strike, i) => {
                const y = i * ROW_H;
                const cOI = callOI.get(strike) ?? 0;
                const pOI = putOI.get(strike)  ?? 0;
                const callBarW = (cOI / maxOI) * RIGHT_W;
                const putBarW  = (pOI / maxOI) * LEFT_W;
                const isSpot    = Math.abs(strike - spot)    < spot * 0.005;
                const isMaxPain2 = Math.abs(strike - maxPainStrike) < spot * 0.005;
                const isAtm     = isSpot || Math.abs(strike - spot) === Math.min(...strikes.map(k => Math.abs(k - spot)));
                const labelColor = isSpot ? '#F59E0B' : isMaxPain2 ? 'rgba(37,232,137,0.9)' : 'rgba(255,255,255,0.45)';

                return (
                  <g key={strike}>
                    <rect
                      x={LEFT_W - putBarW}
                      y={y + 1}
                      width={putBarW}
                      height={BAR_H - 2}
                      rx={2}
                      fill={`rgba(202,63,100,${0.45 + (pOI / maxOI) * 0.35})`}
                    />
                    <rect
                      x={LEFT_W + LABEL_W}
                      y={y + 1}
                      width={callBarW}
                      height={BAR_H - 2}
                      rx={2}
                      fill={`rgba(37,232,137,${0.4 + (cOI / maxOI) * 0.4})`}
                    />
                    <text
                      x={LEFT_W + LABEL_W / 2}
                      y={y + BAR_H / 2 + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={isSpot || isMaxPain2 ? 'bold' : 'normal'}
                      fontFamily="monospace"
                      fill={labelColor}
                    >
                      {fmtPrice(strike)}
                      {isSpot    && ' ◆'}
                      {isMaxPain2 && !isSpot && ' ★'}
                    </text>
                    {pOI > 0 && (
                      <text x={LEFT_W - putBarW - 2} y={y + BAR_H / 2 + 3.5} textAnchor="end" fontSize={8} fill="rgba(202,63,100,0.6)">
                        {fmtOI(pOI)}
                      </text>
                    )}
                    {cOI > 0 && (
                      <text x={LEFT_W + LABEL_W + callBarW + 2} y={y + BAR_H / 2 + 3.5} fontSize={8} fill="rgba(37,232,137,0.55)">
                        {fmtOI(cOI)}
                      </text>
                    )}
                    <line x1={0} y1={y + ROW_H - 0.5} x2={TOTAL_W} y2={y + ROW_H - 0.5} stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
                  </g>
                );
              })}
            </svg>
          )
        }
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        ◆ 现货价  ★ 最大痛点  数据来源：Deribit · {expFilter === 'all' ? '全部到期日' : expFilter}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// GEXWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const GEXWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = data?.expiries.slice(0, 6) ?? [];

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const targetExps = expFilter === 'all' ? expiries : expiries.filter(e => e.label === expFilter);

  const gexMap = new Map<number, { cGex: number; pGex: number }>();
  for (const exp of targetExps) {
    for (const opt of [...exp.calls, ...exp.puts]) {
      const g = bsGamma(spot, opt.strike, opt.T, opt.iv) * spot * spot / 100;
      if (!gexMap.has(opt.strike)) gexMap.set(opt.strike, { cGex: 0, pGex: 0 });
      const e = gexMap.get(opt.strike)!;
      if (opt.type === 'C') e.cGex += g * opt.oi;
      else                   e.pGex += g * opt.oi;
    }
  }

  const strikes = [...gexMap.keys()]
    .filter(k => k >= spot * 0.70 && k <= spot * 1.30)
    .sort((a, b) => a - b);

  const netGex = strikes.map(k => {
    const e = gexMap.get(k)!;
    return e.cGex - e.pGex;
  });
  const totalNet = netGex.reduce((s, g) => s + g, 0);

  let zeroGamma: number | null = null;
  for (let i = 1; i < strikes.length; i++) {
    if (netGex[i - 1] * netGex[i] < 0) {
      const frac = Math.abs(netGex[i - 1]) / (Math.abs(netGex[i - 1]) + Math.abs(netGex[i]));
      zeroGamma = strikes[i - 1] + frac * (strikes[i] - strikes[i - 1]);
      break;
    }
  }

  const maxAbsGex = Math.max(...netGex.map(Math.abs), 1);
  const fmtGex = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const BAR_H2 = 15, GAP = 3, ROW_H2 = BAR_H2 + GAP;
  const MAX_BAR = 130;
  const LABEL_W2 = 72;
  const CHART_H2 = strikes.length * ROW_H2;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 py-1.5 shrink-0 border-b border-white/[0.04]">
        {['all', ...expiries.map(e => e.label)].map(f => (
          <button key={f} onClick={() => setExpFilter(f as 'all' | string)}
            className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[6px] transition-colors',
              expFilter === f ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
            )}>
            {f === 'all' ? '全部' : f}
          </button>
        ))}
      </div>

      <div className="flex gap-2 px-3 py-2 shrink-0">
        {[
          { label: '净 GEX', val: fmtGex(totalNet), color: totalNet >= 0 ? '#25e889' : '#f87171' },
          { label: '零 Gamma', val: zeroGamma ? fmtPx(zeroGamma) : '—', color: '#F59E0B' },
          { label: '现货', val: fmtPx(spot), color: 'rgba(255,255,255,0.6)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        <svg width="100%" viewBox={`0 0 ${MAX_BAR * 2 + LABEL_W2} ${CHART_H2}`} style={{ display: 'block', minHeight: CHART_H2 }}>
          <line x1={MAX_BAR} y1={0} x2={MAX_BAR} y2={CHART_H2} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

          {strikes.map((k, i) => {
            const y = i * ROW_H2;
            const net = netGex[i];
            const barW = Math.abs(net) / maxAbsGex * (MAX_BAR - 2);
            const isPos = net >= 0;
            const barX = isPos ? MAX_BAR : MAX_BAR - barW;
            const isSpot = Math.abs(k - spot) / spot < 0.005;
            const isZero = zeroGamma !== null && Math.abs(k - zeroGamma) / spot < 0.005;
            const barColor2 = isPos ? 'rgba(37,232,137,0.7)' : 'rgba(248,113,113,0.7)';

            return (
              <g key={k}>
                <rect x={barX} y={y + 1} width={barW} height={BAR_H2 - 2} fill={barColor2} rx={2} />
                <text
                  x={MAX_BAR + LABEL_W2 / 2}
                  y={y + BAR_H2 / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isSpot ? '#F59E0B' : isZero ? '#a78bfa' : 'rgba(255,255,255,0.35)'}
                  fontWeight={isSpot || isZero ? 700 : 400}
                >
                  {fmtPx(k)}{isSpot ? ' ◆' : isZero ? ' ○' : ''}
                </text>
                {Math.abs(net) / maxAbsGex > 0.12 && (
                  <text
                    x={isPos ? barX + barW + 2 : barX - 2}
                    y={y + BAR_H2 / 2 + 3.5}
                    textAnchor={isPos ? 'start' : 'end'}
                    fontSize={7.5}
                    fill={isPos ? 'rgba(37,232,137,0.5)' : 'rgba(248,113,113,0.5)'}
                  >
                    {fmtGex(net)}
                  </text>
                )}
                <line x1={0} y1={y + ROW_H2 - 0.5} x2={MAX_BAR * 2 + LABEL_W2} y2={y + ROW_H2 - 0.5} stroke="rgba(255,255,255,0.025)" strokeWidth={0.5} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        ◆ 现货  ○ 零Gamma  GEX = Γ × OI × S² / 100（每1%标的波动）· Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DEXWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const DEXWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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

  const spot = data.spot;
  const BIN = spot > 10_000 ? 1_000 : 100;

  const allOpts = data.expiries.flatMap(e => [...e.calls, ...e.puts]);
  const inRange  = allOpts.filter(o => o.strike >= spot * 0.80 && o.strike <= spot * 1.20);

  const bins = new Map<number, number>();
  for (const o of inRange) {
    const k = Math.round(o.strike / BIN) * BIN;
    const delta = Math.abs(o.delta);
    const sign  = o.type === 'C' ? -1 : 1;
    const contrib = sign * delta * o.oi * spot / 1_000_000;
    bins.set(k, (bins.get(k) ?? 0) + contrib);
  }

  const sorted = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return <div className="p-4 text-[11px] text-white/20">数据不足</div>;

  const maxAbsDex = Math.max(...sorted.map(([, v]) => Math.abs(v)), 0.01);
  const BAR_MAX2 = 110;
  const ROW_H3 = 22;
  const fmtM = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1000) return `${(v / 1000).toFixed(1)}B`;
    if (a >= 1)    return `${v.toFixed(1)}M`;
    return `${(v * 1000).toFixed(0)}K`;
  };
  const fmtK2 = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const netDEX = sorted.reduce((s, [, v]) => s + v, 0);
  const netColor = netDEX < 0 ? '#25e889' : '#f87171';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        <div className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
          <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">净 DEX</div>
          <div className="font-mono text-[13px] font-bold" style={{ color: netColor }}>
            {netDEX >= 0 ? '+' : ''}{fmtM(netDEX)}
          </div>
        </div>
        <div className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
          <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">方向</div>
          <div className="font-mono text-[12px] font-bold" style={{ color: netColor }}>
            {netDEX < 0 ? '做市商净空 → 助涨' : '做市商净多 → 阻涨'}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        {sorted.map(([strike, dex]) => {
          const isSpot = Math.abs(strike - spot) / spot < (BIN / spot) * 0.6;
          const isPos  = dex >= 0;
          const barW   = (Math.abs(dex) / maxAbsDex) * BAR_MAX2;
          const color2  = isPos ? '#f87171' : '#25e889';
          return (
            <div
              key={strike}
              className={cn('flex items-center gap-1 border-b border-white/[0.025]', isSpot && 'bg-amber-500/[0.06]')}
              style={{ height: ROW_H3 }}
            >
              <div className="w-[58px] shrink-0 text-right pr-1">
                <span className={cn('font-mono text-[9.5px]', isSpot ? 'text-amber-400 font-bold' : 'text-white/35')}>
                  {fmtK2(strike)}{isSpot ? '◆' : ''}
                </span>
              </div>
              <div className="flex items-center" style={{ width: BAR_MAX2 * 2 + 2 }}>
                <div className="flex justify-end" style={{ width: BAR_MAX2 }}>
                  {!isPos && (
                    <div className="h-[8px] rounded-l-[2px]" style={{ width: barW, background: color2 }} />
                  )}
                </div>
                <div className="w-px h-[10px] bg-white/10 shrink-0" />
                <div className="flex justify-start" style={{ width: BAR_MAX2 }}>
                  {isPos && (
                    <div className="h-[8px] rounded-r-[2px]" style={{ width: barW, background: color2 }} />
                  )}
                </div>
              </div>
              <div className="w-[52px] shrink-0 text-right font-mono text-[9px] font-bold" style={{ color: color2 }}>
                {dex >= 0 ? '+' : ''}{fmtM(dex)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        绿=做市商净空δ（买盘支撑） 红=净多δ（卖压阻力） 单位$M · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// KeyLevelsWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const KeyLevelsWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!data) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const BIN2 = spot > 10_000 ? 1_000 : 100;

  const allOpts2 = data.expiries.flatMap(e => [...e.calls, ...e.puts]);
  const gexBins = new Map<number, number>();
  for (const o of allOpts2.filter(o => o.strike >= spot * 0.70 && o.strike <= spot * 1.30)) {
    const k2 = Math.round(o.strike / BIN2) * BIN2;
    const g2 = bsGamma(spot, o.strike, o.T, o.iv) * o.oi * spot * spot / 100;
    const sign2 = o.type === 'C' ? 1 : -1;
    gexBins.set(k2, (gexBins.get(k2) ?? 0) + sign2 * g2);
  }
  const gexSorted = [...gexBins.entries()].sort((a, b) => a[0] - b[0]);

  let gammaFlip: number | null = null;
  const belowSpot = gexSorted.filter(([k]) => k <= spot).reverse();
  for (let i = 0; i < belowSpot.length - 1; i++) {
    if (belowSpot[i][1] >= 0 && belowSpot[i + 1][1] < 0) {
      gammaFlip = belowSpot[i][0];
      break;
    }
    if (belowSpot[i][1] < 0) {
      gammaFlip = belowSpot[i][0];
      break;
    }
  }
  if (!gammaFlip && gexSorted.length) {
    const neg = gexSorted.filter(([k, v]) => k <= spot && v < 0);
    gammaFlip = neg.length ? neg.reduce((b, c) => c[1] < b[1] ? c : b, neg[0])[0] : null;
  }

  const oiBins = new Map<number, number>();
  for (const o of allOpts2.filter(o => o.strike >= spot * 0.70 && o.strike <= spot * 1.30)) {
    const k3 = Math.round(o.strike / BIN2) * BIN2;
    oiBins.set(k3, (oiBins.get(k3) ?? 0) + o.oi);
  }
  const biggestOI = [...oiBins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? spot;

  const nearestExp = data.expiries[0] ?? null;
  const mpPrice = nearestExp ? maxPain(nearestExp, spot) : null;

  const fmtPx3 = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
  const pctFromSpot = (v: number) => {
    const p = ((v - spot) / spot) * 100;
    return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
  };

  const levels: { label: string; price: number; color: string; desc: string }[] = [
    { label: '现货', price: spot, color: '#F59E0B', desc: '当前指数价格' },
    ...(gammaFlip ? [{ label: 'Gamma Flip', price: gammaFlip, color: gammaFlip < spot ? '#f87171' : '#25e889', desc: gammaFlip < spot ? '跌破此位 → 负 Gamma 区' : '站上此位 → 正 Gamma 区' }] : []),
    ...(mpPrice !== null ? [{ label: `Max Pain (${nearestExp!.label})`, price: mpPrice, color: '#a78bfa', desc: '期权卖方总损失最小到期价' }] : []),
    { label: '最大 OI 行权价', price: biggestOI, color: '#4ea1ff', desc: '全部到期日合并最大持仓量行权价' },
  ].sort((a, b) => a.price - b.price);

  const allPrices = levels.map(l => l.price);
  const minP = Math.min(...allPrices) * 0.993;
  const maxP = Math.max(...allPrices) * 1.007;
  const rangeP = maxP - minP || 1;
  const toX = (p: number) => ((p - minP) / rangeP) * 100;

  return (
    <div className="w-full h-full flex flex-col px-4 pt-2 pb-1 gap-2">
      <div className="flex items-stretch gap-2 flex-1 min-h-0">
        {levels.map(lv => (
          <div
            key={lv.label}
            className="flex-1 min-w-[100px] rounded-[8px] border px-2.5 py-1.5 flex flex-col justify-between"
            style={{ borderColor: `${lv.color}28`, background: `${lv.color}09` }}
          >
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] truncate">{lv.label}</div>
            <div className="font-mono text-[14px] font-bold leading-tight" style={{ color: lv.color }}>
              ${fmtPx3(lv.price)}
            </div>
            <div className="flex items-end justify-between gap-1">
              <span className="text-[8.5px] text-white/20 leading-snug truncate">{lv.desc}</span>
              {lv.label !== '现货' && (
                <span className="font-mono text-[9px] shrink-0 font-bold"
                  style={{ color: lv.price >= spot ? '#25e889' : '#f87171' }}>
                  {pctFromSpot(lv.price)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 w-full" style={{ height: 22 }}>
        <svg viewBox="0 0 1000 22" preserveAspectRatio="none" width="100%" height="22">
          <line x1="0" y1="4" x2="1000" y2="4" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          {levels.map(lv => {
            const x = toX(lv.price) * 10;
            return (
              <g key={lv.label}>
                <line x1={x} y1="4" x2={x} y2="13"
                  stroke={lv.color} strokeWidth="1.2" />
                <circle cx={x} cy="18" r="3.5" fill={lv.color}
                  style={{ filter: `drop-shadow(0 0 3px ${lv.color}88)` }} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ExpiryCalendarWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const ExpiryCalendarWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!data || !data.expiries.length) return <div className="p-3 text-[11px] text-white/20">暂无到期日数据</div>;

  const spotE = data.spot;
  const exps = data.expiries.slice(0, 10);

  const rowsE = exps.map(e => {
    const callOI2 = e.calls.reduce((s, o) => s + o.oi, 0);
    const putOI2  = e.puts.reduce((s,  o) => s + o.oi, 0);
    const totalOI2 = callOI2 + putOI2;
    const pcr2 = callOI2 > 0 ? putOI2 / callOI2 : 1;
    const mp = maxPain(e, spotE);
    const mpPct = spotE > 0 ? ((mp - spotE) / spotE) * 100 : 0;
    return { label: e.label, daysToExp: e.daysToExp, callOI: callOI2, putOI: putOI2, totalOI: totalOI2, pcr: pcr2, atmIV: e.atmIV, mp, mpPct };
  });

  const maxOIE = Math.max(...rowsE.map(r => r.totalOI), 1);
  const fmtOI2 = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0);
  const fmtPxE = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const BAR_MAX3 = 220;
  const ROW_H4 = 38;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="grid grid-cols-[52px_1fr_60px_56px_60px_70px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['到期日', 'OI 分布（Call ▶ ◀ Put）', 'PCR', 'ATM IV', 'Max Pain', '偏离现货'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/20">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {rowsE.map((r, i) => {
          const callBarW = maxOIE > 0 ? (r.callOI / maxOIE) * (BAR_MAX3 / 2) : 0;
          const putBarW  = maxOIE > 0 ? (r.putOI  / maxOIE) * (BAR_MAX3 / 2) : 0;
          const pcrColor3 = r.pcr >= 1.2 ? '#f87171' : r.pcr <= 0.7 ? '#25e889' : '#F59E0B';
          const mpColor2   = r.mpPct >= 3 ? '#25e889' : r.mpPct <= -3 ? '#f87171' : 'rgba(255,255,255,0.4)';
          const isNear    = r.daysToExp <= 7;

          return (
            <div
              key={i}
              className={cn(
                'grid grid-cols-[52px_1fr_60px_56px_60px_70px] gap-x-2 px-3 items-center border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors',
                isNear && 'bg-amber-500/[0.04]',
              )}
              style={{ minHeight: ROW_H4 }}
            >
              <div>
                <div className={cn('text-[11px] font-mono font-bold', isNear ? 'text-amber-400' : 'text-white/60')}>{r.label}</div>
                <div className="text-[9px] text-white/20">{r.daysToExp}天</div>
              </div>

              <div className="flex items-center justify-center gap-px">
                <div className="flex justify-end" style={{ width: `${BAR_MAX3 / 2}px` }}>
                  <div
                    className="h-[10px] rounded-l-[3px] transition-all"
                    style={{ width: `${callBarW}px`, background: 'rgba(37,232,137,0.55)' }}
                  />
                </div>
                <div className="w-px h-[12px] bg-white/10" />
                <div className="flex justify-start" style={{ width: `${BAR_MAX3 / 2}px` }}>
                  <div
                    className="h-[10px] rounded-r-[3px] transition-all"
                    style={{ width: `${putBarW}px`, background: 'rgba(248,113,113,0.55)' }}
                  />
                </div>
              </div>

              <span className="font-mono text-[11px] font-bold" style={{ color: pcrColor3 }}>
                {r.pcr.toFixed(2)}
              </span>

              <span className="font-mono text-[11px] text-white/50">
                {r.atmIV.toFixed(1)}%
              </span>

              <span className="font-mono text-[11px] text-white/45">
                ${fmtPxE(r.mp)}
              </span>

              <span className="font-mono text-[11px] font-bold" style={{ color: mpColor2 }}>
                {r.mpPct >= 0 ? '+' : ''}{r.mpPct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 shrink-0 border-t border-white/[0.04] flex items-center gap-4">
        <span className="text-[9px] text-white/15">
          Max Pain = 期权卖方总损失最小的到期价
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(37,232,137,0.55)]" />
            <span className="text-[9px] text-white/25">Call OI</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(248,113,113,0.55)]" />
            <span className="text-[9px] text-white/25">Put OI</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TopOIWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const TopOIWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [sortBy, setSortBy] = useState<'oi' | 'vol'>('oi');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
          {(['oi', 'vol'] as const).map(m => (
            <button key={m} onClick={() => setSortBy(m)}
              className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[18px] transition-colors',
                sortBy === m ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
              )}>
              {m === 'oi' ? '持仓量' : '成交量'}
            </button>
          ))}
        </div>
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, sortBy]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const spotT = data.spot;
  const allOptsT = data.expiries.flatMap(e =>
    [...e.calls, ...e.puts].map(o => ({ ...o, expLabel: e.label }))
  );

  const sortedT = [...allOptsT]
    .sort((a, b) => sortBy === 'oi' ? b.oi - a.oi : b.volume - a.volume)
    .slice(0, 15);

  const maxVal = Math.max(...sortedT.map(o => sortBy === 'oi' ? o.oi : o.volume), 1);
  const fmtN = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const fmtK4 = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const moneyness2 = (o: ParsedOption & { expLabel: string }) => {
    const pct = ((o.strike - spotT) / spotT) * 100;
    if (Math.abs(pct) < 1) return { label: 'ATM', color: '#F59E0B' };
    if (pct > 0) return { label: `OTM +${pct.toFixed(0)}%`, color: 'rgba(255,255,255,0.3)' };
    return { label: `OTM ${pct.toFixed(0)}%`, color: 'rgba(255,255,255,0.3)' };
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="grid grid-cols-[40px_60px_56px_48px_56px_56px_1fr] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['#', '行权价', '到期', '类型', 'IV', 'Delta', sortBy === 'oi' ? '持仓量 OI' : '成交量 Vol'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/20">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {sortedT.map((o, i) => {
          const val = sortBy === 'oi' ? o.oi : o.volume;
          const barW2 = (val / maxVal) * 100;
          const typeColor = o.type === 'C' ? '#4ea1ff' : '#f59e0b';
          const m2 = moneyness2(o);
          return (
            <div key={i}
              className="grid grid-cols-[40px_60px_56px_48px_56px_56px_1fr] gap-x-2 px-3 py-1.5 border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors items-center"
            >
              <span className="text-[10px] text-white/20 font-mono">{i + 1}</span>
              <div>
                <span className="font-mono text-[11px] font-bold text-white/75">${fmtK4(o.strike)}</span>
                <div className="text-[8.5px] mt-0.5" style={{ color: m2.color }}>{m2.label}</div>
              </div>
              <span className="font-mono text-[10px] text-white/45">{o.expLabel}</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: typeColor }}>
                {o.type === 'C' ? 'CALL' : 'PUT'}
              </span>
              <span className="font-mono text-[10px] text-white/50">{o.iv.toFixed(1)}%</span>
              <span className="font-mono text-[10px] text-white/45">{o.delta.toFixed(2)}</span>

              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-white/[0.04]">
                  <div className="h-full rounded-full" style={{ width: `${barW2}%`, background: typeColor, opacity: 0.6 }} />
                </div>
                <span className="font-mono text-[10px] text-white/50 shrink-0 w-[36px] text-right">{fmtN(val)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        按{sortBy === 'oi' ? '持仓量' : '成交量'}排序 · 全到期日 · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// OIDeltaWidget
// ═══════════════════════════════════════════════════════════════════════════════

const OI_SNAPSHOT = new Map<string, Map<string, number>>();

interface OIDeltaRow {
  instrument: string;
  strike: number;
  type: 'C' | 'P';
  expiry: string;
  delta: number;
  current: number;
}

async function fetchOIDelta(coin: Coin): Promise<OIDeltaRow[]> {
  const cur = coin === 'BTC' ? 'BTC' : 'ETH';
  const res = await fetch(
    `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${cur}&kind=option`
  ).then(r => r.json());
  const books: any[] = res.result ?? [];

  const currentMap = new Map<string, number>();
  for (const b of books) currentMap.set(b.instrument_name as string, b.open_interest ?? 0);

  if (!OI_SNAPSHOT.has(coin)) OI_SNAPSHOT.set(coin, new Map(currentMap));
  const snapshot = OI_SNAPSHOT.get(coin)!;

  const rowsI: OIDeltaRow[] = [];
  for (const [inst, curr] of currentMap) {
    const parts = inst.split('-');
    if (parts.length !== 4) continue;
    const [, expiryRaw, strikeStr, typeStr] = parts;
    const strike = Number(strikeStr);
    const type = typeStr === 'C' ? 'C' : 'P';
    const snap = snapshot.get(inst) ?? 0;
    const delta = curr - snap;
    if (Math.abs(delta) > 0) rowsI.push({ instrument: inst, strike, type, expiry: expiryRaw, delta, current: curr });
  }
  return rowsI.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
}

export const OIDeltaWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [rows, setRows] = useState<OIDeltaRow[]>([]);
  const [loading2, setLoading2] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const resetSnapshot = useCallback(() => {
    OI_SNAPSHOT.delete(coin);
    setLoading2(true);
    fetchOIDelta(coin)
      .then(r => { setRows(r); setLoading2(false); setUpdatedAt(Date.now()); })
      .catch(() => setLoading2(false));
  }, [coin]);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <CoinTabs v={coin} set={setCoin} />
        <button
          onClick={resetSnapshot}
          className="text-[9px] text-slate-600 hover:text-slate-300 transition-colors px-1.5 py-0.5 rounded border border-white/8">
          重置快照
        </button>
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, resetSnapshot]);

  useEffect(() => {
    let alive = true;
    const unsub = subscribeData<OIDeltaRow[]>(
      `oidelta-${coin}`,
      () => fetchOIDelta(coin),
      30_000,
      d => {
        if (!alive) return;
        setRows(d);
        setLoading2(false);
        setUpdatedAt(Date.now());
      },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (loading2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const maxAbs2 = Math.max(...rows.map(r => Math.abs(r.delta)), 1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0">
        <span className="text-[9px] text-slate-600">
          Top {rows.length} 合约 OI 变动（会话内）
        </span>
        {updatedAt && (
          <span className="text-[9px] text-slate-700">
            {new Date(updatedAt).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          快照已记录，等待 OI 变动…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
          {rows.map(r => {
            const barW = (Math.abs(r.delta) / maxAbs2) * 100;
            const isInc = r.delta > 0;
            const color3 = isInc ? 'var(--nexus-green)' : 'var(--nexus-red)';
            return (
              <div key={r.instrument} className="flex items-center gap-2 py-[3px] border-b border-white/4">
                <span className="w-3 text-center text-[9px] font-bold shrink-0"
                  style={{ color: r.type === 'C' ? 'var(--nexus-green)' : 'var(--nexus-red)' }}>
                  {r.type}
                </span>
                <span className="w-[68px] shrink-0 text-[9px] font-mono text-slate-500 truncate">
                  {r.expiry}
                </span>
                <span className="w-[58px] shrink-0 text-[9px] font-mono text-slate-300 text-right">
                  {r.strike.toLocaleString()}
                </span>
                <div className="flex-1 h-[8px] rounded-full overflow-hidden bg-white/4 relative">
                  <div
                    className="absolute top-0 h-full rounded-full"
                    style={{
                      width: `${barW}%`,
                      [isInc ? 'left' : 'right']: 0,
                      background: color3,
                      opacity: 0.65,
                    }}
                  />
                </div>
                <span className="w-[52px] shrink-0 text-right text-[10px] font-mono font-bold tnum"
                  style={{ color: color3 }}>
                  {isInc ? '+' : ''}{r.delta.toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// GammaPinWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const GammaPinWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const S = ddata.spot;
  interface PinCandidate {
    strike: number; expiry: string; daysToExp: number;
    callOI: number; putOI: number; totalOI: number;
    distPct: number; gamma: number; pinScore: number;
  }

  const candidates: PinCandidate[] = [];
  for (const exp of ddata.expiries) {
    if (exp.daysToExp > 7 || exp.daysToExp < 0) continue;
    const T = Math.max(exp.daysToExp / 365, 0.001);
    const iv = exp.atmIV / 100;
    const oiMap = new Map<number, { call: number; put: number }>();
    for (const c of exp.calls) {
      const e = oiMap.get(c.strike) ?? { call: 0, put: 0 };
      e.call = c.oi; oiMap.set(c.strike, e);
    }
    for (const p of exp.puts) {
      const e = oiMap.get(p.strike) ?? { call: 0, put: 0 };
      e.put = p.oi; oiMap.set(p.strike, e);
    }
    for (const [strike, { call, put }] of oiMap) {
      const distPct = Math.abs(strike - S) / S * 100;
      if (distPct > 3) continue;
      const totalOI = call + put;
      if (totalOI < 10) continue;
      const gamma = bsGamma(S, strike, T, iv);
      const pinScore = totalOI * gamma * S * S / 100 / (1 + exp.daysToExp);
      candidates.push({ strike, expiry: exp.label, daysToExp: exp.daysToExp, callOI: call, putOI: put, totalOI, distPct, gamma, pinScore });
    }
  }

  candidates.sort((a, b) => b.pinScore - a.pinScore);
  const top = candidates.slice(0, 8);

  if (top.length === 0) return (
    <div className="w-full h-full flex items-center justify-center flex-col gap-1">
      <span className="text-[13px] text-slate-600">✓</span>
      <span className="text-[11px] text-slate-500">7日内无 Gamma 钉牢候选（无近期高OI集中）</span>
    </div>
  );

  const maxScore = top[0].pinScore;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        ≤7日到期 · Spot 3% 范围内 · 高OI集中 → 钉牢候选
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
        {top.map((c, i) => {
          const barW = (c.pinScore / maxScore) * 100;
          const isBelowSpot = c.strike < S;
          const distLabel = `${isBelowSpot ? '▼' : '▲'}${c.distPct.toFixed(2)}%`;
          const distColor = isBelowSpot ? 'var(--nexus-red)' : 'var(--nexus-green)';
          return (
            <div key={`${c.expiry}-${c.strike}`} className="flex items-center gap-2 py-1 border-b border-white/4">
              <span className="text-[9px] text-slate-600 w-3 shrink-0">#{i + 1}</span>
              <span className="text-[10px] font-mono font-bold text-slate-200 w-[72px] shrink-0">
                {c.strike.toLocaleString()}
              </span>
              <span className="text-[9px] font-mono text-slate-500 w-[52px] shrink-0">{c.expiry}</span>
              <span className="text-[9px] font-mono w-[36px] shrink-0" style={{ color: distColor }}>{distLabel}</span>
              <span className="text-[9px] font-mono text-slate-500 w-[28px] shrink-0">{c.daysToExp}d</span>
              <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-white/4">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: 'var(--nexus-accent)', opacity: 0.7 }} />
              </div>
              <span className="text-[9px] font-mono text-slate-500 w-[56px] shrink-0 text-right">
                OI {c.totalOI.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
