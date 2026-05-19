import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Order, Position, Fill, AccountBalance, TickerData,
  TradingState, TradingActions, OrderInput, OrderSide,
} from '../types/trading';

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

// Black-76 风格希腊字母（S 用对应到期日的远期价/合成期货价，不是现货指数）。
// r 用 Deribit 隐含利率；为保持向后兼容，r 默认为 0（影响约 0.5% 量级，可接受）。
function bsGreeks(
  S: number, K: number, T: number, sigma: number,
  type: 'call' | 'put', r: number = 0
) {
  if (T <= 1e-12 || sigma <= 1e-12 || S <= 0 || K <= 0) {
    let delta = 0;
    if (type === 'call') delta = S > K ? 1 : 0;
    else delta = S < K ? -1 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const disc = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const delta = type === 'call' ? disc * normCdf(d1) : disc * (normCdf(d1) - 1);
  const gamma = (disc * pdf) / (S * sigma * sqrtT);
  // theta 以"每天"为单位
  const term1 = -disc * S * pdf * sigma / (2 * sqrtT);
  const theta = type === 'call'
    ? (term1 - r * K * disc * normCdf(d2)) / 365
    : (term1 + r * K * disc * normCdf(-d2)) / 365;
  // vega 以"波动率 1%(=0.01) 变化对应价格变化"为单位
  const vega = (disc * S * pdf * sqrtT) * 0.01;
  return { delta, gamma, theta, vega };
}

function parseSymbol(symbol: string) {
  const parts = symbol.split('-');
  if (parts.length < 4) return { coin: symbol, expiry: '', strike: 0, instrumentType: 'call' as const };
  return {
    coin: parts[0],
    expiry: parts[1],
    strike: parseFloat(parts[2]),
    instrumentType: parts[3].toLowerCase() as 'call' | 'put',
  };
}

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

const DEFAULT_INITIAL_BALANCE = 100000;

interface SimTradingStore extends TradingState, TradingActions {}

export const useSimTradingStore = create<SimTradingStore>()(
  persist(
    (set, get) => ({
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
      tickers: {},
      slippage: 0.001,
      makerFee: 0.0002,
      takerFee: 0.0005,

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
        const { slippage, makerFee, takerFee, balance, positions, tickers } = get();
        const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const { coin, expiry, strike, instrumentType } = parseSymbol(orderInput.symbol);

        // Use real mark price from tickers if available
        const realTicker = tickers[orderInput.symbol];
        const markPrice = realTicker?.markPrice ?? orderInput.price;

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

        let filledOrder: Order = { ...order };
        let fill: Fill | null = null;

        if (order.type === 'market') {
          const slipPrice = markPrice * (1 + (order.side === 'buy' ? slippage : -slippage));
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
        }

        let newPositions = [...positions];
        let newBalance = { ...balance };

        if (fill) {
          const existingPos = newPositions.find(
            p => p.symbol === order.symbol &&
              p.side === (order.side === 'buy' ? 'long' : 'short')
          );

          if (existingPos) {
            const totalCost = existingPos.avgEntryPrice * existingPos.qty + fill.price * fill.qty;
            const totalQty = existingPos.qty + fill.qty;
            existingPos.avgEntryPrice = totalCost / totalQty;
            existingPos.qty = totalQty;
          } else {
            const T = daysToExpiry(order.expiry) / 365;
            // 用真实的对应到期日远期价（来自 Deribit underlying_price），fallback 到 strike
            const realTickerForGreeks = tickers[order.symbol];
            const spotPrice = realTickerForGreeks?.underlyingPrice ?? strike;
            const iv = order.iv ?? realTickerForGreeks?.iv ?? 0.6;
            const r = realTickerForGreeks?.interestRate ?? 0;
            const positionSide: 'long' | 'short' = order.side === 'buy' ? 'long' : 'short';
            const sideSign = positionSide === 'long' ? 1 : -1;

            // 用 gamma>0 判断是否有真实 API 希腊字母（REST 阶段为 0）
            const useApi = realTickerForGreeks != null
              && Number.isFinite(realTickerForGreeks.gamma)
              && realTickerForGreeks.gamma > 0;
            const g = useApi
              ? {
                  delta: realTickerForGreeks!.delta,
                  gamma: realTickerForGreeks!.gamma,
                  theta: realTickerForGreeks!.theta,
                  vega: realTickerForGreeks!.vega,
                }
              : bsGreeks(spotPrice, strike, T, iv, instrumentType, r);

            const newPos: Position = {
              id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              symbol: order.symbol,
              coin,
              expiry,
              strike,
              instrumentType,
              side: positionSide,
              qty: fill.qty,
              avgEntryPrice: fill.price,
              markPrice: fill.price,
              unrealizedPnL: 0,
              realizedPnL: 0,
              delta: g.delta * fill.qty * sideSign,
              gamma: g.gamma * fill.qty * sideSign,
              theta: g.theta * fill.qty * sideSign,
              vega: g.vega * fill.qty * sideSign,
              openedAt: Date.now(),
            };
            newPositions.push(newPos);
          }

          const cost = fill.price * fill.qty;
          const fee = fill.fee;
          if (order.side === 'buy') {
            newBalance.availableBalance -= (cost + fee);
          } else {
            newBalance.availableBalance += (cost - fee);
          }
          newBalance.totalFees += fee;
        }

        const allOrders = [...get().orders, filledOrder];
        const openOrders = allOrders.filter(o => o.status === 'pending');
        const orderHistory = allOrders.filter(o => o.status !== 'pending');
        const allFills = fill ? [...get().fills, fill] : get().fills;

        const totalUnrealizedPnL = newPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
        const totalRealizedPnL = newPositions.reduce((sum, p) => sum + p.realizedPnL, 0);
        newBalance.totalPnL = totalUnrealizedPnL + totalRealizedPnL;
        newBalance.equity = newBalance.availableBalance + newBalance.usedMargin + totalUnrealizedPnL;
        newBalance.usedMargin = newPositions.reduce((sum, p) => sum + p.avgEntryPrice * p.qty * 0.2, 0);

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
        const { positions, balance, fills, slippage, takerFee, tickers } = get();
        const pos = positions.find(p => p.id === positionId);
        if (!pos) return;

        const realTicker = tickers[pos.symbol];
        const markPrice = realTicker?.markPrice ?? pos.markPrice;

        const closeSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
        const slipPrice = markPrice * (1 + (closeSide === 'buy' ? slippage : -slippage));
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

      updateTickers: (tickerUpdates) => {
        const { tickers, positions, balance } = get();
        const newTickers = { ...tickers };
        let hasChanges = false;

        for (const [symbol, update] of Object.entries(tickerUpdates)) {
          const existing = newTickers[symbol];

          // ★ Issue 6 修复：REST 阶段希腊字母为 0，不能覆盖 WS 已推送的真实值。
          // 判定：update 中 gamma > 0 才视为"携带真实 Greeks"；否则保留 existing 的 Greeks。
          const updateHasGreeks = Number.isFinite(update.gamma) && (update.gamma as number) > 0;
          const delta = updateHasGreeks ? (update.delta as number) : (existing?.delta ?? 0);
          const gamma = updateHasGreeks ? (update.gamma as number) : (existing?.gamma ?? 0);
          const theta = updateHasGreeks ? (update.theta as number) : (existing?.theta ?? 0);
          const vega = updateHasGreeks ? (update.vega as number) : (existing?.vega ?? 0);

          // bid/ask/last 用 !== undefined 判定"是否有新值"，允许 null 透传（表示"无报价"）
          const bid = update.bid !== undefined ? update.bid : (existing?.bid ?? null);
          const ask = update.ask !== undefined ? update.ask : (existing?.ask ?? null);
          const lastPrice = update.lastPrice !== undefined ? update.lastPrice : (existing?.lastPrice ?? null);

          newTickers[symbol] = {
            symbol,
            markPrice: update.markPrice ?? existing?.markPrice ?? 0,
            iv: update.iv ?? existing?.iv ?? 0,
            delta, gamma, theta, vega,
            bid, ask, lastPrice,
            change24h: update.change24h ?? existing?.change24h ?? 0,
            oi: update.oi ?? existing?.oi ?? null,
            volume: update.volume ?? existing?.volume ?? null,
            underlyingPrice: update.underlyingPrice ?? existing?.underlyingPrice,
            interestRate: update.interestRate ?? existing?.interestRate,
            updatedAt: Date.now(),
          };
          hasChanges = true;
        }

        if (!hasChanges) return;

        // Update position PnL with new mark prices.
        // 注意 markPrice 现在是 USD（stream 层已转换）。
        const newPositions = positions.map(pos => {
          const ticker = newTickers[pos.symbol];
          if (!ticker || ticker.markPrice <= 0) return pos;

          const sideSign = pos.side === 'long' ? 1 : -1;
          const newPnL = sideSign * (ticker.markPrice - pos.avgEntryPrice) * pos.qty;

          const T = daysToExpiry(pos.expiry) / 365;
          const iv = ticker.iv || 0.6;
          // ✅ 用真正的远期价当 spot，不能用 strike
          const S = ticker.underlyingPrice ?? pos.strike;
          const r = ticker.interestRate ?? 0;

          // 用 gamma>0 判断是否有真实 API 希腊字母（REST 阶段为 0）
          const hasApiGreeks = Number.isFinite(ticker.gamma) && ticker.gamma > 0;
          const g = hasApiGreeks
            ? { delta: ticker.delta, gamma: ticker.gamma, theta: ticker.theta, vega: ticker.vega }
            : bsGreeks(S, pos.strike, T, iv, pos.instrumentType, r);

          return {
            ...pos,
            markPrice: ticker.markPrice,
            unrealizedPnL: newPnL,
            // 短仓需要反号
            delta: g.delta * pos.qty * sideSign,
            gamma: g.gamma * pos.qty * sideSign,
            theta: g.theta * pos.qty * sideSign,
            vega: g.vega * pos.qty * sideSign,
          };
        });

        const totalUnrealizedPnL = newPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
        const totalRealizedPnL = newPositions.reduce((sum, p) => sum + p.realizedPnL, 0);
        const newBalance = {
          ...balance,
          totalPnL: totalUnrealizedPnL + totalRealizedPnL,
          equity: balance.availableBalance + balance.usedMargin + totalUnrealizedPnL,
        };

        set({ tickers: newTickers, positions: newPositions, balance: newBalance });

        // Check if any limit orders should be filled
        const { openOrders, orders } = get();
        const triggeredOrders = openOrders.filter(o => {
          const ticker = newTickers[o.symbol];
          if (!ticker || ticker.markPrice <= 0) return false;
          return (o.side === 'buy' && o.price >= ticker.markPrice) ||
                 (o.side === 'sell' && o.price <= ticker.markPrice);
        });

        if (triggeredOrders.length > 0) {
          for (const order of triggeredOrders) {
            const ticker = newTickers[order.symbol];
            if (!ticker) continue;

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

            const updatedOrders = orders.map(o =>
              o.id === order.id
                ? { ...o, status: 'filled' as const, filledAt: Date.now(), filledQty: order.qty, filledPrice: order.price }
                : o
            );

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
              const tk = newTickers[order.symbol];
              const S = tk?.underlyingPrice ?? strike;
              const iv = tk?.iv || 0.6;
              const r = tk?.interestRate ?? 0;
              const positionSide: 'long' | 'short' = order.side === 'buy' ? 'long' : 'short';
              const sideSign = positionSide === 'long' ? 1 : -1;

              const hasApiGreeks = tk != null
                && Number.isFinite(tk.gamma) && tk.gamma > 0;
              const greeks = hasApiGreeks
                ? { delta: tk!.delta, gamma: tk!.gamma, theta: tk!.theta, vega: tk!.vega }
                : bsGreeks(S, strike, T, iv, instrumentType, r);

              finalPositions.push({
                id: `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                symbol: order.symbol,
                coin,
                expiry,
                strike,
                instrumentType,
                side: positionSide,
                qty: order.qty,
                avgEntryPrice: order.price,
                markPrice: order.price,
                unrealizedPnL: 0,
                realizedPnL: 0,
                delta: greeks.delta * order.qty * sideSign,
                gamma: greeks.gamma * order.qty * sideSign,
                theta: greeks.theta * order.qty * sideSign,
                vega: greeks.vega * order.qty * sideSign,
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
