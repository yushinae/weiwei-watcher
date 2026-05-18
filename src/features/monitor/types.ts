export type Coin = 'BTC' | 'ETH';

export const MONITOR_TABS = [
  { id: 'overview', label: '概览' },
  { id: 'surface', label: '波动率曲面' },
  { id: 'history', label: '历史数据' },
  { id: 'distribution', label: '分布分析' },
  { id: 'greeks', label: 'Greeks' },
  { id: 'chain', label: '期权链' },
  { id: 'polymarket', label: '市场预测' },
] as const;

export type MonitorTabId = (typeof MONITOR_TABS)[number]['id'];

export const MONITOR_RANGES = ['24H', '7D', '30D', '90D', 'CUSTOM'] as const;
export type MonitorRange = (typeof MONITOR_RANGES)[number];

export const MONITOR_TENORS = ['7D', '14D', '30D', '60D', '90D'] as const;
export type MonitorTenor = (typeof MONITOR_TENORS)[number];

export type MonitorSelection =
  | { type: 'none' }
  | { type: 'smilePoint'; coin: Coin; tenor: '7D' | '30D' | '90D'; label: string; value: number }
  | { type: 'skewCell'; coin: Coin; row: string; col: string; value: number };

