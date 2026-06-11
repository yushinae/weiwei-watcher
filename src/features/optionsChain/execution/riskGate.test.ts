import { describe, expect, it } from 'vitest';
import { liveExecutionDisabledAdapter, runRiskGate, type RiskGateInput } from '.';

const base: RiskGateInput = {
  mode: 'sim',
  bid: 100,
  ask: 104,
  mark: 102,
  qty: 0.1,
  price: 103,
  orderType: 'limit',
  chainKind: 'live',
  chainAgeMs: 500,
  spotKind: 'live',
  notional: 10.3,
  deltaNotional: 1_000,
};

describe('runRiskGate', () => {
  it('keeps sim mode permissive for large notional', () => {
    const result = runRiskGate({ ...base, notional: 9_999, deltaNotional: 999_999 });
    expect(result.blocking).toBe(false);
    expect(result.checks.find(c => c.id === 'live-premium-cap')).toBeUndefined();
  });

  it('blocks live orders above hard premium and delta caps', () => {
    const result = runRiskGate({
      ...base,
      mode: 'live',
      notional: 9_999,
      deltaNotional: 999_999,
      liveReady: { armed: true, credentials: true, venueSupported: true },
    });
    expect(result.level).toBe('block');
    expect(result.blocking).toBe(true);
    expect(result.checks.find(c => c.id === 'live-premium-cap')?.level).toBe('block');
    expect(result.checks.find(c => c.id === 'live-delta-cap')?.level).toBe('block');
  });

  it('blocks live orders until venue, credentials, and armed switch are ready', () => {
    const result = runRiskGate({
      ...base,
      mode: 'live',
      liveReady: { armed: false, credentials: false, venueSupported: false },
    });
    expect(result.level).toBe('block');
    expect(result.checks.find(c => c.id === 'live-venue')?.level).toBe('block');
    expect(result.checks.find(c => c.id === 'live-credentials')?.level).toBe('block');
    expect(result.checks.find(c => c.id === 'live-armed')?.level).toBe('block');
  });
});

describe('liveExecutionDisabledAdapter', () => {
  it('rejects live orders until a venue adapter is explicitly wired', async () => {
    const result = await liveExecutionDisabledAdapter.placeOrder({
      mode: 'live',
      venue: 'deribit',
      accountId: 'deribit-default',
      symbol: 'BTC-26JUN2026-100000-C',
      side: 'buy',
      orderType: 'limit',
      qty: 1,
      price: 100,
      mark: 100,
      reduceOnly: false,
      postOnly: false,
      tif: 'GTC',
      source: 'options-chain',
      greeks: { delta: 0.5, gamma: 0, theta: 0, vega: 0 },
    });

    expect(result.status).toBe('rejected');
    expect(result.message).toContain('Live execution is not wired yet');
  });
});
