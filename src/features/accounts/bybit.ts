// Bybit 适配器：复用既有签名请求 bybitGet（features/bybit），不重造鉴权。
// 持仓 = /v5/position/list（option + linear）；已实现盈亏 = /v5/position/closed-pnl
// （linear，单次最多 7 天窗口，故按周分窗 + cursor 翻页，回拉最多约 1 年）。
// 注：Bybit 期权没有 closed-pnl 端点，期权的历史盈亏需走 execution（后续再加）；本版期权只取当前持仓。
import type { VenueAdapter, VenueAccount, SyncResult, UnifiedPosition, UnifiedFill } from './types';
import { bybitGet, fetchBybitOptionPositions, BybitAuthError } from '../bybit/rest';

interface BybitLinearPosition {
  symbol: string; side: 'Buy' | 'Sell' | ''; size: string; avgPrice: string; markPrice: string;
  unrealisedPnl: string; positionValue: string; liqPrice?: string; leverage?: string;
}
interface BybitOptGreeks { delta?: string; gamma?: string; vega?: string; theta?: string }
interface BybitListResult<T> { list: T[]; nextPageCursor?: string }
interface ClosedPnl {
  symbol: string; side: 'Buy' | 'Sell'; qty: string; avgExitPrice: string;
  closedPnl: string; createdTime: string; updatedTime: string; orderId: string; cumExitValue?: string;
}
interface BybitExecution {
  symbol: string; side: 'Buy' | 'Sell'; execPrice: string; execQty: string;
  execFee: string; execTime: string; execId?: string;
}

// 拉期权成交（7 天窗口分页，回拉约 1 年）
async function fetchOptionExecutions(sinceMs: number): Promise<BybitExecution[]> {
  const out: BybitExecution[] = [];
  const now = Date.now();
  let start = Math.max(sinceMs, now - MAX_WINDOWS * WEEK);
  let windows = 0;
  while (start < now && windows < MAX_WINDOWS) {
    const end = Math.min(start + WEEK, now);
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await bybitGet<BybitListResult<BybitExecution>>('/v5/execution/list', {
        category: 'option', startTime: start, endTime: end, limit: 100, cursor,
      });
      out.push(...(res.list ?? []));
      cursor = res.nextPageCursor || undefined;
    } while (cursor && ++pages < MAX_PAGES);
    start = end;
    windows++;
  }
  return out;
}

// FIFO 开平配对算期权实现盈亏。期权 premium 以 USDT 计、1 张=1 币 → 盈亏 = (平价−开价)×张数（USD）。
function fifoRealized(execs: BybitExecution[], acctId: string): UnifiedFill[] {
  const sorted = [...execs].sort((a, b) => Number(a.execTime) - Number(b.execTime));
  const lots = new Map<string, { price: number; qty: number }[]>(); // qty 带符号：+多 / −空
  const fills: UnifiedFill[] = [];
  for (const e of sorted) {
    const price = Number(e.execPrice) || 0;
    const qty = Number(e.execQty) || 0;
    if (!qty) continue;
    const fee = Math.abs(Number(e.execFee) || 0);
    const time = Number(e.execTime) || 0;
    const fillSign = e.side === 'Buy' ? 1 : -1;
    const coin = e.symbol.split('-')[0];
    const q = lots.get(e.symbol) ?? [];
    let remaining = qty;
    let realized = 0;
    // 先和反向持仓配对平仓
    while (remaining > 1e-12 && q.length && Math.sign(q[0].qty) === -fillSign) {
      const lot = q[0];
      const m = Math.min(remaining, Math.abs(lot.qty));
      realized += (price - lot.price) * m * Math.sign(lot.qty);
      lot.qty -= m * Math.sign(lot.qty);
      if (Math.abs(lot.qty) < 1e-9) q.shift();
      remaining -= m;
    }
    if (remaining > 1e-12) q.push({ price, qty: remaining * fillSign }); // 剩余为开仓
    lots.set(e.symbol, q);
    fills.push({
      venue: 'Bybit', accountId: acctId,
      id: `exec-${e.execId ?? `${e.symbol}-${time}-${e.side}-${qty}-${price}`}`,
      coin, side: fillSign > 0 ? 'buy' : 'sell', px: price, size: qty, notionalUsd: price * qty,
      time, closedPnl: realized, fee,
      dir: `${fillSign > 0 ? '买' : '卖'} ${e.symbol}`,
    });
  }
  return fills;
}

const coinOf = (sym: string) => sym.replace(/USDT$|USDC$|PERP$/i, '');
const WEEK = 7 * 86_400_000;
const MAX_WINDOWS = 60;     // 安全上限（~1 年 ≈ 52 周）
const MAX_PAGES = 50;       // 单窗口翻页上限

export const bybitAdapter: VenueAdapter = {
  venue: 'Bybit',
  needs: 'apiKey',
  async sync(acct: VenueAccount, sinceMs: number): Promise<SyncResult> {
    try {
      // ── 当前持仓：期权 + 线性永续 ──
      const positions: UnifiedPosition[] = [];

      const opts = await fetchBybitOptionPositions();
      for (const p of opts) {
        const sz = Number(p.size) * (p.side === 'Sell' ? -1 : 1);
        const g = p as BybitOptGreeks; // Bybit 报每张希腊；× 带符号张数 = 仓位级
        positions.push({
          venue: 'Bybit', accountId: acct.id, coin: p.symbol.split('-')[0], kind: 'option',
          instrument: p.symbol,
          size: sz, entryPx: Number(p.avgPrice) || null, markPx: Number(p.markPrice) || null,
          notionalUsd: Math.abs(Number(p.positionValue)), unrealizedPnl: Number(p.unrealisedPnl),
          leverage: null, liqPx: null,
          delta: (Number(g.delta) || 0) * sz, gamma: (Number(g.gamma) || 0) * sz,
          vega: (Number(g.vega) || 0) * sz, theta: (Number(g.theta) || 0) * sz,
          greeksUsd: true, // USDT 结算，vega/theta 已是 USD
        });
      }

      const lin = await bybitGet<BybitListResult<BybitLinearPosition>>('/v5/position/list', {
        category: 'linear', settleCoin: 'USDT', limit: 200,
      });
      for (const p of (lin.list ?? []).filter(x => Number(x.size) !== 0)) {
        const sz = Number(p.size) * (p.side === 'Sell' ? -1 : 1);
        positions.push({
          venue: 'Bybit', accountId: acct.id, coin: coinOf(p.symbol), kind: 'perp',
          instrument: p.symbol,
          size: sz, entryPx: Number(p.avgPrice) || null, markPx: Number(p.markPrice) || null,
          notionalUsd: Math.abs(Number(p.positionValue)), unrealizedPnl: Number(p.unrealisedPnl),
          leverage: p.leverage ? Number(p.leverage) : null, liqPx: p.liqPrice ? Number(p.liqPrice) : null,
          delta: sz, gamma: 0, vega: 0, theta: 0, greeksUsd: true, // 永续 delta = 仓位币数
        });
      }

      // ── 已实现盈亏（线性永续，按周分窗回拉）──
      const fills: UnifiedFill[] = [];
      const now = Date.now();
      let start = Math.max(sinceMs, now - MAX_WINDOWS * WEEK);
      let windows = 0;
      while (start < now && windows < MAX_WINDOWS) {
        const end = Math.min(start + WEEK, now);
        let cursor: string | undefined;
        let pages = 0;
        do {
          const res = await bybitGet<BybitListResult<ClosedPnl>>('/v5/position/closed-pnl', {
            category: 'linear', startTime: start, endTime: end, limit: 100, cursor,
          });
          for (const r of res.list ?? []) {
            const coin = coinOf(r.symbol);
            fills.push({
              venue: 'Bybit', accountId: acct.id, id: `cp-${r.orderId}-${r.updatedTime}`,
              coin, side: r.side === 'Buy' ? 'buy' : 'sell',
              px: Number(r.avgExitPrice) || 0, size: Number(r.qty) || 0,
              notionalUsd: Number(r.cumExitValue) || (Number(r.avgExitPrice) * Number(r.qty)) || 0,
              time: Number(r.updatedTime) || Number(r.createdTime) || end,
              closedPnl: Number(r.closedPnl) || 0, fee: 0,
              dir: `平仓 ${coin}`,
            });
          }
          cursor = res.nextPageCursor || undefined;
        } while (cursor && ++pages < MAX_PAGES);
        start = end;
        windows++;
      }

      // ── 期权已实现盈亏（无 closed-pnl 接口 → 拉成交 FIFO 配对）──
      const optExecs = await fetchOptionExecutions(sinceMs);
      fills.push(...fifoRealized(optExecs, acct.id));

      const newestFillMs = fills.reduce((m, f) => Math.max(m, f.time), sinceMs);
      return { positions, fills, newestFillMs };
    } catch (e) {
      if (e instanceof BybitAuthError) {
        throw new Error('请先配置 Bybit 只读 API key（.env 的 VITE_BYBIT_API_KEY/SECRET，或「头寸可视化」设置）');
      }
      throw e;
    }
  },
};
