import { getEnvCredentials, isConfigured, isEnvConfigured } from '../../bybit/auth';
import { hmacSha256Hex } from '../../bybit/crypto';
import type {
  AccountTradingState,
  AmendIntent,
  ExecutionAdapter,
  OrderResult,
  TimeInForce,
  TradeIntent,
} from './types';

type BybitBody = Record<string, string | number | boolean | undefined>;

export interface BybitLiveAdapterConfig {
  armed: boolean;
  testnet: boolean;
  transport?: BybitTransport;
  labelPrefix?: string;
}

export interface BybitTransport {
  post<T>(path: string, body: BybitBody): Promise<T>;
}

interface BybitResponse<T> {
  retCode: number;
  retMsg?: string;
  result?: T;
}

interface BybitOrderResult {
  orderId?: string;
  orderLinkId?: string;
}

const RECV_WINDOW = '5000';

function bybitTif(tif: TimeInForce): string {
  if (tif === 'IOC') return 'IOC';
  if (tif === 'FOK') return 'FOK';
  return 'GTC';
}

function bybitOrderType(orderType: TradeIntent['orderType']): string {
  return orderType === 'market' ? 'Market' : 'Limit';
}

function sideName(side: TradeIntent['side']): string {
  return side === 'buy' ? 'Buy' : 'Sell';
}

function orderLinkId(intent: TradeIntent): string {
  const symbol = intent.instrument ?? intent.symbol;
  return `oc-${intent.source}-${symbol}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
}

function orderBody(intent: TradeIntent): BybitBody {
  const body: BybitBody = {
    category: 'option',
    symbol: intent.instrument ?? intent.symbol,
    side: sideName(intent.side),
    orderType: bybitOrderType(intent.orderType),
    qty: String(intent.qty),
    timeInForce: bybitTif(intent.tif),
    reduceOnly: intent.reduceOnly,
    orderLinkId: orderLinkId(intent),
  };
  if (intent.orderType !== 'market') body.price = String(intent.price);
  if (intent.postOnly) body.timeInForce = 'PostOnly';
  return body;
}

function assertLiveReady(config: BybitLiveAdapterConfig): string | null {
  if (!config.armed) return 'Live Bybit execution is locked. Turn on the explicit armed switch first.';
  if (!isConfigured()) return 'Bybit credentials are missing.';
  if (config.testnet) return 'Bybit testnet execution is not wired in this app yet.';
  return null;
}

export class BybitRestTransport implements BybitTransport {
  async post<T>(path: string, body: BybitBody): Promise<T> {
    if (isEnvConfigured()) return this.localPost<T>(path, body);

    const resp = await fetch('/api/proxy/bybit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method: 'POST', body }),
    });
    const json = await resp.json() as BybitResponse<T>;
    if (!resp.ok || json.retCode !== 0) throw new Error(json.retMsg ?? `Bybit HTTP ${resp.status}`);
    return json.result as T;
  }

  private async localPost<T>(path: string, body: BybitBody): Promise<T> {
    const creds = getEnvCredentials();
    if (!creds) throw new Error('Bybit credentials are missing.');
    const timestamp = Date.now().toString();
    const jsonBody = JSON.stringify(body);
    const payload = timestamp + creds.apiKey + RECV_WINDOW + jsonBody;
    const signature = await hmacSha256Hex(creds.secret, payload);
    const resp = await fetch(`/bybit-api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': creds.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': RECV_WINDOW,
        'X-BAPI-SIGN': signature,
      },
      body: jsonBody,
    });
    const json = await resp.json() as BybitResponse<T>;
    if (!resp.ok || json.retCode !== 0) throw new Error(json.retMsg ?? `Bybit HTTP ${resp.status}`);
    return json.result as T;
  }
}

export function createBybitLiveAdapter(config: BybitLiveAdapterConfig): ExecutionAdapter {
  const transport = config.transport ?? new BybitRestTransport();
  const label = `${config.labelPrefix ?? 'BYBIT'} ${config.testnet ? 'TESTNET unavailable' : 'LIVE'}${config.armed ? '' : ' locked'}`;

  const lockedResult = (message: string, orderId?: string): OrderResult => ({
    mode: 'live',
    venue: 'bybit',
    status: 'rejected',
    orderId,
    message,
  });

  const requireReady = () => {
    const blocked = assertLiveReady(config);
    if (blocked) return { blocked };
    return { transport };
  };

  return {
    mode: 'live',
    label,
    async placeOrder(intent: TradeIntent): Promise<OrderResult> {
      const ready = requireReady();
      if ('blocked' in ready) return lockedResult(ready.blocked);
      if (intent.venue !== 'bybit') return lockedResult('Bybit adapter received a non-Bybit order.');
      if (!intent.instrument) return lockedResult('Bybit option symbol is required.');
      try {
        const result = await ready.transport.post<BybitOrderResult>('/v5/order/create', orderBody(intent));
        return {
          mode: 'live',
          venue: 'bybit',
          status: 'pending',
          orderId: result.orderId,
          message: 'Bybit order submitted',
        };
      } catch (error) {
        return lockedResult(error instanceof Error ? error.message : 'Bybit order failed');
      }
    },
    async cancelOrder(orderId: string): Promise<OrderResult> {
      const ready = requireReady();
      if ('blocked' in ready) return lockedResult(ready.blocked, orderId);
      try {
        await ready.transport.post<BybitOrderResult>('/v5/order/cancel', { category: 'option', orderId });
        return { mode: 'live', venue: 'bybit', status: 'cancelled', orderId, message: 'Bybit cancel submitted' };
      } catch (error) {
        return lockedResult(error instanceof Error ? error.message : 'Bybit cancel failed', orderId);
      }
    },
    async amendOrder(orderId: string, patch: AmendIntent): Promise<OrderResult> {
      const ready = requireReady();
      if ('blocked' in ready) return lockedResult(ready.blocked, orderId);
      try {
        await ready.transport.post<BybitOrderResult>('/v5/order/amend', {
          category: 'option',
          orderId,
          price: String(patch.price),
          qty: String(patch.qty),
        });
        return { mode: 'live', venue: 'bybit', status: 'pending', orderId, message: 'Bybit amend submitted' };
      } catch (error) {
        return lockedResult(error instanceof Error ? error.message : 'Bybit amend failed', orderId);
      }
    },
    getState(): AccountTradingState {
      return { positions: [], openOrders: [], orderHistory: [], fills: [] };
    },
  };
}
