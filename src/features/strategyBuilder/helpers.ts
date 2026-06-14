// ═══════════════════════════════════════════════════════════════════════════════
// Pure helpers for the strategy builder: option pricing, payoff, synthetic chain
// generation, Deribit instrument parsing, contract matching, template ranking,
// axis layout, and value/percent formatters. No React, no component state.
// ═══════════════════════════════════════════════════════════════════════════════

import { bsCall, bsPut } from '../../registry/lib/bs-math';
import { AXIS_MAX_TICKS, VIEW_TAG_WEIGHTS } from './constants';
import type {
  OptionType, LegSide, ReviewLevel, ValueMode, MarketView,
  MarketPreset, StrategyLeg, OptionContract, DeribitBookSummary,
  StrategyTemplate, RankedTemplate,
} from './types';

export function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

export function years(days: number) {
  return Math.max(0, days) / 365;
}

export function optionPrice(S: number, K: number, T: number, iv: number, type: OptionType) {
  return type === 'call' ? bsCall(S, K, T, iv) : bsPut(S, K, T, iv);
}

export function formatMoney(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

export function formatAbsMoney(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatPrice(value: number | undefined, digits = 2) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatCompact(value: number) {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatSpotValue(value: number) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function exposureText(value: number, positive: string, negative: string, flat = '中性') {
  if (Math.abs(value) < 0.12) return flat;
  return value > 0 ? positive : negative;
}

export function reviewTone(level: ReviewLevel) {
  if (level === 'danger') return 'bg-[#EF454A]/12 text-[#EF454A]';
  if (level === 'watch') return 'bg-[#FEBC2E]/12 text-[#FEBC2E]';
  return 'bg-[#24AE64]/12 text-[#24AE64]';
}

export function legSign(side: LegSide) {
  return side === 'buy' ? 1 : -1;
}

export function payoffAt(leg: StrategyLeg, S: number, remainingDays: number, baseIv: number, mode: ValueMode, scenarioIvMultiplier = 1) {
  const sign = legSign(leg.side);
  if (leg.kind === 'underlying') {
    const current = S;
    const value = sign * leg.qty * current;
    const pnl = sign * leg.qty * (current - leg.entry);
    return mode === 'contractValue' ? value : pnl;
  }

  const T = years(remainingDays);
  const scenarioIv = Math.max(5, (leg.iv ?? baseIv) * scenarioIvMultiplier);
  const current = optionPrice(S, leg.strike ?? S, T, scenarioIv, leg.type ?? 'call');
  const value = sign * leg.qty * current;
  const pnl = sign * leg.qty * (current - leg.entry);
  return mode === 'contractValue' ? value : pnl;
}

export function buildChain(market: MarketPreset, spot: number, expiryDays: number, ivShift: number): OptionContract[] {
  const center = roundToStep(spot, market.step);
  const strikes = Array.from({ length: 17 }, (_, index) => center + (index - 8) * market.step).filter(k => k > 0);
  const T = years(expiryDays);
  return strikes.flatMap((strike, index) => {
    return (['call', 'put'] as OptionType[]).map(type => {
      const moneyness = Math.abs(Math.log(strike / spot));
      const skew = type === 'put' ? Math.max(0, (spot - strike) / spot) * 18 : Math.max(0, (strike - spot) / spot) * 10;
      const localIv = Math.max(8, market.iv + ivShift + skew + moneyness * 22);
      const mark = optionPrice(spot, strike, T, localIv, type);
      const spread = Math.max(market.step * 0.015, mark * (0.035 + moneyness * 0.08));
      const oiShape = Math.max(0.08, 1 - Math.abs(index - 8) / 10);
      return {
        instrumentName: `${market.symbol}-SIM-${expiryDays}D-${strike}-${type === 'call' ? 'C' : 'P'}`,
        strike,
        type,
        expiryTs: Date.now() + expiryDays * 86_400_000,
        expiryLabel: `${expiryDays}D`,
        days: expiryDays,
        bid: Math.max(0.01, mark - spread / 2),
        ask: mark + spread / 2,
        mark,
        iv: localIv,
        oi: Math.round((1200 + 8800 * oiShape) * (type === 'call' ? 1.08 : 0.94)),
        underlyingPrice: spot,
        synthetic: true,
      };
    });
  });
}

const DERIBIT_MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseDeribitInstrument(name: string): null | { strike: number; type: OptionType; expiryTs: number; expiryLabel: string; days: number } {
  const parts = name.split('-');
  if (parts.length < 4) return null;
  const expiry = parts[1];
  const strike = Number(parts[2]);
  const type = parts[3] === 'C' ? 'call' : parts[3] === 'P' ? 'put' : null;
  const match = expiry.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match || !Number.isFinite(strike) || !type) return null;
  const [, dayRaw, monthRaw, yearRaw] = match;
  const month = DERIBIT_MONTHS[monthRaw];
  if (month === undefined) return null;
  const year = 2000 + Number(yearRaw);
  const expiryTs = Date.UTC(year, month, Number(dayRaw), 8, 0, 0);
  const days = Math.max(1, Math.ceil((expiryTs - Date.now()) / 86_400_000));
  return { strike, type, expiryTs, expiryLabel: expiry, days };
}

export function deribitSummaryToContract(row: DeribitBookSummary): OptionContract | null {
  if (!row.instrument_name) return null;
  const parsed = parseDeribitInstrument(row.instrument_name);
  const underlying = row.underlying_price;
  if (!parsed || !underlying || underlying <= 0) return null;
  const mark = (row.mark_price ?? 0) * underlying;
  const bid = (row.bid_price ?? row.mark_price ?? 0) * underlying;
  const ask = (row.ask_price ?? row.mark_price ?? 0) * underlying;
  if (!Number.isFinite(mark) || mark <= 0) return null;
  return {
    instrumentName: row.instrument_name,
    ...parsed,
    bid: Math.max(0.01, bid),
    ask: Math.max(0.01, ask),
    mark,
    iv: row.mark_iv ?? 50,
    oi: row.open_interest ?? 0,
    underlyingPrice: underlying,
  };
}

export function findContract(contracts: OptionContract[], strike: number | undefined, type: OptionType | undefined, expiryDays: number, expiryTs?: number) {
  if (!strike || !type || contracts.length === 0) return null;
  const scoped = expiryTs ? contracts.filter(contract => contract.expiryTs === expiryTs) : contracts;
  return (scoped.length > 0 ? scoped : contracts)
    .filter(contract => contract.type === type)
    .sort((a, b) => {
      const expiryWeight = expiryTs ? 1_000_000 : 10;
      const da = Math.abs(a.strike - strike) + Math.abs(a.days - expiryDays) * expiryWeight;
      const db = Math.abs(b.strike - strike) + Math.abs(b.days - expiryDays) * expiryWeight;
      return da - db;
    })[0] ?? null;
}

export function priceLegFromContract(leg: StrategyLeg, contract: OptionContract | null, spot: number, fallbackIv: number): StrategyLeg {
  if (leg.kind === 'underlying') return { ...leg, entry: spot };
  if (!contract) {
    return {
      ...leg,
      instrumentName: undefined,
      expiryTs: undefined,
      iv: undefined,
      bid: undefined,
      ask: undefined,
      oi: undefined,
      entry: optionPrice(spot, leg.strike ?? spot, years(leg.expiryDays), fallbackIv, leg.type ?? 'call'),
    };
  }
  const executable = leg.side === 'buy' ? contract.ask : contract.bid;
  return {
    ...leg,
    strike: contract.strike,
    type: contract.type,
    expiryDays: contract.days,
    expiryTs: contract.expiryTs,
    instrumentName: contract.instrumentName,
    iv: contract.iv,
    bid: contract.bid,
    ask: contract.ask,
    oi: contract.oi,
    entry: executable > 0 ? executable : contract.mark,
  };
}

export function makeLegFromContract(contract: OptionContract, side: LegSide): StrategyLeg {
  return {
    id: `leg-${contract.instrumentName}-${side}-${Date.now()}`,
    kind: 'option',
    side,
    type: contract.type,
    strike: contract.strike,
    expiryDays: contract.days,
    expiryTs: contract.expiryTs,
    instrumentName: contract.instrumentName,
    iv: contract.iv,
    bid: contract.bid,
    ask: contract.ask,
    oi: contract.oi,
    qty: 1,
    entry: side === 'buy' ? contract.ask : contract.bid,
  };
}

export function instantiateTemplate(template: StrategyTemplate, market: MarketPreset, spot: number, iv: number, contracts: OptionContract[] = []): StrategyLeg[] {
  return template.legs.map((draft, index) => {
    if (draft.kind === 'underlying') {
      return {
        id: `${template.id}-${index}`,
        kind: 'underlying',
        side: draft.side,
        qty: draft.qty ?? 1,
        expiryDays: 0,
        entry: spot,
      };
    }

    const strike = roundToStep(spot + (draft.strikeOffset ?? 0) * market.step, market.step);
    const expiryDays = draft.expiryDays ?? 30;
    const baseLeg: StrategyLeg = {
      id: `${template.id}-${index}`,
      kind: 'option',
      side: draft.side,
      type: draft.type,
      strike,
      expiryDays,
      qty: draft.qty ?? 1,
      entry: optionPrice(spot, strike, years(expiryDays), iv, draft.type ?? 'call'),
    };
    return priceLegFromContract(baseLeg, findContract(contracts, strike, draft.type, expiryDays), spot, iv);
  });
}

export function rankTemplateForView(template: StrategyTemplate, view: MarketView): RankedTemplate {
  if (view === 'all') {
    return {
      template,
      score: template.id === 'custom' ? 99 : Math.max(20, 70 - template.legs.length * 3),
      fit: 'ok',
      reason: template.id === 'custom' ? '从空白组合开始。' : '常用策略，适合作为构建起点。',
    };
  }

  const weights = VIEW_TAG_WEIGHTS[view];
  let score = template.tags.reduce((sum, tag) => sum + (weights[tag] ?? 0), 0);
  const longOptions = template.legs.filter(leg => leg.kind === 'option' && leg.side === 'buy').length;
  const shortOptions = template.legs.filter(leg => leg.kind === 'option' && leg.side === 'sell').length;
  const hasUnderlying = template.legs.some(leg => leg.kind === 'underlying');
  const isDefinedRiskSpread = longOptions > 0 && shortOptions > 0;
  const isShortPremium = shortOptions > longOptions;
  const isCalendar = template.tags.includes('calendar');
  const isEmpty = template.legs.length === 0;

  if (isEmpty) score = -4;
  if ((view === 'bullish' || view === 'bearish') && isDefinedRiskSpread) score += 2;
  if ((view === 'bullish' || view === 'bearish') && hasUnderlying) score -= 1;
  if (view === 'range' && isShortPremium) score += 3;
  if (view === 'range' && template.tags.includes('trend')) score -= 4;
  if (view === 'breakout' && longOptions >= shortOptions) score += 2;
  if (view === 'breakout' && template.tags.includes('neutral')) score -= 3;
  if (view === 'volUp' && longOptions >= shortOptions) score += 3;
  if (view === 'volDown' && isShortPremium) score += 3;
  if (view === 'calendar' && isCalendar) score += 3;

  const fit: RankedTemplate['fit'] = score >= 8 ? 'best' : score >= 3 ? 'ok' : 'weak';
  let reason = '与当前观点匹配度较低，除非你有更具体的交易假设。';
  if (fit === 'best') {
    if (view === 'range') reason = isShortPremium ? '收取时间价值，适合区间震荡。' : '风险有限，适合温和震荡。';
    else if (view === 'breakout') reason = '凸性较强，适合等待突破。';
    else if (view === 'volUp') reason = '偏做多波动，适合 IV 扩张。';
    else if (view === 'volDown') reason = '偏收波动和时间价值。';
    else if (view === 'calendar') reason = '跨期限结构，适合做期限差。';
    else reason = isDefinedRiskSpread ? '方向明确且风险边界清晰。' : '方向表达直接，结构容易理解。';
  } else if (fit === 'ok') {
    reason = isDefinedRiskSpread ? '可用，但需要确认价格区间和成本。' : '可以表达观点，但风险边界要复核。';
  }

  return { template, score, fit, reason };
}

export function fitTone(fit: RankedTemplate['fit']) {
  if (fit === 'best') return 'bg-white/[0.07] text-white/72';
  if (fit === 'ok') return 'bg-white/[0.05] text-white/58';
  return 'bg-white/[0.05] text-white/45';
}

export function fitLabel(fit: RankedTemplate['fit']) {
  if (fit === 'best') return '推荐';
  if (fit === 'ok') return '可用';
  return '谨慎';
}

export function nearestStrikeIndex(strikes: number[], value: number) {
  if (strikes.length === 0) return -1;
  return strikes.reduce((bestIndex, strike, index) => (
    Math.abs(strike - value) < Math.abs(strikes[bestIndex] - value) ? index : bestIndex
  ), 0);
}

export function pickAxisStrikes(strikes: number[], spot: number, legs: StrategyLeg[], maxTicks = AXIS_MAX_TICKS) {
  if (strikes.length <= maxTicks) return strikes;
  const anchorIndexes = [
    nearestStrikeIndex(strikes, spot),
    ...legs
      .filter((leg): leg is StrategyLeg & { strike: number } => leg.kind === 'option' && Number.isFinite(leg.strike))
      .map(leg => nearestStrikeIndex(strikes, leg.strike)),
  ].filter(index => index >= 0);
  const minAnchor = Math.min(...anchorIndexes);
  const maxAnchor = Math.max(...anchorIndexes);
  const centerIndex = Math.round((minAnchor + maxAnchor) / 2);
  const start = Math.max(0, Math.min(strikes.length - maxTicks, centerIndex - Math.floor(maxTicks / 2)));
  return strikes.slice(start, start + maxTicks);
}

export function axisPositionPct(strikes: number[], strike: number | undefined) {
  if (!strike || strikes.length === 0) return 50;
  const exactIndex = strikes.findIndex(item => item === strike);
  if (exactIndex >= 0) return 2 + (exactIndex / Math.max(1, strikes.length - 1)) * 96;
  const minStrike = strikes[0];
  const maxStrike = strikes[strikes.length - 1];
  if (maxStrike === minStrike) return 50;
  const ratio = Math.max(0, Math.min(1, (strike - minStrike) / (maxStrike - minStrike)));
  return 2 + ratio * 96;
}

export function buildAxisLegLayout(strikes: number[], legs: StrategyLeg[], side: LegSide) {
  const laneTops = side === 'buy' ? [28, 48] : [76, 96];
  const minGapPct = strikes.length > 18 ? 9.8 : 11.6;
  const laneLastPct: number[] = [];
  const layout = new Map<string, { leftPct: number; top: number; lane: number }>();

  legs
    .filter(leg => leg.kind === 'option' && leg.side === side)
    .map(leg => ({ leg, leftPct: axisPositionPct(strikes, leg.strike) }))
    .sort((a, b) => a.leftPct - b.leftPct || a.leg.id.localeCompare(b.leg.id))
    .forEach(({ leg, leftPct }) => {
      const openLane = laneLastPct.findIndex(lastPct => Math.abs(leftPct - lastPct) >= minGapPct);
      const lane = openLane >= 0 ? openLane : Math.min(laneLastPct.length, laneTops.length - 1);
      laneLastPct[lane] = leftPct;
      layout.set(leg.id, { leftPct, top: laneTops[lane], lane });
    });

  return layout;
}
