import { useEffect, useRef, useCallback } from 'react';
import { useSimTradingStore } from '../store/useSimTradingStore';

const DERIBIT_WS_URL = 'wss://www.deribit.com/ws/api/v2';

interface DeribitTickerData {
  instrument_name: string;
  mark_price: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  best_bid_price: number;
  best_ask_price: number;
  last_price: number;
  current_funding: number;
  funding_8h: number;
  mark_iv: number;
  underlying_price: number;
  open_interest: number;
  volume_24h: number;
  price_change: number;
}

let reqId = 0;

export function useDeribitOptionsStream(enabled = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateTickers = useSimTradingStore(s => s.updateTickers);
  const updateRef = useRef(updateTickers);
  updateRef.current = updateTickers;

  const connect = useCallback(() => {
    if (!enabled) return;
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
            ],
          },
        }));

        reqId += 1;
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: reqId,
          method: 'public/get_book_summary_by_currency',
          params: {
            currency: 'BTC',
            kind: 'option',
          },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle subscription confirmation
          if (msg.result?.channels) {
            console.log('[Deribit WS] Subscribed to:', msg.result.channels);
            return;
          }

          // Handle book summary response (initial snapshot of all options)
          if (msg.result && Array.isArray(msg.result)) {
            const tickers: Record<string, any> = {};
            for (const item of msg.result) {
              const name = item.instrument_name;
              const mark = item.mark_price;
              if (name && Number.isFinite(mark) && mark > 0) {
                tickers[name] = {
                  markPrice: mark,
                  iv: (item.mark_iv ?? item.iv ?? 0) / 100,
                  delta: item.delta ?? 0,
                  gamma: item.gamma ?? 0,
                  theta: item.theta ?? 0,
                  vega: item.vega ?? 0,
                  bid: item.best_bid_price ?? 0,
                  ask: item.best_ask_price ?? 0,
                  lastPrice: item.last_price ?? 0,
                  change24h: item.price_change ?? 0,
                };
              }
            }
            if (Object.keys(tickers).length > 0) {
              console.log('[Deribit WS] Received snapshot tickers:', Object.keys(tickers).length);
              updateRef.current(tickers);
            }
            return;
          }

          // Handle real-time ticker notifications
          if (msg.method === 'subscription' && msg.params?.channel?.startsWith('ticker.')) {
            const data: DeribitTickerData = msg.params.data;
            if (data?.instrument_name && Number.isFinite(data.mark_price) && data.mark_price > 0) {
              const tickers: Record<string, any> = {};
              tickers[data.instrument_name] = {
                markPrice: data.mark_price,
                iv: (data.mark_iv ?? data.iv ?? 0) / 100,
                delta: data.delta ?? 0,
                gamma: data.gamma ?? 0,
                theta: data.theta ?? 0,
                vega: data.vega ?? 0,
                bid: data.best_bid_price ?? 0,
                ask: data.best_ask_price ?? 0,
                lastPrice: data.last_price ?? 0,
                change24h: data.price_change ?? 0,
              };
              updateRef.current(tickers);
            }
          }
        } catch {
          // ignore parse errors
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
