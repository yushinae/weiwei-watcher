// ═══════════════════════════════════════════════════════════════════════════════
// Bybit V5 REST client.
//
// 现在所有签名请求走后端代理（/api/proxy/bybit），Key 不出浏览器。
// 后端没跑时仍回退到本地签名（从 .env / localStorage 读 Key）。
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

/**
 * 优先走后端代理（安全），后端不可用时回退到本地签名（env/localStorage）。
 */
export async function bybitGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  // 尝试后端代理
  try {
    const resp = await fetch('/api/proxy/bybit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, params }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ retMsg: 'HTTP ' + resp.status }));
      if (err.retCode === 10001) throw new BybitAuthError();
      throw new BybitApiError(err.retCode ?? -1, err.retMsg ?? `HTTP ${resp.status}`);
    }
    const json = await resp.json();
    if (json.retCode !== 0) throw new BybitApiError(json.retCode, json.retMsg ?? 'unknown error');
    return json.result as T;
  } catch (e) {
    // 网络错误（后端没跑）→ 回退本地签名
    if (e instanceof BybitAuthError || e instanceof BybitApiError) throw e;
    return fallbackBybitGet<T>(path, params);
  }
}

/** 本地签名版（后端不可用时的退路） */
async function fallbackBybitGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const creds = await getCredentials();
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
  // 不需要签名的公开接口
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
  const coins = baseCoin ? [baseCoin] : (['BTC', 'ETH', 'SOL'] as const);
  const out: BybitOptionPosition[] = [];
  for (const c of coins) {
    try {
      const result = await bybitGet<BybitListResult<BybitOptionPosition>>('/v5/position/list', {
        category: 'option',
        baseCoin: c,
        limit: 200,
      });
      out.push(...result.list.filter(p => parseFloat(p.size) !== 0));
    } catch (e) {
      if (e instanceof BybitAuthError) throw e;
    }
  }
  return out;
}
