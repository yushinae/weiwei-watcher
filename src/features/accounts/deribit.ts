// Deribit 适配器：私有鉴权走 client_credentials（over 既有 DERIBIT_WS）。
// 持仓 = private/get_positions；成交 = private/get_user_trades_by_currency_and_time（按时间分页回拉）；
// 已实现盈亏 = private/get_settlement_history_by_currency（交割/结算的 profit_loss）。
// 注意：Deribit 期权为反向（inverse），价格/盈亏以币计 → 用 index_price 折算 USD。
//       逐笔成交无 closedPnl（Deribit 不直接给），故成交记录 closedPnl=0，已实现盈亏来自结算。
import type { VenueAdapter, VenueAccount, SyncResult, UnifiedPosition, UnifiedFill } from './types';
import { DERIBIT_WS } from '../../registry/monitorWidgetsBase';

// BTC/ETH = 反向（币本位），价格/盈亏以币计 → ×index 折 USD。
// USDC = 线性，价格/盈亏已是 USD → ×1。
const CCY_LIST: { ccy: string; linear: boolean }[] = [
  { ccy: 'BTC', linear: false },
  { ccy: 'ETH', linear: false },
  { ccy: 'USDC', linear: true },
];
// 'BTC-…' → BTC；'BTC_USDC-…' → BTC
const coinOf = (inst: string) => (inst || '').split(/[-_]/)[0] || '—';
const isUsd = (cur: string) => cur === 'USDC' || cur === 'USD' || cur === 'USDT';

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
  delta?: number; gamma?: number; vega?: number; theta?: number;
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
    for (const { ccy, linear } of CCY_LIST) {
      // ── 当前持仓（期权）──
      const pos = await priv<DbPosition[]>('private/get_positions', { currency: ccy, kind: 'option' });
      for (const p of pos ?? []) {
        if (!p.size) continue;
        const idx = p.index_price || 0;
        const mult = linear ? 1 : idx;   // USDC 已是 USD；BTC/ETH 反向 ×index
        positions.push({
          venue: 'Deribit', accountId: acct.id, coin: coinOf(p.instrument_name), kind: 'option',
          size: p.size,
          entryPx: p.average_price ? p.average_price * mult : null,
          markPx: p.mark_price ? p.mark_price * mult : null,
          notionalUsd: Math.abs(p.size) * idx,   // |张| × 标的现价
          unrealizedPnl: (p.floating_profit_loss || 0) * mult,
          leverage: null, liqPx: null,
          // Deribit 报仓位级希腊：delta 币本位；反向(BTC/ETH) vega/theta 以币计→greeksUsd=false，USDC 已是 USD
          delta: p.delta ?? 0, gamma: p.gamma ?? 0, vega: p.vega ?? 0, theta: p.theta ?? 0,
          greeksUsd: linear,
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
          const mult = linear ? 1 : idx;
          fills.push({
            venue: 'Deribit', accountId: acct.id, id: `tr-${t.trade_id}`,
            coin: coinOf(t.instrument_name), side: t.direction === 'buy' ? 'buy' : 'sell',
            px: t.price * mult, size: t.amount, notionalUsd: t.amount * idx,
            time: t.timestamp, closedPnl: 0,
            fee: Math.abs(t.fee) * (isUsd(t.fee_currency) ? 1 : idx),
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
          const mult = linear ? 1 : (s.index_price || 0);
          fills.push({
            venue: 'Deribit', accountId: acct.id,
            id: `set-${s.instrument_name ?? ccy}-${s.timestamp}`,
            coin: coinOf(s.instrument_name ?? ccy), side: 'sell', px: 0, size: 0, notionalUsd: 0,
            time: s.timestamp, closedPnl: s.profit_loss * (mult || 1), fee: 0,
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
