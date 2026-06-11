import { describe, expect, it, vi } from 'vitest';
import { createBybitLiveAdapter, type BybitTransport, type TradeIntent } from '.';

vi.mock('../../bybit/auth', () => ({
  isConfigured: () => true,
  isEnvConfigured: () => false,
  getEnvCredentials: () => null,
}));

class FakeTransport implements BybitTransport {
  calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    this.calls.push({ path, body });
    return { orderId: 'bybit-order-1' } as T;
  }
}

const intent = (patch: Partial<TradeIntent> = {}): TradeIntent => ({
  mode: 'live',
  venue: 'bybit',
  accountId: 'bybit-mainnet',
  source: 'options-chain',
  symbol: 'BTC-26JUN26-100000-C',
  instrument: 'BTC-26JUN26-100000-C',
  side: 'buy',
  orderType: 'limit',
  qty: 1,
  price: 100,
  mark: 100,
  reduceOnly: false,
  postOnly: true,
  tif: 'GTC',
  greeks: { delta: 0.5, gamma: 0, theta: 0, vega: 0 },
  ...patch,
});

describe('createBybitLiveAdapter', () => {
  it('rejects when not armed', async () => {
    const transport = new FakeTransport();
    const adapter = createBybitLiveAdapter({ armed: false, testnet: false, transport });
    const result = await adapter.placeOrder(intent());
    expect(result.status).toBe('rejected');
    expect(result.message).toContain('locked');
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects testnet until a testnet proxy is wired', async () => {
    const transport = new FakeTransport();
    const adapter = createBybitLiveAdapter({ armed: true, testnet: true, transport });
    const result = await adapter.placeOrder(intent());
    expect(result.status).toBe('rejected');
    expect(result.message).toContain('testnet');
    expect(transport.calls).toHaveLength(0);
  });

  it('maps a limit option intent to /v5/order/create', async () => {
    const transport = new FakeTransport();
    const adapter = createBybitLiveAdapter({ armed: true, testnet: false, transport });
    const result = await adapter.placeOrder(intent());
    expect(result).toMatchObject({ status: 'pending', orderId: 'bybit-order-1' });
    expect(transport.calls[0].path).toBe('/v5/order/create');
    expect(transport.calls[0].body).toMatchObject({
      category: 'option',
      symbol: 'BTC-26JUN26-100000-C',
      side: 'Buy',
      orderType: 'Limit',
      qty: '1',
      price: '100',
      timeInForce: 'PostOnly',
      reduceOnly: false,
    });
  });

  it('does not send price for market orders', async () => {
    const transport = new FakeTransport();
    const adapter = createBybitLiveAdapter({ armed: true, testnet: false, transport });
    await adapter.placeOrder(intent({ orderType: 'market', price: 0, postOnly: false, tif: 'IOC' }));
    expect(transport.calls[0].body).toMatchObject({
      orderType: 'Market',
      timeInForce: 'IOC',
    });
    expect(transport.calls[0].body).not.toHaveProperty('price');
  });

  it('maps cancel and amend requests', async () => {
    const transport = new FakeTransport();
    const adapter = createBybitLiveAdapter({ armed: true, testnet: false, transport });
    await adapter.cancelOrder('order-1');
    await adapter.amendOrder('order-1', { price: 101, qty: 2 });

    expect(transport.calls[0]).toMatchObject({ path: '/v5/order/cancel', body: { category: 'option', orderId: 'order-1' } });
    expect(transport.calls[1]).toMatchObject({ path: '/v5/order/amend', body: { category: 'option', orderId: 'order-1', price: '101', qty: '2' } });
  });
});
