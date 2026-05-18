// ── 模拟交易系统类型定义 ──

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'stop';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';
export type OrderTIF = 'GTC' | 'IOC' | 'FOK';
export type PositionSide = 'long' | 'short';
export type InstrumentType = 'call' | 'put';

export interface Order {
  id: string;
  side: OrderSide;
  type: OrderType;
  symbol: string;
  coin: string;
  expiry: string;
  strike: number;
  instrumentType: InstrumentType;
  qty: number;
  price: number;
  iv?: number;
  tif: OrderTIF;
  reduceOnly: boolean;
  postOnly: boolean;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  filledQty?: number;
  filledPrice?: number;
}

export interface OrderInput {
  side: OrderSide;
  type: OrderType;
  symbol: string;
  qty: number;
  price: number;
  iv?: number;
  tif?: OrderTIF;
  reduceOnly?: boolean;
  postOnly?: boolean;
}

export interface Position {
  id: string;
  symbol: string;
  coin: string;
  expiry: string;
  strike: number;
  instrumentType: InstrumentType;
  side: PositionSide;
  qty: number;
  avgEntryPrice: number;
  markPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openedAt: number;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  fee: number;
  timestamp: number;
}

export interface AccountBalance {
  equity: number;
  availableBalance: number;
  usedMargin: number;
  totalPnL: number;
  totalFees: number;
}

export interface TickerData {
  symbol: string;
  markPrice: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bid: number;
  ask: number;
  lastPrice: number;
  change24h: number;
  updatedAt: number;
}

export interface TradingState {
  initialBalance: number;
  balance: AccountBalance;
  orders: Order[];
  openOrders: Order[];
  orderHistory: Order[];
  positions: Position[];
  fills: Fill[];
  tickers: Record<string, TickerData>;
  slippage: number;
  makerFee: number;
  takerFee: number;
}

export interface TradingActions {
  resetAccount: (initialBalance?: number) => void;
  placeOrder: (order: OrderInput) => void;
  cancelOrder: (orderId: string) => void;
  cancelAllOrders: () => void;
  closePosition: (positionId: string) => void;
  updateTickers: (tickers: Record<string, Partial<TickerData>>) => void;
  setSlippage: (slippage: number) => void;
  setFees: (maker: number, taker: number) => void;
}
