import { describe, expect, it } from 'vitest';
import { processDeribitResponse } from './deribit';

const rawOption = (o: Record<string, unknown>) => ({
  instrument_name: 'BTC-25DEC26-60000-C',
  mark_iv: 50,
  underlying_price: 60000,
  index_price: 60000,
  mark_price: 0.05,
  bid_price: 0.04,
  ask_price: 0.06,
  open_interest: 1,
  volume: 1,
  volume_usd: 3000,
  ...o,
});

describe('processDeribitResponse price units', () => {
  it('converts inverse coin-quoted option prices to USD', () => {
    const data = processDeribitResponse([
      rawOption({ instrument_name: 'BTC-25DEC26-60000-C' }),
    ]);
    const call = data.expiries[0].calls[0];
    expect(call.mark).toBeCloseTo(3000, 6);
    expect(call.bid).toBeCloseTo(2400, 6);
    expect(call.ask).toBeCloseTo(3600, 6);
  });

  it('keeps linear USDC option prices as USD values', () => {
    const data = processDeribitResponse([
      rawOption({
        instrument_name: 'BTC_USDC-25DEC26-60000-C',
        quote_currency: 'USDC',
        mark_price: 3000,
        bid_price: 2900,
        ask_price: 3100,
      }),
    ], 0, 0.02, 'usd');
    const call = data.expiries[0].calls[0];
    expect(call.mark).toBe(3000);
    expect(call.bid).toBe(2900);
    expect(call.ask).toBe(3100);
  });
});
