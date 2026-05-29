// ═══════════════════════════════════════════════════════════════════════════════
// Convert Bybit option positions into PositionBuilder ImportLegs.
//
// Multi-coin handling: PositionBuilder currently models a single symbol at a
// time (BTC | ETH | SOL). When the user has positions across coins, we pick
// the coin with the most positions as the primary and report the others so
// the UI can warn.
// ═══════════════════════════════════════════════════════════════════════════════

import type { BybitOptionPosition } from './rest';
import type { ImportLeg, PendingImport } from '../positionBuilder/import';

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

type Coin = 'BTC' | 'ETH' | 'SOL';

interface ParsedSymbol { coin: Coin; expiryTs: number; strike: number; type: 'call' | 'put' }

function parseSymbol(symbol: string): ParsedSymbol | null {
  const parts = symbol.split('-');
  if (parts.length !== 4) return null;
  const coin = parts[0];
  if (coin !== 'BTC' && coin !== 'ETH' && coin !== 'SOL') return null;
  const day = parseInt(parts[1].slice(0, 2));
  const mon = MONTH_MAP[parts[1].slice(2, 5)];
  const yr  = 2000 + parseInt(parts[1].slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  const expiryTs = Date.UTC(yr, mon, day, 8, 0, 0);
  const strike = parseInt(parts[2]);
  if (isNaN(strike)) return null;
  const type = parts[3] === 'C' ? 'call' : parts[3] === 'P' ? 'put' : null;
  if (!type) return null;
  return { coin, expiryTs, strike, type };
}

export interface ConvertResult {
  primary: PendingImport | null;
  /** Coins that had positions but were skipped because they aren't the primary. */
  skippedCoins: { coin: Coin; count: number }[];
  /** Positions that couldn't be parsed (unknown symbol shape, expired, etc.). */
  unparseable: number;
}

export function bybitToImport(positions: BybitOptionPosition[]): ConvertResult {
  const now = Date.now();
  const byCoin = new Map<Coin, ImportLeg[]>();
  let unparseable = 0;

  for (const p of positions) {
    const parsed = parseSymbol(p.symbol);
    if (!parsed) { unparseable++; continue; }
    if (parsed.expiryTs <= now) { unparseable++; continue; }
    const size = parseFloat(p.size);
    if (isNaN(size) || size === 0) continue;

    const leg: ImportLeg = {
      side: p.side === 'Sell' ? -1 : 1,
      type: parsed.type,
      K: parsed.strike,
      qty: Math.abs(size),
      hoursToExpiry: Math.max(1, (parsed.expiryTs - now) / 3_600_000),
      entryPremium: parseFloat(p.avgPrice) || 0,
      expiryTs: parsed.expiryTs,
    };
    const list = byCoin.get(parsed.coin) ?? [];
    list.push(leg);
    byCoin.set(parsed.coin, list);
  }

  if (byCoin.size === 0) return { primary: null, skippedCoins: [], unparseable };

  // Pick the coin with the most positions; ties resolved by BTC > ETH > SOL.
  const order: Coin[] = ['BTC', 'ETH', 'SOL'];
  const sorted = [...byCoin.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });
  const [primaryCoin, primaryLegs] = sorted[0];
  const skippedCoins = sorted.slice(1).map(([coin, legs]) => ({ coin, count: legs.length }));

  return {
    primary: { symbol: primaryCoin, legs: primaryLegs, source: 'Bybit' },
    skippedCoins,
    unparseable,
  };
}
