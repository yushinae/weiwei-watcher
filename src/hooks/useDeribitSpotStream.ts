import { useEffect, useRef, useState, useCallback } from 'react';

const DERIBIT_WS_URL = 'wss://www.deribit.com/ws/api/v2';

interface SpotTicker {
  symbol: string;
  price: string;
  change: string;
  up: boolean;
}

let reqId = 0;

export function useDeribitSpotStream() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tickers, setTickers] = useState<SpotTicker[]>([
    { symbol: 'BTC', price: '—', change: '—', up: true },
    { symbol: 'ETH', price: '—', change: '—', up: true },
  ]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(DERIBIT_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reqId += 1;
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: reqId,
          method: 'public/subscribe',
          params: {
            channels: [
              'ticker.BTC-PERPETUAL.raw',
              'ticker.ETH-PERPETUAL.raw',
            ],
          },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.method === 'subscription' && msg.params?.channel?.startsWith('ticker.')) {
            const data = msg.params.data;
            if (data?.instrument_name && data.last_price) {
              const isBTC = data.instrument_name.includes('BTC');
              const priceNum = data.last_price;
              const changeNum = data.price_change ?? 0;
              
              setTickers(prev => prev.map(t => {
                if ((isBTC && t.symbol === 'BTC') || (!isBTC && t.symbol === 'ETH')) {
                  return {
                    ...t,
                    price: priceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    change: `${changeNum >= 0 ? '+' : ''}${changeNum.toFixed(2)}%`,
                    up: changeNum >= 0,
                  };
                }
                return t;
              }));
            }
          }
        } catch {
          // ignore
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
  }, []);

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

  return tickers;
}
