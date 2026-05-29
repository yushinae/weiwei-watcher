// ═══════════════════════════════════════════════════════════════════════════════
// Bybit V5 signed REST client.
//
// Signature spec (V5):
//   payload   = timestamp + apiKey + recvWindow + (queryString | bodyString)
//   signature = HMAC_SHA256(apiSecret, payload), hex-encoded
//
// Headers:
//   X-BAPI-API-KEY, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW, X-BAPI-SIGN
//
// All requests go through the /bybit-api Vite proxy so we don't hit CORS.
// ═══════════════════════════════════════════════════════════════════════════════

import { getCredentials } from './auth';
import { hmacSha256Hex } from './crypto';

const BASE = '/bybit-api';
const RECV_WINDOW = '5000';

export class BybitAuthError extends Error {
  constructor() { super('Bybit credentials locked or missing'); }
}

export class BybitApiError extends Error {
  readonly retCode: number;
  constructor(retCode: number, retMsg: string) {
    super(`Bybit ${retCode}: ${retMsg}`);
    this.retCode = retCode;
  }
}

function paramsToQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export async function bybitGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const creds = getCredentials();
  if (!creds) throw new BybitAuthError();

  const queryString = paramsToQuery(params);
  const timestamp   = Date.now().toString();
  const payload     = timestamp + creds.apiKey + RECV_WINDOW + queryString;
  const signature   = await hmacSha256Hex(creds.secret, payload);

  const url = `${BASE}${path}${queryString ? `?${queryString}` : ''}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY':     creds.apiKey,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN':        signature,
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.retCode !== 0) throw new BybitApiError(json.retCode, json.retMsg ?? 'unknown error');
  return json.result as T;
}

// ── Server time check — useful to detect clock skew ──────────────────────────
export async function getBybitServerTime(): Promise<number> {
  const resp = await fetch(`${BASE}/v5/market/time`);
  const json = await resp.json();
  return Number(json.result?.timeSecond ?? 0) * 1000;
}

// ── Positions ────────────────────────────────────────────────────────────────

export interface BybitOptionPosition {
  symbol: string;             // "BTC-25APR25-90000-C"
  side: 'Buy' | 'Sell' | '';
  size: string;               // contracts, as string
  avgPrice: string;           // entry price (USDC per contract)
  markPrice: string;
  unrealisedPnl: string;
  positionValue: string;
  delta?: string;
  gamma?: string;
  vega?: string;
  theta?: string;
  positionIM?: string;        // initial margin
  positionMM?: string;        // maintenance margin
  createdTime?: string;
  updatedTime?: string;
}

interface BybitListResult<T> {
  category: string;
  list: T[];
  nextPageCursor?: string;
}

export async function fetchBybitOptionPositions(baseCoin?: 'BTC' | 'ETH' | 'SOL'): Promise<BybitOptionPosition[]> {
  // category=option requires baseCoin (Bybit V5). Pull each requested coin, merge.
  const coins = baseCoin ? [baseCoin] : (['BTC', 'ETH', 'SOL'] as const);
  const out: BybitOptionPosition[] = [];
  for (const c of coins) {
    try {
      const result = await bybitGet<BybitListResult<BybitOptionPosition>>('/v5/position/list', {
        category: 'option',
        baseCoin: c,
        limit: 200,
      });
      // Filter out zero-size positions (Bybit returns historical entries with size=0)
      out.push(...result.list.filter(p => parseFloat(p.size) !== 0));
    } catch (e) {
      // One coin failing shouldn't kill the whole fetch
      if (e instanceof BybitAuthError) throw e;
      // swallow other per-coin errors (e.g. user has no SOL options)
    }
  }
  return out;
}
