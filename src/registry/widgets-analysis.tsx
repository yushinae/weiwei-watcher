import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import { mapPts, poly, smooth, area } from '../lib/svg-utils';
import { normCDF, fitAR1, forecastAR1, bsCall, bsPut } from '../lib/bs-math';
import type { DeribitData, HistoryData } from './types';
import { useDeribitOptions, useDeribitHistory } from './data-hooks';
import { subscribeData, fetchDeribitOptions, fetchDeribitHistory, SKEW_BUFFER, CACHE_TTL, HIST_TTL } from './data-layer';
import {
  GRID, TXT, BRAND, YELLOW, BLUE,
  CoinControlProps, useCoinControl, CoinTabs, LiveBadge, Skeleton,
} from './ui-helpers';
import type { FlowData } from './widgets-market';
import { useFlowData } from './widgets-market';

// ═══════════════════════════════════════════════════════════════════════════════
// VolRegimeWidget
// ═══════════════════════════════════════════════════════════════════════════════

type VolRegime =
  | 'low-vol-complacent'
  | 'vol-expansion'
  | 'high-vol-fear'
  | 'vol-compression'
  | 'mean-revert'
  | 'unknown';

interface RegimeResult {
  regime: VolRegime;
  label: string;
  color: string;
  confidence: number;
  description: string;
  playbook: string[];
}

function classifyRegime(
  data: DeribitData,
  hist: HistoryData | null,
  flow: FlowData | null,
): RegimeResult {
  const ivr   = hist?.ivRankCurrent ?? 50;
  const vrpNow = (hist?.vrp?.length ?? 0) > 0
    ? hist!.vrp[hist!.vrp.length - 1].iv - hist!.vrp[hist!.vrp.length - 1].rv
    : 5;
  const dvolChange = hist?.dvolChange24h ?? 0;
  const exp = data.expiries;
  const slope = exp.length >= 2 ? exp[exp.length - 1].atmIV - exp[0].atmIV : 0;
  const skew30 = exp.length
    ? (exp.reduce((b, e) => Math.abs(e.daysToExp - 30) < Math.abs(b.daysToExp - 30) ? e : b, exp[0])?.rr25 ?? 0)
    : 0;
  const funding = flow?.annFunding ?? 0;

  let scores: Partial<Record<VolRegime, number>> = {};

  scores['low-vol-complacent'] = (
    (ivr < 30 ? 40 : ivr < 45 ? 20 : 0) +
    (vrpNow > 8 ? 35 : vrpNow > 4 ? 20 : 0) +
    (slope > 0 ? 15 : 0) +
    (funding > 20 ? 10 : 0)
  );

  scores['vol-expansion'] = (
    (dvolChange > 2 ? 40 : dvolChange > 0.5 ? 20 : 0) +
    (vrpNow < 2 ? 30 : vrpNow < 5 ? 10 : 0) +
    (skew30 < -3 ? 25 : skew30 < -1 ? 10 : 0) +
    (funding < -5 ? 10 : 0)
  );

  scores['high-vol-fear'] = (
    (ivr > 75 ? 40 : ivr > 60 ? 20 : 0) +
    (slope < -5 ? 35 : slope < -2 ? 15 : 0) +
    (skew30 < -5 ? 20 : skew30 < -2 ? 10 : 0) +
    (vrpNow < 0 ? 10 : 0)
  );

  scores['vol-compression'] = (
    (dvolChange < -1.5 ? 40 : dvolChange < -0.5 ? 20 : 0) +
    (vrpNow > 6 ? 30 : vrpNow > 3 ? 15 : 0) +
    (slope > 3 ? 20 : slope > 0 ? 10 : 0) +
    (ivr > 40 && ivr < 70 ? 10 : 0)
  );

  scores['mean-revert'] = (
    (ivr >= 30 && ivr <= 65 ? 35 : 0) +
    (vrpNow >= 3 && vrpNow <= 9 ? 25 : 0) +
    (Math.abs(slope) < 4 ? 20 : 0) +
    (Math.abs(skew30) < 3 ? 15 : 0) +
    (Math.abs(dvolChange) < 1 ? 10 : 0)
  );

  const best = (Object.entries(scores) as [VolRegime, number][])
    .sort((a, b) => b[1] - a[1])[0];

  const regime = best[0];
  const rawScore = best[1];
  const confidence = Math.min(100, Math.round(rawScore * 1.1));

  const INFO: Record<VolRegime, { label: string; color: string; description: string; playbook: string[] }> = {
    'low-vol-complacent': {
      label: '低波 / 市场自满',
      color: '#25e889',
      description: `IV Rank ${ivr.toFixed(0)}%ile（低），VRP +${vrpNow.toFixed(1)}pp，期限结构正常——市场低估尾部风险。`,
      playbook: ['卖 IV 策略（Iron Condor、Strangle）溢价充足', '注意尾部风险：低波容易逆转为快速扩张', '资金费率偏高时做空 perp 对冲多头 Delta 风险'],
    },
    'vol-expansion': {
      label: '波动率扩张',
      color: '#f87171',
      description: `DVOL 24h +${dvolChange.toFixed(1)}pp，VRP 受压（+${vrpNow.toFixed(1)}pp），Skew ${skew30.toFixed(1)}%——空间正在打开。`,
      playbook: ['避免裸卖 vega；若已有 short vega 应收窄或对冲', '25D Put 或 OTM Put Spread 保护下行', '买入近端 Straddle 参与波动率重定价'],
    },
    'high-vol-fear': {
      label: '高波 / 恐慌区间',
      color: '#ef4444',
      description: `IV Rank ${ivr.toFixed(0)}%ile（极高），期限结构倒挂（${slope.toFixed(1)}pp），Skew 极度负偏——恐慌溢价高峰。`,
      playbook: ['逆向考虑：卖近端 Put（高保护溢价），用远端对冲', 'Ratio Put Spread 可低成本或零成本构建', '等待 IV Rank 回落至 60% 以下再考虑卖方策略'],
    },
    'vol-compression': {
      label: '波动率收缩',
      color: '#4ea1ff',
      description: `DVOL 24h ${dvolChange.toFixed(1)}pp（下行），VRP 扩张至 +${vrpNow.toFixed(1)}pp——意味着卖 IV 窗口可能临近。`,
      playbook: ['日历价差（Calendar Spread）受益于期限溢价', 'Theta 策略窗口打开：短期 Condor 或 Strangle', '监控 DVOL 是否企稳；若反弹应及时止损'],
    },
    'mean-revert': {
      label: '均值回归区间',
      color: '#F59E0B',
      description: `IV Rank ${ivr.toFixed(0)}%ile，VRP +${vrpNow.toFixed(1)}pp，结构平稳——无明显方向性信号。`,
      playbook: ['中性策略：Iron Condor 收取时间价值', '关注 Skew 偏向决定调整 Call/Put 比重', '保持仓位较小，等待更强方向信号'],
    },
    'unknown': {
      label: '信号不足',
      color: 'rgba(255,255,255,0.3)',
      description: '数据采集中，请稍候…',
      playbook: ['等待数据加载'],
    },
  };

  return { regime, confidence, ...INFO[regime] };
}

export const VolRegimeWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin }      = useCoinControl({ coin: coinProp, onCoinChange });
  const { data }               = useDeribitOptions(coin);
  const { data: hist }         = useDeribitHistory(coin);
  const { data: flow }         = useFlowData(coin);
  const { setHeaderRight }     = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (!data) return <Skeleton />;

  const result = classifyRegime(data, hist, flow);

  const GAUGE_R = 36, CX = 48, CY = 48;
  const angle = ((result.confidence / 100) * 180 - 180) * (Math.PI / 180);
  const nx = CX + GAUGE_R * Math.cos(angle);
  const ny = CY + GAUGE_R * Math.sin(angle);

  const ivr   = hist?.ivRankCurrent ?? null;
  const vrpNow = (hist?.vrp?.length ?? 0) > 0
    ? hist!.vrp[hist!.vrp.length - 1].iv - hist!.vrp[hist!.vrp.length - 1].rv
    : null;
  const exp   = data.expiries;
  const slope = exp.length >= 2 ? exp[exp.length - 1].atmIV - exp[0].atmIV : null;
  const skew30 = exp.length
    ? (exp.reduce((b, e) => Math.abs(e.daysToExp - 30) < Math.abs(b.daysToExp - 30) ? e : b, exp[0])?.rr25 ?? null)
    : null;

  const factors = [
    { label: 'IV Rank', val: ivr !== null ? `${ivr.toFixed(0)}%ile` : '—',
      ok: ivr !== null && ivr >= 30 && ivr <= 70 },
    { label: 'VRP', val: vrpNow !== null ? `+${vrpNow.toFixed(1)}pp` : '—',
      ok: vrpNow !== null && vrpNow > 2 },
    { label: '期限结构', val: slope !== null ? `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}pp` : '—',
      ok: slope !== null && slope > -3 },
    { label: '30D Skew', val: skew30 !== null ? `${skew30 >= 0 ? '+' : ''}${skew30.toFixed(2)}%` : '—',
      ok: skew30 !== null && Math.abs(skew30) < 3 },
    { label: '资金费率', val: flow ? `${flow.annFunding >= 0 ? '+' : ''}${flow.annFunding.toFixed(1)}%` : '—',
      ok: flow ? Math.abs(flow.annFunding) < 25 : false },
  ];

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex flex-1 min-h-0 gap-3 px-3 pt-2 pb-2">

        <div className="flex flex-col items-center shrink-0" style={{ width: 100 }}>
          <svg width={96} height={56} viewBox="0 0 96 56">
            <path d={`M ${CX - GAUGE_R} ${CY} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${CX + GAUGE_R} ${CY}`}
              fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
            <path d={`M ${CX - GAUGE_R} ${CY} A ${GAUGE_R} ${GAUGE_R} 0 ${result.confidence > 50 ? 1 : 0} 1 ${nx.toFixed(1)} ${ny.toFixed(1)}`}
              fill="none" stroke={result.color} strokeWidth={4} strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${result.color}88)` }} />
            <circle cx={nx.toFixed(1)} cy={ny.toFixed(1)} r={3.5} fill={result.color} />
            <text x={CX} y={CY + 2} textAnchor="middle" fontSize={11} fontWeight={700} fill={result.color}>
              {result.confidence}%
            </text>
            <text x={CX} y={CY + 13} textAnchor="middle" fontSize={6.5} fill="rgba(255,255,255,0.25)">置信度</text>
          </svg>
          <div className="text-[10px] font-bold text-center leading-tight mt-0.5" style={{ color: result.color }}>
            {result.label}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <p className="text-[10px] text-white/45 leading-relaxed">{result.description}</p>

          <div className="flex gap-1.5 flex-wrap">
            {factors.map(f => (
              <div key={f.label}
                className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 border"
                style={{
                  borderColor: f.ok ? 'rgba(37,232,137,0.2)' : 'rgba(248,113,113,0.2)',
                  background:  f.ok ? 'rgba(37,232,137,0.05)' : 'rgba(248,113,113,0.05)',
                }}>
                <span className="text-[8.5px] text-white/30">{f.label}</span>
                <span className="font-mono text-[9px] font-bold"
                  style={{ color: f.ok ? '#25e889' : '#f87171' }}>{f.val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 flex flex-col gap-1" style={{ width: 240 }}>
          <div className="text-[9px] font-bold text-white/25 uppercase tracking-wider mb-0.5">策略建议</div>
          {result.playbook.map((tip, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold mt-0.5"
                style={{ background: `${result.color}20`, color: result.color }}>
                {i + 1}
              </span>
              <span className="text-[9px] text-white/40 leading-snug">{tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// GreeksScenarioWidget
// ═══════════════════════════════════════════════════════════════════════════════

const SCEN_SPOT = [-15, -10, -7, -5, -3, -1, 0, 1, 3, 5, 7, 10, 15];
const SCEN_IV   = [-20, -10, -5, 0, 5, 10, 20];

export const GreeksScenarioWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ddata, setDdata] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expIdx, setExpIdx] = useState(0);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (alive) { setDdata(d); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (loading || !ddata) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>
  );

  const expiries = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0).slice(0, 6);
  if (!expiries.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>
  );

  const safeIdx = Math.min(expIdx, expiries.length - 1);
  const exp2 = expiries[safeIdx];
  const S = ddata.spot;
  const allStrikes = [...exp2.calls.map(c => c.strike), ...exp2.puts.map(p => p.strike)];
  const K = allStrikes.reduce((best, s) => Math.abs(s - S) < Math.abs(best - S) ? s : best, allStrikes[0] ?? S);
  const T = Math.max(exp2.daysToExp / 365, 0.0027);
  const iv0 = exp2.atmIV / 100;

  const price0 = bsCall(S, K, T, iv0) + bsPut(S, K, T, iv0);

  const matrix: number[][] = SCEN_SPOT.map(sp => {
    const newS = S * (1 + sp / 100);
    return SCEN_IV.map(ds => {
      const newIV = Math.max(0.01, iv0 + ds / 100);
      const newPrice = bsCall(newS, K, T, newIV) + bsPut(newS, K, T, newIV);
      return price0 > 0 ? (newPrice - price0) / price0 * 100 : 0;
    });
  });

  const maxAbs = Math.max(...matrix.flat().map(Math.abs), 1);
  const cellColor = (v: number) => {
    const t = Math.min(Math.abs(v) / maxAbs, 1);
    if (v > 0.5) return `rgba(37,167,80,${0.12 + t * 0.6})`;
    if (v < -0.5) return `rgba(244,63,94,${0.12 + t * 0.6})`;
    return 'rgba(255,255,255,0.03)';
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 shrink-0 flex-wrap">
        {expiries.map((e, i) => (
          <button
            key={e.label}
            onClick={() => setExpIdx(i)}
            className="px-2 py-0.5 rounded text-[10px] font-mono transition-colors"
            style={{
              background: i === safeIdx ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
              color: i === safeIdx ? 'var(--nexus-accent)' : '#64748b',
              border: `1px solid ${i === safeIdx ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
            }}>
            {e.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-slate-600 font-mono">
          K={K.toLocaleString()} · IV={(iv0 * 100).toFixed(1)}% · {exp2.daysToExp}d
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 56 }} />
            {SCEN_IV.map(ds => <col key={ds} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="text-left text-[9px] text-slate-600 pb-1 pr-2 font-normal">Spot↓/IV→</th>
              {SCEN_IV.map(ds => (
                <th key={ds} className="text-center text-[9px] font-mono pb-1 px-0.5"
                  style={{ color: ds < 0 ? 'var(--nexus-red)' : ds > 0 ? 'var(--nexus-green)' : '#94a3b8' }}>
                  {ds > 0 ? '+' : ''}{ds}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCEN_SPOT.map((sp, ri) => (
              <tr key={sp}>
                <td
                  className="pr-2 py-[3px] text-[9px] font-mono text-right"
                  style={{
                    color: sp < 0 ? 'var(--nexus-red)' : sp > 0 ? 'var(--nexus-green)' : '#94a3b8',
                    fontWeight: sp === 0 ? 700 : 400,
                    background: sp === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  }}>
                  {sp > 0 ? '+' : ''}{sp}%
                </td>
                {SCEN_IV.map((_, ci) => {
                  const v = matrix[ri][ci];
                  return (
                    <td
                      key={ci}
                      className="text-center px-0.5 py-[3px]"
                      title={`Spot ${sp > 0 ? '+' : ''}${sp}%, IV ${SCEN_IV[ci] > 0 ? '+' : ''}${SCEN_IV[ci]}% → ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                      style={{
                        background: cellColor(v),
                        color: Math.abs(v) > maxAbs * 0.25 ? '#fff' : '#64748b',
                        borderRadius: 3,
                      }}>
                      {v >= 0 ? '+' : ''}{v.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// PriceTargetProbWidget
// ═══════════════════════════════════════════════════════════════════════════════

const PROB_STRIKE_OFFSETS = [-0.20, -0.15, -0.10, -0.07, -0.04, 0, +0.04, +0.07, +0.10, +0.15, +0.20];

export const PriceTargetProbWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!data || !data.expiries.length) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const exps = data.expiries.slice(0, 6);

  const d2 = (S: number, K: number, T: number, iv: number) => {
    if (T <= 0 || iv <= 0) return S >= K ? 1 : 0;
    const sigma = iv / 100;
    return (Math.log(S / K) - 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  };

  const strikes = PROB_STRIKE_OFFSETS.map(o => Math.round(spot * (1 + o) / (spot > 10_000 ? 1_000 : 100)) * (spot > 10_000 ? 1_000 : 100));
  const probGrid: number[][] = strikes.map(k =>
    exps.map(e => {
      const iv = e.atmIV;
      return normCDF(d2(spot, k, e.T, iv)) * 100;
    })
  );

  const probColor = (p: number) => {
    if (p >= 80) return `rgba(37,232,137,${0.15 + (p - 80) / 20 * 0.5})`;
    if (p >= 50) return `rgba(245,158,11,${0.10 + (p - 50) / 30 * 0.35})`;
    return `rgba(248,113,113,${0.10 + (50 - p) / 50 * 0.55})`;
  };
  const probTextColor = (p: number) => {
    if (p >= 70) return '#25e889';
    if (p >= 45) return '#F59E0B';
    return '#f87171';
  };

  const fmtK = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
  const CELL_H = 28, CELL_W = 74, LABEL_W = 78;
  const totalW = LABEL_W + exps.length * CELL_W;
  const totalH = (strikes.length + 1) * CELL_H;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1.5 pb-1 text-[9px] text-white/25 shrink-0">
        P(收盘 &gt; 行权价) = N(d₂)·100%，基于当前 ATM IV · 风险中性概率，非真实概率
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <svg viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} style={{ display: 'block' }}>
          {exps.map((e, j) => (
            <text key={e.label}
              x={LABEL_W + j * CELL_W + CELL_W / 2} y={CELL_H / 2 + 4}
              textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)" fontWeight={600}>
              {e.label}
            </text>
          ))}

          {strikes.map((k, i) => {
            const y = (i + 1) * CELL_H;
            const isAtm = Math.abs(k - spot) / spot < 0.025;
            const pctFromSpot = ((k - spot) / spot) * 100;
            return (
              <g key={k}>
                <text x={LABEL_W - 6} y={y + CELL_H / 2 + 4}
                  textAnchor="end" fontSize={9}
                  fill={isAtm ? '#F59E0B' : 'rgba(255,255,255,0.35)'}
                  fontWeight={isAtm ? 700 : 400}>
                  ${fmtK(k)}
                </text>
                <text x={LABEL_W - 6} y={y + CELL_H / 2 + 13}
                  textAnchor="end" fontSize={7}
                  fill={isAtm ? '#F59E0B88' : 'rgba(255,255,255,0.15)'}>
                  {pctFromSpot >= 0 ? '+' : ''}{pctFromSpot.toFixed(0)}%
                </text>
                {exps.map((_, j) => {
                  const p = probGrid[i][j];
                  return (
                    <g key={j}>
                      <rect x={LABEL_W + j * CELL_W + 1} y={y + 1}
                        width={CELL_W - 2} height={CELL_H - 2}
                        fill={probColor(p)} rx={3} />
                      <text x={LABEL_W + j * CELL_W + CELL_W / 2} y={y + CELL_H / 2 + 3.5}
                        textAnchor="middle" fontSize={9} fontWeight={600}
                        fill={probTextColor(p)}>
                        {p.toFixed(0)}%
                      </text>
                    </g>
                  );
                })}
                {isAtm && (
                  <rect x={0} y={y + 1} width={LABEL_W - 8} height={CELL_H - 2}
                    fill="rgba(245,158,11,0.06)" rx={2} />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// EWMAForecastWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const EWMAForecastWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin }   = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: hist }      = useDeribitHistory(coin);
  const { data: optData }   = useDeribitOptions(coin);
  const { setHeaderRight }  = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {hist && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, hist]);

  if (!hist || !optData) return <Skeleton />;

  const dvol    = hist.dvolSeries;
  const current = dvol[dvol.length - 1];
  const { alpha, beta, mu } = fitAR1(dvol);

  const HORIZONS = [7, 14, 30, 60] as const;
  const forecasts = HORIZONS.map(h => ({
    horizon: h,
    forecast: forecastAR1(current, alpha, beta, h),
    marketIV: optData.expiries.length
      ? optData.expiries.reduce((b, e) =>
          Math.abs(e.daysToExp - h) < Math.abs(b.daysToExp - h) ? e : b,
          optData.expiries[0]).atmIV
      : current,
  }));

  const fmtColor = (f: number, m: number) => {
    const diff = f - m;
    if (diff < -3) return '#25e889';
    if (diff > 3)  return '#f87171';
    return '#F59E0B';
  };

  const chartLen = 30;
  const histSlice = dvol.slice(-chartLen);
  const forecastPath = Array.from({ length: 61 }, (_, i) =>
    forecastAR1(current, alpha, beta, i)
  );

  const allVals = [...histSlice, ...forecastPath, mu];
  const lo = Math.floor(Math.min(...allVals) * 0.94 / 5) * 5;
  const hi = Math.ceil(Math.max(...allVals) * 1.06 / 5) * 5;
  const W = 400, H = 140, PX = 28, PY = 12;

  const histPts  = mapPts(histSlice,   W * 0.4, H, lo, hi, PX, PY);
  const fcstPts  = mapPts(forecastPath, W * 0.6, H, lo, hi, 0, PY);
  const xJoin = PX + (W - PX - PX) * 0.4;
  const fcstShifted: [number, number][] = fcstPts.map(([x, y]) => [xJoin + x, y]);

  const yMu = (H - PY) - ((mu - lo) / (hi - lo)) * (H - 2 * PY);
  const yCurr = histPts[histPts.length - 1]?.[1] ?? 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: '当前 DVOL', val: `${current.toFixed(1)}%`, color: BRAND },
          { label: '长期均值 μ', val: `${mu.toFixed(1)}%`, color: 'rgba(255,255,255,0.5)' },
          { label: '均值回归速度 β', val: beta.toFixed(3), color: BLUE },
          { label: '偏差', val: `${(current - mu >= 0 ? '+' : '')}${(current - mu).toFixed(1)}pp`, color: current > mu ? '#f87171' : '#25e889' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1">
            <div className="text-[9px] text-white/20 uppercase tracking-[0.06em] mb-0.5 truncate">{s.label}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 gap-3 px-3 pb-2">
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
            <line x1={PX} y1={yMu} x2={W - 4} y2={yMu}
              stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} strokeDasharray="5,4" />
            <text x={W - 4} y={yMu - 2} textAnchor="end" fontSize={7} fill="rgba(255,255,255,0.2)">μ={mu.toFixed(0)}</text>

            <path d={area(histPts, H, PY)} fill="url(#wg-green)" />
            <polyline points={poly(histPts)} fill="none" stroke={BRAND} strokeWidth={1.4} opacity={0.85} />

            <path d={smooth(fcstShifted)} fill="none"
              stroke="#a78bfa" strokeWidth={1.2} strokeDasharray="4,3" opacity={0.8} />

            {fcstShifted.length > 0 && (() => {
              const sigma = hist.dvolSeries.reduce((s, v, i, arr) => {
                if (i === 0) return 0;
                return s + Math.pow(v - arr[i-1], 2);
              }, 0);
              const dailyStd = Math.sqrt(sigma / (hist.dvolSeries.length - 1));
              const bandTop: [number,number][] = fcstShifted.map(([x,y], i) => {
                const band = dailyStd * Math.sqrt(i + 1) * 0.8;
                const dy = band / (hi - lo) * (H - 2 * PY);
                return [x, y - dy] as [number,number];
              });
              const bandBot: [number,number][] = fcstShifted.map(([x,y], i) => {
                const band = dailyStd * Math.sqrt(i + 1) * 0.8;
                const dy = band / (hi - lo) * (H - 2 * PY);
                return [x, y + dy] as [number,number];
              });
              return (
                <path
                  d={`${smooth(bandTop)} L ${bandBot.slice().reverse().map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} Z`}
                  fill="rgba(167,139,250,0.08)"
                />
              );
            })()}

            <circle cx={xJoin} cy={yCurr} r={2.5} fill="#a78bfa" />

            {[lo, Math.round((lo+hi)/2), hi].map(v => {
              const y = (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);
              return <text key={v} x={PX - 3} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>;
            })}

            <text x={PX} y={H - 1} fontSize={7} fill={TXT} textAnchor="middle">-30D</text>
            <text x={xJoin} y={H - 1} fontSize={7} fill={TXT} textAnchor="middle">今</text>
            <text x={W - 8} y={H - 1} fontSize={7} fill={TXT} textAnchor="middle">+60D</text>
          </svg>
        </div>

        <div className="shrink-0 flex flex-col gap-1.5" style={{ width: 170 }}>
          <div className="text-[9px] font-bold text-white/20 uppercase tracking-wider mb-0.5">预测 vs 市场 IV</div>
          {forecasts.map(f => {
            const diff = f.forecast - f.marketIV;
            const col = fmtColor(f.forecast, f.marketIV);
            const signal = diff < -3 ? '↓ IV 偏贵' : diff > 3 ? '↑ IV 偏便宜' : '≈ 合理';
            return (
              <div key={f.horizon}
                className="rounded-[7px] border px-2.5 py-1.5"
                style={{ borderColor: `${col}25`, background: `${col}08` }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] text-white/30">+{f.horizon}D 预测</span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: col }}>{signal}</span>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <div className="text-[8px] text-white/20 mb-0">AR(1)</div>
                    <div className="font-mono text-[11px] font-bold" style={{ color: col }}>{f.forecast.toFixed(1)}%</div>
                  </div>
                  <div className="text-white/20 text-[8px] mb-0.5">vs</div>
                  <div>
                    <div className="text-[8px] text-white/20 mb-0">市场 IV</div>
                    <div className="font-mono text-[11px] text-white/50">{f.marketIV.toFixed(1)}%</div>
                  </div>
                  <div className="ml-auto">
                    <div className="font-mono text-[10px] font-bold" style={{ color: col }}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// TenorIVHeatmapWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const TenorIVHeatmapWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
      <div className="text-[9px]">每 30 秒一个快照</div>
    </div>
  );

  const tenorSet = new Set<string>();
  buf.forEach(s => s.tenors.forEach(t => tenorSet.add(t.label)));
  const tenors = [...tenorSet].sort((a, b) => parseInt(a) - parseInt(b)).slice(0, 6);

  const matrix2: (number | null)[][] = tenors.map(label =>
    buf.map(snap => snap.tenors.find(t => t.label === label)?.atm ?? null)
  );

  const allVals2 = matrix2.flat().filter((v): v is number => v !== null);
  if (!allVals2.length) return <Skeleton />;
  const gMin = Math.min(...allVals2);
  const gMax = Math.max(...allVals2);
  const gRange = gMax - gMin || 1;

  const cellColor2 = (v: number | null) => {
    if (v === null) return 'rgba(255,255,255,0.03)';
    const t = (v - gMin) / gRange;
    if (t < 0.5) {
      const s = t * 2;
      const r = Math.round(78  + (37  - 78)  * s);
      const g = Math.round(161 + (232 - 161) * s);
      const b = Math.round(255 + (137 - 255) * s);
      return `rgba(${r},${g},${b},${0.25 + 0.5 * t})`;
    } else {
      const s = (t - 0.5) * 2;
      const r = Math.round(37  + (248 - 37)  * s);
      const g = Math.round(232 + (113 - 232) * s);
      const b = Math.round(137 + (113 - 137) * s);
      return `rgba(${r},${g},${b},${0.5 + 0.4 * (t - 0.5)})`;
    }
  };

  const CELL_H2 = 30, LABEL_W2 = 36;
  const MAX_COLS = 60;
  const step = Math.max(1, Math.ceil(buf.length / MAX_COLS));
  const colIndices = Array.from({ length: Math.ceil(buf.length / step) }, (_, i) => i * step);
  const nCols = colIndices.length;

  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center px-3 pt-1.5 pb-1 shrink-0">
        <span className="text-[9px] text-white/20">
          {fmtTime(buf[0].ts)} → {fmtTime(buf[buf.length - 1].ts)} · {buf.length} 点 · 颜色 = ATM IV（蓝低→橙高）
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-16 h-2 rounded-full" style={{
            background: 'linear-gradient(to right, rgba(78,161,255,0.6), rgba(37,232,137,0.6), rgba(248,113,113,0.8))'
          }} />
          <span className="text-[8px] text-white/20">{gMin.toFixed(0)}% → {gMax.toFixed(0)}%</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <div style={{ display: 'grid', gridTemplateColumns: `${LABEL_W2}px repeat(${nCols}, 1fr)`, minWidth: LABEL_W2 + nCols * 8 }}>
          <div style={{ height: 18 }} />
          {colIndices.map((ci, j) => {
            const isFirst = j === 0;
            const isLast  = j === colIndices.length - 1;
            const isMid   = Math.abs(j - Math.floor(colIndices.length / 2)) <= 1;
            return (
              <div key={ci} style={{ height: 18, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                {(isFirst || isLast || isMid) && (
                  <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap' }}>
                    {fmtTime(buf[Math.min(ci, buf.length - 1)].ts)}
                  </span>
                )}
              </div>
            );
          })}

          {tenors.map((label, ri) => (
            <React.Fragment key={`lbl-${label}`}>
              <div key={label} style={{ height: CELL_H2, display: 'flex', alignItems: 'center', paddingRight: 4 }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
                  {label}
                </span>
              </div>
              {colIndices.map((ci, j) => {
                const val = matrix2[ri][Math.min(ci, buf.length - 1)];
                return (
                  <div key={`${ri}-${j}`}
                    title={val !== null ? `${label}: ${val.toFixed(1)}%` : '—'}
                    style={{
                      height: CELL_H2,
                      background: cellColor2(val),
                      margin: '1px',
                      borderRadius: 2,
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// BTCETHSpreadWidget
// ═══════════════════════════════════════════════════════════════════════════════

function useDualHistory() {
  const [btc, setBtc] = useState<HistoryData | null>(null);
  const [eth, setEth] = useState<HistoryData | null>(null);

  useEffect(() => {
    let active = true;
    const u1 = subscribeData<HistoryData>('history-BTC', () => fetchDeribitHistory('BTC'), HIST_TTL, d => { if (active) setBtc(d); });
    const u2 = subscribeData<HistoryData>('history-ETH', () => fetchDeribitHistory('ETH'), HIST_TTL, d => { if (active) setEth(d); });
    return () => { active = false; u1(); u2(); };
  }, []);

  return { btc, eth };
}

export const BTCETHSpreadWidget = React.memo(() => {
  const { btc, eth } = useDualHistory();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(btc && eth
      ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>
      : null
    );
    return () => setHeaderRight(null);
  }, [setHeaderRight, btc, eth]);

  if (!btc || !eth) return <Skeleton />;

  const btcSeries = btc.dvolSeries;
  const ethSeries = eth.dvolSeries;
  const len = Math.min(btcSeries.length, ethSeries.length);
  if (len < 2) return <Skeleton />;

  const btcA = btcSeries.slice(-len);
  const ethA = ethSeries.slice(-len);
  const spread = btcA.map((b, i) => b - ethA[i]);
  const currentSpread = spread[spread.length - 1];
  const currentBTC    = btcA[btcA.length - 1];
  const currentETH    = ethA[ethA.length - 1];

  const sorted = [...spread].sort((a, b) => a - b);
  const pctile = spread.length > 1
    ? (sorted.filter(v => v <= currentSpread).length / sorted.length) * 100
    : 50;

  const spreadColor = currentSpread > 5 ? '#F59E0B' : currentSpread < -5 ? '#a78bfa' : 'rgba(255,255,255,0.5)';
  const spreadLabel = currentSpread > 10 ? 'BTC vol 大幅溢价'
    : currentSpread > 4  ? 'BTC vol 偏贵'
    : currentSpread < -10 ? 'ETH vol 大幅溢价'
    : currentSpread < -4  ? 'ETH vol 偏贵'
    : '基本持平';

  const W = 540, H5 = 130, PX = 8, PY = 14;
  const spreadLo = Math.min(...spread) - 1;
  const spreadHi = Math.max(...spread) + 1;
  const spreadPts = mapPts(spread, W, H5, spreadLo, spreadHi, PX, PY);
  const btcPts    = mapPts(btcA,   W, H5, Math.min(...btcA, ...ethA) - 2, Math.max(...btcA, ...ethA) + 2, PX, PY);
  const ethPts    = mapPts(ethA,   W, H5, Math.min(...btcA, ...ethA) - 2, Math.max(...btcA, ...ethA) + 2, PX, PY);

  const yZero = (H5 - PY) - ((0 - spreadLo) / (spreadHi - spreadLo)) * (H5 - 2 * PY);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: 'BTC DVOL', val: `${currentBTC.toFixed(1)}%`, color: '#F59E0B' },
          { label: 'ETH DVOL', val: `${currentETH.toFixed(1)}%`, color: '#4ea1ff' },
          { label: 'Spread (BTC−ETH)', val: `${currentSpread >= 0 ? '+' : ''}${currentSpread.toFixed(1)}pp`, color: spreadColor },
          { label: '价差百分位', val: `${pctile.toFixed(0)}%ile`, color: spreadColor },
          { label: '解读', val: spreadLabel, color: spreadColor },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5 min-w-0">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5 truncate">{s.label}</div>
            <div className="font-mono text-[11px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 gap-2 px-3 pb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[8.5px] text-white/20 mb-0.5 uppercase tracking-wider">DVOL 历史（90D）</div>
          <svg viewBox={`0 0 ${W} ${H5}`} width="100%" height="100%" preserveAspectRatio="none">
            <path d={area(ethPts, H5, PY)} fill="url(#wg-blue)" />
            <polyline points={poly(ethPts)} fill="none" stroke="#4ea1ff" strokeWidth={1.2} opacity={0.7} />
            <path d={area(btcPts, H5, PY)} fill="url(#wg-yellow)" />
            <polyline points={poly(btcPts)} fill="none" stroke="#F59E0B" strokeWidth={1.4} opacity={0.85} />
            <line x1={PX} y1={8} x2={PX + 12} y2={8} stroke="#F59E0B" strokeWidth={1.4} />
            <text x={PX + 15} y={11} fontSize={7} fill="rgba(255,255,255,0.3)">BTC</text>
            <line x1={PX + 36} y1={8} x2={PX + 48} y2={8} stroke="#4ea1ff" strokeWidth={1.2} />
            <text x={PX + 51} y={11} fontSize={7} fill="rgba(255,255,255,0.3)">ETH</text>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[8.5px] text-white/20 mb-0.5 uppercase tracking-wider">价差（BTC − ETH，pp）</div>
          <svg viewBox={`0 0 ${W} ${H5}`} width="100%" height="100%" preserveAspectRatio="none">
            {yZero > PY && yZero < H5 - PY && (
              <line x1={PX} y1={yZero} x2={W - PX} y2={yZero}
                stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} strokeDasharray="4,3" />
            )}
            <path d={area(spreadPts, H5, PY)} fill={`${spreadColor}12`} />
            <polyline points={poly(spreadPts)} fill="none" stroke={spreadColor} strokeWidth={1.5} opacity={0.9} />
            <text x={W - PX} y={PY} textAnchor="end" fontSize={7} fill="rgba(255,255,255,0.2)">
              {pctile.toFixed(0)}%ile
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// CorrelationWidget
// ═══════════════════════════════════════════════════════════════════════════════

const CORR_HIST_CACHE = new Map<string, { prices: number[]; fetchedAt: number }>();
const CORR_HIST_TTL = 10 * 60 * 1000;

async function fetchCorrPrices(coin: Coin): Promise<number[]> {
  const key = coin;
  const hit = CORR_HIST_CACHE.get(key);
  if (hit && Date.now() - hit.fetchedAt < CORR_HIST_TTL) return hit.prices;

  const idx = coin === 'BTC' ? 'btc_usd' : 'eth_usd';
  const endMs  = Date.now();
  const startMs = endMs - 90 * 86400 * 1000;
  const res = await fetch(
    `https://www.deribit.com/api/v2/public/get_index_price_history?index_name=${idx}&start_timestamp=${startMs}&end_timestamp=${endMs}&resolution=1D`
  ).then(r => r.json());

  const raw: any[] = res.result?.data ?? [];
  const prices = raw.map((d: any) => d[4] as number);
  CORR_HIST_CACHE.set(key, { prices, fetchedAt: Date.now() });
  return prices;
}

function dailyReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  return r;
}

function rollingCorr(x: number[], y: number[], win: number): number[] {
  const n = Math.min(x.length, y.length);
  return Array.from({ length: n }, (_, i) => {
    if (i < win - 1) return NaN;
    const xs = x.slice(i - win + 1, i + 1);
    const ys = y.slice(i - win + 1, i + 1);
    const mx = xs.reduce((a, b) => a + b, 0) / win;
    const my = ys.reduce((a, b) => a + b, 0) / win;
    let cov = 0, vx = 0, vy = 0;
    for (let j = 0; j < win; j++) {
      const dx = xs[j] - mx; const dy = ys[j] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    const d = Math.sqrt(vx * vy);
    return d > 0 ? cov / d : 0;
  });
}

export const CorrelationWidget = React.memo(() => {
  const [corrSeries, setCorrSeries] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [btcP, ethP] = await Promise.all([fetchCorrPrices('BTC'), fetchCorrPrices('ETH')]);
        const rBTC = dailyReturns(btcP);
        const rETH = dailyReturns(ethP);
        const corr = rollingCorr(rBTC, rETH, 30).filter(v => !isNaN(v));
        if (alive) { setCorrSeries(corr); setCurrent(corr[corr.length - 1] ?? null); setLoading(false); }
      } catch { if (alive) setLoading(false); }
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const W = 800; const H6 = 100;
  const lo = -1; const hi = 1;
  const zero = H6 - ((0 - lo) / (hi - lo)) * H6;
  const pts = mapPts(corrSeries, W, H6, lo, hi);
  const corrColor = (v: number) => v > 0.7 ? 'var(--nexus-accent)' : v > 0.4 ? '#f59e0b' : v > 0 ? '#64748b' : 'var(--nexus-red)';
  const cur = current ?? 0;
  const regime = cur > 0.8 ? '高度同步' : cur > 0.6 ? '较强同步' : cur > 0.4 ? '中等相关' : cur > 0.2 ? '弱相关' : '背离走势';

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[10px] text-slate-500">BTC / ETH 已实现相关系数（30日滚动）</span>
        <span className="text-[18px] font-mono font-bold tnum ml-auto" style={{ color: corrColor(cur) }}>
          {cur.toFixed(3)}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${corrColor(cur)}20`, color: corrColor(cur) }}>
          {regime}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H6}`} preserveAspectRatio="none" width="100%" height="100%">
          {[0.8, 0.6, 0, -0.6].map(v => {
            const y = H6 - ((v - lo) / (hi - lo)) * H6;
            return <line key={v} x1="0" y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray={v === 0 ? '4,4' : '2,6'} />;
          })}
          <path d={area(pts, H6)} fill={`${corrColor(cur)}18`} />
          <path d={smooth(pts)} fill="none" stroke={corrColor(cur)} strokeWidth="1.8" />
          {pts.length > 0 && (
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={corrColor(cur)} />
          )}
        </svg>
      </div>
      <div className="flex items-center justify-between mt-1 shrink-0">
        <span className="text-[9px] text-slate-700">← 90天前</span>
        <span className="text-[9px] text-slate-700">今日 →</span>
      </div>
    </div>
  );
)};
// ═══════════════════════════════════════════════════════════════════════════════
// IVCheapnessWidget
// ═══════════════════════════════════════════════════════════════════════════════

const CONE_TENORS2 = [7, 14, 30, 60, 90, 180];

export const IVCheapnessWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [opt, setOpt]   = useState<DeribitData | null>(null);
  const [hist2, setHist2] = useState<HistoryData | null>(null);
  const [loading2, setLoading2] = useState(true);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    let gotOpt = false;
    let gotHist = false;
    setLoading2(true);
    const u1 = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (!alive) return; setOpt(d); gotOpt = true; if (gotHist) setLoading2(false); },
    );
    const u2 = subscribeData<HistoryData>(
      `history-${coin}`,
      () => fetchDeribitHistory(coin),
      HIST_TTL,
      d => { if (!alive) return; setHist2(d); gotHist = true; if (gotOpt) setLoading2(false); },
    );
    return () => { alive = false; u1(); u2(); };
  }, [coin]);

  if (loading2 || !opt || !hist2) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>
  );

  const cone = hist2.volCone;
  const rvByTenor = hist2.rvByTenor;

  function interpIV(targetDays: number): number {
    const sorted = [...opt!.expiries].filter(e => e.daysToExp > 0 && e.atmIV > 0)
      .sort((a, b) => a.daysToExp - b.daysToExp);
    if (!sorted.length) return 0;
    if (targetDays <= sorted[0].daysToExp)  return sorted[0].atmIV;
    if (targetDays >= sorted[sorted.length - 1].daysToExp) return sorted[sorted.length - 1].atmIV;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]; const b = sorted[i + 1];
      if (targetDays >= a.daysToExp && targetDays <= b.daysToExp) {
        const t = (targetDays - a.daysToExp) / (b.daysToExp - a.daysToExp);
        return a.atmIV + t * (b.atmIV - a.atmIV);
      }
    }
    return 0;
  }

  interface RowData {
    tenor: number; label: string;
    iv: number; rv: number; vrp: number;
    p25: number; p50: number; p75: number;
    ivPctile: number;
    verdict: 'cheap' | 'fair' | 'expensive' | 'very-cheap' | 'very-expensive';
  }

  const rows = CONE_TENORS2.map((t, i) => {
    const iv  = interpIV(t);
    const rv  = rvByTenor[i] ?? 0;
    const vrp = iv - rv;
    const p25 = cone.p25[i] ?? 0;
    const p50 = cone.p50[i] ?? 0;
    const p75 = cone.p75[i] ?? 0;
    const p10 = cone.p10[i] ?? 0;
    const p90 = cone.p90[i] ?? 0;
    const range = p90 - p10 || 1;
    const ivPctile = Math.min(100, Math.max(0, (iv - p10) / range * 100));
    const verdict: RowData['verdict'] =
      iv < p10  ? 'very-cheap'    :
      iv < p25  ? 'cheap'         :
      iv < p75  ? 'fair'          :
      iv < p90  ? 'expensive'     : 'very-expensive';
    return { tenor: t, label: `${t}D`, iv, rv, vrp, p25, p50, p75, ivPctile, verdict };
  }).filter(r => r.iv > 0);

  const verdictStyle = (v: RowData['verdict']) => ({
    'very-cheap':     { bg: 'rgba(37,167,80,0.25)',   text: '#4ade80', label: '极便宜' },
    'cheap':          { bg: 'rgba(37,167,80,0.12)',   text: '#86efac', label: '便宜'   },
    'fair':           { bg: 'rgba(255,255,255,0.04)', text: '#94a3b8', label: '合理'   },
    'expensive':      { bg: 'rgba(244,63,94,0.12)',   text: '#fca5a5', label: '偏贵'   },
    'very-expensive': { bg: 'rgba(244,63,94,0.25)',   text: '#f43f5e', label: '极贵'   },
  }[v]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        当前 IV 对比历史 RV 分位锥 — 颜色=便宜/贵评级，VRP=溢价
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal w-[36px]">期限</th>
              <th className="text-right pb-1.5 font-normal">当前IV</th>
              <th className="text-right pb-1.5 font-normal">当前RV</th>
              <th className="text-right pb-1.5 font-normal">VRP</th>
              <th className="pb-1.5 font-normal text-center">IV在锥中位置</th>
              <th className="text-center pb-1.5 font-normal">评级</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const vs = verdictStyle(r.verdict);
              const vrpColor = r.vrp > 3 ? 'var(--nexus-red)' : r.vrp < -3 ? 'var(--nexus-green)' : '#94a3b8';
              return (
                <tr key={r.tenor} className="border-t border-white/4" style={{ background: vs.bg }}>
                  <td className="py-1.5 text-slate-400 font-bold">{r.label}</td>
                  <td className="py-1.5 text-right text-slate-200 font-bold">{r.iv.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-slate-400">{r.rv.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: vrpColor }}>
                    {r.vrp >= 0 ? '+' : ''}{r.vrp.toFixed(1)}vp
                  </td>
                  <td className="py-1.5 px-3">
                    <div className="relative h-[8px] rounded-full bg-white/6 overflow-hidden">
                      <div className="absolute top-0 h-full rounded-full bg-white/10"
                        style={{ left: `${(r.p25 / (r.p75 + 5)) * 100}%`, width: `${((r.p75 - r.p25) / (r.p75 + 5)) * 100}%` }} />
                      <div className="absolute top-0.5 w-[3px] h-[5px] rounded-full"
                        style={{ left: `${r.ivPctile}%`, background: vs.text, transform: 'translateX(-50%)' }} />
                    </div>
                  </td>
                  <td className="py-1.5 text-center">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: vs.text, background: vs.bg }}>
                      {vs.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
)};