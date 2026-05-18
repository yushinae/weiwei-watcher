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
  const prevPricesRef = useRef<Record<string, number>>({ BTC: 0, ETH: 0 });

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
              'deribit_price_index.btc_usd',
              'deribit_price_index.eth_usd',
            ],
          },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.method === 'subscription' && msg.params?.channel?.startsWith('deribit_price_index.')) {
            const data = msg.params.data;
            if (data?.price) {
              const isBTC = data.index_name?.includes('btc');
              const priceNum = parseFloat(data.price);
              const prevPrice = prevPricesRef.current[isBTC ? 'BTC' : 'ETH'] || priceNum;
              const changePercent = ((priceNum - prevPrice) / prevPrice) * 100;

              prevPricesRef.current[isBTC ? 'BTC' : 'ETH'] = priceNum;

              setTickers(prev => prev.map(t => {
                if ((isBTC && t.symbol === 'BTC') || (!isBTC && t.symbol === 'ETH')) {
                  return {
                    ...t,
                    price: priceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    change: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
                    up: changePercent >= 0,
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
