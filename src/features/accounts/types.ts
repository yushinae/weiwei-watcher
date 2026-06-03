// 多账户聚合：统一数据模型 + 适配器接口。
// 每个交易所一个「适配器」，把各家的持仓/成交翻译成下面这套统一格式，UI 只认统一格式。

export type Venue = 'Hyperliquid' | 'Bybit' | 'Deribit' | 'Binance';

// 统一持仓（此刻的持仓状态）
export interface UnifiedPosition {
  venue: Venue;
  accountId: string;
  coin: string;                 // BTC / ETH / SOL …
  kind: 'perp' | 'option' | 'spot';
  size: number;                 // 带符号张/币数：正=多，负=空
  entryPx: number | null;
  markPx: number | null;
  notionalUsd: number;          // 名义美元规模（绝对值）
  unrealizedPnl: number | null;
  leverage: number | null;
  liqPx: number | null;
  // 希腊（可选，adapter 能拿到就填；约定：整个仓位级、delta 为币本位。组合风险实盘净希腊用）
  delta?: number;               // 仓位 delta（币）；$Δ = delta × 现价
  gamma?: number;               // d(delta)/d(spot)
  vega?: number;                // 每 1% IV
  theta?: number;               // 每日
  greeksUsd?: boolean;          // vega/theta 是否已是 USD（Bybit/USDC 线性=true；Deribit 反向 BTC/ETH=false）
}

// 统一成交（一笔历史成交）
export interface UnifiedFill {
  venue: Venue;
  accountId: string;
  id: string;                   // 在该交易所内唯一（用于去重）
  coin: string;
  side: 'buy' | 'sell';
  px: number;
  size: number;
  notionalUsd: number;
  time: number;                 // 成交时间（ms）
  closedPnl: number;            // 这笔的已实现盈亏（开仓为 0）
  fee: number;
  dir: string;                  // 人话动作，如 "Open Long" / "Close Short"
}

// 一个已配置的账户
export interface VenueAccount {
  id: string;
  venue: Venue;
  label: string;
  address?: string;             // 链上账户用钱包地址（Hyperliquid）
}

export interface SyncResult {
  positions: UnifiedPosition[];
  fills: UnifiedFill[];         // 本次拉到的成交（调用方负责合并去重）
  newestFillMs: number;         // 本次最新成交时间，作为下次增量起点
}

export interface VenueAdapter {
  venue: Venue;
  needs: 'address' | 'apiKey';
  // sinceMs：只拉这个时间点之后的成交（增量回拉）；持仓总是拉当前全量
  sync(acct: VenueAccount, sinceMs: number): Promise<SyncResult>;
}
