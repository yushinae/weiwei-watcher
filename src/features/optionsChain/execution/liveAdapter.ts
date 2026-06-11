import type { ExecutionAdapter, OrderResult, TradeIntent } from './types';

export class LiveExecutionDisabledError extends Error {
  constructor() {
    super('Live execution is not wired yet. Use SIM until a venue adapter is explicitly enabled.');
  }
}

export const liveExecutionDisabledAdapter: ExecutionAdapter = {
  mode: 'live',
  label: 'LIVE disabled',
  async placeOrder(intent: TradeIntent): Promise<OrderResult> {
    return {
      mode: 'live',
      venue: intent.venue,
      status: 'rejected',
      message: new LiveExecutionDisabledError().message,
    };
  },
  async cancelOrder(orderId: string): Promise<OrderResult> {
    return {
      mode: 'live',
      venue: 'deribit',
      status: 'rejected',
      orderId,
      message: new LiveExecutionDisabledError().message,
    };
  },
  async amendOrder(orderId: string): Promise<OrderResult> {
    return {
      mode: 'live',
      venue: 'deribit',
      status: 'rejected',
      orderId,
      message: new LiveExecutionDisabledError().message,
    };
  },
  getState() {
    return { positions: [], openOrders: [], orderHistory: [], fills: [] };
  },
};
