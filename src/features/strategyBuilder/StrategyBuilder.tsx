import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echarts from '../../components/echart/echartsCore';
import { bsCall, bsDelta, bsGamma, bsPut, bsTheta, bsVega, heatColor } from '../../registry/lib/bs-math';
import { cn } from '../../lib/utils';

type TemplateTag = 'bullish' | 'bearish' | 'neutral' | 'trend' | 'calendar';
type OptionType = 'call' | 'put';
type LegSide = 'buy' | 'sell';
type LegKind = 'option' | 'underlying';
type ViewMode = 'table' | 'curve' | 'greeks';
type ValueMode = 'pnl' | 'pnlPercent' | 'contractValue';
type ReviewLevel = 'ok' | 'watch' | 'danger';
type MarketView = 'all' | 'bullish' | 'bearish' | 'range' | 'breakout' | 'volUp' | 'volDown' | 'calendar';

interface MarketPreset {
  symbol: string;
  label: string;
  spot: number;
  iv: number;
  step: number;
  contractSize: number;
}

interface StrategyLeg {
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

interface LegDraft {
  kind: LegKind;
  side: LegSide;
  type?: OptionType;
  strikeOffset?: number;
  expiryDays?: number;
  qty?: number;
}

interface StrategyTemplate {
  id: string;
  nameCn: string;
  nameEn: string;
  tags: TemplateTag[];
  summary: string;
  detail: string;
  legs: LegDraft[];
}

interface OptionContract {
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

interface DeribitBookSummary {
  instrument_name?: string;
  underlying_price?: number;
  mark_price?: number;
  mark_iv?: number;
  bid_price?: number;
  ask_price?: number;
  open_interest?: number;
  price_change?: number;
}

interface ReviewItem {
  level: ReviewLevel;
  title: string;
  detail: string;
}

interface RankedTemplate {
  template: StrategyTemplate;
  score: number;
  fit: 'best' | 'ok' | 'weak';
  reason: string;
}

const MARKETS: MarketPreset[] = [
  { symbol: 'BTC', label: 'Bitcoin', spot: 65000, iv: 58, step: 1000, contractSize: 1 },
  { symbol: 'ETH', label: 'Ethereum', spot: 3200, iv: 66, step: 50, contractSize: 1 },
  { symbol: 'SOL', label: 'Solana', spot: 155, iv: 82, step: 5, contractSize: 1 },
];

const EXPIRIES = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '60D', days: 60 },
  { label: '90D', days: 90 },
];

const TAG_LABELS: Record<TemplateTag, string> = {
  bullish: '看涨',
  bearish: '看跌',
  neutral: '震荡',
  trend: '趋势',
  calendar: '日历',
};

const VIEW_LABELS: Record<MarketView, { label: string; hint: string }> = {
  all: { label: '全部', hint: '不限制行情观点，按常用度展示。' },
  bullish: { label: '看涨', hint: '预期上涨，优先有限风险多头结构。' },
  bearish: { label: '看跌', hint: '预期下跌，优先 Put 与有限风险空头结构。' },
  range: { label: '震荡', hint: '预期区间内波动，优先收权利金结构。' },
  breakout: { label: '突破', hint: '预期大幅单边或双向波动。' },
  volUp: { label: '升波', hint: '预期隐含波动率上升。' },
  volDown: { label: '降波', hint: '预期隐含波动率回落或横盘衰减。' },
  calendar: { label: '跨期', hint: '关注期限结构、近远月 IV 和时间价值差。' },
};

const VIEW_TAG_WEIGHTS: Record<MarketView, Partial<Record<TemplateTag, number>>> = {
  all: {},
  bullish: { bullish: 5, neutral: 1, calendar: 1 },
  bearish: { bearish: 5, neutral: 1, calendar: 1 },
  range: { neutral: 5, calendar: 1 },
  breakout: { trend: 5, bullish: 1, bearish: 1 },
  volUp: { trend: 4, calendar: 3 },
  volDown: { neutral: 4, calendar: 2 },
  calendar: { calendar: 5, neutral: 1, trend: 1 },
};

const TEMPLATES: StrategyTemplate[] = [
  { id: 'custom', nameCn: '自定义策略', nameEn: 'Custom Strategy', tags: [], summary: '从空白组合开始，逐条添加期权或标的腿。', detail: '适合已有明确交易想法时使用。你可以自由组合买入/卖出 Call、Put 与标的。', legs: [] },
  { id: 'long-call', nameCn: '买入看涨期权', nameEn: 'Long Call', tags: ['bullish'], summary: '预期标的将上涨时使用。', detail: '最大亏损为支付的权利金，收益潜力较高，适合方向明确的上涨观点。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'long-put', nameCn: '买入看跌期权', nameEn: 'Long Put', tags: ['bearish'], summary: '预期标的将下跌时使用。', detail: '最大亏损为权利金，收益随标的下跌扩大，也可用于保护持仓。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'covered-call', nameCn: '备兑看涨', nameEn: 'Covered Call', tags: ['bullish', 'neutral'], summary: '持有标的且预期温和上涨或盘整。', detail: '持有标的并卖出虚值 Call，换取权利金收入，但上行收益被封顶。', legs: [{ kind: 'underlying', side: 'buy', qty: 1 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 1, expiryDays: 30 }] },
  { id: 'synthetic-put', nameCn: '合成看跌期权', nameEn: 'Synthetic Put', tags: ['bearish'], summary: '预期下跌，但希望限制上涨风险。', detail: '卖出标的并买入 Call，构造类似 Long Put 的风险收益形态。', legs: [{ kind: 'underlying', side: 'sell', qty: 1 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'short-put', nameCn: '卖出看跌期权', nameEn: 'Short Put', tags: ['bullish', 'neutral'], summary: '预期标的不会大跌或将上涨。', detail: '收取权利金，若跌破行权价承担买入标的风险。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -1, expiryDays: 30 }] },
  { id: 'short-call', nameCn: '卖出看涨期权', nameEn: 'Short Call', tags: ['bearish', 'neutral'], summary: '预期标的不会大涨或将下跌。', detail: '收取权利金，但裸卖 Call 上行风险不封顶，应谨慎使用。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: 1, expiryDays: 30 }] },
  { id: 'bull-call-spread', nameCn: '看涨牛市价差', nameEn: 'Bull Call Spread', tags: ['bullish'], summary: '预期标的温和上涨。', detail: '买入低行权价 Call，卖出高行权价 Call，降低成本并封顶收益。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'bear-call-spread', nameCn: '看涨熊市价差', nameEn: 'Bear Call Spread', tags: ['bearish', 'neutral'], summary: '预期标的温和下跌或持平。', detail: '卖出低行权价 Call，买入高行权价 Call，构造有限风险的贷方价差。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'bull-put-spread', nameCn: '看跌牛市价差', nameEn: 'Bull Put Spread', tags: ['bullish', 'neutral'], summary: '预期标的温和上涨或持平。', detail: '卖出高行权价 Put，买入低行权价 Put，获得权利金并限制下跌风险。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'bear-put-spread', nameCn: '看跌熊市价差', nameEn: 'Bear Put Spread', tags: ['bearish'], summary: '预期标的温和下跌。', detail: '买入高行权价 Put，卖出低行权价 Put，降低成本并封顶收益。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30 }] },
  { id: 'calendar-call', nameCn: '看涨期权日历价差', nameEn: 'Calendar Call Spread', tags: ['neutral', 'calendar'], summary: '预期近期横盘，波动率将上升。', detail: '卖出近月 Call，买入远月 Call，利用时间价值和期限结构差异。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 14 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 60 }] },
  { id: 'calendar-put', nameCn: '看跌期权日历价差', nameEn: 'Calendar Put Spread', tags: ['neutral', 'calendar'], summary: '预期近期横盘，波动率将上升。', detail: '卖出近月 Put，买入远月 Put，适合方向偏中性但看多远期波动。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 14 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 60 }] },
  { id: 'reverse-calendar-call', nameCn: '反向看涨期权日历价差', nameEn: 'Reverse Calendar Call Spread', tags: ['trend', 'calendar'], summary: '预期标的快速大幅波动，波动率下降。', detail: '买入近月 Call，卖出远月 Call，强调近期方向冲击。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 14 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 60 }] },
  { id: 'reverse-calendar-put', nameCn: '反向看跌期权日历价差', nameEn: 'Reverse Calendar Put Spread', tags: ['trend', 'calendar'], summary: '预期标的快速大幅波动，波动率下降。', detail: '买入近月 Put，卖出远月 Put，适合近期强方向观点。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 14 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 60 }] },
  { id: 'diagonal-call', nameCn: '看涨期权对角价差', nameEn: 'Diagonal Call Spread', tags: ['bullish', 'calendar'], summary: '预期温和上涨，适合长期持有看涨头寸。', detail: '买入远月低行权价 Call，卖出近月高行权价 Call，兼顾方向与时间价值。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 60 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 14 }] },
  { id: 'diagonal-put', nameCn: '看跌期权对角价差', nameEn: 'Diagonal Put Spread', tags: ['bearish', 'calendar'], summary: '预期温和下跌，适合长期看跌头寸。', detail: '买入远月高行权价 Put，卖出近月低行权价 Put，降低持仓成本。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 60 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 14 }] },
  { id: 'collar', nameCn: '领口策略', nameEn: 'Collar', tags: ['bullish', 'neutral'], summary: '已持有标的，希望低成本保护下跌风险。', detail: '买入保护 Put，同时卖出虚值 Call 补贴成本，锁定上下边界。', legs: [{ kind: 'underlying', side: 'buy', qty: 1 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'long-straddle', nameCn: '买入跨式期权', nameEn: 'Long Straddle', tags: ['trend'], summary: '预期大幅波动，但方向不确定。', detail: '同时买入同一行权价 Call 和 Put，押注波动扩张。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'long-strangle', nameCn: '买入宽跨式期权', nameEn: 'Long Strangle', tags: ['trend'], summary: '预期大幅波动，但方向不确定。', detail: '买入虚值 Call 与虚值 Put，成本低于跨式，但需要更大波动。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'short-straddle', nameCn: '卖出跨式期权', nameEn: 'Short Straddle', tags: ['neutral'], summary: '预期标的窄幅区间波动。', detail: '同时卖出 ATM Call 和 Put，收取较高权利金，但双向尾部风险较高。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'short-strangle', nameCn: '卖出宽跨式期权', nameEn: 'Short Strangle', tags: ['neutral'], summary: '预期标的在较宽区间内波动。', detail: '卖出虚值 Call 与虚值 Put，胜率较高但极端行情风险明显。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'iron-butterfly', nameCn: '铁蝶式期权', nameEn: 'Iron Butterfly', tags: ['neutral'], summary: '预期标的在狭窄区间波动。', detail: '卖出 ATM 跨式，同时买入两侧保护腿，构造有限风险的震荡策略。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'iron-condor', nameCn: '铁鹰式期权', nameEn: 'Iron Condor', tags: ['neutral'], summary: '预期标的在较宽区间内波动。', detail: '卖出内侧 Put/Call，买入外侧保护腿，风险收益均有限。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: -4, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 4, expiryDays: 30 }] },
  { id: 'short-call-butterfly', nameCn: '反向看涨期权蝶式', nameEn: 'Short Call Butterfly', tags: ['trend'], summary: '预期标的大幅波动。', detail: '卖出两翼、买入中间 Call，押注突破中间区域。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30, qty: 2 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'short-put-butterfly', nameCn: '反向看跌期权蝶式', nameEn: 'Short Put Butterfly', tags: ['trend'], summary: '预期标的大幅波动。', detail: '使用 Put 构建反向蝶式，适合方向不确定但预期突破。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30, qty: 2 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'bull-call-ladder', nameCn: '看涨牛市期权阶梯', nameEn: 'Bull Call Ladder', tags: ['neutral', 'bullish'], summary: '预期温和上涨但不会大涨。', detail: '买入低行权价 Call，卖出两个更高行权价 Call，降低成本但承担上方风险。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 4, expiryDays: 30 }] },
  { id: 'bear-call-ladder', nameCn: '看涨熊市期权阶梯', nameEn: 'Bear Call Ladder', tags: ['trend', 'bearish'], summary: '预期下跌或大涨。', detail: '卖出低行权价 Call，买入两个更高行权价 Call，形成偏双向结构。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 4, expiryDays: 30 }] },
  { id: 'bull-put-ladder', nameCn: '看跌牛市期权阶梯', nameEn: 'Bull Put Ladder', tags: ['trend', 'bullish'], summary: '预期上涨或大跌。', detail: '卖出高行权价 Put，买入两个较低行权价 Put，构造偏双向结构。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: -4, expiryDays: 30 }] },
  { id: 'bear-put-ladder', nameCn: '看跌熊市期权阶梯', nameEn: 'Bear Put Ladder', tags: ['neutral', 'bearish'], summary: '预期温和下跌但不会大跌。', detail: '买入高行权价 Put，卖出两个较低行权价 Put，成本较低但下方风险扩张。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -4, expiryDays: 30 }] },
  { id: 'call-backspread', nameCn: '看涨期权比率反向价差', nameEn: 'Call Ratio Backspread', tags: ['bullish', 'trend'], summary: '预期标的将大幅上涨。', detail: '卖出较低行权价 Call，买入更多较高行权价 Call，追求上行凸性。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 2, expiryDays: 30, qty: 2 }] },
  { id: 'put-backspread', nameCn: '看跌期权比率反向价差', nameEn: 'Put Ratio Backspread', tags: ['bearish', 'trend'], summary: '预期标的将大幅下跌。', detail: '卖出较高行权价 Put，买入更多较低行权价 Put，追求下行凸性。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30, qty: 2 }] },
  { id: 'long-call-condor', nameCn: '看涨期权鹰式价差', nameEn: 'Long Call Condor', tags: ['neutral'], summary: '预期标的在中间区间波动。', detail: '四腿 Call 组合，收益集中在中间区间，风险有限。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: -3, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: -1, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 1, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 3, expiryDays: 30 }] },
  { id: 'short-call-condor', nameCn: '反向看涨期权鹰式', nameEn: 'Short Call Condor', tags: ['trend'], summary: '预期标的突破中间区间。', detail: '反向四腿 Call 结构，押注远离中间区域。', legs: [{ kind: 'option', side: 'sell', type: 'call', strikeOffset: -3, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: -1, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 1, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 3, expiryDays: 30 }] },
  { id: 'long-put-condor', nameCn: '看跌期权鹰式价差', nameEn: 'Long Put Condor', tags: ['neutral'], summary: '预期标的在中间区间波动。', detail: '四腿 Put 组合，收益集中在中间区间。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: -3, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -1, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 1, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 3, expiryDays: 30 }] },
  { id: 'short-put-condor', nameCn: '反向看跌期权鹰式', nameEn: 'Short Put Condor', tags: ['trend'], summary: '预期标的突破中间区间。', detail: '反向四腿 Put 结构，押注远离中间区域。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -3, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: -1, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 1, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 3, expiryDays: 30 }] },
  { id: 'inverse-iron-butterfly', nameCn: '反向铁蝶式', nameEn: 'Inverse Iron Butterfly', tags: ['trend'], summary: '预期标的将大幅波动。', detail: '买入 ATM 跨式，同时卖出两侧保护腿，形成反向铁蝶结构。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30 }] },
  { id: 'inverse-iron-condor', nameCn: '反向铁鹰式', nameEn: 'Inverse Iron Condor', tags: ['trend'], summary: '预期标的将大幅波动。', detail: '买入内侧 Put/Call，卖出外侧腿，押注突破震荡区间。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -4, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: -2, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 2, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 4, expiryDays: 30 }] },
  { id: 'strap', nameCn: '双倍看涨跨式', nameEn: 'Strap', tags: ['trend', 'bullish'], summary: '预期大幅波动，但更可能上涨。', detail: '买入两个 Call 和一个 Put，方向偏上但保留下行波动收益。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30, qty: 2 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'strip', nameCn: '双倍看跌跨式', nameEn: 'Strip', tags: ['trend', 'bearish'], summary: '预期大幅波动，但更可能下跌。', detail: '买入两个 Put 和一个 Call，方向偏下但保留上行波动收益。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30, qty: 2 }] },
  { id: 'synthetic-long-future', nameCn: '合成做多期货', nameEn: 'Long Synthetic Future', tags: ['bullish'], summary: '看好标的但不想直接买入。', detail: '买入 Call、卖出 Put，构造接近多头期货的线性收益。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'synthetic-short-future', nameCn: '合成做空期货', nameEn: 'Short Synthetic Future', tags: ['bearish'], summary: '看空标的但做空不方便或成本高。', detail: '买入 Put、卖出 Call，构造接近空头期货的线性收益。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 0, expiryDays: 30 }] },
  { id: 'long-combo', nameCn: '做多组合', nameEn: 'Long Combo', tags: ['bullish'], summary: '看好标的，类似合成做多但行权价不同。', detail: '买入虚值 Call，卖出虚值 Put，以较低成本表达多头观点。', legs: [{ kind: 'option', side: 'sell', type: 'put', strikeOffset: -1, expiryDays: 30 }, { kind: 'option', side: 'buy', type: 'call', strikeOffset: 1, expiryDays: 30 }] },
  { id: 'short-combo', nameCn: '做空组合', nameEn: 'Short Combo', tags: ['bearish'], summary: '看空标的，类似合成做空但行权价不同。', detail: '买入虚值 Put，卖出虚值 Call，以较低成本表达空头观点。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: -1, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 1, expiryDays: 30 }] },
  { id: 'ratio-call-spread', nameCn: '看涨期权比率价差', nameEn: 'Ratio Call Spread', tags: ['bullish', 'neutral'], summary: '预期温和上涨但不会大涨。', detail: '买入低行权价 Call，卖出更多高行权价 Call，降低成本但上方风险增加。', legs: [{ kind: 'option', side: 'buy', type: 'call', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'call', strikeOffset: 2, expiryDays: 30, qty: 2 }] },
  { id: 'ratio-put-spread', nameCn: '看跌期权比率价差', nameEn: 'Ratio Put Spread', tags: ['bearish', 'neutral'], summary: '预期温和下跌但不会大跌。', detail: '买入高行权价 Put，卖出更多低行权价 Put，降低成本但下方风险增加。', legs: [{ kind: 'option', side: 'buy', type: 'put', strikeOffset: 0, expiryDays: 30 }, { kind: 'option', side: 'sell', type: 'put', strikeOffset: -2, expiryDays: 30, qty: 2 }] },
  { id: 'long-stock', nameCn: '买入标的', nameEn: 'Long Stock', tags: ['bullish'], summary: '看好标的长期或短期表现。', detail: '直接买入标的，线性承担涨跌风险。', legs: [{ kind: 'underlying', side: 'buy', qty: 1 }] },
  { id: 'short-stock', nameCn: '卖出标的', nameEn: 'Short Stock', tags: ['bearish'], summary: '看空标的，预期下跌。', detail: '直接做空标的，线性承担涨跌风险。', legs: [{ kind: 'underlying', side: 'sell', qty: 1 }] },
  { id: 'empty', nameCn: '空策略', nameEn: 'Empty Strategy', tags: [], summary: '清空当前组合并从头开始。', detail: '用于重置构建器状态。', legs: [] },
];

const INPUT_CLS = 'h-8 bg-[#2B2D35] rounded-[6px] px-2 text-[12px] text-white/85 outline-none focus:bg-[#3A3B40] transition-colors w-full';
const SELECT_CLS = 'h-8 bg-[#2B2D35] rounded-[6px] px-2 text-[12px] text-white/85 outline-none focus:bg-[#3A3B40] transition-colors cursor-pointer w-full';

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function years(days: number) {
  return Math.max(0, days) / 365;
}

function optionPrice(S: number, K: number, T: number, iv: number, type: OptionType) {
  return type === 'call' ? bsCall(S, K, T, iv) : bsPut(S, K, T, iv);
}

function formatMoney(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

function formatAbsMoney(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPrice(value: number | undefined, digits = 2) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatCompact(value: number) {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(0);
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function exposureText(value: number, positive: string, negative: string, flat = '中性') {
  if (Math.abs(value) < 0.12) return flat;
  return value > 0 ? positive : negative;
}

function reviewTone(level: ReviewLevel) {
  if (level === 'danger') return 'bg-[#EF454A]/12 text-[#EF454A]';
  if (level === 'watch') return 'bg-[#FEBC2E]/12 text-[#FEBC2E]';
  return 'bg-[#24AE64]/12 text-[#24AE64]';
}

function legSign(side: LegSide) {
  return side === 'buy' ? 1 : -1;
}

function payoffAt(leg: StrategyLeg, S: number, remainingDays: number, baseIv: number, mode: ValueMode, scenarioIvShift = 0) {
  const sign = legSign(leg.side);
  if (leg.kind === 'underlying') {
    const current = S;
    const value = sign * leg.qty * current;
    const pnl = sign * leg.qty * (current - leg.entry);
    return mode === 'contractValue' ? value : pnl;
  }

  const T = years(remainingDays);
  const scenarioIv = Math.max(5, (leg.iv ?? baseIv) + scenarioIvShift);
  const current = optionPrice(S, leg.strike ?? S, T, scenarioIv, leg.type ?? 'call');
  const value = sign * leg.qty * current;
  const pnl = sign * leg.qty * (current - leg.entry);
  return mode === 'contractValue' ? value : pnl;
}

function buildChain(market: MarketPreset, spot: number, expiryDays: number, ivShift: number): OptionContract[] {
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

function parseDeribitInstrument(name: string): null | { strike: number; type: OptionType; expiryTs: number; expiryLabel: string; days: number } {
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

function deribitSummaryToContract(row: DeribitBookSummary): OptionContract | null {
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

function findContract(contracts: OptionContract[], strike: number | undefined, type: OptionType | undefined, expiryDays: number, expiryTs?: number) {
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

function priceLegFromContract(leg: StrategyLeg, contract: OptionContract | null, spot: number, fallbackIv: number): StrategyLeg {
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

function makeLegFromContract(contract: OptionContract, side: LegSide): StrategyLeg {
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

function Panel({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('bg-[#17181E] rounded-[8px] overflow-hidden min-h-0', className)}>
      {(title || action) && (
        <div className="h-10 px-3 flex items-center justify-between border-b border-white/[0.06]">
          <div className="text-[13px] font-semibold text-white/75">{title}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function MiniPayoff({ template, market }: { template: StrategyTemplate; market: MarketPreset }) {
  const points = useMemo(() => {
    if (template.legs.length === 0) return [];
    const baseLegs = instantiateTemplate(template, market, market.spot, market.iv);
    const xs = Array.from({ length: 28 }, (_, i) => market.spot * (0.84 + i * 0.012));
    return xs.map(S => baseLegs.reduce((sum, leg) => sum + payoffAt(leg, S, 0, market.iv, 'pnl'), 0));
  }, [market, template]);

  if (points.length === 0) {
    return <div className="h-10 rounded-[6px] bg-[#2B2D35]" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((p, index) => {
    const x = 2 + index * (92 / (points.length - 1));
    const y = 38 - ((p - min) / span) * 34;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const zeroY = 38 - ((0 - min) / span) * 34;

  return (
    <svg className="h-11 w-full" viewBox="0 0 98 42" aria-hidden="true">
      <line x1="2" x2="96" y1={Math.max(4, Math.min(38, zeroY))} y2={Math.max(4, Math.min(38, zeroY))} stroke="rgba(255,255,255,.18)" strokeWidth="1" />
      <path d={path} fill="none" stroke="var(--nexus-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function instantiateTemplate(template: StrategyTemplate, market: MarketPreset, spot: number, iv: number, contracts: OptionContract[] = []): StrategyLeg[] {
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

function rankTemplateForView(template: StrategyTemplate, view: MarketView): RankedTemplate {
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

function fitTone(fit: RankedTemplate['fit']) {
  if (fit === 'best') return 'bg-[#ff9c2e]/12 text-[#ff9c2e]';
  if (fit === 'ok') return 'bg-[#24AE64]/12 text-[#24AE64]';
  return 'bg-[#FEBC2E]/12 text-[#FEBC2E]';
}

function fitLabel(fit: RankedTemplate['fit']) {
  if (fit === 'best') return '推荐';
  if (fit === 'ok') return '可用';
  return '谨慎';
}

export function StrategyBuilder() {
  const [marketSymbol, setMarketSymbol] = useState('BTC');
  const market = useMemo(() => MARKETS.find(item => item.symbol === marketSymbol) ?? MARKETS[0], [marketSymbol]);
  const [spot, setSpot] = useState(market.spot);
  const [iv, setIv] = useState(market.iv);
  const [selectedExpiry, setSelectedExpiry] = useState(30);
  const [contracts, setContracts] = useState<OptionContract[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [marketView, setMarketView] = useState<MarketView>('all');
  const [expandedTemplateId, setExpandedTemplateId] = useState('long-call');
  const [selectedTemplateId, setSelectedTemplateId] = useState('long-call');
  const [legs, setLegs] = useState<StrategyLeg[]>(() => instantiateTemplate(TEMPLATES[1], MARKETS[0], MARKETS[0].spot, MARKETS[0].iv));
  const [ivShift, setIvShift] = useState(0);
  const [rangePct, setRangePct] = useState(8);
  const [viewMode, setViewMode] = useState<ViewMode>('curve');
  const [valueMode, setValueMode] = useState<ValueMode>('pnl');
  const [addOpen, setAddOpen] = useState(false);
  const [dragLegId, setDragLegId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [analysisDayRatio, setAnalysisDayRatio] = useState(0.5);
  const chainLoadedSymbolRef = useRef<string | null>(null);

  const activeTemplate = useMemo(() => TEMPLATES.find(item => item.id === selectedTemplateId) ?? TEMPLATES[1], [selectedTemplateId]);
  const rankedTemplates = useMemo(() => {
    return TEMPLATES
      .map(template => rankTemplateForView(template, marketView))
      .filter(item => marketView === 'all' || item.fit !== 'weak' || item.template.id === selectedTemplateId)
      .sort((a, b) => b.score - a.score || a.template.legs.length - b.template.legs.length || a.template.nameCn.localeCompare(b.template.nameCn));
  }, [marketView, selectedTemplateId]);
  const weakTemplateCount = useMemo(() => (
    TEMPLATES.map(template => rankTemplateForView(template, marketView)).filter(item => item.fit === 'weak').length
  ), [marketView]);

  useEffect(() => {
    let cancelled = false;

    async function loadChain() {
      setChainLoading(true);
      setChainError(null);
      try {
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${marketSymbol}&kind=option`);
        const json = await res.json();
        const parsed = ((json.result ?? []) as DeribitBookSummary[])
          .map(deribitSummaryToContract)
          .filter((item): item is OptionContract => Boolean(item))
          .filter(item => item.days > 0)
          .sort((a, b) => a.expiryTs - b.expiryTs || a.strike - b.strike);

        if (cancelled) return;
        setContracts(parsed);

        if (parsed.length > 0) {
          const underlying = parsed.find(item => Number.isFinite(item.underlyingPrice))?.underlyingPrice;
          if (underlying) setSpot(underlying);

          const uniqueExpiries = Array.from(new Map(parsed.map(item => [item.expiryTs, item])).values())
            .sort((a, b) => a.expiryTs - b.expiryTs);
          const target = uniqueExpiries.reduce((best, item) =>
            Math.abs(item.days - 30) < Math.abs(best.days - 30) ? item : best,
            uniqueExpiries[0],
          );
          setSelectedExpiry(target.days);

          const atm = parsed
            .filter(item => item.expiryTs === target.expiryTs)
            .reduce((best, item) =>
              Math.abs(item.strike - (underlying ?? market.spot)) < Math.abs(best.strike - (underlying ?? market.spot)) ? item : best,
            );
          setIv(atm.iv || market.iv);

          if (chainLoadedSymbolRef.current !== marketSymbol) {
            const currentTemplate = TEMPLATES.find(item => item.id === selectedTemplateId) ?? TEMPLATES[1];
            setLegs(instantiateTemplate(currentTemplate, market, underlying ?? market.spot, atm.iv || market.iv, parsed));
            chainLoadedSymbolRef.current = marketSymbol;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setContracts([]);
          setChainError(error instanceof Error ? error.message : '期权链加载失败');
        }
      } finally {
        if (!cancelled) setChainLoading(false);
      }
    }

    loadChain();
    return () => { cancelled = true; };
  }, [market.spot, market.iv, marketSymbol]);

  const expiryChoices = useMemo(() => {
    const real = Array.from(new Map<number, OptionContract>(contracts.map(item => [item.expiryTs, item])).values())
      .sort((a, b) => a.expiryTs - b.expiryTs)
      .slice(0, 8)
      .map(item => ({ label: item.expiryLabel, days: item.days, expiryTs: item.expiryTs }));
    return real.length > 0 ? real : EXPIRIES.map(item => ({ ...item, expiryTs: Date.now() + item.days * 86_400_000 }));
  }, [contracts]);

  const selectedExpiryInfo = useMemo(() => {
    return expiryChoices.reduce((best, item) =>
      Math.abs(item.days - selectedExpiry) < Math.abs(best.days - selectedExpiry) ? item : best,
      expiryChoices[0],
    );
  }, [expiryChoices, selectedExpiry]);

  const chain = useMemo(() => {
    const realChain = contracts.filter(item => item.expiryTs === selectedExpiryInfo?.expiryTs);
    return realChain.length > 0 ? realChain : buildChain(market, spot, selectedExpiry, ivShift);
  }, [contracts, ivShift, market, selectedExpiry, selectedExpiryInfo?.expiryTs, spot]);
  const strikes = useMemo(() => Array.from(new Set<number>(chain.map(item => item.strike))).sort((a, b) => a - b), [chain]);
  const maxChainOi = useMemo(() => Math.max(1, ...chain.map(item => item.oi)), [chain]);
  const hasRealChain = chain.some(item => !item.synthetic);
  const visibleChainLabel = selectedExpiryInfo?.label ?? `${selectedExpiry}D`;
  const atmContract = useMemo(() => {
    if (chain.length === 0) return null;
    return chain.reduce((best, item) =>
      Math.abs(item.strike - spot) < Math.abs(best.strike - spot) ? item : best,
      chain[0],
    );
  }, [chain, spot]);

  useEffect(() => {
    if (contracts.length === 0) return;
    setLegs(prev => prev.map(leg => {
      if (leg.kind !== 'option') return { ...leg, entry: spot };
      const contract = findContract(contracts, leg.strike, leg.type, leg.expiryDays, leg.expiryTs);
      return priceLegFromContract(leg, contract, spot, iv);
    }));
  }, [contracts, iv, spot]);

  const analysisIv = Math.max(5, iv + ivShift);
  const maxExpiry = Math.max(selectedExpiry, ...legs.map(leg => leg.expiryDays), 1);
  const spotReference = atmContract?.underlyingPrice ?? market.spot;
  const spotControlMin = roundToStep(spotReference * 0.75, market.step / 5);
  const spotControlMax = roundToStep(spotReference * 1.25, market.step / 5);

  useEffect(() => {
    if (!lastSavedAt) return undefined;
    const timer = window.setTimeout(() => setLastSavedAt(null), 1600);
    return () => window.clearTimeout(timer);
  }, [lastSavedAt]);

  const priceRows = useMemo(() => {
    const rows = 15;
    return Array.from({ length: rows }, (_, index) => {
      const pct = rangePct - (index * 2 * rangePct) / (rows - 1);
      return roundToStep(spot * (1 + pct / 100), market.step / 5);
    });
  }, [market.step, rangePct, spot]);
  const timeColumns = useMemo(() => {
    const points = [0, 0.16, 0.33, 0.5, 0.67, 0.84, 1];
    return points.map(point => Math.round(maxExpiry * point));
  }, [maxExpiry]);
  const chartPrices = useMemo(() => {
    return Array.from({ length: 121 }, (_, index) => spot * (1 - rangePct / 100) + (spot * (2 * rangePct / 100) * index) / 120);
  }, [rangePct, spot]);

  const netPremium = useMemo(() => legs.reduce((sum, leg) => sum + legSign(leg.side) * leg.qty * leg.entry, 0), [legs]);
  const portfolioValue = useMemo(() => legs.reduce((sum, leg) => sum + payoffAt(leg, spot, Math.max(0, leg.expiryDays), iv, 'contractValue', ivShift), 0), [iv, ivShift, legs, spot]);
  const expiryPnl = useMemo(() => chartPrices.map(price => legs.reduce((sum, leg) => sum + payoffAt(leg, price, 0, iv, 'pnl', ivShift), 0)), [chartPrices, iv, ivShift, legs]);
  const currentPnl = useMemo(() => chartPrices.map(price => legs.reduce((sum, leg) => sum + payoffAt(leg, price, leg.expiryDays, iv, 'pnl', ivShift), 0)), [chartPrices, iv, ivShift, legs]);
  const analysisDay = Math.round(maxExpiry * analysisDayRatio);
  const analysisPnl = useMemo(() => chartPrices.map(price => legs.reduce((sum, leg) => {
    const remaining = Math.max(0, leg.expiryDays - analysisDay);
    return sum + payoffAt(leg, price, remaining, iv, 'pnl', ivShift);
  }, 0)), [analysisDay, chartPrices, iv, ivShift, legs]);
  const maxProfit = useMemo(() => expiryPnl.length ? Math.max(...expiryPnl) : 0, [expiryPnl]);
  const maxLoss = useMemo(() => expiryPnl.length ? Math.min(...expiryPnl) : 0, [expiryPnl]);
  const breakeven = useMemo(() => {
    const values: number[] = [];
    for (let i = 1; i < chartPrices.length; i += 1) {
      const prev = expiryPnl[i - 1];
      const next = expiryPnl[i];
      if (prev === 0 || prev * next < 0) {
        const x = chartPrices[i - 1] + (chartPrices[i] - chartPrices[i - 1]) * (-prev / (next - prev || 1));
        values.push(x);
      }
    }
    return values;
  }, [chartPrices, expiryPnl]);

  const greeks = useMemo(() => {
    return legs.reduce((acc, leg) => {
      const scale = legSign(leg.side) * leg.qty;
      if (leg.kind === 'underlying') {
        acc.delta += scale;
        return acc;
      }
      const K = leg.strike ?? spot;
      const T = years(leg.expiryDays);
      const type = leg.type === 'put' ? 'P' : 'C';
      const legIv = Math.max(5, (leg.iv ?? iv) + ivShift);
      acc.delta += scale * bsDelta(spot, K, T, legIv, type);
      acc.gamma += scale * bsGamma(spot, K, T, legIv);
      acc.vega += scale * bsVega(spot, K, T, legIv);
      acc.theta += scale * bsTheta(spot, K, T, legIv);
      return acc;
    }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
  }, [iv, ivShift, legs, spot]);

  const optionLegs = useMemo(() => legs.filter(leg => leg.kind === 'option'), [legs]);
  const nearestBreakeven = useMemo(() => {
    if (breakeven.length === 0) return null;
    return breakeven.reduce((best, value) => (
      Math.abs(value - spot) < Math.abs(best - spot) ? value : best
    ), breakeven[0]);
  }, [breakeven, spot]);
  const nearestBreakevenPct = nearestBreakeven ? ((nearestBreakeven / spot) - 1) * 100 : null;
  const hasCalendarStructure = useMemo(() => {
    const expiries = new Set(optionLegs.map(leg => leg.expiryTs ?? leg.expiryDays));
    return expiries.size > 1;
  }, [optionLegs]);
  const nakedShortCall = useMemo(() => {
    const shortCallQty = optionLegs
      .filter(leg => leg.side === 'sell' && leg.type === 'call')
      .reduce((sum, leg) => sum + leg.qty, 0);
    const longCallQty = optionLegs
      .filter(leg => leg.side === 'buy' && leg.type === 'call')
      .reduce((sum, leg) => sum + leg.qty, 0);
    const longUnderlyingQty = legs
      .filter(leg => leg.kind === 'underlying' && leg.side === 'buy')
      .reduce((sum, leg) => sum + leg.qty, 0);
    return shortCallQty > longCallQty + longUnderlyingQty;
  }, [legs, optionLegs]);
  const nakedShortPut = useMemo(() => {
    return optionLegs.some(leg => (
      leg.side === 'sell'
      && leg.type === 'put'
      && !optionLegs.some(peer => peer.side === 'buy' && peer.type === 'put' && (peer.strike ?? 0) < (leg.strike ?? 0))
    ));
  }, [optionLegs]);
  const directionLabel = exposureText(greeks.delta, '看涨', '看跌');
  const volatilityLabel = exposureText(greeks.vega, '做多波动', '做空波动', '波动中性');
  const carryLabel = exposureText(greeks.theta, '收时间价值', '付时间价值', '时间中性');
  const upsideSlope = useMemo(() => legs.reduce((sum, leg) => {
    if (leg.kind === 'underlying') return sum + legSign(leg.side) * leg.qty;
    if (leg.type === 'call') return sum + legSign(leg.side) * leg.qty;
    return sum;
  }, 0), [legs]);
  const profitBoundLabel = upsideSlope > 0.01 ? '上行潜力大' : '有限';
  const lossBoundLabel = upsideSlope < -0.01 || nakedShortPut ? '尾部亏损大' : '有限';
  const strategyHeadline = `${market.symbol} ${visibleChainLabel} · ${activeTemplate.nameCn} · ${directionLabel} · ${volatilityLabel}`;

  const reviewItems = useMemo<ReviewItem[]>(() => {
    if (legs.length === 0) {
      return [{ level: 'watch', title: '还没有组合腿', detail: '先选择模板或添加合约，审查面板会自动生成风险结论。' }];
    }

    const items: ReviewItem[] = [];
    if (nakedShortCall) {
      items.push({ level: 'danger', title: '存在裸卖 Call 风险', detail: '上方价格快速突破时亏损可能不封顶，需要保护腿或明确止损。' });
    }
    if (nakedShortPut) {
      items.push({ level: 'danger', title: '存在裸卖 Put 风险', detail: '下跌尾部风险较重，建议检查保证金、最大亏损和保护 Put。' });
    }
    if (maxLoss < -Math.max(spot * 0.18, Math.abs(netPremium) * 3)) {
      items.push({ level: 'watch', title: '最大亏损偏大', detail: `到期曲线最低约 -${formatAbsMoney(maxLoss, 0)}，需要确认这不是超出账户承受范围的仓位。` });
    }
    if (nearestBreakevenPct !== null && Math.abs(nearestBreakevenPct) > rangePct * 0.7) {
      items.push({ level: 'watch', title: '盈亏平衡离现价较远', detail: `最近盈亏平衡在 ${formatCompact(nearestBreakeven ?? spot)}，距离现价 ${formatSignedPercent(nearestBreakevenPct)}。` });
    }
    if (Math.abs(greeks.delta) > 1.5) {
      items.push({ level: 'watch', title: '方向暴露较重', detail: `组合 Delta 为 ${formatMoney(greeks.delta, 2)}，更像方向仓而不是中性策略。` });
    }
    if (hasCalendarStructure) {
      items.push({ level: 'ok', title: '跨期限结构', detail: '组合含不同到期日，重点观察期限结构、近月衰减和远月 IV 变化。' });
    }
    if (Math.abs(greeks.vega) > 18 && Math.sign(greeks.vega) !== Math.sign(ivShift || greeks.vega)) {
      items.push({ level: 'watch', title: '波动率情景要复核', detail: '组合 Vega 较明显，右侧 IV 偏移会显著改变中途盈亏。' });
    }
    if (items.length === 0) {
      items.push({ level: 'ok', title: '结构风险清晰', detail: '当前组合没有明显裸卖或异常暴露，继续检查入场价和目标行情即可。' });
    }
    return items.slice(0, 4);
  }, [greeks.delta, greeks.vega, hasCalendarStructure, legs.length, maxLoss, nakedShortCall, nakedShortPut, nearestBreakeven, nearestBreakevenPct, netPremium, rangePct, spot, ivShift]);

  const tradePlan = useMemo(() => {
    const premiumLabel = netPremium <= 0
      ? `净收入 ${formatAbsMoney(netPremium, 2)}`
      : `净支出 ${formatAbsMoney(netPremium, 2)}`;
    const beLabel = breakeven.length
      ? breakeven.map(value => formatCompact(value)).join(' / ')
      : '暂无明确盈亏平衡';
    return [
      ['入场检查', `${premiumLabel}，使用 ${hasRealChain ? 'Deribit Bid/Ask' : '合成报价'} 估算成交。`],
      ['有效行情', `${directionLabel}，${volatilityLabel}，${carryLabel}。`],
      ['关键价位', `现价 ${formatCompact(spot)}，盈亏平衡 ${beLabel}。`],
      ['风控边界', `${lossBoundLabel} -${formatAbsMoney(maxLoss, 0)}，${profitBoundLabel} ${formatMoney(maxProfit, 0)}。`],
    ];
  }, [breakeven, carryLabel, directionLabel, hasRealChain, lossBoundLabel, maxLoss, maxProfit, netPremium, profitBoundLabel, spot, volatilityLabel]);

  const tableData = useMemo(() => {
    return priceRows.map(price => {
      return timeColumns.map(elapsed => {
        const raw = legs.reduce((sum, leg) => {
          const remaining = Math.max(0, leg.expiryDays - elapsed);
          return sum + payoffAt(leg, price, remaining, iv, valueMode, ivShift);
        }, 0);
        return valueMode === 'pnlPercent' ? (Math.abs(netPremium) > 0 ? raw / Math.abs(netPremium) * 100 : 0) : raw;
      });
    });
  }, [iv, ivShift, legs, netPremium, priceRows, timeColumns, valueMode]);
  const tableAbsMax = useMemo(() => Math.max(1, ...tableData.flat().map(value => Math.abs(value))), [tableData]);
  const chainRows = useMemo(() => {
    return strikes.map(strike => {
      const call = chain.find(item => item.strike === strike && item.type === 'call') ?? null;
      const put = chain.find(item => item.strike === strike && item.type === 'put') ?? null;
      return {
        strike,
        call,
        put,
        callSpread: call ? Math.max(0, call.ask - call.bid) : 0,
        putSpread: put ? Math.max(0, put.ask - put.bid) : 0,
        oi: (call?.oi ?? 0) + (put?.oi ?? 0),
        isAtm: Math.abs(strike - spot) <= market.step / 2,
        inStrategy: legs.some(leg => leg.kind === 'option' && leg.strike === strike && leg.expiryTs === selectedExpiryInfo?.expiryTs),
      };
    });
  }, [chain, legs, market.step, selectedExpiryInfo?.expiryTs, spot, strikes]);
  const legChainByExpiry = useMemo(() => {
    return expiryChoices.reduce<Record<number, OptionContract[]>>((acc, expiry) => {
      const byExpiry = contracts.filter(item => item.expiryTs === expiry.expiryTs);
      acc[expiry.expiryTs] = byExpiry.length > 0 ? byExpiry : buildChain(market, spot, expiry.days, ivShift);
      return acc;
    }, {});
  }, [contracts, expiryChoices, ivShift, market, spot]);

  const curveOption = useMemo(() => ({
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 58, right: 18, top: 20, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(11,15,23,0.94)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#fff', fontSize: 11 },
    },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#404347' } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#404347' } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
    },
    series: [
      {
        name: '当前',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: '#ff9c2e', width: 2 },
        data: chartPrices.map((price, index) => [price, currentPnl[index]]),
      },
      {
        name: '到期',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: '#24AE64', width: 2 },
        data: chartPrices.map((price, index) => [price, expiryPnl[index]]),
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          data: [{ xAxis: spot, lineStyle: { color: 'rgba(255,255,255,.35)', type: 'dotted' }, label: { show: false } }],
        },
      },
      {
        name: `T+${analysisDay}D`,
        type: 'line',
        symbol: 'none',
        lineStyle: { color: 'rgba(255,255,255,.62)', width: 1.5, type: 'dashed' },
        data: chartPrices.map((price, index) => [price, analysisPnl[index]]),
      },
      {
        name: '盈亏平衡',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 9,
        itemStyle: { color: '#24AE64' },
        data: breakeven.map(price => [price, 0]),
      },
    ],
  }), [analysisDay, analysisPnl, breakeven, chartPrices, currentPnl, expiryPnl, spot]);

  function applyTemplate(template: StrategyTemplate) {
    setSelectedTemplateId(template.id);
    setExpandedTemplateId(template.id);
    setLegs(instantiateTemplate(template, market, spot, iv, contracts));
  }

  function changeMarket(nextSymbol: string) {
    const next = MARKETS.find(item => item.symbol === nextSymbol) ?? MARKETS[0];
    setMarketSymbol(next.symbol);
    setSpot(next.spot);
    setIv(next.iv);
    setSelectedExpiry(30);
    setContracts([]);
    chainLoadedSymbolRef.current = null;
    const template = TEMPLATES.find(item => item.id === selectedTemplateId) ?? TEMPLATES[1];
    setLegs(instantiateTemplate(template, next, next.spot, next.iv));
  }

  function addLeg(kind: LegKind, side: LegSide, type?: OptionType) {
    if (kind === 'underlying') {
      setLegs(prev => [...prev, {
        id: `leg-${Date.now()}`,
        kind,
        side,
        qty: 1,
        expiryDays: 0,
        entry: spot,
      }]);
    } else {
      const selectedChain = chain.length > 0 ? chain : buildChain(market, spot, selectedExpiry, ivShift);
      const strike = selectedChain.reduce((best, contract) =>
        Math.abs(contract.strike - spot) < Math.abs(best.strike - spot) ? contract : best,
        selectedChain[0],
      )?.strike ?? roundToStep(spot, market.step);
      const baseLeg: StrategyLeg = {
        id: `leg-${Date.now()}`,
        kind,
        side,
        type,
        strike,
        expiryDays: selectedExpiry,
        expiryTs: selectedExpiryInfo?.expiryTs,
        qty: 1,
        entry: optionPrice(spot, strike, years(selectedExpiry), iv, type ?? 'call'),
      };
      setLegs(prev => [...prev, priceLegFromContract(baseLeg, findContract(selectedChain, strike, type, selectedExpiry, selectedExpiryInfo?.expiryTs), spot, iv)]);
    }
    setAddOpen(false);
  }

  function addContractLeg(contract: OptionContract, side: LegSide) {
    setSelectedTemplateId('custom');
    setExpandedTemplateId('custom');
    setLegs(prev => [...prev, makeLegFromContract(contract, side)]);
    setAddOpen(false);
  }

  function updateLeg(id: string, patch: Partial<StrategyLeg>) {
    setLegs(prev => prev.map(leg => {
      if (leg.id !== id) return leg;
      const next = { ...leg, ...patch };
      if (next.kind === 'option') {
        const expiry = expiryChoices.find(item => item.days === next.expiryDays)
          ?? expiryChoices.find(item => item.expiryTs === next.expiryTs)
          ?? selectedExpiryInfo;
        const candidateChain = expiry?.expiryTs ? (legChainByExpiry[expiry.expiryTs] ?? chain) : chain;
        const contract = findContract(candidateChain, next.strike, next.type, next.expiryDays, expiry?.expiryTs);
        return priceLegFromContract(next, contract, spot, iv);
      } else {
        next.entry = spot;
      }
      return next;
    }));
  }

  function moveLegToStrike(id: string, strike: number) {
    updateLeg(id, { strike });
  }

  function saveTrade() {
    const payload = {
      market: market.symbol,
      spot,
      iv: analysisIv,
      template: selectedTemplateId,
      headline: strategyHeadline,
      reviewItems,
      tradePlan,
      metrics: { netPremium, maxProfit, maxLoss, breakeven, greeks },
      legs,
      savedAt: Date.now(),
    };
    const existing = JSON.parse(localStorage.getItem('strategy_builder_trades') || '[]') as unknown[];
    localStorage.setItem('strategy_builder_trades', JSON.stringify([payload, ...existing].slice(0, 20)));
    setLastSavedAt(payload.savedAt);
  }

  return (
    <div className="strategy-builder-page position-builder-page absolute inset-0 flex bg-black text-white font-medium">
      <aside className="strategy-builder-sidebar w-[320px] shrink-0 border-r border-white/[0.08] bg-[#101014] flex flex-col min-h-0">
        <div className="h-12 px-3 flex items-center justify-between border-b border-white/[0.08]">
          <div>
            <div className="text-[14px] font-semibold text-white/85">策略推荐</div>
            <div className="text-[11px] text-white/45">{VIEW_LABELS[marketView].label} · {rankedTemplates.length} 个候选</div>
          </div>
          <span className="rounded-[4px] bg-[#ff9c2e]/12 px-2 py-1 text-[11px] text-[#ff9c2e]">Decision</span>
        </div>

        <div className="p-3 border-b border-white/[0.08]">
          <div className="grid grid-cols-4 gap-1.5">
            {(['all', 'bullish', 'bearish', 'range', 'breakout', 'volUp', 'volDown', 'calendar'] as MarketView[]).map(view => (
              <button
                key={view}
                onClick={() => setMarketView(view)}
                className={cn(
                  'h-8 rounded-[6px] text-[12px] transition-colors',
                  marketView === view ? 'bg-[#3A3F40] text-[#ff9c2e]' : 'bg-[#2B2D35] text-white/65 hover:bg-[#3A3B40] hover:text-white/85',
                )}
              >
                {VIEW_LABELS[view].label}
              </button>
            ))}
          </div>
          <div className="mt-2 rounded-[6px] bg-[#17181E] px-2 py-2">
            <div className="text-[11px] leading-4 text-white/48">{VIEW_LABELS[marketView].hint}</div>
            {marketView !== 'all' && <div className="mt-1 text-[10px] text-white/30">{weakTemplateCount} 个低匹配策略已降权隐藏</div>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
          {rankedTemplates.map(({ template, fit, reason }) => {
            const selected = template.id === selectedTemplateId;
            const expanded = template.id === expandedTemplateId;
            return (
              <article
                key={template.id}
                className={cn(
                  'rounded-[8px] bg-[#17181E] border transition-colors overflow-hidden',
                  selected ? 'border-[#ff9c2e]/45' : 'border-transparent hover:border-white/[0.08]',
                )}
              >
                <button onClick={() => applyTemplate(template)} className="w-full text-left p-3">
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[14px] font-semibold text-white/88 truncate">{template.nameCn}</h3>
                        {selected && <span className="rounded-[4px] bg-[#ff9c2e]/12 px-1.5 py-0.5 text-[10px] text-[#ff9c2e]">当前</span>}
                        {!selected && <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold', fitTone(fit))}>{fitLabel(fit)}</span>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-white/45">{template.nameEn}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {template.tags.map(tag => (
                          <span key={tag} className="rounded-[4px] bg-[#2B2D35] px-1.5 py-0.5 text-[10px] text-white/55">{TAG_LABELS[tag]}</span>
                        ))}
                      </div>
                    </div>
                    <div className="hidden w-[96px] shrink-0 min-[1120px]:block">
                      <MiniPayoff template={template} market={market} />
                    </div>
                  </div>
                  <div className="mt-2 rounded-[6px] bg-[#2B2D35] px-2 py-1.5 text-[11px] leading-4 text-white/55">{reason}</div>
                  <p className="mt-2 text-[12px] leading-5 text-white/58">{expanded ? template.detail : template.summary}</p>
                </button>
                <div className="px-3 pb-3 flex items-center justify-between">
                  <button
                    onClick={() => setExpandedTemplateId(expanded ? '' : template.id)}
                    className="text-[11px] text-white/45 hover:text-white/75"
                  >
                    {expanded ? '收起' : '展开'}
                  </button>
                  <span className="text-[11px] text-white/35">{template.legs.length || 0} 腿</span>
                </div>
              </article>
            );
          })}
        </div>
      </aside>

      <main className="strategy-builder-main min-w-0 flex-1 flex flex-col">
        <header className="h-[104px] shrink-0 border-b border-white/[0.08] bg-[#17181E]">
          <div className="h-14 px-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[24px] font-semibold tnum">{spot.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                <div className={cn('text-[12px]', contracts.length > 0 ? 'text-[#24AE64]' : chainError ? 'text-[#FEBC2E]' : 'text-white/45')}>
                  {chainLoading
                    ? '加载 Deribit 期权链…'
                    : contracts.length > 0
                      ? `${hasRealChain ? 'Deribit 实盘链' : '合成期限'} · ${contracts.length} 合约`
                      : chainError
                        ? 'Deribit 不可用 · 模拟兜底'
                        : '模拟兜底'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select value={marketSymbol} onChange={event => changeMarket(event.target.value)} className={cn(SELECT_CLS, '!w-32')}>
                  {MARKETS.map(item => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.label}</option>)}
                  </select>
                <input
                  value={spot}
                  type="number"
                  onChange={event => setSpot(Number(event.target.value) || market.spot)}
                  className={cn(INPUT_CLS, '!w-28')}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden xl:grid grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-black">
                <div className="bg-[#2B2D35] px-3 py-1.5">
                  <div className="text-[10px] text-white/38">当前期限</div>
                  <div className="tnum text-[12px] font-semibold text-white/78">{visibleChainLabel}</div>
                </div>
                <div className="bg-[#2B2D35] px-3 py-1.5">
                  <div className="text-[10px] text-white/38">ATM IV</div>
                  <div className="tnum text-[12px] font-semibold text-white/78">{atmContract ? `${atmContract.iv.toFixed(1)}%` : `${iv.toFixed(1)}%`}</div>
                </div>
                <div className="bg-[#2B2D35] px-3 py-1.5">
                  <div className="text-[10px] text-white/38">Open Interest</div>
                  <div className="tnum text-[12px] font-semibold text-white/78">{formatCompact(chain.reduce((sum, item) => sum + item.oi, 0))}</div>
                </div>
              </div>
              <div className="relative">
                <button onClick={() => setAddOpen(open => !open)} className="h-8 whitespace-nowrap rounded-[6px] bg-[#2B2D35] px-3 text-[12px] text-white/80 hover:bg-[#3A3B40]">
                  + 添加合约
                </button>
                {addOpen && (
                  <div className="absolute right-0 top-10 z-20 w-[560px] max-w-[calc(100vw-380px)] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[rgba(21,23,25,.96)] shadow-[0_8px_25px_rgba(0,0,0,.4)] backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2">
                      <div>
                        <div className="text-[12px] font-semibold text-white/78">添加合约</div>
                        <div className="text-[10px] text-white/38">{visibleChainLabel} · {hasRealChain ? 'Deribit' : '合成报价'} · Bid 卖出 / Ask 买入</div>
                      </div>
                      <button onClick={() => setAddOpen(false)} className="h-6 w-6 rounded-[4px] text-white/45 hover:bg-white/[0.08] hover:text-white/75">×</button>
                    </div>
                    <div className="grid grid-cols-[132px_1fr] min-h-[300px]">
                      <div className="border-r border-white/[0.08] p-2">
                        <div className="px-1 pb-1.5 text-[11px] text-white/40">快捷添加</div>
                        {[
                          ['buy', 'call', '买入 看涨'],
                          ['sell', 'call', '卖出 看涨'],
                          ['buy', 'put', '买入 看跌'],
                          ['sell', 'put', '卖出 看跌'],
                        ].map(([side, type, label]) => (
                          <button key={`${side}-${type}`} onClick={() => addLeg('option', side as LegSide, type as OptionType)} className="mb-1 w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] text-white/70 hover:bg-white/[0.08]">
                            {label}
                          </button>
                        ))}
                        <div className="mt-2 border-t border-white/[0.08] px-1 py-1.5 text-[11px] text-white/40">标的</div>
                        <button onClick={() => addLeg('underlying', 'buy')} className="mb-1 w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] text-white/70 hover:bg-white/[0.08]">买入 标的</button>
                        <button onClick={() => addLeg('underlying', 'sell')} className="w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] text-white/70 hover:bg-white/[0.08]">卖出 标的</button>
                      </div>
                      <div className="max-h-[340px] overflow-auto p-2">
                        <table className="w-full min-w-[390px] border-separate border-spacing-0 text-center text-[12px]">
                          <thead className="sticky top-0 z-10 bg-[rgba(21,23,25,.98)]">
                            <tr>
                              <th className="px-2 py-1.5 text-right text-[11px] font-medium text-[#24AE64]/75">C Bid</th>
                              <th className="px-2 py-1.5 text-right text-[11px] font-medium text-[#EF454A]/75">C Ask</th>
                              <th className="px-2 py-1.5 text-center text-[11px] font-semibold text-white/62">Strike</th>
                              <th className="px-2 py-1.5 text-left text-[11px] font-medium text-[#EF454A]/75">P Ask</th>
                              <th className="px-2 py-1.5 text-left text-[11px] font-medium text-[#24AE64]/75">P Bid</th>
                            </tr>
                          </thead>
                          <tbody>
                            {chainRows.map(row => (
                              <tr key={row.strike} className={cn(row.isAtm && 'bg-[#3A3F40]/55', row.inStrategy && !row.isAtm && 'bg-[#ff9c2e]/[0.06]')}>
                                <td className="border-t border-white/[0.04] px-1 py-1 text-right">
                                  {row.call ? <button onClick={() => addContractLeg(row.call!, 'sell')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-right tnum text-[#24AE64] hover:bg-[#3A3B40]">{formatPrice(row.call.bid, 2)}</button> : <span className="text-white/20">—</span>}
                                </td>
                                <td className="border-t border-white/[0.04] px-1 py-1 text-right">
                                  {row.call ? <button onClick={() => addContractLeg(row.call!, 'buy')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-right tnum text-[#EF454A] hover:bg-[#3A3B40]">{formatPrice(row.call.ask, 2)}</button> : <span className="text-white/20">—</span>}
                                </td>
                                <td className={cn('border-t border-white/[0.04] px-2 py-1.5 text-center tnum font-semibold', row.isAtm ? 'text-[#ff9c2e]' : row.inStrategy ? 'text-white/90' : 'text-white/72')}>{row.strike.toLocaleString()}</td>
                                <td className="border-t border-white/[0.04] px-1 py-1 text-left">
                                  {row.put ? <button onClick={() => addContractLeg(row.put!, 'buy')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-left tnum text-[#EF454A] hover:bg-[#3A3B40]">{formatPrice(row.put.ask, 2)}</button> : <span className="text-white/20">—</span>}
                                </td>
                                <td className="border-t border-white/[0.04] px-1 py-1 text-left">
                                  {row.put ? <button onClick={() => addContractLeg(row.put!, 'sell')} className="h-6 min-w-14 rounded-[4px] px-1.5 text-left tnum text-[#24AE64] hover:bg-[#3A3B40]">{formatPrice(row.put.bid, 2)}</button> : <span className="text-white/20">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={saveTrade} disabled={legs.length === 0} className="h-8 whitespace-nowrap rounded-[6px] bg-[#ff9c2e] px-3 text-[12px] font-semibold text-black hover:bg-[#ffad45] disabled:opacity-35">
                {lastSavedAt ? '已保存' : '保存交易'}
              </button>
            </div>
          </div>

          <div className="h-[50px] px-5 flex items-center gap-2">
            {expiryChoices.map(expiry => (
              <button
                key={expiry.expiryTs}
                onClick={() => setSelectedExpiry(expiry.days)}
                className={cn(
                  'h-9 min-w-16 rounded-[6px] px-3 text-[12px] transition-colors',
                  selectedExpiryInfo?.expiryTs === expiry.expiryTs ? 'bg-[#3A3F40] text-[#ff9c2e]' : 'bg-[#2B2D35] text-white/62 hover:bg-[#3A3B40]',
                )}
              >
                <div className="font-semibold">{expiry.label}</div>
                <div className="text-[10px] opacity-70">{expiry.days}天</div>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-white/55">
                IV
                <input type="number" value={iv} onChange={event => setIv(Number(event.target.value) || market.iv)} className={cn(INPUT_CLS, '!w-16 text-center')} />
              </label>
              <span className="text-[12px] text-white/38">模板：{activeTemplate.nameCn}</span>
            </div>
          </div>
        </header>

        <section className="shrink-0 border-b border-white/[0.08] bg-black px-5 py-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] text-white/55">行权价</div>
            <div className="text-[11px] text-white/35">拖动组合腿或点击行权价轴调整 Strike</div>
          </div>
          <div className="relative h-[78px] overflow-hidden rounded-[8px] bg-[#17181E]">
            <div className="absolute inset-x-4 top-10 h-px bg-white/[0.12]" />
            <div className="absolute inset-x-4 top-[48px] flex items-end justify-between">
              {strikes.map(strike => {
                const call = chain.find(item => item.strike === strike && item.type === 'call');
                const put = chain.find(item => item.strike === strike && item.type === 'put');
                const oi = Math.max(call?.oi ?? 0, put?.oi ?? 0);
                const h = Math.max(4, Math.min(28, (oi / maxChainOi) * 28));
                return (
                  <button
                    key={strike}
                    onDragOver={event => event.preventDefault()}
                    onDrop={() => dragLegId && moveLegToStrike(dragLegId, strike)}
                    onClick={() => {
                      const firstOption = legs.find(leg => leg.kind === 'option');
                      if (firstOption) moveLegToStrike(firstOption.id, strike);
                    }}
                    className="group relative flex h-10 flex-1 flex-col items-center justify-start text-[10px] text-white/45 hover:text-white/80"
                    title={`Strike ${strike.toLocaleString()} · Call ${formatPrice(call?.mark, 2)} · Put ${formatPrice(put?.mark, 2)} · OI ${formatCompact(oi)}`}
                  >
                    <span className="h-2 w-px bg-white/[0.18]" />
                    <span className="mt-1 tnum">{formatCompact(strike)}</span>
                    <span className="absolute -bottom-1 w-1.5 rounded-t bg-[#24AE64]/55" style={{ height: Math.min(18, h) }} />
                    <span className="absolute -top-5 w-1.5 rounded-b bg-[#EF454A]/55" style={{ height: Math.min(16, h * 0.82) }} />
                  </button>
                );
              })}
            </div>
            {legs.filter(leg => leg.kind === 'option').map((leg, index) => {
              const strikeIndex = strikes.findIndex(strike => strike === leg.strike);
              const leftPct = strikeIndex < 0 ? 50 : 2 + (strikeIndex / Math.max(1, strikes.length - 1)) * 96;
              const top = leg.side === 'buy' ? 18 - index * 2 : 48 + index * 2;
              return (
                <button
                  key={leg.id}
                  draggable
                  onDragStart={() => setDragLegId(leg.id)}
                  onDragEnd={() => setDragLegId(null)}
                  onClick={() => updateLeg(leg.id, { side: leg.side === 'buy' ? 'sell' : 'buy' })}
                  className={cn(
                    'absolute z-10 -translate-x-1/2 rounded-[5px] px-2 py-1 text-[11px] font-semibold shadow-lg cursor-grab active:cursor-grabbing',
                    leg.type === 'call' ? 'bg-[#EF454A] text-white' : 'bg-[#24AE64] text-black',
                  )}
                  style={{ left: `${leftPct}%`, top }}
                  title="拖动改变行权价，点击切换买卖方向"
                >
                  x{leg.qty} {formatCompact(leg.strike ?? 0)} {leg.type === 'call' ? 'C' : 'P'}
                </button>
              );
            })}
            <div className="absolute top-2 bottom-2 w-px bg-[#ff9c2e]/70" style={{ left: `${2 + (Math.max(0, strikes.findIndex(strike => strike >= spot)) / Math.max(1, strikes.length - 1)) * 96}%` }}>
              <span className="absolute -top-1 left-1 rounded bg-[#ff9c2e] px-1 text-[10px] font-semibold text-black">最新价</span>
            </div>
          </div>
        </section>

        <section className="shrink-0 grid grid-cols-8 gap-px bg-black border-b border-white/[0.08]">
          {[
            [netPremium <= 0 ? '净收入' : '净支出', 'Premium', netPremium <= 0 ? formatMoney(Math.abs(netPremium), 2) : formatMoney(-Math.abs(netPremium), 2), netPremium <= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]'],
            ['最大收益', '', maxProfit > 100000 ? '无限大' : formatMoney(maxProfit, 0), 'text-[#24AE64]'],
            ['盈亏平衡', '', breakeven.length ? breakeven.map(value => formatCompact(value)).join(' / ') : '—', 'text-white/82'],
            ['最大亏损', '', maxLoss < -100000 ? '无限大' : formatMoney(maxLoss, 0), 'text-[#EF454A]'],
            ['胜率%', '', `${Math.max(8, Math.min(92, 50 + greeks.theta / 8 - Math.abs(greeks.delta) * 8)).toFixed(0)}%`, 'text-white/82'],
            ['Δ DELTA', '', formatMoney(greeks.delta, 2), greeks.delta >= 0 ? 'text-[#EF454A]' : 'text-[#24AE64]'],
            ['ν VEGA', '', formatMoney(greeks.vega, 2), greeks.vega >= 0 ? 'text-[#EF454A]' : 'text-[#24AE64]'],
            ['Θ THETA', '', formatMoney(greeks.theta, 2), greeks.theta >= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]'],
          ].map(([label, sub, value, color]) => (
            <div key={label} className="bg-[#17181E] px-3 py-2">
              <div className="text-[11px] text-white/45">{label}</div>
              <div className={cn('mt-1 min-h-5 text-[14px] font-semibold tnum', color)}>{value}</div>
              {sub && <div className="text-[10px] text-white/32">{sub}</div>}
            </div>
          ))}
        </section>

        <section className="strategy-builder-workspace min-h-0 flex-1 grid grid-cols-[minmax(360px,1fr)_340px] gap-2 p-2">
          <Panel
            title={
              <div className="flex items-center gap-2">
                {(['curve', 'table', 'greeks'] as ViewMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { setViewMode(mode); setAddOpen(false); }}
                    className={cn('h-7 rounded-[5px] px-2 text-[12px]', viewMode === mode ? 'bg-[#3A3F40] text-[#ff9c2e]' : 'bg-[#2B2D35] text-white/58 hover:bg-[#3A3B40]')}
                  >
                    {mode === 'curve' ? '曲线' : mode === 'table' ? '表格' : '希腊字母'}
                  </button>
                ))}
              </div>
            }
            action={
              <div className="flex items-center gap-1">
                {(['pnl', 'pnlPercent', 'contractValue'] as ValueMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setValueMode(mode)}
                    className={cn('h-7 rounded-[5px] px-2 text-[11px]', valueMode === mode ? 'bg-[#ff9c2e]/12 text-[#ff9c2e]' : 'text-white/48 hover:bg-[#2B2D35] hover:text-white/72')}
                  >
                    {mode === 'pnl' ? '盈亏金额' : mode === 'pnlPercent' ? '盈亏百分比' : '合约价值'}
                  </button>
                ))}
              </div>
            }
            className="min-h-0"
          >
            {viewMode === 'table' && (
              <div className="h-full overflow-auto p-3">
                <table className="w-full border-separate border-spacing-0 text-center text-[12px]">
                  <thead className="sticky top-0 z-10 bg-[#17181E]">
                    <tr>
                      <th className="w-24 px-2 py-2 text-left text-white/50">标的</th>
                      <th className="w-16 px-2 py-2 text-right text-white/50">涨幅</th>
                      {timeColumns.map(day => <th key={day} className="px-2 py-2 text-white/50">{day === 0 ? '现在' : `T+${day}D`}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {priceRows.map((price, row) => (
                      <tr key={price}>
                        <td className="border-t border-white/[0.04] px-2 py-1.5 text-left font-semibold tnum text-white/78">{formatCompact(price)}</td>
                        <td className="border-t border-white/[0.04] px-2 py-1.5 text-right tnum text-white/42">{((price / spot - 1) * 100).toFixed(1)}%</td>
                        {tableData[row].map((value, col) => (
                          <td
                            key={`${price}-${col}`}
                            className="border-t border-white/[0.04] px-2 py-1.5 tnum text-black/85"
                            style={{ background: heatColor(value, tableAbsMax) }}
                          >
                            {valueMode === 'pnlPercent' ? `${value.toFixed(1)}%` : formatMoney(value, 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {viewMode === 'curve' && (
              <div className="flex h-full min-h-[300px] flex-col p-3">
                <div className="min-h-[220px] flex-1">
                  <ReactECharts echarts={echarts} option={curveOption} notMerge style={{ width: '100%', height: '100%', minHeight: 220 }} opts={{ renderer: 'canvas' }} />
                </div>
                <div className="mt-2 grid shrink-0 grid-cols-3 gap-2 border-t border-white/[0.06] pt-2">
                  <div className="rounded-[6px] bg-[#2B2D35] px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-white/45">日期</span>
                      <span className="tnum text-white/72">T+{analysisDay}D</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={analysisDayRatio} onChange={event => setAnalysisDayRatio(Number(event.target.value))} className="range-slider w-full" />
                  </div>
                  <div className="rounded-[6px] bg-[#2B2D35] px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-white/45">标的</span>
                      <span className="tnum text-white/72">{formatCompact(spot)}</span>
                    </div>
                    <input type="range" min={spotControlMin} max={spotControlMax} step={market.step / 5} value={spot} onChange={event => setSpot(Number(event.target.value) || spot)} className="range-slider w-full" />
                  </div>
                  <div className="rounded-[6px] bg-[#2B2D35] px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-white/45">隐波</span>
                      <span className={cn('tnum', ivShift >= 0 ? 'text-[#EF454A]' : 'text-[#24AE64]')}>{ivShift >= 0 ? '+' : ''}{ivShift}%</span>
                    </div>
                    <input type="range" min="-40" max="80" step="1" value={ivShift} onChange={event => setIvShift(Number(event.target.value))} className="range-slider w-full" />
                  </div>
                </div>
              </div>
            )}
            {viewMode === 'greeks' && (
              <div className="h-full overflow-auto p-4">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ['Delta', greeks.delta, '标的价格变化 1 时组合价值的近似变化'],
                    ['Gamma', greeks.gamma, 'Delta 对标的价格变化的敏感度'],
                    ['Vega', greeks.vega, '隐含波动率变化 1% 时组合价值变化'],
                    ['Theta', greeks.theta, '时间流逝 1 天的组合价值变化'],
                  ].map(([label, value, hint]) => (
                    <div key={label} className="rounded-[8px] bg-[#2B2D35] p-4">
                      <div className="text-[12px] text-white/45">{label}</div>
                      <div className={cn('mt-2 text-[24px] font-semibold tnum', Number(value) >= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]')}>
                        {formatMoney(Number(value), 3)}
                      </div>
                      <div className="mt-3 text-[12px] leading-5 text-white/48">{hint}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-[8px] bg-[#2B2D35] p-3">
                  <div className="mb-2 text-[13px] font-semibold text-white/72">逐腿 Greeks</div>
                  <div className="space-y-1">
                    {legs.map((leg, index) => {
                      const scale = legSign(leg.side) * leg.qty;
                      const legIv = Math.max(5, (leg.iv ?? iv) + ivShift);
                      const delta = leg.kind === 'underlying' ? scale : scale * bsDelta(spot, leg.strike ?? spot, years(leg.expiryDays), legIv, leg.type === 'put' ? 'P' : 'C');
                      const gamma = leg.kind === 'underlying' ? 0 : scale * bsGamma(spot, leg.strike ?? spot, years(leg.expiryDays), legIv);
                      const vega = leg.kind === 'underlying' ? 0 : scale * bsVega(spot, leg.strike ?? spot, years(leg.expiryDays), legIv);
                      const theta = leg.kind === 'underlying' ? 0 : scale * bsTheta(spot, leg.strike ?? spot, years(leg.expiryDays), legIv);
                      return (
                        <div key={leg.id} className="grid grid-cols-5 rounded-[6px] bg-[#17181E] px-3 py-2 text-[12px]">
                          <div className="text-white/72">#{index + 1} {leg.kind === 'underlying' ? '标的' : `${leg.strike} ${leg.type === 'call' ? 'C' : 'P'}`}</div>
                          <div className="tnum text-white/55">Δ {formatMoney(delta, 3)}</div>
                          <div className="tnum text-white/55">Γ {formatMoney(gamma, 5)}</div>
                          <div className="tnum text-white/55">ν {formatMoney(vega, 2)}</div>
                          <div className="tnum text-white/55">Θ {formatMoney(theta, 2)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="策略审查" className="min-h-0">
            <div className="h-full overflow-auto p-3 space-y-2">
              <div className="rounded-[8px] bg-[#2B2D35] p-3">
                <div className="text-[11px] text-white/40">当前方案</div>
                <div className="mt-1 text-[13px] font-semibold leading-5 text-white/86">{strategyHeadline}</div>
                <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] bg-black text-[11px]">
                  {[
                    ['收益', profitBoundLabel],
                    ['亏损', lossBoundLabel],
                    ['时间', carryLabel],
                    ['期限', hasCalendarStructure ? '跨期限' : '单期限'],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-[#17181E] px-2 py-1.5">
                      <div className="text-white/34">{label}</div>
                      <div className="mt-0.5 font-semibold text-white/72">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[8px] bg-[#17181E] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[12px] font-semibold text-white/72">风险诊断</div>
                  <span className="text-[10px] text-white/35">{reviewItems.filter(item => item.level !== 'ok').length} 项需复核</span>
                </div>
                <div className="space-y-1.5">
                  {reviewItems.map(item => (
                    <div key={`${item.level}-${item.title}`} className="rounded-[6px] bg-[#2B2D35] p-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold', reviewTone(item.level))}>
                          {item.level === 'danger' ? '高风险' : item.level === 'watch' ? '复核' : '正常'}
                        </span>
                        <span className="text-[12px] font-semibold text-white/78">{item.title}</span>
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-white/45">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[8px] bg-[#17181E] p-3">
                <div className="mb-2 text-[12px] font-semibold text-white/72">交易计划</div>
                <div className="space-y-1.5">
                  {tradePlan.map(([label, detail]) => (
                    <div key={label} className="grid grid-cols-[56px_1fr] gap-2 text-[11px] leading-4">
                      <div className="text-white/36">{label}</div>
                      <div className="text-white/62">{detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-1 text-[12px] font-semibold text-white/62">组合腿</div>
              {legs.length === 0 && <div className="rounded-[8px] bg-[#2B2D35] p-4 text-center text-[12px] text-white/45">从左侧模板或添加合约开始。</div>}
              {legs.map((leg, index) => {
                const legExpiry = expiryChoices.find(item => item.expiryTs === leg.expiryTs)
                  ?? expiryChoices.find(item => item.days === leg.expiryDays)
                  ?? selectedExpiryInfo;
                const legChain = leg.kind === 'option' && legExpiry?.expiryTs ? (legChainByExpiry[legExpiry.expiryTs] ?? chain) : chain;
                const legStrikes = Array.from(new Set<number>(legChain.map(item => item.strike))).sort((a, b) => a - b);
                const option = leg.kind === 'option'
                  ? findContract(legChain, leg.strike, leg.type, leg.expiryDays, leg.expiryTs ?? legExpiry?.expiryTs)
                  : null;
                return (
                  <div key={leg.id} className="rounded-[8px] bg-[#2B2D35] p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-white/38">#{index + 1}</span>
                        <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold', leg.side === 'buy' ? 'bg-[#24AE64]/14 text-[#24AE64]' : 'bg-[#EF454A]/14 text-[#EF454A]')}>{leg.side === 'buy' ? '买入' : '卖出'}</span>
                        <span className="text-[12px] text-white/72">{leg.kind === 'underlying' ? `${market.symbol} 标的` : `${legExpiry?.label ?? `${leg.expiryDays}D`} ${leg.type === 'call' ? 'Call' : 'Put'}`}</span>
                      </div>
                      <button onClick={() => setLegs(prev => prev.filter(item => item.id !== leg.id))} className="h-6 w-6 rounded-[5px] text-white/42 hover:bg-[#3A3B40] hover:text-[#EF454A]">×</button>
                    </div>
                    {leg.kind === 'option' && (
                      <div className="mb-2 min-w-0 rounded-[6px] bg-[#17181E] px-2 py-1.5">
                        <div className="truncate text-[11px] font-semibold text-white/72">{leg.instrumentName ?? option?.instrumentName ?? `${market.symbol}-${legExpiry?.label ?? `${leg.expiryDays}D`}-${leg.strike}-${leg.type === 'call' ? 'C' : 'P'}`}</div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40">
                          <span>{option?.synthetic ? '合成报价' : 'Deribit'}</span>
                          <span>IV {formatPrice(option?.iv ?? leg.iv, 1)}%</span>
                          <span>OI {formatCompact(option?.oi ?? leg.oi ?? 0)}</span>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <select value={leg.side} onChange={event => updateLeg(leg.id, { side: event.target.value as LegSide })} className={SELECT_CLS}>
                        <option value="buy">买入</option>
                        <option value="sell">卖出</option>
                      </select>
                      <input type="number" min="0.1" step="0.1" value={leg.qty} onChange={event => updateLeg(leg.id, { qty: Number(event.target.value) || 1 })} className={INPUT_CLS} />
                      {leg.kind === 'option' && (
                        <>
                          <select value={leg.type} onChange={event => updateLeg(leg.id, { type: event.target.value as OptionType })} className={SELECT_CLS}>
                            <option value="call">看涨 Call</option>
                            <option value="put">看跌 Put</option>
                          </select>
                          <select
                            value={legExpiry?.expiryTs ?? ''}
                            onChange={event => {
                              const expiry = expiryChoices.find(item => item.expiryTs === Number(event.target.value));
                              if (expiry) updateLeg(leg.id, { expiryDays: expiry.days, expiryTs: expiry.expiryTs });
                            }}
                            className={SELECT_CLS}
                          >
                            {expiryChoices.map(expiry => <option key={expiry.expiryTs} value={expiry.expiryTs}>{expiry.label} · {expiry.days}天</option>)}
                          </select>
                          <select value={leg.strike} onChange={event => updateLeg(leg.id, { strike: Number(event.target.value) })} className={cn(SELECT_CLS, 'col-span-2')}>
                            {legStrikes.map(strike => <option key={strike} value={strike}>{strike.toLocaleString()}</option>)}
                          </select>
                        </>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[6px] bg-black text-[11px]">
                      <div className="bg-[#17181E] px-2 py-1.5">
                        <div className="text-white/34">Bid</div>
                        <div className="tnum text-[#24AE64]">{formatPrice(option?.bid ?? leg.bid, 2)}</div>
                      </div>
                      <div className="bg-[#17181E] px-2 py-1.5">
                        <div className="text-white/34">Ask</div>
                        <div className="tnum text-[#EF454A]">{formatPrice(option?.ask ?? leg.ask, 2)}</div>
                      </div>
                      <div className="bg-[#17181E] px-2 py-1.5">
                        <div className="text-white/34">Entry</div>
                        <div className="tnum text-white/72">{formatPrice(leg.entry, 2)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-[8px] bg-[#17181E] p-3 space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/55">标的范围</span>
                  <span className="tnum text-white/72">±{rangePct}%</span>
                </div>
                <input type="range" min="3" max="30" step="1" value={rangePct} onChange={event => setRangePct(Number(event.target.value))} className="range-slider w-full" />
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/55">隐波偏移</span>
                  <span className={cn('tnum', ivShift >= 0 ? 'text-[#EF454A]' : 'text-[#24AE64]')}>{ivShift >= 0 ? '+' : ''}{ivShift}%</span>
                </div>
                <input type="range" min="-40" max="80" step="1" value={ivShift} onChange={event => setIvShift(Number(event.target.value))} className="range-slider w-full" />
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/55">组合价值</span>
                  <span className={cn('tnum font-semibold', portfolioValue >= 0 ? 'text-[#24AE64]' : 'text-[#EF454A]')}>{formatMoney(portfolioValue, 2)}</span>
                </div>
              </div>
            </div>
          </Panel>
        </section>
      </main>
    </div>
  );
}
