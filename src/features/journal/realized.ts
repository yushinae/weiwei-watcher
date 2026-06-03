// 把「账户」页累积的真实成交（closedPnl）桥接成日志的净值/拆解模型。
// 闭环：你不用手填，HL/Bybit/Deribit 的真实已实现盈亏自动连成净值线 + 按交易所/币种/月份拆解。
import { loadAllFills } from '../accounts/fillStore';
import type { EquityPoint } from './store';

export interface RealizedEvent { date: string; pnl: number; venue: string; coin: string }

// 净已实现盈亏 = Σ(closedPnl − fee) 覆盖【所有】成交（开仓也有手续费，必须计入），
// 与「账户」页"合计净盈亏（扣费）"口径完全一致。
export function accountRealizedEvents(): RealizedEvent[] {
  return loadAllFills().map(f => ({
    date: new Date(f.time).toISOString().slice(0, 10),
    pnl: (f.closedPnl || 0) - (f.fee || 0),
    venue: f.venue,
    coin: f.coin,
  }));
}

export function equityFromEvents(events: RealizedEvent[]): EquityPoint[] {
  if (!events.length) return [];
  const byDate = new Map<string, number>();
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.pnl);
  const dates = [...byDate.keys()].sort();
  let cum = 0;
  const pts: EquityPoint[] = [{ date: '起始', cum: 0, day: 0 }];
  for (const d of dates) { const day = byDate.get(d)!; cum += day; pts.push({ date: d, cum, day }); }
  return pts;
}

export interface Breakdown { label: string; pnl: number; count: number }

export function breakdownBy(events: RealizedEvent[], key: 'venue' | 'coin' | 'month'): Breakdown[] {
  const m = new Map<string, { pnl: number; count: number }>();
  for (const e of events) {
    const k = key === 'month' ? e.date.slice(0, 7) : e[key];
    const x = m.get(k) ?? { pnl: 0, count: 0 };
    x.pnl += e.pnl; x.count += 1;
    m.set(k, x);
  }
  const arr = [...m.entries()].map(([label, x]) => ({ label, pnl: x.pnl, count: x.count }));
  return key === 'month'
    ? arr.sort((a, b) => (a.label < b.label ? -1 : 1))
    : arr.sort((a, b) => b.pnl - a.pnl);
}
