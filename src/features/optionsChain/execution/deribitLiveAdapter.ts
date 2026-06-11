import type {
  AccountTradingState,
  AmendIntent,
  ExecutionAdapter,
  OrderResult,
  TimeInForce,
  TradeIntent,
} from './types';

type JsonRpcParams = Record<string, string | number | boolean | undefined>;

export interface DeribitCredentials {
  clientId: string;
  clientSecret: string;
}

export interface DeribitLiveAdapterConfig {
  armed: boolean;
  testnet: boolean;
  credentials?: DeribitCredentials | null;
  transport?: DeribitTransport;
  labelPrefix?: string;
}

export interface DeribitRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface DeribitTransport {
  request<T>(method: string, params?: JsonRpcParams): Promise<T>;
  close?(): void;
}

interface DeribitOrderResponse {
  order?: {
    order_id?: string;
    order_state?: string;
    amount?: number;
    filled_amount?: number;
    average_price?: number;
  };
  trades?: Array<{
    amount?: number;
    price?: number;
  }>;
}

function assertLiveReady(config: DeribitLiveAdapterConfig): string | null {
  if (!config.armed) return 'Live Deribit execution is locked. Turn on the explicit armed switch first.';
  if (!config.credentials?.clientId || !config.credentials.clientSecret) return 'Deribit credentials are missing.';
  return null;
}

function deribitTif(tif: TimeInForce): string {
  if (tif === 'IOC') return 'immediate_or_cancel';
  if (tif === 'FOK') return 'fill_or_kill';
  return 'good_til_cancelled';
}

function toOrderStatus(orderState: string | undefined): OrderResult['status'] {
  if (orderState === 'filled') return 'filled';
  if (orderState === 'cancelled' || orderState === 'rejected') return orderState;
  return 'pending';
}

function summarizeFill(payload: DeribitOrderResponse): Pick<OrderResult, 'filledQty' | 'avgPrice'> {
  const order = payload.order;
  if (order?.filled_amount != null || order?.average_price != null) {
    return { filledQty: order.filled_amount, avgPrice: order.average_price };
  }
  const trades = payload.trades ?? [];
  const filledQty = trades.reduce((sum, trade) => sum + (trade.amount ?? 0), 0);
  if (filledQty <= 0) return {};
  const notional = trades.reduce((sum, trade) => sum + (trade.amount ?? 0) * (trade.price ?? 0), 0);
  return { filledQty, avgPrice: notional / filledQty };
}

function orderParams(intent: TradeIntent): JsonRpcParams {
  const params: JsonRpcParams = {
    instrument_name: intent.instrument,
    amount: intent.qty,
    type: intent.orderType,
    time_in_force: deribitTif(intent.tif),
    reduce_only: intent.reduceOnly,
    post_only: intent.postOnly,
    label: `${intent.source}:${intent.accountId}:${Date.now()}`,
  };
  if (intent.orderType !== 'market') params.price = intent.price;
  return params;
}

export class DeribitWsTransport implements DeribitTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly testnet: boolean,
    private readonly credentials: DeribitCredentials,
    private readonly timeoutMs = 12_000,
  ) {}

  async request<T>(method: string, params: JsonRpcParams = {}): Promise<T> {
    await this.ensureConnected();
    return this.send<T>(method, params);
  }

  close(): void {
    const socket = this.ws;
    this.ws = null;
    if (socket) socket.close();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Deribit WebSocket closed'));
    }
    this.pending.clear();
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.open().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private open(): Promise<void> {
    const url = this.testnet ? 'wss://test.deribit.com/ws/api/v2' : 'wss://www.deribit.com/ws/api/v2';
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = async () => {
        try {
          await this.send('public/auth', {
            grant_type: 'client_credentials',
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      socket.onerror = () => reject(new Error('Deribit WebSocket error'));
      socket.onclose = () => {
        if (this.ws === socket) this.ws = null;
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as {
          id?: number;
          result?: unknown;
          error?: DeribitRpcError;
        };
        if (message.id == null) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? `Deribit ${message.error.code ?? 'error'}`));
        else pending.resolve(message.result);
      };
    });
  }

  private send<T>(method: string, params: JsonRpcParams): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Deribit WebSocket is not connected'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Deribit request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
}

export function createDeribitLiveAdapter(config: DeribitLiveAdapterConfig): ExecutionAdapter {
  const transport = config.transport ?? (
    config.credentials
      ? new DeribitWsTransport(config.testnet, config.credentials)
      : null
  );
  const label = `${config.labelPrefix ?? 'DERIBIT'} ${config.testnet ? 'TESTNET' : 'LIVE'}${config.armed ? '' : ' locked'}`;

  const lockedResult = (message: string, orderId?: string): OrderResult => ({
    mode: 'live',
    venue: 'deribit',
    status: 'rejected',
    orderId,
    message,
  });

  const requireReady = () => {
    const blocked = assertLiveReady(config);
    if (blocked) return { blocked };
    if (!transport) return { blocked: 'Deribit transport is not available.' };
    return { transport };
  };

  return {
    mode: 'live',
    label,
    async placeOrder(intent: TradeIntent): Promise<OrderResult> {
      const ready = requireReady();
      if ('blocked' in ready) return lockedResult(ready.blocked);
      if (intent.venue !== 'deribit') return lockedResult('Deribit adapter received a non-Deribit order.');
      if (!intent.instrument) return lockedResult('Deribit instrument is required.');

      try {
        const payload = await ready.transport.request<DeribitOrderResponse>(
          intent.side === 'buy' ? 'private/buy' : 'private/sell',
          orderParams(intent),
        );
        const state = payload.order?.order_state;
        return {
          mode: 'live',
          venue: 'deribit',
          status: toOrderStatus(state),
          orderId: payload.order?.order_id,
          message: state ? `Deribit order ${state}` : 'Deribit order submitted',
          ...summarizeFill(payload),
        };
      } catch (error) {
        return lockedResult(error instanceof Error ? error.message : 'Deribit order failed');
      }
    },
    async cancelOrder(orderId: string): Promise<OrderResult> {
      const ready = requireReady();
      if ('blocked' in ready) return lockedResult(ready.blocked, orderId);
      try {
        const payload = await ready.transport.request<DeribitOrderResponse>('private/cancel', { order_id: orderId });
        return {
          mode: 'live',
          venue: 'deribit',
          status: toOrderStatus(payload.order?.order_state ?? 'cancelled'),
          orderId,
          message: 'Deribit cancel submitted',
        };
      } catch (error) {
        return lockedResult(error instanceof Error ? error.message : 'Deribit cancel failed', orderId);
      }
    },
    async amendOrder(orderId: string, patch: AmendIntent): Promise<OrderResult> {
      const ready = requireReady();
      if ('blocked' in ready) return lockedResult(ready.blocked, orderId);
      try {
        const payload = await ready.transport.request<DeribitOrderResponse>('private/edit', {
          order_id: orderId,
          amount: patch.qty,
          price: patch.price,
        });
        return {
          mode: 'live',
          venue: 'deribit',
          status: toOrderStatus(payload.order?.order_state),
          orderId,
          message: 'Deribit amend submitted',
          ...summarizeFill(payload),
        };
      } catch (error) {
        return lockedResult(error instanceof Error ? error.message : 'Deribit amend failed', orderId);
      }
    },
    getState(): AccountTradingState {
      return { positions: [], openOrders: [], orderHistory: [], fills: [] };
    },
  };
}
