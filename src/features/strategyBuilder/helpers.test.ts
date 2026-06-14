import { describe, it, expect } from 'vitest';
import {
  roundToStep, years, optionPrice, payoffAt, buildChain,
  parseDeribitInstrument, rankTemplateForView,
} from './helpers';
import { MARKETS, TEMPLATES } from './constants';
import type { StrategyLeg } from './types';

// optionPrice / bs-math here take IV as a PERCENT (e.g. 50 = 50% vol).

describe('roundToStep / years', () => {
  it('rounds to the nearest step', () => {
    expect(roundToStep(65432, 1000)).toBe(65000);
    expect(roundToStep(65500, 1000)).toBe(66000);
  });
  it('years clamps negatives to 0 and divides by 365', () => {
    expect(years(365)).toBeCloseTo(1, 12);
    expect(years(-10)).toBe(0);
  });
});

describe('optionPrice', () => {
  it('ATM call ≈ put when S=K, r=0 (parity)', () => {
    expect(optionPrice(100, 100, 1, 50, 'call')).toBeCloseTo(optionPrice(100, 100, 1, 50, 'put'), 6);
  });
  it('degenerates to intrinsic at T=0', () => {
    expect(optionPrice(120, 100, 0, 50, 'call')).toBe(20);
    expect(optionPrice(80, 100, 0, 50, 'put')).toBe(20);
  });
});

describe('payoffAt', () => {
  const callLeg: StrategyLeg = { id: 'a', kind: 'option', side: 'buy', type: 'call', strike: 100, qty: 1, expiryDays: 30, entry: 0, iv: 50 };
  it('long call at expiry pays intrinsic as pnl', () => {
    expect(payoffAt(callLeg, 120, 0, 50, 'pnl')).toBeCloseTo(20, 6);
    expect(payoffAt(callLeg, 90, 0, 50, 'pnl')).toBeCloseTo(0, 6);
  });
  it('underlying leg pnl is linear in spot', () => {
    const u: StrategyLeg = { id: 'u', kind: 'underlying', side: 'buy', qty: 2, expiryDays: 0, entry: 100 };
    expect(payoffAt(u, 110, 30, 50, 'pnl')).toBeCloseTo(20, 6); // 2 × (110−100)
  });
});

describe('buildChain', () => {
  it('produces a call+put for each strike with valid quotes', () => {
    const chain = buildChain(MARKETS[0], 65000, 30, 0);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length % 2).toBe(0); // calls + puts
    expect(chain.some(c => c.type === 'call')).toBe(true);
    expect(chain.some(c => c.type === 'put')).toBe(true);
    for (const c of chain) {
      expect(c.ask).toBeGreaterThanOrEqual(c.bid);
      expect(c.mark).toBeGreaterThan(0);
    }
  });
});

describe('parseDeribitInstrument', () => {
  it('parses a well-formed option name', () => {
    const p = parseDeribitInstrument('BTC-25DEC30-70000-P');
    expect(p).not.toBeNull();
    expect(p!.strike).toBe(70000);
    expect(p!.type).toBe('put');
    expect(p!.expiryLabel).toBe('25DEC30');
  });
  it('rejects malformed names / bad type', () => {
    expect(parseDeribitInstrument('GARBAGE')).toBeNull();
    expect(parseDeribitInstrument('BTC-25DEC30-70000-X')).toBeNull();
  });
});

describe('rankTemplateForView', () => {
  const longCall = TEMPLATES.find(t => t.id === 'long-call')!;
  it('"all" view gives the custom template the top score', () => {
    const custom = TEMPLATES.find(t => t.id === 'custom')!;
    expect(rankTemplateForView(custom, 'all').score).toBe(99);
  });
  it('a bullish template scores higher under a bullish view than a bearish one', () => {
    expect(rankTemplateForView(longCall, 'bullish').score)
      .toBeGreaterThan(rankTemplateForView(longCall, 'bearish').score);
  });
});
