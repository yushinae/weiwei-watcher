import type { DataSource } from '../chainModel';
import type { DepthBook, SimFill, SimOrder, SimPosition } from '../simBook';

export type ExecutionMode = 'sim' | 'live';
export type TradeVenue = DataSource;
export type TradeSide = 'buy' | 'sell';
export type TradeOrderType = 'limit' | 'market' | 'stop';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';

export interface TradeIntent {
  mode: ExecutionMode;
  venue: TradeVenue;
  accountId: string;
  instrument?: string;
  symbol: string;
  side: TradeSide;
  orderType: TradeOrderType;
  qty: number;
  price: number;
  mark: number;
  reduceOnly: boolean;
  postOnly: boolean;
  tif: TimeInForce;
  source: 'options-chain' | 'quick-order';
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  book?: DepthBook;
}

export interface OrderResult {
  mode: ExecutionMode;
  venue: TradeVenue;
  status: OrderStatus;
  orderId?: string;
  message?: string;
  filledQty?: number;
  avgPrice?: number;
}

export interface AmendIntent {
  price: number;
  qty: number;
}

export interface AccountTradingState {
  positions: SimPosition[];
  openOrders: SimOrder[];
  orderHistory: SimOrder[];
  fills: SimFill[];
}

export interface ExecutionAdapter {
  readonly mode: ExecutionMode;
  readonly label: string;
  placeOrder(intent: TradeIntent): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<OrderResult>;
  amendOrder(orderId: string, patch: AmendIntent): Promise<OrderResult>;
  getState(): AccountTradingState;
}
