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
  // 注意：markPrice / bid / ask / lastPrice 在 stream 层已统一转换为 USD（美元价）
  // 原始 Deribit 返回为币本位（BTC/ETH），underlyingPrice 是对应到期日的远期价（USD）
  markPrice: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  // 当 Deribit 该 instrument 没有盘口报价时为 null（区别于"价格为 0"）
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  change24h: number;
  oi: number | null;
  volume: number | null;
  /** 该期权对应到期日的合成期货/远期价格（USD），来自 Deribit underlying_price */
  underlyingPrice?: number;
  /** Deribit 从期货基差反推的隐含无风险利率（小数，如 0.05 表示 5%） */
  interestRate?: number;
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
