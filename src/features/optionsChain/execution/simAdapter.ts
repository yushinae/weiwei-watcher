import type { ExecutionAdapter, OrderResult, TradeIntent } from './types';
import type { GlobalOptionBook } from '../optionBookStore';

export function createSimExecutionAdapter(book: GlobalOptionBook): ExecutionAdapter {
  return {
    mode: 'sim',
    label: 'SIM',
    async placeOrder(intent: TradeIntent): Promise<OrderResult> {
      const beforeFills = book.fills.length;
      const beforeOpen = book.openOrders.length;
      book.placeOrder({
        side: intent.side,
        type: intent.orderType,
        symbol: intent.symbol,
        qty: intent.qty,
        price: intent.orderType === 'market' ? intent.mark : intent.price,
        mark: intent.mark,
        delta: intent.greeks.delta,
        gamma: intent.greeks.gamma,
        theta: intent.greeks.theta,
        vega: intent.greeks.vega,
        source: intent.venue,
        instrument: intent.instrument,
        book: intent.book,
      });
      return {
        mode: 'sim',
        venue: intent.venue,
        status: beforeFills !== book.fills.length ? 'filled' : beforeOpen !== book.openOrders.length ? 'pending' : 'pending',
        message: '模拟订单已提交',
      };
    },
    async cancelOrder(orderId: string): Promise<OrderResult> {
      book.cancelOrder(orderId);
      return { mode: 'sim', venue: 'deribit', status: 'cancelled', orderId, message: '模拟订单已撤销' };
    },
    async amendOrder(orderId, patch): Promise<OrderResult> {
      book.editOrder(orderId, patch.price, patch.qty);
      return { mode: 'sim', venue: 'deribit', status: 'pending', orderId, message: '模拟订单已修改' };
    },
    getState() {
      return {
        positions: book.positions,
        openOrders: book.openOrders,
        orderHistory: book.orderHistory,
        fills: book.fills,
      };
    },
  };
}
