export type Coin = 'BTC' | 'ETH';

export const MONITOR_TABS = [
  { id: 'market', label: '行情'   },
  { id: 'vol',    label: '波动率' },
  { id: 'oi',     label: '持仓'   },
  { id: 'flow',   label: '资金流' },
] as const;

export type MonitorTabId = (typeof MONITOR_TABS)[number]['id'];

export type MonitorSelection =
  | { type: 'none' }
  | { type: 'smilePoint'; coin: Coin; tenor: string; label: string; value: number }
  | { type: 'skewCell';   coin: Coin; row: string; col: string; value: number };
