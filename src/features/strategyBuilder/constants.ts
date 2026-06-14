// Static configuration for the strategy builder: market presets, expiries, tag /
// view labels and weights, the strategy template catalog, and input styling.

import type { MarketPreset, TemplateTag, MarketView, StrategyTemplate } from './types';

export const AXIS_MAX_TICKS = 21;
export const AXIS_MIN_TICK_GAP = 72;

export const MARKETS: MarketPreset[] = [
  { symbol: 'BTC', label: 'Bitcoin', spot: 65000, iv: 58, step: 1000, contractSize: 1 },
  { symbol: 'ETH', label: 'Ethereum', spot: 3200, iv: 66, step: 50, contractSize: 1 },
  { symbol: 'SOL', label: 'Solana', spot: 155, iv: 82, step: 5, contractSize: 1 },
];

export const EXPIRIES = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '60D', days: 60 },
  { label: '90D', days: 90 },
];

export const TAG_LABELS: Record<TemplateTag, string> = {
  bullish: '看涨',
  bearish: '看跌',
  neutral: '震荡',
  trend: '趋势',
  calendar: '日历',
};

export const VIEW_LABELS: Record<MarketView, { label: string; hint: string }> = {
  all: { label: '全部', hint: '不限制行情观点，按常用度展示。' },
  bullish: { label: '看涨', hint: '预期上涨，优先有限风险多头结构。' },
  bearish: { label: '看跌', hint: '预期下跌，优先 Put 与有限风险空头结构。' },
  range: { label: '震荡', hint: '预期区间内波动，优先收权利金结构。' },
  breakout: { label: '突破', hint: '预期大幅单边或双向波动。' },
  volUp: { label: '升波', hint: '预期隐含波动率上升。' },
  volDown: { label: '降波', hint: '预期隐含波动率回落或横盘衰减。' },
  calendar: { label: '跨期', hint: '关注期限结构、近远月 IV 和时间价值差。' },
};

export const VIEW_TAG_WEIGHTS: Record<MarketView, Partial<Record<TemplateTag, number>>> = {
  all: {},
  bullish: { bullish: 5, neutral: 1, calendar: 1 },
  bearish: { bearish: 5, neutral: 1, calendar: 1 },
  range: { neutral: 5, calendar: 1 },
  breakout: { trend: 5, bullish: 1, bearish: 1 },
  volUp: { trend: 4, calendar: 3 },
  volDown: { neutral: 4, calendar: 2 },
  calendar: { calendar: 5, neutral: 1, trend: 1 },
};

export const TEMPLATES: StrategyTemplate[] = [
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

export const INPUT_CLS = 'h-8 bg-[#2B2D35] rounded-[6px] px-2 text-[12px] text-white/85 outline-none focus:bg-[#3A3B40] transition-colors w-full';
export const SELECT_CLS = 'h-8 bg-[#2B2D35] rounded-[6px] px-2 text-[12px] text-white/85 outline-none focus:bg-[#3A3B40] transition-colors cursor-pointer w-full';
export const SMALL_BUTTON_BASE = 'rounded-[6px] bg-[#2B2D35] text-white/62 transition-colors hover:bg-[#3A3B40] hover:text-white/86';
export const SMALL_BUTTON_ACTIVE = 'bg-[#3A3F40] text-[#ff9c2e]';
export const SMALL_BUTTON_DISABLED = 'cursor-not-allowed bg-[#17181E] text-white/28';
