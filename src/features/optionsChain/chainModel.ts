// ═══════════════════════════════════════════════════════════════════════════════
// Options chain model — unifies Bybit + Deribit into one row shape for the grid.
//
// Bybit gives full live data (bid/ask/mark/IV/greeks/OI/vol). Deribit's public
// book-summary only gives IV/delta/OI/vol, so we derive the missing
// price + greeks columns with Black-Scholes from the real IV. Premiums are shown
// in USD for both sources.
// ═══════════════════════════════════════════════════════════════════════════════

import type { ExpiryGroup as BybitExpiryGroup, BybitOptionTicker } from './bybitTickers';
import type { ExpiryGroup as DeribitExpiryGroup } from '../../registry/data/deribit';
import {
  bsCall, bsPut,
  bsDelta as bsDeltaPct, bsGamma as bsGammaPct, bsVega as bsVegaPct, bsTheta as bsThetaPct,
} from '../../registry/lib/bs-math';

// ── Black-Scholes ───────────────────────────────────────────────────────────────
// Single authoritative implementation lives in registry/lib/bs-math.ts. The chain's
// public API takes sigma as a DECIMAL (0.5 = 50%) and a `call` boolean; bs-math takes
// IV as a PERCENT and a 'C'|'P' tag — these thin wrappers bridge the two conventions.

export const bsPrice = (S: number, K: number, T: number, sig: number, call: boolean) =>
  call ? bsCall(S, K, T, sig * 100) : bsPut(S, K, T, sig * 100);
export const bsDelta = (S: number, K: number, T: number, sig: number, call: boolean) =>
  bsDeltaPct(S, K, T, sig * 100, call ? 'C' : 'P');
export const bsGamma = (S: number, K: number, T: number, sig: number) =>
  bsGammaPct(S, K, T, sig * 100);
export const bsVega = (S: number, K: number, T: number, sig: number) =>
  bsVegaPct(S, K, T, sig * 100);
export const bsTheta = (S: number, K: number, T: number, sig: number, _call: boolean) =>
  bsThetaPct(S, K, T, sig * 100);

// ── Types ─────────────────────────────────────────────────────────────────────

export type Coin = 'BTC' | 'ETH';
export type DataSource = 'bybit' | 'deribit';

export interface Side {
  bid: number | null;
  ask: number | null;
  mark: number;
  iv: number;          // percent, e.g. 48.5
  ivBid: number | null;
  ivAsk: number | null;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  oi: number | null;
  dOI: number | null;
  size: number | null;
  pos: number | null;
  instrument?: string; // venue instrument/symbol — used to subscribe the live WS ticker
}

export interface ChainRow {
  strike: number;
  isATM: boolean;
  isITM: boolean;      // call ITM (strike < spot)
  call: Side;
  put: Side;
}

export interface ChainExpiry {
  key: string;
  label: string;       // short tab label
  dateLabel: string;   // "26 MAR 2027"
  daysToExp: number;
  expiryTs: number;    // UTC ms — for live DTE and cycle detection
  rows: ChainRow[];
  atmStrike: number;
  atmIV: number;       // percent
  spot: number;
}

export function emptySide(): Side {
  return {
    bid: null, ask: null, mark: 0, iv: 0, ivBid: null, ivAsk: null,
    delta: 0, gamma: 0, vega: 0, theta: 0, oi: null, dOI: null, size: null, pos: null,
  };
}

// ── Formatting helpers ──────────────────────────────────────────────────────────

const MON_S = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MON_S[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function expiryCycle(expiryTs: number): string {
  const d = new Date(expiryTs);
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const dow = d.getUTCDay();

  // Only Friday expiries can be quarterly/monthly/weekly
  if (dow === 5) {
    // Find the last Friday of this month
    const lastDate = new Date(Date.UTC(year, month + 1, 0));
    const lastDay = lastDate.getUTCDate();
    const lastDOW = lastDate.getUTCDay();
    const lastFriday = lastDay - ((lastDOW - 5 + 7) % 7);

    if (day === lastFriday) {
      return [2, 5, 8, 11].includes(month) ? '（每季度）' : '（每月）';
    }
    return '（每周）';
  }

  return '（每日）';
}

export function dteLabel(days: number, expiryTs?: number): string {
  const totalMin = Math.max(0, Math.round(days * 24 * 60));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const suffix = expiryTs ? expiryCycle(expiryTs) : (days < 2 ? '（每日）' : '');
  return `${d}d ${h}h ${m}m${suffix}`;
}

// ── Builders ────────────────────────────────────────────────────────────────────

function bybitSide(t: BybitOptionTicker | undefined): Side {
  if (!t) return emptySide();
  return {
    bid: t.bidPrice,
    ask: t.askPrice,
    mark: t.markPrice,
    iv: t.markIv * 100,
    ivBid: t.bidIv != null ? t.bidIv * 100 : null,
    ivAsk: t.askIv != null ? t.askIv * 100 : null,
    delta: t.delta,
    gamma: t.gamma,
    vega: t.vega,
    theta: t.theta,
    oi: t.openInterest,
    dOI: null,
    size: t.volume24h,
    pos: null,
    instrument: t.symbol,
  };
}

export function buildBybitExpiry(g: BybitExpiryGroup, spot: number): ChainExpiry {
  const callByK = new Map<number, BybitOptionTicker>();
  const putByK = new Map<number, BybitOptionTicker>();
  for (const c of g.calls) callByK.set(c.strike, c);
  for (const p of g.puts) putByK.set(p.strike, p);

  const strikes = [...new Set([...callByK.keys(), ...putByK.keys()])].sort((a, b) => a - b);
  const rows: ChainRow[] = strikes.map(K => ({
    strike: K,
    isATM: K === g.atmStrike,
    isITM: K < spot,
    call: bybitSide(callByK.get(K)),
    put: bybitSide(putByK.get(K)),
  }));

  const atmCall = callByK.get(g.atmStrike);
  return {
    key: `bybit-${g.label}`,
    label: g.label,
    dateLabel: fmtDate(g.expiryTs),
    daysToExp: g.daysToExp,
    expiryTs: g.expiryTs,
    rows,
    atmStrike: g.atmStrike,
    atmIV: atmCall ? atmCall.markIv * 100 : 0,
    spot,
  };
}

function deribitSide(strike: number, T: number, ivPct: number, spot: number, oi: number, vol: number, call: boolean, instrument?: string, real?: { mark: number; bid: number | null; ask: number | null }): Side {
  const sig = ivPct / 100;
  // Prefer real book-summary prices; fall back to Black-Scholes only if missing.
  const mark = real && real.mark > 0 ? real.mark : bsPrice(spot, strike, T, sig, call);
  const spread = Math.max(mark * 0.012, 0.5);
  return {
    bid: real ? real.bid : Math.max(mark - spread / 2, 0),
    ask: real ? real.ask : mark + spread / 2,
    mark,
    iv: ivPct,
    ivBid: ivPct - 0.4,
    ivAsk: ivPct + 0.4,
    delta: bsDelta(spot, strike, T, sig, call),
    gamma: bsGamma(spot, strike, T, sig),
    vega: bsVega(spot, strike, T, sig),
    theta: bsTheta(spot, strike, T, sig, call),
    oi,
    dOI: null,
    size: vol,
    pos: null,
    instrument,
  };
}

export function buildDeribitExpiry(g: DeribitExpiryGroup, spot: number): ChainExpiry {
  type P = { strike: number; iv: number; oi: number; volume: number; T: number; instrument: string; mark: number; bid: number | null; ask: number | null };
  const callByK = new Map<number, P>();
  const putByK = new Map<number, P>();
  for (const c of g.calls) callByK.set(c.strike, c);
  for (const p of g.puts) putByK.set(p.strike, p);

  const strikes = [...new Set([...callByK.keys(), ...putByK.keys()])].sort((a, b) => a - b);
  // ATM strike = closest to spot
  let atmStrike = strikes[0] ?? 0;
  for (const k of strikes) if (Math.abs(k - spot) < Math.abs(atmStrike - spot)) atmStrike = k;

  const rows: ChainRow[] = strikes.map(K => {
    const c = callByK.get(K);
    const p = putByK.get(K);
    return {
      strike: K,
      isATM: K === atmStrike,
      isITM: K < spot,
      call: c ? deribitSide(K, c.T, c.iv, spot, c.oi, c.volume, true, c.instrument, { mark: c.mark, bid: c.bid, ask: c.ask }) : emptySide(),
      put: p ? deribitSide(K, p.T, p.iv, spot, p.oi, p.volume, false, p.instrument, { mark: p.mark, bid: p.bid, ask: p.ask }) : emptySide(),
    };
  });

  // Compute DTE at display time from the stored expiry timestamp,
  // so it's not stale from the 5-minute data cache.
  const expiryTs = g.expiryTs;
  const liveDaysToExp = (expiryTs - Date.now()) / 86_400_000;
  return {
    key: `deribit-${g.label}`,
    label: g.label,
    dateLabel: fmtDate(expiryTs),
    daysToExp: liveDaysToExp,
    expiryTs,
    rows,
    atmStrike,
    atmIV: g.atmIV,
    spot,
  };
}

// ── Synthetic order book (visual depth around bid/ask) ───────────────────────────

export interface BookLevel { price: number; size: number; iv: number; total: number }

function xorRng(seed: number) {
  let s = seed | 0 || 1;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

export function genBook(bid: number | null, ask: number | null, iv: number, dec: number, seed: number) {
  const rng = xorRng(seed ^ 0xdead);
  const tick = Math.max(Math.pow(10, -dec), 0.0001);
  const asks: BookLevel[] = [];
  let cumAsk = 0, ap = ask ?? (bid ?? 1) * 1.01;
  for (let i = 0; i < 8; i++) {
    const size = parseFloat((rng() * 4 + 0.05).toFixed(2));
    cumAsk += size;
    asks.push({ price: parseFloat((ap + i * tick * (1 + Math.floor(rng() * 4))).toFixed(dec + 1)), size, iv: parseFloat((iv + 0.3 * i + rng() * 0.2).toFixed(1)), total: parseFloat(cumAsk.toFixed(2)) });
  }
  const bids: BookLevel[] = [];
  let cumBid = 0, bp = bid ?? (ask ?? 1) * 0.99;
  for (let i = 0; i < 8; i++) {
    const size = parseFloat((rng() * 4 + 0.05).toFixed(2));
    cumBid += size;
    bids.push({ price: parseFloat((bp - i * tick * (1 + Math.floor(rng() * 4))).toFixed(dec + 1)), size, iv: parseFloat((iv - 0.3 * i - rng() * 0.2).toFixed(1)), total: parseFloat(cumBid.toFixed(2)) });
  }
  return { asks, bids };
}

export function seedFor(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
