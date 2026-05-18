import { useEffect, useRef, useCallback } from 'react';
import { useSimTradingStore } from '../store/useSimTradingStore';

// Bybit V5 公开 WebSocket 端点（期权）
const BYBIT_WS_URL = 'wss://stream.bybit.com/v5/public/option';

// 订阅的标的
const SUBSCRIBE_SYMBOLS = ['BTC', 'ETH'];

interface BybitTickerMsg {
  topic: string;
  type: string;
  data: {
    symbol: string;       // e.g. "BTC-29MAY26-65000-C"
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
  const updateMarkPrices = useSimTradingStore(s => s.updateMarkPrices);
  const updateRef = useRef(updateMarkPrices);
  updateRef.current = updateMarkPrices;

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(BYBIT_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        // 订阅每个标的的 ticker
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
            const prices: Record<string, number> = {};
            for (const item of msg.data) {
              const mark = parseFloat(item.markPrice);
              if (Number.isFinite(mark) && mark > 0) {
                prices[item.symbol] = mark;
              }
            }
            if (Object.keys(prices).length > 0) {
              updateRef.current(prices);
            }
          }
        } catch {
          // 忽略解析错误（心跳等）
        }
      };

      ws.onclose = () => {
        // 5 秒后重连
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
