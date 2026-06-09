import { describe, expect, it } from 'vitest';
import { __bookMarkFeedTest } from './useBookMarkFeed';

describe('book mark feed normalization', () => {
  it('keeps Bybit option marks in quote currency', () => {
    expect(__bookMarkFeedTest.normalizeBybitMark({ markPrice: '123.45' })).toBe(123.45);
    expect(__bookMarkFeedTest.normalizeBybitMark({ markPrice: '0' })).toBeNull();
  });

  it('converts Deribit inverse coin marks to USD', () => {
    const mark = __bookMarkFeedTest.normalizeDeribitMark({
      instrument_name: 'BTC-12JUN26-60000-C',
      mark_price: 0.012,
      underlying_price: 62_000,
    });
    expect(mark).toBeCloseTo(744, 6);
  });

  it('keeps Deribit USDC linear marks as USD', () => {
    const mark = __bookMarkFeedTest.normalizeDeribitMark({
      instrument_name: 'BTC_USDC-12JUN26-60000-C',
      mark_price: 744,
      underlying_price: 62_000,
    });
    expect(mark).toBe(744);
  });
});
