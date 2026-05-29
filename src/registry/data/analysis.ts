import type { DeribitData, ExpiryGroup, HistoryData } from './deribit';
import type { FlowData } from './flow';
import { fetchDeribitOptions, fetchDeribitHistory } from './deribit';
import { fetchFlowData } from './flow';
import type { Coin } from '../../features/monitor/types';

// ═══════════════════════════════════════════════════════════════════════════════
// Max Pain
// ═══════════════════════════════════════════════════════════════════════════════

export function computeMaxPain(
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

export function maxPain(exp: ExpiryGroup, spot: number): number {
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
// Fear & Greed zones
// ═══════════════════════════════════════════════════════════════════════════════

export const FG_ZONES = [
  { min: 0,  max: 25,  label: '极度恐慌', color: '#ef4444' },
  { min: 25, max: 45,  label: '恐慌',     color: '#f97316' },
  { min: 45, max: 55,  label: '中性',     color: '#FEBC2E' },
  { min: 55, max: 75,  label: '贪婪',     color: '#84cc16' },
  { min: 75, max: 100, label: '极度贪婪', color: '#28C840' },
];

export function fgColor(v: number) {
  return FG_ZONES.find(z => v >= z.min && v <= z.max)?.color ?? '#FEBC2E';
}

// ═══════════════════════════════════════════════════════════════════════════════
// IV Signals
// ═══════════════════════════════════════════════════════════════════════════════

export type SignalSeverity = 'bullish' | 'bearish' | 'warning' | 'neutral';

export interface IVSignal {
  id: string;
  label: string;
  value: string;
  desc: string;
  severity: SignalSeverity;
}

export function severityColor(s: SignalSeverity): string {
  if (s === 'bullish')  return '#25e889';
  if (s === 'bearish')  return '#FF5F57';
  if (s === 'warning')  return '#FEBC2E';
  return 'rgba(255,255,255,0.35)';
}

export function severityBg(s: SignalSeverity): string {
  if (s === 'bullish')  return 'rgba(37,232,137,0.08)';
  if (s === 'bearish')  return 'rgba(248,113,113,0.08)';
  if (s === 'warning')  return 'rgba(245,158,11,0.08)';
  return 'rgba(255,255,255,0.03)';
}

export function severityBorder(s: SignalSeverity): string {
  if (s === 'bullish')  return 'rgba(37,232,137,0.18)';
  if (s === 'bearish')  return 'rgba(248,113,113,0.18)';
  if (s === 'warning')  return 'rgba(245,158,11,0.18)';
  return 'rgba(255,255,255,0.07)';
}

export function generateSignals(
  data: DeribitData,
  histData: HistoryData | null,
  flowData: FlowData | null,
): IVSignal[] {
  const signals: IVSignal[] = [];

  const ivr = histData?.ivRankCurrent ?? null;
  if (ivr !== null) {
    signals.push({
      id: 'ivrank',
      label: 'IV Rank',
      value: `${ivr.toFixed(0)}%`,
      desc: ivr >= 80 ? '极端高位 — 卖方溢价，考虑卖 IV'
          : ivr >= 60 ? '偏高 — IV 较贵，中性策略占优'
          : ivr <= 20 ? '极端低位 — IV 便宜，考虑买 IV'
          : ivr <= 40 ? '偏低 — IV 较便宜，长 vega 策略有优势'
          : '中性区间',
      severity: ivr >= 75 ? 'bearish' : ivr <= 25 ? 'bullish' : ivr >= 60 ? 'warning' : 'neutral',
    });
  }

  const pcr = data.pcr;
  signals.push({
    id: 'pcr',
    label: 'PCR（OI）',
    value: pcr.toFixed(2),
    desc: pcr >= 1.2 ? '看跌 OI 严重堆积 — 市场偏悲观'
        : pcr >= 1.0 ? '看跌稍多 — 轻度偏空情绪'
        : pcr <= 0.6 ? '看涨 OI 过多 — 市场过度乐观'
        : pcr <= 0.8 ? '看涨偏向 — 多头情绪略占优'
        : '多空均衡',
    severity: pcr >= 1.2 ? 'bearish' : pcr <= 0.6 ? 'warning' : pcr >= 1.0 ? 'warning' : 'neutral',
  });

  const exp30 = data.expiries.length
    ? data.expiries.reduce((best, e) =>
        Math.abs(e.daysToExp - 30) < Math.abs(best.daysToExp - 30) ? e : best,
        data.expiries[0])
    : null;
  if (exp30) {
    const rr25 = exp30.rr25;
    signals.push({
      id: 'skew',
      label: '30D Skew (RR25)',
      value: `${rr25 >= 0 ? '+' : ''}${rr25.toFixed(2)}%`,
      desc: rr25 <= -5 ? '强烈看跌偏斜 — 市场积极买入保护'
          : rr25 <= -2 ? '温和看跌偏斜 — 下行保护溢价'
          : rr25 >= 5  ? '强烈看涨偏斜 — 上行 Call 需求旺盛'
          : rr25 >= 2  ? '温和看涨偏斜'
          : '偏斜基本中性',
      severity: rr25 <= -5 ? 'bearish' : rr25 >= 5 ? 'bullish' : rr25 <= -2 ? 'warning' : 'neutral',
    });
  }

  if (histData) {
    const vrpPairs = histData.vrp;
    if (vrpPairs.length) {
      const latest = vrpPairs[vrpPairs.length - 1];
      const vrp = latest.iv - latest.rv;
      signals.push({
        id: 'vrp',
        label: 'VRP (IV−RV)',
        value: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}pp`,
        desc: vrp >= 12 ? '波动率风险溢价极高 — 卖方历史上有稳定收益'
            : vrp >= 6  ? 'VRP 偏高 — 期权定价偏贵'
            : vrp <= 0  ? 'VRP 为负 — 已实现波动超过隐含波动，少见'
            : vrp <= 2  ? 'VRP 受压 — 期权相对便宜'
            : 'VRP 正常区间',
        severity: vrp >= 12 ? 'bearish' : vrp <= 0 ? 'bullish' : vrp <= 2 ? 'warning' : 'neutral',
      });
    }
  }

  if (flowData) {
    const annFunding = flowData.annFunding;
    signals.push({
      id: 'funding',
      label: '资金费率（年化）',
      value: `${annFunding >= 0 ? '+' : ''}${annFunding.toFixed(1)}%`,
      desc: annFunding >= 50 ? '永续多头极度拥挤 — 回调风险高'
          : annFunding >= 25 ? '资金费率偏高 — 多头主导，注意过热'
          : annFunding <= -15? '永续空头拥挤 — 轧空风险'
          : annFunding <= -5 ? '资金费率偏低 — 市场偏空情绪'
          : '资金费率中性',
      severity: annFunding >= 50 ? 'bearish' : annFunding <= -15 ? 'bullish'
              : annFunding >= 25 ? 'warning' : annFunding <= -5 ? 'warning' : 'neutral',
    });
  }

  if (data.expiries.length >= 2) {
    const front = data.expiries[0];
    const back  = data.expiries[data.expiries.length - 1];
    const slope = back.atmIV - front.atmIV;
    signals.push({
      id: 'termstructure',
      label: '期限结构',
      value: `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}pp`,
      desc: slope <= -8 ? '强倒挂 — 近端 IV 极度拥挤，事件驱动风险高'
          : slope <= -3 ? '轻度倒挂 — 近端 IV 抬升，市场情绪偏紧张'
          : slope >= 8  ? '显著正斜 — 远端溢价高，日历价差受益'
          : slope >= 3  ? '正常正斜 — 结构健康'
          : '平坦期限结构',
      severity: slope <= -8 ? 'bearish' : slope <= -3 ? 'warning'
              : slope >= 8  ? 'bullish' : 'neutral',
    });
  }

  return signals;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Vol Regime
// ═══════════════════════════════════════════════════════════════════════════════

export type VolRegime =
  | 'low-vol-complacent'
  | 'vol-expansion'
  | 'high-vol-fear'
  | 'vol-compression'
  | 'mean-revert'
  | 'unknown';

export interface RegimeResult {
  regime: VolRegime;
  label: string;
  color: string;
  confidence: number;
  description: string;
  playbook: string[];
}

export function classifyRegime(
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
      color: '#FF5F57',
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
      color: '#FEBC2E',
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

// ═══════════════════════════════════════════════════════════════════════════════
// Sentiment
// ═══════════════════════════════════════════════════════════════════════════════

export function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

export interface SentFactor { label: string; score: number; raw: string; weight: number }

export async function computeSentiment(coin: Coin): Promise<{ composite: number; factors: SentFactor[] }> {
  const [opt, hist, flow] = await Promise.all([
    fetchDeribitOptions(coin),
    fetchDeribitHistory(coin),
    fetchFlowData(coin),
  ]);

  const pcrScore   = clamp01((2.0 - opt.pcr) / 1.5);
  const rr25 = opt.expiries.find(e => e.daysToExp >= 1)?.rr25 ?? 0;
  const skewScore  = clamp01((rr25 + 10) / 20);
  const ivrScore   = clamp01(1 - hist.ivRankCurrent / 100);
  const fundScore  = clamp01((flow.annFunding + 100) / 200);
  const fgScore    = clamp01(flow.currentFG / 100);

  const realtimeDvol   = opt.dvol30;
  const yesterdayDvol  = hist.dvolSeries.length > 0
    ? hist.dvolSeries[hist.dvolSeries.length - 1]
    : realtimeDvol;
  const dvolChangeLive = realtimeDvol - yesterdayDvol;
  const dvolScore      = clamp01((-dvolChangeLive + 10) / 20);

  const factors: SentFactor[] = [
    { label: 'PCR',      score: pcrScore  * 100, raw: opt.pcr.toFixed(2),            weight: 2 },
    { label: 'Skew 25δ', score: skewScore * 100, raw: `${rr25 >= 0 ? '+' : ''}${rr25.toFixed(1)}vp`, weight: 2 },
    { label: 'IV Rank',  score: ivrScore  * 100, raw: `${hist.ivRankCurrent.toFixed(0)}%ile`,  weight: 1.5 },
    { label: '资金费率',  score: fundScore * 100, raw: `${flow.annFunding >= 0 ? '+' : ''}${flow.annFunding.toFixed(1)}%`, weight: 1.5 },
    { label: 'FG指数',   score: fgScore   * 100, raw: `${flow.currentFG} ${flow.currentFGLabel}`, weight: 1 },
    { label: 'DVOL Δ',   score: dvolScore * 100, raw: `${dvolChangeLive >= 0 ? '+' : ''}${dvolChangeLive.toFixed(1)}%`, weight: 1 },
  ];

  const totalW  = factors.reduce((s, f) => s + f.weight, 0);
  const composite = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalW;
  return { composite, factors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Payoff parser
// ═══════════════════════════════════════════════════════════════════════════════

export function parseInstForPayoff(inst: string): { K: number; type: 'C' | 'P'; expiryLabel: string } | null {
  const parts = inst.split('-');
  if (parts.length !== 4) return null;
  const [, expiryRaw, strikeStr, typeStr] = parts;
  const K = Number(strikeStr);
  if (isNaN(K)) return null;
  return { K, type: typeStr === 'C' ? 'C' : 'P', expiryLabel: expiryRaw };
}
