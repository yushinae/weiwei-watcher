// Binance 适配器：Spot + USD-M Futures，只读签名接口。
// 持仓 = Spot 余额 + /fapi/v2/positionRisk；已实现盈亏 = /fapi/v1/income。
import type { VenueAdapter, VenueAccount, SyncResult, UnifiedFill, UnifiedPosition } from './types';
import { hmacSha256Hex } from '../bybit/crypto';
import { fetchWithRetry } from '../../lib/fetchRetry';

const SPOT_BASE = '/binance-spot-api';
const FAPI_BASE = '/binance-fapi';
const RECV_WINDOW = '5000';
const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'USD']);

function creds(): { apiKey: string; secret: string } {
  const apiKey = import.meta.env.VITE_BINANCE_API_KEY?.trim();
  const secret = import.meta.env.VITE_BINANCE_API_SECRET?.trim();
  if (!apiKey || !secret) throw new Error('请在 .env 配置 Binance 只读 API key（VITE_BINANCE_API_KEY/SECRET）');
  return { apiKey, secret };
}

function query(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function signed<T>(base: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const c = creds();
  const qs = query({ ...params, recvWindow: RECV_WINDOW, timestamp: Date.now() });
  const sig = await hmacSha256Hex(c.secret, qs);
  const resp = await fetchWithRetry(`${base}${path}?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': c.apiKey },
    retries: 2,
    timeoutMs: 12_000,
  });
  if (!resp.ok) throw new Error(`Binance HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.code && json.code < 0) throw new Error(`Binance ${json.code}: ${json.msg ?? 'API error'}`);
  return json as T;
}

async function publicJson<T>(base: string, path: string): Promise<T> {
  const resp = await fetchWithRetry(`${base}${path}`, { retries: 2, timeoutMs: 10_000 });
  if (!resp.ok) throw new Error(`Binance public HTTP ${resp.status}`);
  return resp.json() as Promise<T>;
}

interface SpotAccount {
  balances?: { asset: string; free: string; locked: string }[];
}

interface TickerPrice { symbol: string; price: string }

interface FuturesPosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  notional?: string;
  leverage?: string;
  liquidationPrice?: string;
}

interface IncomeItem {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  time: number;
  tranId: string | number;
}

const coinOfSymbol = (symbol: string) => symbol.replace(/USDT$|USDC$|BUSD$|FDUSD$/i, '');
const spotSymbol = (asset: string) => `${asset}USDT`;

async function spotPrices(assets: string[]): Promise<Map<string, number>> {
  const nonStable = assets.filter(a => !STABLES.has(a));
  const prices = new Map<string, number>();
  for (const s of STABLES) prices.set(s, 1);
  if (!nonStable.length) return prices;

  const symbols = encodeURIComponent(JSON.stringify(nonStable.map(spotSymbol)));
  const rows = await publicJson<TickerPrice[]>(SPOT_BASE, `/api/v3/ticker/price?symbols=${symbols}`);
  for (const r of rows) {
    const asset = coinOfSymbol(r.symbol);
    const px = Number(r.price);
    if (Number.isFinite(px) && px > 0) prices.set(asset, px);
  }
  return prices;
}

async function fetchIncome(sinceMs: number): Promise<IncomeItem[]> {
  const out: IncomeItem[] = [];
  const now = Date.now();
  const WINDOW = 30 * 86_400_000;
  const types = ['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE'];
  for (const incomeType of types) {
    let start = Math.max(sinceMs, now - 365 * 86_400_000);
    let guard = 0;
    while (start < now && guard++ < 15) {
      const end = Math.min(start + WINDOW, now);
      const rows = await signed<IncomeItem[]>(FAPI_BASE, '/fapi/v1/income', {
        incomeType, startTime: start, endTime: end, limit: 1000,
      });
      out.push(...rows);
      start = end + 1;
    }
  }
  return out;
}

export const binanceAdapter: VenueAdapter = {
  venue: 'Binance',
  needs: 'apiKey',
  async sync(acct: VenueAccount, sinceMs: number): Promise<SyncResult> {
    const positions: UnifiedPosition[] = [];

    const [spot, fut] = await Promise.all([
      signed<SpotAccount>(SPOT_BASE, '/api/v3/account'),
      signed<FuturesPosition[]>(FAPI_BASE, '/fapi/v2/positionRisk'),
    ]);

    const spotBalances = (spot.balances ?? [])
      .map(b => ({ asset: b.asset, qty: Number(b.free) + Number(b.locked) }))
      .filter(b => Number.isFinite(b.qty) && Math.abs(b.qty) > 1e-10);
    const prices = await spotPrices(spotBalances.map(b => b.asset));
    for (const b of spotBalances) {
      const mark = prices.get(b.asset) ?? null;
      positions.push({
        venue: 'Binance', accountId: acct.id, coin: b.asset, kind: 'spot',
        size: b.qty, entryPx: null, markPx: mark,
        notionalUsd: mark != null ? Math.abs(b.qty * mark) : 0,
        unrealizedPnl: null, leverage: null, liqPx: null,
        delta: STABLES.has(b.asset) ? 0 : b.qty, gamma: 0, vega: 0, theta: 0, greeksUsd: true,
      });
    }

    for (const p of fut ?? []) {
      const size = Number(p.positionAmt);
      if (!Number.isFinite(size) || Math.abs(size) <= 1e-12) continue;
      const mark = Number(p.markPrice) || null;
      positions.push({
        venue: 'Binance', accountId: acct.id, coin: coinOfSymbol(p.symbol), kind: 'perp',
        size, entryPx: Number(p.entryPrice) || null, markPx: mark,
        notionalUsd: Math.abs(Number(p.notional) || (mark ? size * mark : 0)),
        unrealizedPnl: Number(p.unRealizedProfit) || 0,
        leverage: Number(p.leverage) || null,
        liqPx: Number(p.liquidationPrice) || null,
        delta: size, gamma: 0, vega: 0, theta: 0, greeksUsd: true,
      });
    }

    const income = await fetchIncome(sinceMs);
    const fills: UnifiedFill[] = income
      .filter(i => Number(i.income) !== 0)
      .map(i => {
        const v = Number(i.income) || 0;
        const isFee = i.incomeType === 'COMMISSION';
        return {
          venue: 'Binance', accountId: acct.id,
          id: `inc-${i.incomeType}-${i.tranId}-${i.time}-${i.symbol || i.asset}`,
          coin: i.symbol ? coinOfSymbol(i.symbol) : i.asset,
          side: v >= 0 ? 'sell' : 'buy',
          px: 0, size: 0, notionalUsd: 0,
          time: i.time,
          closedPnl: isFee ? 0 : v,
          fee: isFee ? Math.abs(v) : 0,
          dir: i.incomeType === 'REALIZED_PNL' ? `已实现盈亏 ${i.symbol}`
            : i.incomeType === 'FUNDING_FEE' ? `资金费 ${i.symbol}`
            : `手续费 ${i.symbol || i.asset}`,
        };
      });

    const newestFillMs = fills.reduce((m, f) => Math.max(m, f.time), sinceMs);
    return { positions, fills, newestFillMs };
  },
};
