import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Order, Position, Fill, AccountBalance,
  TradingState, TradingActions, OrderInput,
  OrderSide, OrderType, PositionSide, InstrumentType,
} from '../types/trading';

// ── Black-Scholes helpers for Greeks ──

function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + (x < 0 ? -1 : 1) * y);
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsGreeks(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) {
    let delta = 0;
    if (type === 'call') delta = S > K ? 1 : 0;
    else delta = S < K ? -1 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const pdf = normPdf(d1);
  const delta = type === 'call' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * sqrtT);
  const theta = (-S * pdf * sigma / (2 * sqrtT)) / 365;
  const vega = (S * pdf * sqrtT) / 100;
  return { delta, gamma, theta, vega };
}

// Parse symbol like "BTC-29MAY26-65000-C"
function parseSymbol(symbol: string) {
  const parts = symbol.split('-');
  if (parts.length < 4) return { coin: symbol, expiry: '', strike: 0, instrumentType: 'call' as InstrumentType };
  return {
    coin: parts[0],
    expiry: parts[1],
    strike: parseFloat(parts[2]),
    instrumentType: parts[3].toLowerCase() as InstrumentType,
  };
}

// Estimate days to expiry from string like "29MAY26"
function daysToExpiry(expiry: string): number {
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const match = expiry.match(/(\d+)([A-Z]{3})(\d{2})/);
  if (!match) return 30;
  const day = parseInt(match[1]);
  const month = months[match[2]] ?? 0;
  const year = 2000 + parseInt(match[3]);
  const expDate = new Date(year, month, day);
  const now = new Date();
  return Math.max(1, Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

// ── Store ──

const DEFAULT_INITIAL_BALANCE = 100000; // 100k USDC

interface SimTradingStore extends TradingState, TradingActions {}

export const useSimTradingStore = create<SimTradingStore>()(
  persist(
    (set, get) => ({
      // ── Initial State ──
      initialBalance: DEFAULT_INITIAL_BALANCE,
      balance: {
        equity: DEFAULT_INITIAL_BALANCE,
        availableBalance: DEFAULT_INITIAL_BALANCE,
        usedMargin: 0,
        totalPnL: 0,
        totalFees: 0,
      },
      orders: [],
      openOrders: [],
      orderHistory: [],
      positions: [],
      fills: [],
      slippage: 0.001,
      makerFee: 0.0002,
      takerFee: 0.0005,

      // ── Actions ──

      resetAccount: (initialBalance = DEFAULT_INITIAL_BALANCE) => {
        set({
          initialBalance,
          balance: {
            equity: initialBalance,
            availableBalance: initialBalance,
            usedMargin: 0,
            totalPnL: 0,
            totalFees: 0,
          },
          orders: [],
          openOrders: [],
          orderHistory: [],
          positions: [],
          fills: [],
        });
      },

      placeOrder: (orderInput: OrderInput) => {
        const { slippage, makerFee, takerFee, balance, positions } = get();
        const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const { coin, expiry, strike, instrumentType } = parseSymbol(orderInput.symbol);

        const order: Order = {
          id,
          side: orderInput.side,
          type: orderInput.type,
          symbol: orderInput.symbol,
          coin,
          expiry,
          strike,
          instrumentType,
          qty: orderInput.qty,
          price: orderInput.price,
          iv: orderInput.iv,
          tif: orderInput.tif ?? 'GTC',
          reduceOnly: orderInput.reduceOnly ?? false,
          postOnly: orderInput.postOnly ?? false,
          status: 'pending',
          createdAt: Date.now(),
        };

        // ── 撮合逻辑 ──
        let filledOrder: Order = { ...order };
        let fill: Fill | null = null;

        if (order.type === 'market') {
          // 市价单：立即成交，加上滑点
          const slipPrice = order.price * (1 + (order.side === 'buy' ? slippage : -slippage));
          const feeRate = takerFee;
          const fee = slipPrice * order.qty * feeRate;

          filledOrder = {
            ...order,
            status: 'filled',
            filledAt: Date.now(),
            filledQty: order.qty,
            filledPrice: slipPrice,
          };

          fill = {
            id: `fill_${id}`,
            orderId: id,
            symbol: order.symbol,
            side: order.side,
            qty: order.qty,
            price: slipPrice,
            fee,
            timestamp: Date.now(),
          };
        } else if (order.type === 'limit') {
          // 限价单：检查是否可立即成交（价格穿过）
          // 简化：如果限价单价格优于当前标记价，立即成交
          // 实际应该用订单簿，这里用标记价近似
          const markPrice = order.price; // 下单时的标记价
          const shouldFill =
            (order.side === 'buy' && order.price >= markPrice) ||
            (order.side === 'sell' && order.price <= markPrice);

          if (shouldFill) {
            const feeRate = order.postOnly ? makerFee : takerFee;
            const fee = order.price * order.qty * feeRate;

            filledOrder = {
              ...order,
              status: 'filled',
              filledAt: Date.now(),
              filledQty: order.qty,
              filledPrice: order.price,
            };

            fill = {
              id: `fill_${id}`,
              orderId: id,
              symbol: order.symbol,
              side: order.side,
              qty: order.qty,
              price: order.price,
              fee,
              timestamp: Date.now(),
            };
          }
          // 否则保持 pending，等待后续 mark price 更新触发
        }

        // ── 更新持仓 ──
        let newPositions = [...positions];
        let newBalance = { ...balance };

        if (fill) {
          const posKey = `${order.symbol}_${order.side === 'buy' ? 'long' : 'short'}`;
          const existingPos = newPositions.find(
            p => p.symbol === order.symbol &&
              p.side === (order.side === 'buy' ? 'long' : 'short')
          );

          if (existingPos) {
            // 加仓：更新均价和数量
            const totalCost = existingPos.avgEntryPrice * existingPos.qty + fill.price * fill.qty;
            const totalQty = existingPos.qty + fill.qty;
            existingPos.avgEntryPrice = totalCost / totalQty;
            existingPos.qty = totalQty;
          } else {
            // 开新仓
            const T = daysToExpiry(order.expiry) / 365;
            const spotPrice = strike; // 简化：用行权价近似标的价
            const iv = order.iv ?? 0.6;
            const greeks = bsGreeks(spotPrice, strike, T, iv, instrumentType);

            const newPos: Position = {
              id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              symbol: order.symbol,
              coin,
              expiry,
              strike,
              instrumentType,
              side: order.side === 'buy' ? 'long' : 'short',
              qty: fill.qty,
              avgEntryPrice: fill.price,
              markPrice: fill.price,
              unrealizedPnL: 0,
              realizedPnL: 0,
              delta: greeks.delta * fill.qty,
              gamma: greeks.gamma * fill.qty,
              theta: greeks.theta * fill.qty,
              vega: greeks.vega * fill.qty,
              openedAt: Date.now(),
            };
            newPositions.push(newPos);
          }

          // 更新余额
          const cost = fill.price * fill.qty;
          const fee = fill.fee;
          if (order.side === 'buy') {
            newBalance.availableBalance -= (cost + fee);
          } else {
            newBalance.availableBalance += (cost - fee);
          }
          newBalance.totalFees += fee;
        }

        // ── 更新状态 ──
        const allOrders = [...get().orders, filledOrder];
        const openOrders = allOrders.filter(o => o.status === 'pending');
        const orderHistory = allOrders.filter(o => o.status !== 'pending');
        const allFills = fill ? [...get().fills, fill] : get().fills;

        // 重新计算 PnL
        const totalUnrealizedPnL = newPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
        const totalRealizedPnL = newPositions.reduce((sum, p) => sum + p.realizedPnL, 0);
        newBalance.totalPnL = totalUnrealizedPnL + totalRealizedPnL;
        newBalance.equity = newBalance.availableBalance + newBalance.usedMargin + totalUnrealizedPnL;
        newBalance.usedMargin = newPositions.reduce((sum, p) => {
          // 简化保证金计算：期权权利金的 20%
          return sum + p.avgEntryPrice * p.qty * 0.2;
        }, 0);

        set({
          orders: allOrders,
          openOrders,
          orderHistory,
          positions: newPositions,
          fills: allFills,
          balance: newBalance,
        });
      },

      cancelOrder: (orderId) => {
        const { orders } = get();
        const newOrders = orders.map(o =>
          o.id === orderId ? { ...o, status: 'cancelled' as const } : o
        );
        set({
          orders: newOrders,
          openOrders: newOrders.filter(o => o.status === 'pending'),
          orderHistory: newOrders.filter(o => o.status !== 'pending'),
        });
      },

      cancelAllOrders: () => {
        const { orders } = get();
        const newOrders = orders.map(o =>
          o.status === 'pending' ? { ...o, status: 'cancelled' as const } : o
        );
        set({
          orders: newOrders,
          openOrders: [],
          orderHistory: newOrders.filter(o => o.status !== 'pending'),
        });
      },

      closePosition: (positionId) => {
        const { positions, balance, fills, slippage, takerFee } = get();
        const pos = positions.find(p => p.id === positionId);
        if (!pos) return;

        // 平仓：以当前标记价反向成交
        const closeSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
        const slipPrice = pos.markPrice * (1 + (closeSide === 'buy' ? slippage : -slippage));
        const fee = slipPrice * pos.qty * takerFee;
        const pnl = (closeSide === 'sell' ? 1 : -1) * (slipPrice - pos.avgEntryPrice) * pos.qty - fee;

        const fill: Fill = {
          id: `fill_close_${Date.now()}`,
          orderId: `close_${positionId}`,
          symbol: pos.symbol,
          side: closeSide,
          qty: pos.qty,
          price: slipPrice,
          fee,
          timestamp: Date.now(),
        };

        const newPositions = positions.filter(p => p.id !== positionId);
        const newBalance = { ...balance };
        newBalance.availableBalance += (pos.side === 'long' ? 1 : -1) * pos.qty * slipPrice - fee;
        newBalance.totalFees += fee;
        newBalance.totalPnL += pnl;
        newBalance.equity = newBalance.availableBalance + newBalance.usedMargin;
        newBalance.usedMargin = newPositions.reduce((sum, p) => sum + p.avgEntryPrice * p.qty * 0.2, 0);

        set({
          positions: newPositions,
          fills: [...fills, fill],
          balance: newBalance,
        });
      },

      updateMarkPrices: (prices) => {
        const { positions, balance } = get();
        let hasChanges = false;

        const newPositions = positions.map(pos => {
          const newMark = prices[pos.symbol];
          if (newMark === undefined) return pos;

          const oldPnL = pos.unrealizedPnL;
          const newPnL = pos.side === 'long'
            ? (newMark - pos.avgEntryPrice) * pos.qty
            : (pos.avgEntryPrice - newMark) * pos.qty;

          if (Math.abs(newPnL - oldPnL) > 0.01) {
            hasChanges = true;
            // 更新 Greeks（简化：假设 IV 不变）
            const T = daysToExpiry(pos.expiry) / 365;
            const iv = 0.6;
            const greeks = bsGreeks(pos.strike, pos.strike, T, iv, pos.instrumentType);

            return {
              ...pos,
              markPrice: newMark,
              unrealizedPnL: newPnL,
              delta: greeks.delta * pos.qty,
              gamma: greeks.gamma * pos.qty,
              theta: greeks.theta * pos.qty,
              vega: greeks.vega * pos.qty,
            };
          }
          return pos;
        });

        if (hasChanges) {
          const totalUnrealizedPnL = newPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
          const totalRealizedPnL = newPositions.reduce((sum, p) => sum + p.realizedPnL, 0);
          const newBalance = {
            ...balance,
            totalPnL: totalUnrealizedPnL + totalRealizedPnL,
            equity: balance.availableBalance + balance.usedMargin + totalUnrealizedPnL,
          };

          set({ positions: newPositions, balance: newBalance });

          // ── 检查限价单是否触发 ──
          const { orders, openOrders } = get();
          const triggeredOrders: Order[] = [];

          for (const order of openOrders) {
            const mark = prices[order.symbol];
            if (mark === undefined) continue;

            const shouldFill =
              (order.side === 'buy' && order.price >= mark) ||
              (order.side === 'sell' && order.price <= mark);

            if (shouldFill) {
              triggeredOrders.push(order);
            }
          }

          if (triggeredOrders.length > 0) {
            // 递归触发成交（简化处理）
            for (const order of triggeredOrders) {
              const fee = order.price * order.qty * get().takerFee;
              const fill: Fill = {
                id: `fill_${order.id}`,
                orderId: order.id,
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                price: order.price,
                fee,
                timestamp: Date.now(),
              };

              // 更新订单状态
              const updatedOrders = orders.map(o =>
                o.id === order.id
                  ? { ...o, status: 'filled' as const, filledAt: Date.now(), filledQty: order.qty, filledPrice: order.price }
                  : o
              );

              // 更新持仓
              const existingPos = newPositions.find(
                p => p.symbol === order.symbol && p.side === (order.side === 'buy' ? 'long' : 'short')
              );

              let finalPositions = [...newPositions];
              if (existingPos) {
                const totalCost = existingPos.avgEntryPrice * existingPos.qty + order.price * order.qty;
                const totalQty = existingPos.qty + order.qty;
                existingPos.avgEntryPrice = totalCost / totalQty;
                existingPos.qty = totalQty;
              } else {
                const { coin, expiry, strike, instrumentType } = parseSymbol(order.symbol);
                const T = daysToExpiry(expiry) / 365;
                const greeks = bsGreeks(strike, strike, T, 0.6, instrumentType);

                finalPositions.push({
                  id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  symbol: order.symbol,
                  coin,
                  expiry,
                  strike,
                  instrumentType,
                  side: order.side === 'buy' ? 'long' : 'short',
                  qty: order.qty,
                  avgEntryPrice: order.price,
                  markPrice: order.price,
                  unrealizedPnL: 0,
                  realizedPnL: 0,
                  delta: greeks.delta * order.qty,
                  gamma: greeks.gamma * order.qty,
                  theta: greeks.theta * order.qty,
                  vega: greeks.vega * order.qty,
                  openedAt: Date.now(),
                });
              }

              const newBal = { ...get().balance };
              if (order.side === 'buy') {
                newBal.availableBalance -= (order.price * order.qty + fee);
              } else {
                newBal.availableBalance += (order.price * order.qty - fee);
              }
              newBal.totalFees += fee;
              const totalUPnL = finalPositions.reduce((s, p) => s + p.unrealizedPnL, 0);
              newBal.totalPnL = totalUPnL + finalPositions.reduce((s, p) => s + p.realizedPnL, 0);
              newBal.equity = newBal.availableBalance + newBal.usedMargin + totalUPnL;

              set({
                orders: updatedOrders,
                openOrders: updatedOrders.filter(o => o.status === 'pending'),
                orderHistory: updatedOrders.filter(o => o.status !== 'pending'),
                positions: finalPositions,
                fills: [...get().fills, fill],
                balance: newBal,
              });
            }
          }
        }
      },

      setSlippage: (slippage) => set({ slippage }),
      setFees: (makerFee, takerFee) => set({ makerFee, takerFee }),
    }),
    {
      name: 'sim-trading-storage',
      partialize: (state) => ({
        initialBalance: state.initialBalance,
        balance: state.balance,
        orders: state.orders,
        orderHistory: state.orderHistory,
        positions: state.positions,
        fills: state.fills,
        slippage: state.slippage,
        makerFee: state.makerFee,
        takerFee: state.takerFee,
      }),
    }
  )
);
