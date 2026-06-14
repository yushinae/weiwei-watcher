// Shared types for the strategy builder.

export type TemplateTag = 'bullish' | 'bearish' | 'neutral' | 'trend' | 'calendar';
export type OptionType = 'call' | 'put';
export type LegSide = 'buy' | 'sell';
export type LegKind = 'option' | 'underlying';
export type ViewMode = 'table' | 'curve' | 'greeks';
export type ValueMode = 'pnl' | 'pnlPercent' | 'contractValue';
export type ReviewLevel = 'ok' | 'watch' | 'danger';
export type MarketView = 'all' | 'bullish' | 'bearish' | 'range' | 'breakout' | 'volUp' | 'volDown' | 'calendar';

export interface MarketPreset {
  symbol: string;
  label: string;
  spot: number;
  iv: number;
  step: number;
  contractSize: number;
}

export interface StrategyLeg {
  id: string;
  kind: LegKind;
  side: LegSide;
  type?: OptionType;
  strike?: number;
  instrumentName?: string;
  expiryTs?: number;
  iv?: number;
  bid?: number;
  ask?: number;
  oi?: number;
  expiryDays: number;
  qty: number;
  entry: number;
}

export interface LegDraft {
  kind: LegKind;
  side: LegSide;
  type?: OptionType;
  strikeOffset?: number;
  expiryDays?: number;
  qty?: number;
}

export interface StrategyTemplate {
  id: string;
  nameCn: string;
  nameEn: string;
  tags: TemplateTag[];
  summary: string;
  detail: string;
  legs: LegDraft[];
}

export interface OptionContract {
  instrumentName: string;
  strike: number;
  type: OptionType;
  expiryTs: number;
  expiryLabel: string;
  days: number;
  bid: number;
  ask: number;
  mark: number;
  iv: number;
  oi: number;
  underlyingPrice: number;
  synthetic?: boolean;
}

export interface DeribitBookSummary {
  instrument_name?: string;
  underlying_price?: number;
  mark_price?: number;
  mark_iv?: number;
  bid_price?: number;
  ask_price?: number;
  open_interest?: number;
  price_change?: number;
}

export interface ReviewItem {
  level: ReviewLevel;
  title: string;
  detail: string;
}

export interface RankedTemplate {
  template: StrategyTemplate;
  score: number;
  fit: 'best' | 'ok' | 'weak';
  reason: string;
}

export interface AxisDragState {
  legId: string;
  pointerId: number;
  axisLeft: number;
  axisWidth: number;
  startX: number;
  x: number;
  moved: boolean;
  lastStrike: number | null;
  anchorStartStrike: number | null;
  startStrikes: Array<{ id: string; strike: number }>;
}
