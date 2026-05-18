import { useEffect, useRef, useCallback } from 'react';
import { useSimTradingStore } from '../store/useSimTradingStore';

const BYBIT_WS_URL = 'wss://stream.bybit.com/v5/public/option';
const SUBSCRIBE_SYMBOLS = ['BTC', 'ETH'];

interface BybitTickerMsg {
  topic: string;
  type: string;
  data: {
    symbol: string;
    markPrice: string;
    iv: string;
    delta: string;
    gamma: string;
    theta: string;
    vega: string;
    bid1Price: string;
    bid1Size: string;
    ask1Price: string;
    ask1Size: string;
    lastPrice: string;
    prevPrice24h: string;
    change24h: string;
  }[];
}

export function useBybitOptionsStream(enabled = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateTickers = useSimTradingStore(s => s.updateTickers);
  const updateRef = useRef(updateTickers);
  updateRef.current = updateTickers;

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(BYBIT_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        for (const sym of SUBSCRIBE_SYMBOLS) {
          ws.send(JSON.stringify({
            op: 'subscribe',
            args: [`tickers.${sym}`],
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: BybitTickerMsg = JSON.parse(event.data);
          if (msg.topic?.startsWith('tickers.') && msg.type === 'snapshot' && msg.data) {
            const tickers: Record<string, any> = {};
            for (const item of msg.data) {
              const mark = parseFloat(item.markPrice);
              if (Number.isFinite(mark) && mark > 0) {
                tickers[item.symbol] = {
                  markPrice: mark,
                  iv: parseFloat(item.iv) / 100,
                  delta: parseFloat(item.delta),
                  gamma: parseFloat(item.gamma),
                  theta: parseFloat(item.theta),
                  vega: parseFloat(item.vega),
                  bid: parseFloat(item.bid1Price),
                  ask: parseFloat(item.ask1Price),
                  lastPrice: parseFloat(item.lastPrice),
                  change24h: parseFloat(item.change24h),
                };
              }
            }
            if (Object.keys(tickers).length > 0) {
              updateRef.current(tickers);
            }
          }
        } catch {
          // ignore parse errors (heartbeats etc)
        }
      };

      ws.onclose = () => {
        reconnectTimerRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectTimerRef.current = setTimeout(connect, 5000);
    }
  }, [enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
