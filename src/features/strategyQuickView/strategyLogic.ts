// ═══════════════════════════════════════════════════════════════════════════════
// 策略逻辑：10种策略的盈亏计算、Greeks、关键指标
// ═══════════════════════════════════════════════════════════════════════════════

import { bsCall, bsPut, bsDelta, bsVega, bsTheta, bsGamma } from '../../registry/lib/bs-math';

// ── 策略类型 ──────────────────────────────────────────────────────────────────

export type StrategyType =
  | 'long-call'
  | 'long-put'
  | 'bear-call-spread'
  | 'bull-put-spread'
  | 'iron-condor'
  | 'naked-put'
  | 'short-strangle'
  | 'short-straddle'
  | 'call-debit-spread'
  | 'put-debit-spread';

export interface StrategyMeta {
  type: StrategyType;
  label: string;
  isBullish: boolean | null;
  isCredit: boolean;
  legs: number;
}

export const STRATEGY_METAS: StrategyMeta[] = [
  { type: 'long-call',           label: 'Long Call (买入看涨)',       isBullish: true,  isCredit: false, legs: 1 },
  { type: 'long-put',            label: 'Long Put (买入看跌)',        isBullish: false, isCredit: false, legs: 1 },
  { type: 'bear-call-spread',    label: 'Bear Call (熊市价差)',       isBullish: false, isCredit: true,  legs: 2 },
  { type: 'bull-put-spread',     label: 'Bull Put (牛市价差)',        isBullish: true,  isCredit: true,  legs: 2 },
  { type: 'iron-condor',         label: 'Iron Condor (铁鹰策略)',     isBullish: null,  isCredit: true,  legs: 4 },
  { type: 'naked-put',           label: 'Naked Put (裸卖Put)',        isBullish: true,  isCredit: true,  legs: 1 },
  { type: 'short-strangle',      label: 'Short Strangle (宽跨式)',    isBullish: null,  isCredit: true,  legs: 2 },
  { type: 'short-straddle',      label: 'Short Straddle (跨式)',      isBullish: null,  isCredit: true,  legs: 2 },
  { type: 'call-debit-spread',   label: 'Call Debit (看涨价差)',      isBullish: true,  isCredit: false, legs: 2 },
  { type: 'put-debit-spread',    label: 'Put Debit (看跌价差)',       isBullish: false, isCredit: false, legs: 2 },
];

export function getStrategyMeta(type: StrategyType): StrategyMeta {
  return STRATEGY_METAS.find(m => m.type === type)!;
}

// ── 参数定义 ──────────────────────────────────────────────────────────────────

export interface ParamDef {
  id: string;
  label: string;
  shortLabel: string;
  defaultOffset?: number;
  step?: number;
}

export function getStrategyParams(type: StrategyType): ParamDef[] {
  switch (type) {
    case 'long-call':
    case 'long-put':
      return [{ id: 'strike', label: '行权价', shortLabel: 'K', defaultOffset: 0, step: 1000 }];
    case 'bear-call-spread':
      return [
        { id: 'k1', label: '卖出 Call', shortLabel: 'K₁', defaultOffset: 0, step: 1000 },
        { id: 'k2', label: '买入 Call', shortLabel: 'K₂', defaultOffset: 2000, step: 1000 },
      ];
    case 'bull-put-spread':
      return [
        { id: 'k1', label: '买入 Put', shortLabel: 'K₁', defaultOffset: -2000, step: 1000 },
        { id: 'k2', label: '卖出 Put', shortLabel: 'K₂', defaultOffset: 0, step: 1000 },
      ];
    case 'iron-condor':
      return [
        { id: 'k1', label: 'Put 卖出', shortLabel: 'K₁', defaultOffset: -5000, step: 1000 },
        { id: 'k2', label: 'Put 买入', shortLabel: 'K₂', defaultOffset: -3000, step: 1000 },
        { id: 'k3', label: 'Call 买入', shortLabel: 'K₃', defaultOffset: 3000, step: 1000 },
        { id: 'k4', label: 'Call 卖出', shortLabel: 'K₄', defaultOffset: 5000, step: 1000 },
      ];
    case 'naked-put':
      return [{ id: 'strike', label: '卖出 Put', shortLabel: 'K', defaultOffset: -2000, step: 1000 }];
    case 'short-strangle':
      return [
        { id: 'k1', label: 'Put 卖出', shortLabel: 'K₁', defaultOffset: -3000, step: 1000 },
        { id: 'k2', label: 'Call 卖出', shortLabel: 'K₂', defaultOffset: 3000, step: 1000 },
      ];
    case 'short-straddle':
      return [{ id: 'strike', label: '行权价 (ATM)', shortLabel: 'K', defaultOffset: 0, step: 1000 }];
    case 'call-debit-spread':
      return [
        { id: 'k1', label: '买入 Call', shortLabel: 'K₁', defaultOffset: 0, step: 1000 },
        { id: 'k2', label: '卖出 Call', shortLabel: 'K₂', defaultOffset: 2000, step: 1000 },
      ];
    case 'put-debit-spread':
      return [
        { id: 'k1', label: '卖出 Put', shortLabel: 'K₁', defaultOffset: -2000, step: 1000 },
        { id: 'k2', label: '买入 Put', shortLabel: 'K₂', defaultOffset: 0, step: 1000 },
      ];
  }
}

export function defaultStrikes(type: StrategyType, spot: number): number[] {
  const params = getStrategyParams(type);
  return params.map(p => {
    const offset = p.defaultOffset ?? 0;
    return Math.round((spot + offset) / 1000) * 1000;
  });
}

// ── 公共类型 ──────────────────────────────────────────────────────────────────

export interface PayoffPoint { price: number; pnl: number; }

export interface StrategyResult {
  payoff: PayoffPoint[];
  breakevens: number[];
  maxProfit: number;
  maxLoss: number;
  costOrCredit: number;
  delta: number; gamma: number; vega: number; theta: number;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function roundPx(v: number) { return Math.round(v / 100) * 100; }

function buildPayoff(spot: number, fn: (price: number) => number): PayoffPoint[] {
  const minPx = roundPx(spot * 0.85);
  const maxPx = roundPx(spot * 1.20);
  const steps = 80;
  const stepSize = (maxPx - minPx) / steps;
  const result: PayoffPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const price = minPx + i * stepSize;
    result.push({ price, pnl: fn(price) });
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 各策略计算
// ═══════════════════════════════════════════════════════════════════════════════

interface CalcCtx { S: number; T: number; iv: number; qty: number; K: number[]; }

function calcLongCall(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k = K[0];
  const premium = bsCall(S, k, T, iv) * qty;
  return {
    payoff: buildPayoff(S, (px) => Math.max(px - k, 0) * qty - premium),
    breakevens: [k + premium / qty],
    maxProfit: Infinity,
    maxLoss: -premium,
    costOrCredit: -premium,
    delta: bsDelta(S, k, T, iv, 'C') * qty,
    gamma: bsGamma(S, k, T, iv) * qty,
    vega: bsVega(S, k, T, iv) * qty,
    theta: bsTheta(S, k, T, iv) * qty,
  };
}

function calcLongPut(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k = K[0];
  const premium = bsPut(S, k, T, iv) * qty;
  return {
    payoff: buildPayoff(S, (px) => Math.max(k - px, 0) * qty - premium),
    breakevens: [k - premium / qty],
    maxProfit: k * qty - premium,
    maxLoss: -premium,
    costOrCredit: -premium,
    delta: bsDelta(S, k, T, iv, 'P') * qty,
    gamma: bsGamma(S, k, T, iv) * qty,
    vega: bsVega(S, k, T, iv) * qty,
    theta: bsTheta(S, k, T, iv) * qty,
  };
}

function calcBearCallSpread(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k1 = K[0], k2 = K[1];
  const credit = (bsCall(S, k1, T, iv) - bsCall(S, k2, T, iv)) * qty;
  const width = (k2 - k1) * qty;
  return {
    payoff: buildPayoff(S, (px) => {
      if (px <= k1) return credit;
      if (px < k2) return credit - (px - k1) * qty;
      return credit - width;
    }),
    breakevens: [k1 + credit / qty],
    maxProfit: credit,
    maxLoss: credit - width,
    costOrCredit: credit,
    delta: (bsDelta(S, k1, T, iv, 'C') - bsDelta(S, k2, T, iv, 'C')) * qty,
    gamma: (bsGamma(S, k1, T, iv) - bsGamma(S, k2, T, iv)) * qty,
    vega: (bsVega(S, k1, T, iv) - bsVega(S, k2, T, iv)) * qty,
    theta: (bsTheta(S, k1, T, iv) - bsTheta(S, k2, T, iv)) * qty,
  };
}

function calcBullPutSpread(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k1 = K[0], k2 = K[1];
  const credit = (bsPut(S, k2, T, iv) - bsPut(S, k1, T, iv)) * qty;
  const width = (k2 - k1) * qty;
  return {
    payoff: buildPayoff(S, (px) => {
      if (px >= k2) return credit;
      if (px > k1) return credit - (k2 - px) * qty;
      return credit - width;
    }),
    breakevens: [k2 - credit / qty],
    maxProfit: credit,
    maxLoss: credit - width,
    costOrCredit: credit,
    delta: (bsDelta(S, k2, T, iv, 'P') - bsDelta(S, k1, T, iv, 'P')) * qty,
    gamma: (bsGamma(S, k2, T, iv) - bsGamma(S, k1, T, iv)) * qty,
    vega: (bsVega(S, k2, T, iv) - bsVega(S, k1, T, iv)) * qty,
    theta: (bsTheta(S, k2, T, iv) - bsTheta(S, k1, T, iv)) * qty,
  };
}

function calcIronCondor(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const [k1, k2, k3, k4] = K;
  const putCredit = bsPut(S, k2, T, iv) - bsPut(S, k1, T, iv);
  const callCredit = bsCall(S, k4, T, iv) - bsCall(S, k3, T, iv);
  const credit = (putCredit + callCredit) * qty;
  const putWidth = (k2 - k1) * qty;
  const callWidth = (k4 - k3) * qty;
  const maxLoss = credit - Math.max(putWidth, callWidth);
  return {
    payoff: buildPayoff(S, (px) => {
      if (px <= k1) return credit - putWidth;
      if (px < k2)  return credit - (k2 - px) * qty;
      if (px <= k3) return credit;
      if (px < k4)  return credit - (px - k3) * qty;
      return credit - callWidth;
    }),
    breakevens: [k2 - credit / qty, k3 + credit / qty],
    maxProfit: credit,
    maxLoss,
    costOrCredit: credit,
    delta: (bsDelta(S, k2, T, iv, 'P') - bsDelta(S, k1, T, iv, 'P')
          + bsDelta(S, k4, T, iv, 'C') - bsDelta(S, k3, T, iv, 'C')) * qty,
    gamma: (bsGamma(S, k2, T, iv) - bsGamma(S, k1, T, iv)
          + bsGamma(S, k4, T, iv) - bsGamma(S, k3, T, iv)) * qty,
    vega: (bsVega(S, k2, T, iv) - bsVega(S, k1, T, iv)
          + bsVega(S, k4, T, iv) - bsVega(S, k3, T, iv)) * qty,
    theta: (bsTheta(S, k2, T, iv) - bsTheta(S, k1, T, iv)
          + bsTheta(S, k4, T, iv) - bsTheta(S, k3, T, iv)) * qty,
  };
}

// ════ 新策略 ═════════════════════════════════════════════════════════════════

function calcNakedPut(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k = K[0];
  const premium = bsPut(S, k, T, iv) * qty;
  return {
    payoff: buildPayoff(S, (px) => {
      if (px >= k) return premium;
      return premium - (k - px) * qty;
    }),
    breakevens: [k - premium / qty],
    maxProfit: premium,
    maxLoss: -(k * qty - premium),
    costOrCredit: premium,
    delta: bsDelta(S, k, T, iv, 'P') * qty,
    gamma: bsGamma(S, k, T, iv) * qty,
    vega: bsVega(S, k, T, iv) * qty,
    theta: bsTheta(S, k, T, iv) * qty,
  };
}

function calcShortStrangle(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k1 = K[0], k2 = K[1]; // k1 < S < k2: sell put @k1, sell call @k2
  const credit = (bsPut(S, k1, T, iv) + bsCall(S, k2, T, iv)) * qty;
  return {
    payoff: buildPayoff(S, (px) => {
      if (px <= k1) return credit - (k1 - px) * qty;
      if (px < k2)  return credit;
      return credit - (px - k2) * qty;
    }),
    breakevens: [k1 - credit / qty, k2 + credit / qty],
    maxProfit: credit,
    maxLoss: -Infinity,
    costOrCredit: credit,
    delta: (bsDelta(S, k1, T, iv, 'P') + bsDelta(S, k2, T, iv, 'C')) * qty,
    gamma: (bsGamma(S, k1, T, iv) + bsGamma(S, k2, T, iv)) * qty,
    vega: (bsVega(S, k1, T, iv) + bsVega(S, k2, T, iv)) * qty,
    theta: (bsTheta(S, k1, T, iv) + bsTheta(S, k2, T, iv)) * qty,
  };
}

function calcShortStraddle(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k = K[0];
  const credit = (bsPut(S, k, T, iv) + bsCall(S, k, T, iv)) * qty;
  return {
    payoff: buildPayoff(S, (px) => credit - Math.abs(px - k) * qty),
    breakevens: [k - credit / qty, k + credit / qty],
    maxProfit: credit,
    maxLoss: -Infinity,
    costOrCredit: credit,
    delta: (bsDelta(S, k, T, iv, 'P') + bsDelta(S, k, T, iv, 'C')) * qty,
    gamma: (bsGamma(S, k, T, iv) + bsGamma(S, k, T, iv)) * qty,
    vega: (bsVega(S, k, T, iv) + bsVega(S, k, T, iv)) * qty,
    theta: (bsTheta(S, k, T, iv) + bsTheta(S, k, T, iv)) * qty,
  };
}

function calcCallDebitSpread(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k1 = K[0], k2 = K[1]; // k1 < k2: buy call @k1, sell call @k2
  const debit = (bsCall(S, k1, T, iv) - bsCall(S, k2, T, iv)) * qty;
  const width = (k2 - k1) * qty;
  return {
    payoff: buildPayoff(S, (px) => {
      if (px <= k1) return -debit;
      if (px < k2)  return -debit + (px - k1) * qty;
      return width - debit;
    }),
    breakevens: [k1 + debit / qty],
    maxProfit: width - debit,
    maxLoss: -debit,
    costOrCredit: -debit,
    delta: (bsDelta(S, k1, T, iv, 'C') - bsDelta(S, k2, T, iv, 'C')) * qty,
    gamma: (bsGamma(S, k1, T, iv) - bsGamma(S, k2, T, iv)) * qty,
    vega: (bsVega(S, k1, T, iv) - bsVega(S, k2, T, iv)) * qty,
    theta: (bsTheta(S, k1, T, iv) - bsTheta(S, k2, T, iv)) * qty,
  };
}

function calcPutDebitSpread(ctx: CalcCtx): StrategyResult {
  const { S, T, iv, qty, K } = ctx;
  const k1 = K[0], k2 = K[1]; // k1 < k2: sell put @k1, buy put @k2
  const debit = (bsPut(S, k2, T, iv) - bsPut(S, k1, T, iv)) * qty;
  const width = (k2 - k1) * qty;
  return {
    payoff: buildPayoff(S, (px) => {
      if (px >= k2) return -debit;
      if (px > k1)  return -debit + (k2 - px) * qty;
      return width - debit;
    }),
    breakevens: [k2 - debit / qty],
    maxProfit: width - debit,
    maxLoss: -debit,
    costOrCredit: -debit,
    delta: (bsDelta(S, k2, T, iv, 'P') - bsDelta(S, k1, T, iv, 'P')) * qty,
    gamma: (bsGamma(S, k2, T, iv) - bsGamma(S, k1, T, iv)) * qty,
    vega: (bsVega(S, k2, T, iv) - bsVega(S, k1, T, iv)) * qty,
    theta: (bsTheta(S, k2, T, iv) - bsTheta(S, k1, T, iv)) * qty,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 统一入口
// ═══════════════════════════════════════════════════════════════════════════════

export interface StrategyParams {
  type: StrategyType;
  spot: number;
  strikes: number[];
  expiryT: number;
  iv: number;
  qty: number;
}

export function calculateStrategy(params: StrategyParams): StrategyResult {
  const { type, spot, strikes, expiryT, iv, qty } = params;
  const ctx: CalcCtx = { S: spot, T: expiryT, iv, qty, K: strikes };
  switch (type) {
    case 'long-call':        return calcLongCall(ctx);
    case 'long-put':         return calcLongPut(ctx);
    case 'bear-call-spread': return calcBearCallSpread(ctx);
    case 'bull-put-spread':  return calcBullPutSpread(ctx);
    case 'iron-condor':      return calcIronCondor(ctx);
    case 'naked-put':        return calcNakedPut(ctx);
    case 'short-strangle':   return calcShortStrangle(ctx);
    case 'short-straddle':   return calcShortStraddle(ctx);
    case 'call-debit-spread':return calcCallDebitSpread(ctx);
    case 'put-debit-spread': return calcPutDebitSpread(ctx);
  }
}
