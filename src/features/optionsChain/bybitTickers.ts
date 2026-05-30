// ═══════════════════════════════════════════════════════════════════════════════
// Bybit option ticker client — public API, no auth needed.
//
// Endpoint: GET /v5/market/tickers?category=option&baseCoin=BTC|ETH
// Returns: bid/ask/mark price, IV, Greeks, OI, volume for every option.
//
// All IVs from Bybit are decimals (0.43 → 43%). We store as-decimal and let the
// UI format for display. Premiums are in USDT (unlike Deribit which is in BTC).
// ═══════════════════════════════════════════════════════════════════════════════

import { subscribeData } from '../../registry/data/poller';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BybitOptionTicker {
  symbol: string;               // "BTC-26MAR27-78000-C-USDT"
  coin: 'BTC' | 'ETH';
  expiryStr: string;            // "26MAR27"
  expiryTs: number;             // deliveryTime from instruments, or parsed
  strike: number;
  type: 'C' | 'P';
  bidPrice: number | null;
  askPrice: number | null;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  underlyingPrice: number;
  bidIv: number | null;         // decimal (0.43 = 43%)
  askIv: number | null;
  markIv: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  openInterest: number;
  volume24h: number;
  turnover24h: number;
  change24h: number;
}

export interface ExpiryGroup {
  label: string;                // "26MAR27"
  expiryTs: number;
  daysToExp: number;
  calls: BybitOptionTicker[];
  puts: BybitOptionTicker[];
  atmStrike: number;
}

export interface OptionChainData {
  coin: 'BTC' | 'ETH';
  spot: number;
  expiries: ExpiryGroup[];
  fetchedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Parse "26MAR27" → Date (UTC 08:00 = Deribit/Bybit standard delivery hour). */
function parseBybitExpiry(s: string): number | null {
  const day = parseInt(s.slice(0, 2));
  const mon = MONTH_MAP[s.slice(2, 5)];
  const yr  = 2000 + parseInt(s.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return Date.UTC(yr, mon, day, 8, 0, 0);
}

/** Parse "BTC-26MAR27-78000-C-USDT" → parts. */
function parseSymbol(symbol: string): {
  coin: 'BTC' | 'ETH'; expiryStr: string; expiryTs: number; strike: number; type: 'C' | 'P';
} | null {
  // Strip -USDT suffix if present
  const s = symbol.endsWith('-USDT') ? symbol.slice(0, -5) : symbol;
  const parts = s.split('-');
  if (parts.length !== 4) return null;
  const [coinStr, expiryStr, strikeStr, typeStr] = parts;
  const coin = coinStr === 'BTC' ? 'BTC' as const : coinStr === 'ETH' ? 'ETH' as const : null;
  if (!coin || (typeStr !== 'C' && typeStr !== 'P')) return null;
  const strike = parseInt(strikeStr);
  if (isNaN(strike)) return null;
  const expiryTs = parseBybitExpiry(expiryStr);
  if (!expiryTs) return null;
  return { coin, expiryStr, expiryTs, strike, type: typeStr };
}

function parseNum(s: string | undefined, fallback: number | null = null): number | null {
  if (s === undefined || s === '') return fallback;
  const n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

const BASE = '/bybit-api';

export async function fetchBybitTickers(coin: 'BTC' | 'ETH'): Promise<BybitOptionTicker[]> {
  const url = `${BASE}/v5/market/tickers?category=option&baseCoin=${coin}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.retCode !== 0) throw new Error(`Bybit ${json.retCode}: ${json.retMsg}`);
  const rawList: any[] = json.result?.list ?? [];

  const tickers: BybitOptionTicker[] = [];

  for (const raw of rawList) {
    const parsed = parseSymbol(raw.symbol);
    if (!parsed) continue;
    const daysToExp = (parsed.expiryTs - Date.now()) / 86_400_000;
    if (daysToExp < 0.5 || daysToExp > 365) continue; // skip expired / too far

    const ticker: BybitOptionTicker = {
      symbol: raw.symbol,
      coin: parsed.coin,
      expiryStr: parsed.expiryStr,
      expiryTs: parsed.expiryTs,
      strike: parsed.strike,
      type: parsed.type,
      bidPrice: parseNum(raw.bid1Price),
      askPrice: parseNum(raw.ask1Price),
      lastPrice: parseNum(raw.lastPrice, 0)!,
      markPrice: parseNum(raw.markPrice, 0)!,
      indexPrice: parseNum(raw.indexPrice, 0)!,
      underlyingPrice: parseNum(raw.underlyingPrice, 0)!,
      bidIv: parseNum(raw.bid1Iv),
      askIv: parseNum(raw.ask1Iv),
      markIv: parseNum(raw.markIv, 0)!,
      delta: parseNum(raw.delta, 0)!,
      gamma: parseNum(raw.gamma, 0)!,
      vega: parseNum(raw.vega, 0)!,
      theta: parseNum(raw.theta, 0)!,
      openInterest: parseNum(raw.openInterest, 0)!,
      volume24h: parseNum(raw.volume24h, 0)!,
      turnover24h: parseNum(raw.turnover24h, 0)!,
      change24h: parseNum(raw.change24h, 0)!,
    };
    tickers.push(ticker);
  }

  return tickers;
}

/** Organize raw tickers into an OptionChainData (grouped by expiry). */
export function organizeChain(coin: 'BTC' | 'ETH', tickers: BybitOptionTicker[]): OptionChainData {
  const now = Date.now();
  const spot = tickers.length > 0 ? tickers[0].indexPrice : 0;

  // Group by expiry
  const groups = new Map<string, BybitOptionTicker[]>();
  for (const t of tickers) {
    const key = `${t.expiryStr}_${t.expiryTs}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const expiries: ExpiryGroup[] = [];

  for (const [key, opts] of [...groups.entries()].sort((a, b) => {
    const tsA = a[1][0].expiryTs;
    const tsB = b[1][0].expiryTs;
    return tsA - tsB;
  })) {
    const daysToExp = (opts[0].expiryTs - now) / 86_400_000;
    if (daysToExp < 1 || daysToExp > 180) continue;

    const calls = opts.filter(o => o.type === 'C').sort((a, b) => a.strike - b.strike);
    const puts  = opts.filter(o => o.type === 'P').sort((a, b) => a.strike - b.strike);

    // ATM strike: closest to index price
    const atmStrike = calls.reduce(
      (best, o) => Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best,
      calls[0],
    )?.strike ?? 0;

    expiries.push({
      label: opts[0].expiryStr,
      expiryTs: opts[0].expiryTs,
      daysToExp,
      calls,
      puts,
      atmStrike,
    });
  }

  return { coin, spot, expiries, fetchedAt: now };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CHAIN_CACHE = new Map<string, { data: OptionChainData; ts: number }>();
const CHAIN_TTL = 30_000; // 30 seconds — options prices move fast

export async function fetchOptionChain(coin: 'BTC' | 'ETH'): Promise<OptionChainData> {
  const cached = CHAIN_CACHE.get(coin);
  if (cached && Date.now() - cached.ts < CHAIN_TTL) return cached.data;

  const tickers = await fetchBybitTickers(coin);
  const data = organizeChain(coin, tickers);
  CHAIN_CACHE.set(coin, { data, ts: Date.now() });
  return data;
}

// ── React Hook ────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';

export function useOptionChain(coin: 'BTC' | 'ETH') {
  const [data, setData] = useState<OptionChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const unsub = subscribeData<OptionChainData>(
      `option-chain-${coin}`,
      () => fetchOptionChain(coin),
      CHAIN_TTL,
      d => {
        if (!active) return;
        setLoading(false);
        setError(null);
        setData(prev => (prev && prev.fetchedAt === d.fetchedAt ? prev : d));
      },
    );

    return () => { active = false; unsub(); };
  }, [coin]);

  return { data, loading, error };
}
