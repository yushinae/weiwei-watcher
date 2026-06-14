import { describe, it, expect } from 'vitest';
import { bsPrice, bsGreeks, hoursToYears } from './greeks';

// Convention reminder: sigma is DECIMAL here (0.5 = 50% vol).

describe('bsPrice', () => {
  it('ATM call ≈ put when r=0 and S=K (put-call parity)', () => {
    expect(bsPrice(100, 100, 1, 0.5, 'call')).toBeCloseTo(bsPrice(100, 100, 1, 0.5, 'put'), 6);
  });

  it('deep ITM call ≥ intrinsic; far OTM call ≈ 0', () => {
    expect(bsPrice(200, 100, 1, 0.5, 'call')).toBeGreaterThan(100); // ≥ S−K
    expect(bsPrice(50, 100, 0.1, 0.5, 'call')).toBeLessThan(5);
  });

  it('call price increases with spot', () => {
    expect(bsPrice(110, 100, 1, 0.5, 'call')).toBeGreaterThan(bsPrice(100, 100, 1, 0.5, 'call'));
  });

  it('degenerates to intrinsic at T=0', () => {
    expect(bsPrice(120, 100, 0, 0.5, 'call')).toBe(20);
    expect(bsPrice(80, 100, 0, 0.5, 'put')).toBe(20);
  });
});

describe('bsGreeks', () => {
  it('first-order signs: ATM call delta∈(0,1), gamma/vega>0, theta<0', () => {
    const g = bsGreeks(100, 100, 1, 0.5, 'call');
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(1);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });

  it('put delta = call delta − 1; gamma & vega match (strike/type independent of right)', () => {
    const c = bsGreeks(100, 105, 0.5, 0.6, 'call');
    const p = bsGreeks(100, 105, 0.5, 0.6, 'put');
    expect(c.delta - p.delta).toBeCloseTo(1, 9);
    expect(c.gamma).toBeCloseTo(p.gamma, 12);
    expect(c.vega).toBeCloseTo(p.vega, 12);
  });

  it('exposes higher-order greeks as finite numbers', () => {
    const g = bsGreeks(65000, 64000, 0.08, 0.55, 'call');
    for (const k of ['vanna', 'volga', 'charm', 'speed'] as const) {
      expect(Number.isFinite(g[k])).toBe(true);
    }
  });

  it('degenerates safely at T=0 / σ=0 (gamma 0, delta ±1/0 by moneyness)', () => {
    expect(bsGreeks(100, 100, 0, 0.5, 'call').gamma).toBe(0);
    expect(bsGreeks(120, 100, 0, 0.5, 'call').delta).toBe(1);
    expect(bsGreeks(80, 100, 0, 0.5, 'put').delta).toBe(-1);
  });
});

describe('hoursToYears', () => {
  it('converts a 365-day year', () => {
    expect(hoursToYears(24 * 365)).toBeCloseTo(1, 12);
    expect(hoursToYears(24)).toBeCloseTo(1 / 365, 12);
  });
});
