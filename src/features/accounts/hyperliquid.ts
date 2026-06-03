// Hyperliquid 适配器：按钱包地址只读拉取（无需密钥）。
// 持仓 = clearinghouseState；成交 = userFillsByTime（传 startTime 增量回拉）。
import type { VenueAdapter, VenueAccount, SyncResult, UnifiedPosition, UnifiedFill } from './types';

const INFO = '/hyperliquid-api/info';

async function info<T>(body: object): Promise<T> {
  const r = await fetch(INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Hyperliquid ${r.status}`);
  return r.json() as Promise<T>;
}

interface ClearinghouseState {
  assetPositions?: {
    position: {
      coin: string; szi: string; entryPx: string | null; positionValue: string;
      unrealizedPnl: string; leverage?: { value: number }; liquidationPx: string | null;
    };
  }[];
}

interface HlFill {
  coin: string; px: string; sz: string; side: string; time: number;
  dir: string; closedPnl: string; hash: string; oid: number; fee: string; tid: number;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export const hyperliquidAdapter: VenueAdapter = {
  venue: 'Hyperliquid',
  needs: 'address',
  async sync(acct: VenueAccount, sinceMs: number): Promise<SyncResult> {
    const user = (acct.address ?? '').trim();
    if (!ADDR_RE.test(user)) throw new Error('钱包地址格式不对（应为 0x 开头 + 40 位十六进制）');

    const [state, fills] = await Promise.all([
      info<ClearinghouseState>({ type: 'clearinghouseState', user }),
      info<HlFill[]>({ type: 'userFillsByTime', user, startTime: sinceMs > 0 ? sinceMs : 0, endTime: Date.now() }),
    ]);

    const positions: UnifiedPosition[] = (state.assetPositions ?? []).map(ap => {
      const p = ap.position;
      const szi = Number(p.szi);
      const notional = Math.abs(Number(p.positionValue));
      return {
        venue: 'Hyperliquid', accountId: acct.id, coin: p.coin, kind: 'perp',
        size: szi,
        entryPx: p.entryPx != null ? Number(p.entryPx) : null,
        markPx: szi !== 0 ? notional / Math.abs(szi) : null,
        notionalUsd: notional,
        unrealizedPnl: Number(p.unrealizedPnl),
        leverage: p.leverage?.value ?? null,
        liqPx: p.liquidationPx != null ? Number(p.liquidationPx) : null,
        delta: szi, gamma: 0, vega: 0, theta: 0, greeksUsd: true, // 永续 delta = 仓位币数
      };
    });

    const list = Array.isArray(fills) ? fills : [];
    const uFills: UnifiedFill[] = list.map(f => ({
      venue: 'Hyperliquid', accountId: acct.id, id: `${f.hash}-${f.tid}`,
      coin: f.coin, side: f.side === 'B' ? 'buy' : 'sell',
      px: Number(f.px), size: Number(f.sz), notionalUsd: Number(f.px) * Number(f.sz),
      time: f.time, closedPnl: Number(f.closedPnl), fee: Number(f.fee), dir: f.dir,
    }));

    const newestFillMs = uFills.reduce((m, f) => Math.max(m, f.time), sinceMs);
    return { positions, fills: uFills, newestFillMs };
  },
};
