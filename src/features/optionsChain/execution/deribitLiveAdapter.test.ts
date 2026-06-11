import { describe, expect, it } from 'vitest';
import { createDeribitLiveAdapter, type DeribitTransport, type TradeIntent } from '.';

class FakeTransport implements DeribitTransport {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  constructor(private readonly response: unknown = { order: { order_id: 'abc', order_state: 'open' } }) {}

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    return this.response as T;
  }
}

const intent = (patch: Partial<TradeIntent> = {}): TradeIntent => ({
  mode: 'live',
  venue: 'deribit',
  accountId: 'deribit-default',
  source: 'options-chain',
  symbol: 'BTC-26JUN2026-100000-C',
  instrument: 'BTC-26JUN26-100000-C',
  side: 'buy',
  orderType: 'limit',
  qty: 1,
  price: 0.1,
  mark: 0.1,
  reduceOnly: false,
  postOnly: true,
  tif: 'GTC',
  greeks: { delta: 0.5, gamma: 0, theta: 0, vega: 0 },
  ...patch,
});

describe('createDeribitLiveAdapter', () => {
  it('rejects orders when not armed', async () => {
    const transport = new FakeTransport();
    const adapter = createDeribitLiveAdapter({
      armed: false,
      testnet: true,
      credentials: { clientId: 'id', clientSecret: 'secret' },
      transport,
    });

    const result = await adapter.placeOrder(intent());
    expect(result.status).toBe('rejected');
    expect(result.message).toContain('locked');
    expect(transport.calls).toHaveLength(0);
  });

  it('maps a limit intent to private/buy params', async () => {
    const transport = new FakeTransport({ order: { order_id: 'abc', order_state: 'filled', filled_amount: 1, average_price: 0.1 } });
    const adapter = createDeribitLiveAdapter({
      armed: true,
      testnet: true,
      credentials: { clientId: 'id', clientSecret: 'secret' },
      transport,
    });

    const result = await adapter.placeOrder(intent());
    expect(result).toMatchObject({ status: 'filled', orderId: 'abc', filledQty: 1, avgPrice: 0.1 });
    expect(transport.calls[0].method).toBe('private/buy');
    expect(transport.calls[0].params).toMatchObject({
      instrument_name: 'BTC-26JUN26-100000-C',
      amount: 1,
      type: 'limit',
      price: 0.1,
      time_in_force: 'good_til_cancelled',
      reduce_only: false,
      post_only: true,
    });
  });

  it('does not send price for market orders', async () => {
    const transport = new FakeTransport();
    const adapter = createDeribitLiveAdapter({
      armed: true,
      testnet: true,
      credentials: { clientId: 'id', clientSecret: 'secret' },
      transport,
    });

    await adapter.placeOrder(intent({ orderType: 'market', price: 0, postOnly: false, tif: 'IOC' }));
    expect(transport.calls[0].params).toMatchObject({
      type: 'market',
      time_in_force: 'immediate_or_cancel',
      post_only: false,
    });
    expect(transport.calls[0].params).not.toHaveProperty('price');
  });

  it('maps cancel and amend requests', async () => {
    const transport = new FakeTransport();
    const adapter = createDeribitLiveAdapter({
      armed: true,
      testnet: true,
      credentials: { clientId: 'id', clientSecret: 'secret' },
      transport,
    });

    await adapter.cancelOrder('order-1');
    await adapter.amendOrder('order-1', { price: 0.2, qty: 2 });

    expect(transport.calls[0]).toMatchObject({ method: 'private/cancel', params: { order_id: 'order-1' } });
    expect(transport.calls[1]).toMatchObject({ method: 'private/edit', params: { order_id: 'order-1', amount: 2, price: 0.2 } });
  });
});
