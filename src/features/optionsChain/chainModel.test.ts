import { describe, it, expect } from 'vitest';
import {
  bsPrice, bsDelta, bsGamma, bsVega, bsTheta,
  buildBybitExpiry, buildDeribitExpiry, genBook, dteLabel, seedFor, emptySide,
} from './chainModel';
import type { BybitOptionTicker, ExpiryGroup as BybitExpiryGroup } from './bybitTickers';
import type { ParsedOption, ExpiryGroup as DeribitExpiryGroup } from '../../registry/data/deribit';

// ── Black-Scholes ───────────────────────────────────────────────────────────

describe('Black-Scholes', () => {
  it('ATM call delta ≈ 0.6, put = call − 1', () => {
    const cd = bsDelta(100, 100, 1, 0.5, true);
    const pd = bsDelta(100, 100, 1, 0.5, false);
    expect(cd).toBeGreaterThan(0.5);
    expect(cd).toBeLessThan(0.7);
    expect(cd - pd).toBeCloseTo(1, 6); // call − put delta = 1
  });

  it('ATM call price ≈ put price (r=0, S=K)', () => {
    const c = bsPrice(100, 100, 1, 0.5, true);
    const p = bsPrice(100, 100, 1, 0.5, false);
    expect(c).toBeCloseTo(p, 6);
    expect(c).toBeGreaterThan(0);
  });

  it('deep ITM call ≥ intrinsic; far OTM call ≈ 0', () => {
    expect(bsPrice(200, 100, 1, 0.5, true)).toBeGreaterThan(100); // ≥ S−K
    expect(bsPrice(50, 100, 0.1, 0.5, true)).toBeLessThan(5);
  });

  it('call price is monotonically increasing in spot', () => {
    expect(bsPrice(110, 100, 1, 0.5, true)).toBeGreaterThan(bsPrice(100, 100, 1, 0.5, true));
  });

  it('gamma & vega > 0; call theta < 0 (time decay)', () => {
    expect(bsGamma(100, 100, 1, 0.5)).toBeGreaterThan(0);
    expect(bsVega(100, 100, 1, 0.5)).toBeGreaterThan(0);
    expect(bsTheta(100, 100, 1, 0.5, true)).toBeLessThan(0);
  });

  it('degenerates safely at T=0 / σ=0', () => {
    expect(bsPrice(120, 100, 0, 0.5, true)).toBe(20); // intrinsic
    expect(bsGamma(100, 100, 0, 0.5)).toBe(0);
  });
});

// ── Synthetic order book ──────────────────────────────────────────────────────

describe('genBook', () => {
  it('asks ascend & bids descend around the quote; totals are cumulative', () => {
    const { asks, bids } = genBook(9, 11, 50, 2, 123);
    expect(asks).toHaveLength(8);
    expect(bids).toHaveLength(8);
    expect(asks[7].price).toBeGreaterThan(asks[0].price);
    expect(bids[7].price).toBeLessThan(bids[0].price);
    expect(asks[7].total).toBeGreaterThan(asks[0].total);
    expect(bids[7].total).toBeGreaterThan(bids[0].total);
    for (const lvl of [...asks, ...bids]) expect(lvl.size).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    expect(genBook(9, 11, 50, 2, 7)).toEqual(genBook(9, 11, 50, 2, 7));
  });
});

// ── Small utils ───────────────────────────────────────────────────────────────

describe('utils', () => {
  it('dteLabel formats hours/days', () => {
    expect(dteLabel(0.5)).toBe('12h');
    expect(dteLabel(13)).toBe('13天');
  });
  it('seedFor is stable & distinguishes inputs', () => {
    expect(seedFor('abc')).toBe(seedFor('abc'));
    expect(seedFor('abc')).not.toBe(seedFor('abd'));
  });
  it('emptySide is all null/zero, no instrument', () => {
    const s = emptySide();
    expect(s.mark).toBe(0);
    expect(s.bid).toBeNull();
    expect(s.instrument).toBeUndefined();
  });
});

// ── Builders (REST → unified ChainExpiry) ─────────────────────────────────────

const bybitTicker = (o: Partial<BybitOptionTicker>): BybitOptionTicker => ({
  symbol: 'BTC-12JUN26-100-C-USDT', coin: 'BTC', expiryStr: '12JUN26', expiryTs: 1_800_000_000_000,
  strike: 100, type: 'C', bidPrice: 9, askPrice: 11, lastPrice: 10, markPrice: 10,
  indexPrice: 100, underlyingPrice: 100, bidIv: 0.5, askIv: 0.52, markIv: 0.51,
  delta: 0.5, gamma: 0.01, vega: 0.1, theta: -0.05, openInterest: 100, volume24h: 50,
  turnover24h: 5000, change24h: 0.01, ...o,
});

const parsed = (o: Partial<ParsedOption>): ParsedOption => ({
  strike: 100, type: 'C', daysToExp: 12, T: 12 / 365, iv: 51, spot: 100, delta: 0.5,
  oi: 100, volume: 50, instrument: 'BTC-12JUN26-100-C', mark: 1000, bid: 990, ask: 1010, ...o,
});

describe('buildBybitExpiry', () => {
  it('maps tickers → rows; IV ×100, carries symbol as instrument', () => {
    const g: BybitExpiryGroup = {
      label: '12JUN26', expiryTs: 1_800_000_000_000, daysToExp: 12,
      calls: [bybitTicker({ type: 'C', markIv: 0.32 })],
      puts: [bybitTicker({ type: 'P', symbol: 'BTC-12JUN26-100-P-USDT', strike: 100 })],
      atmStrike: 100,
    };
    const exp = buildBybitExpiry(g, 100);
    expect(exp.rows).toHaveLength(1);
    const row = exp.rows[0];
    expect(row.strike).toBe(100);
    expect(row.isATM).toBe(true);
    expect(row.call.mark).toBe(10);
    expect(row.call.iv).toBeCloseTo(32, 6);       // 0.32 → 32%
    expect(row.call.instrument).toBe('BTC-12JUN26-100-C-USDT');
    expect(row.put.instrument).toBe('BTC-12JUN26-100-P-USDT');
  });
});

describe('buildDeribitExpiry', () => {
  it('uses REAL book mark/bid/ask (not Black-Scholes) and the instrument name', () => {
    const g: DeribitExpiryGroup = {
      label: '12D', daysToExp: 12,
      calls: [parsed({ type: 'C', mark: 1234, bid: 1200, ask: 1260 })],
      puts: [], atmIV: 51, rr25: 0, bf25: 0, rr10: 0, bf10: 0,
    };
    const exp = buildDeribitExpiry(g, 70000);
    const call = exp.rows[0].call;
    expect(call.mark).toBe(1234);          // real, not bsPrice(...)
    expect(call.bid).toBe(1200);
    expect(call.ask).toBe(1260);
    expect(call.instrument).toBe('BTC-12JUN26-100-C');
  });

  it('falls back to Black-Scholes when book mark is missing', () => {
    const g: DeribitExpiryGroup = {
      label: '12D', daysToExp: 12,
      calls: [parsed({ type: 'C', strike: 70000, iv: 50, mark: 0, bid: null, ask: null })],
      puts: [], atmIV: 50, rr25: 0, bf25: 0, rr10: 0, bf10: 0,
    };
    const exp = buildDeribitExpiry(g, 70000);
    expect(exp.rows[0].call.mark).toBeGreaterThan(0); // BS-derived fallback
  });
});
