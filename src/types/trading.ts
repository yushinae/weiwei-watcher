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
  symbol: string;       // e.g. "BTC-29MAY26-65000-C"
  coin: string;         // e.g. "BTC" (derived from symbol)
  expiry: string;       // e.g. "29MAY26" (derived from symbol)
  strike: number;       // derived from symbol
  instrumentType: InstrumentType; // derived from symbol
  qty: number;
  price: number;        // limit price or 0 for market
  iv?: number;          // implied volatility if quoted in IV
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

export interface TradingState {
  // Account
  initialBalance: number;
  balance: AccountBalance;

  // Orders
  orders: Order[];
  openOrders: Order[];
  orderHistory: Order[];

  // Positions
  positions: Position[];

  // Fills
  fills: Fill[];

  // Settings
  slippage: number;       // 滑点百分比 (default 0.001 = 0.1%)
  makerFee: number;       // maker 手续费 (default 0.0002 = 0.02%)
  takerFee: number;       // taker 手续费 (default 0.0005 = 0.05%)
}

// ── Actions ──

export interface TradingActions {
  // Account
  resetAccount: (initialBalance?: number) => void;

  // Orders
  placeOrder: (order: OrderInput) => void;
  cancelOrder: (orderId: string) => void;
  cancelAllOrders: () => void;

  // Positions
  closePosition: (positionId: string) => void;

  // Market data updates (called from SSE)
  updateMarkPrices: (prices: Record<string, number>) => void;

  // Settings
  setSlippage: (slippage: number) => void;
  setFees: (maker: number, taker: number) => void;
}
