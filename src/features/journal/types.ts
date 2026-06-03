// 交易日志数据模型 —— 长期战绩记录的最小可用集。
export type TradeStatus = 'open' | 'closed';

export interface JournalTrade {
  id: string;
  coin: string;        // BTC / ETH / SOL / 其他
  strategy: string;    // 策略类型（见 STRATEGIES）
  status: TradeStatus;
  openDate: string;    // 开仓日期 yyyy-mm-dd
  closeDate?: string;  // 平仓日期 yyyy-mm-dd（closed 时有效）
  pnl: number;         // 已实现盈亏 USD（closed 时计入统计）
  entryCost?: number;  // 净权利金 / 成本 USD（可选，用于回报率）
  notes?: string;
}

// 加密期权常见结构（卖方/买方/价差/中性）
export const STRATEGIES = [
  '买入 Call', '买入 Put', '卖出 Call', '卖出 Put',
  '跨式 Straddle', '宽跨 Strangle',
  '牛市价差', '熊市价差', '日历价差', '铁鹰 Condor',
  '现货对冲', '其他',
] as const;

export const JOURNAL_COINS = ['BTC', 'ETH', 'SOL', '其他'] as const;
