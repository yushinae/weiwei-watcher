// 交易日志：localStorage 持久化 + 后端同步。
import type { JournalTrade } from './types';
import { put as apiPut } from '../../api';

const KEY = 'weiwei.journal.v1';

export function loadTrades(): JournalTrade[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as JournalTrade[]) : [];
  } catch {
    return [];
  }
}

export function saveTrades(trades: JournalTrade[]): void {
  localStorage.setItem(KEY, JSON.stringify(trades));
  apiPut('/api/journal', trades).catch(() => {});
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 统计 ─────────────────────────────────────────────────────────────────────

export interface StrategyStat {
  strategy: string;
  pnl: number;
  count: number;
  winRate: number;
}

export interface JournalStats {
  totalPnl: number;
  closedCount: number;
  openCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;       // 0..1
  avgWin: number;
  avgLoss: number;       // ≤ 0
  profitFactor: number;  // ∑盈利 / |∑亏损|
  bestPnl: number;
  worstPnl: number;
  byStrategy: StrategyStat[];
}

export function computeStats(trades: JournalTrade[]): JournalStats {
  const closed = trades.filter(t => t.status === 'closed');
  const open = trades.filter(t => t.status === 'open');
  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);

  const sumWin = wins.reduce((s, t) => s + t.pnl, 0);
  const sumLoss = losses.reduce((s, t) => s + t.pnl, 0); // ≤ 0
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);

  const byMap = new Map<string, { pnl: number; count: number; wins: number }>();
  for (const t of closed) {
    const e = byMap.get(t.strategy) ?? { pnl: 0, count: 0, wins: 0 };
    e.pnl += t.pnl;
    e.count += 1;
    if (t.pnl > 0) e.wins += 1;
    byMap.set(t.strategy, e);
  }
  const byStrategy: StrategyStat[] = [...byMap.entries()]
    .map(([strategy, e]) => ({ strategy, pnl: e.pnl, count: e.count, winRate: e.count ? e.wins / e.count : 0 }))
    .sort((a, b) => b.pnl - a.pnl);

  return {
    totalPnl,
    closedCount: closed.length,
    openCount: open.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgWin: wins.length ? sumWin / wins.length : 0,
    avgLoss: losses.length ? sumLoss / losses.length : 0,
    profitFactor: sumLoss !== 0 ? sumWin / Math.abs(sumLoss) : sumWin > 0 ? Infinity : 0,
    bestPnl: closed.length ? Math.max(...closed.map(t => t.pnl)) : 0,
    worstPnl: closed.length ? Math.min(...closed.map(t => t.pnl)) : 0,
    byStrategy,
  };
}

// ── 净值曲线（累计已实现盈亏，按平仓日聚合） ──────────────────────────────────

export interface EquityPoint {
  date: string;
  cum: number;
  day: number; // 当日盈亏
}

export function buildEquityCurve(trades: JournalTrade[]): EquityPoint[] {
  const closed = trades.filter(t => t.status === 'closed' && t.closeDate);
  if (!closed.length) return [];
  const byDate = new Map<string, number>();
  for (const t of closed) byDate.set(t.closeDate!, (byDate.get(t.closeDate!) ?? 0) + t.pnl);
  const dates = [...byDate.keys()].sort();
  let cum = 0;
  const pts: EquityPoint[] = [{ date: '起始', cum: 0, day: 0 }];
  for (const d of dates) {
    const day = byDate.get(d)!;
    cum += day;
    pts.push({ date: d, cum, day });
  }
  return pts;
}

// ── 示例数据（空状态一键填充，便于先看效果） ────────────────────────────────

export function sampleTrades(): JournalTrade[] {
  const mk = (
    coin: string, strategy: string, openDate: string, closeDate: string, pnl: number, notes: string,
  ): JournalTrade => ({ id: newId(), coin, strategy, status: 'closed', openDate, closeDate, pnl, notes });
  return [
    mk('BTC', '卖出 Put', '2026-04-02', '2026-04-09', 1240, 'IV Rank 偏高，卖 25Δ put 收 vega'),
    mk('ETH', '跨式 Straddle', '2026-04-05', '2026-04-12', -680, '事件前买跨，IV 压缩亏 theta'),
    mk('BTC', '牛市价差', '2026-04-10', '2026-04-24', 540, '方向对，价差控制成本'),
    mk('BTC', '卖出 Call', '2026-04-15', '2026-04-22', -1320, '被 Call 墙上方突破打穿'),
    mk('ETH', '卖出 Put', '2026-04-20', '2026-04-27', 880, '回踩支撑卖 put'),
    mk('BTC', '日历价差', '2026-05-01', '2026-05-15', 410, '近月 IV 高、远月低，正向期限结构'),
    mk('SOL', '买入 Call', '2026-05-06', '2026-05-13', 1960, '低 IV 买方，趋势配合'),
    mk('BTC', '宽跨 Strangle', '2026-05-12', '2026-05-19', -450, '区间震荡，宽跨双输'),
    mk('ETH', '铁鹰 Condor', '2026-05-18', '2026-06-01', 720, '震荡市收 theta，到期内 pin'),
    {
      id: newId(), coin: 'BTC', strategy: '卖出 Put', status: 'open',
      openDate: '2026-05-28', pnl: 0, notes: '持仓中：6月到期 60k put',
    },
  ];
}
