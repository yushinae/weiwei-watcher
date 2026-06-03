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
