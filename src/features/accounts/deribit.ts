// Deribit 适配器：私有鉴权走 client_credentials（over 既有 DERIBIT_WS）。
// 持仓 = private/get_positions；成交 = private/get_user_trades_by_currency_and_time（按时间分页回拉）；
// 已实现盈亏 = private/get_settlement_history_by_currency（交割/结算的 profit_loss）。
// 注意：Deribit 期权为反向（inverse），价格/盈亏以币计 → 用 index_price 折算 USD。
//       逐笔成交无 closedPnl（Deribit 不直接给），故成交记录 closedPnl=0，已实现盈亏来自结算。
import type { VenueAdapter, VenueAccount, SyncResult, UnifiedPosition, UnifiedFill } from './types';
import { DERIBIT_WS } from '../../registry/monitorWidgetsBase';

const CCYS = ['BTC', 'ETH'] as const;

let authedUntil = 0;
let accessToken = '';
let authScope = '';
async function ensureAuth(): Promise<void> {
  const id = import.meta.env.VITE_DERIBIT_API_KEY?.trim();
  const secret = import.meta.env.VITE_DERIBIT_API_SECRET?.trim();
  if (!id || !secret) throw new Error('请在 .env 配置 Deribit 只读 key（VITE_DERIBIT_API_KEY/SECRET）');
  if (Date.now() < authedUntil && accessToken) return;
  const res = await DERIBIT_WS.rpc<{ expires_in?: number; access_token?: string; scope?: string }>('public/auth', {
    grant_type: 'client_credentials', client_id: id, client_secret: secret,
  });
  accessToken = res.access_token ?? '';
  authScope = res.scope ?? '';
  authedUntil = Date.now() + (res.expires_in ? res.expires_in * 800 : 600_000); // 提前 20% 过期
}

// 私有调用统一带 access_token（即便连接级鉴权没生效也能用 token 鉴权）
function priv<T>(method: string, params: Record<string, unknown>): Promise<T> {
  return DERIBIT_WS.rpc<T>(method, { ...params, access_token: accessToken });
}

interface DbPosition {
  instrument_name: string; size: number; direction: string;
  average_price: number; mark_price: number; index_price: number;
  floating_profit_loss: number; kind: string;
}
interface DbTrade {
  trade_id: string; instrument_name: string; direction: 'buy' | 'sell';
  amount: number; price: number; index_price: number; timestamp: number;
  fee: number; fee_currency: string;
}
interface DbSettlement {
  type: string; instrument_name?: string; profit_loss: number; timestamp: number; index_price?: number;
}

export const deribitAdapter: VenueAdapter = {
  venue: 'Deribit',
  needs: 'apiKey',
  async sync(acct: VenueAccount, sinceMs: number): Promise<SyncResult> {
    const positions: UnifiedPosition[] = [];
    const fills: UnifiedFill[] = [];
    const now = Date.now();

    try {
    await ensureAuth();
    for (const ccy of CCYS) {
      // ── 当前持仓（期权）──
      const pos = await priv<DbPosition[]>('private/get_positions', { currency: ccy, kind: 'option' });
      for (const p of pos ?? []) {
        if (!p.size) continue;
        const idx = p.index_price || 0;
        positions.push({
          venue: 'Deribit', accountId: acct.id, coin: ccy, kind: 'option',
          size: p.size,
          entryPx: p.average_price && idx ? p.average_price * idx : null,
          markPx: p.mark_price && idx ? p.mark_price * idx : null,
          notionalUsd: Math.abs(p.size) * idx,
          unrealizedPnl: (p.floating_profit_loss || 0) * idx,
          leverage: null, liqPx: null,
        });
      }

      // ── 成交历史（按时间向前分页）──
      let start = sinceMs;
      let guard = 0;
      while (start < now && guard < 40) {
        const r = await priv<{ trades: DbTrade[]; has_more: boolean }>(
          'private/get_user_trades_by_currency_and_time',
          { currency: ccy, kind: 'option', start_timestamp: start, end_timestamp: now, count: 1000, sorting: 'asc' },
        );
        const trades = r?.trades ?? [];
        for (const t of trades) {
          const idx = t.index_price || 0;
          fills.push({
            venue: 'Deribit', accountId: acct.id, id: `tr-${t.trade_id}`,
            coin: ccy, side: t.direction === 'buy' ? 'buy' : 'sell',
            px: t.price * idx, size: t.amount, notionalUsd: t.amount * idx,
            time: t.timestamp, closedPnl: 0,
            fee: Math.abs(t.fee) * (t.fee_currency === ccy ? idx : 1),
            dir: `${t.direction === 'buy' ? '买' : '卖'} ${t.instrument_name}`,
          });
        }
        if (!trades.length || !r.has_more) break;
        start = trades[trades.length - 1].timestamp + 1;
        guard++;
      }

      // ── 交割/结算的已实现盈亏 ──
      try {
        const sh = await priv<{ settlements: DbSettlement[] }>(
          'private/get_settlement_history_by_currency', { currency: ccy, count: 1000 },
        );
        for (const s of sh?.settlements ?? []) {
          if (s.timestamp < sinceMs || !s.profit_loss) continue;
          const idx = s.index_price || 0;
          fills.push({
            venue: 'Deribit', accountId: acct.id,
            id: `set-${s.instrument_name ?? ccy}-${s.timestamp}`,
            coin: ccy, side: 'sell', px: 0, size: 0, notionalUsd: 0,
            time: s.timestamp, closedPnl: s.profit_loss * (idx || 1), fee: 0,
            dir: `${s.type === 'delivery' ? '交割' : '结算'} ${s.instrument_name ?? ''}`.trim(),
          });
        }
      } catch { /* 结算历史失败不影响成交 */ }
    }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unauthor|invalid_cred|13009|13004/i.test(msg)) {
        throw new Error(`Deribit 鉴权被拒（${msg}）。请检查：① 是主网 key（非 test.deribit.com）② key 含 account:read 权限 ③ 无 IP 限制或已放行本机 IP。当前 key scope: ${authScope || '(空)'}`);
      }
      throw e;
    }

    const newestFillMs = fills.reduce((m, f) => Math.max(m, f.time), sinceMs);
    return { positions, fills, newestFillMs };
  },
};
