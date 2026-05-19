import { useEffect, useRef, useCallback, useState } from 'react';
import { useSimTradingStore } from '../store/useSimTradingStore';

const DERIBIT_WS_URL = '/deribit-ws';

interface DeribitTickerData {
  instrument_name: string;
  mark_price: number;
  mark_iv: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  best_bid_price: number;
  best_ask_price: number;
  last_price: number;
  price_change: number;
  open_interest: number;
  volume: number;
  volume_usd: number;
}

let reqId = 0;

// HMAC-SHA256 签名函数
async function signMessage(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, msgData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function useDeribitOptionsStream(currency = 'BTC', expiry: string | null = null, enabled = true) {
  console.log('[Deribit Hook] Called with currency:', currency, 'expiry:', expiry, 'enabled:', enabled);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateTickers = useSimTradingStore(s => s.updateTickers);
  const updateRef = useRef(updateTickers);
  updateRef.current = updateTickers;
  const currencyRef = useRef(currency);
  currencyRef.current = currency;
  const expiryRef = useRef(expiry);
  expiryRef.current = expiry;
  const isAuthenticated = useRef(false);
  const [underlyingPrice, setUnderlyingPrice] = useState<number | null>(null);
  const underlyingPriceRef = useRef<number | null>(null);
  const subscribedInstrumentsRef = useRef<Set<string>>(new Set());

  // Deribit API currency 映射
  const apiCurrency = currency === 'BTC' || currency === 'ETH' ? currency : 'USDC';

  // REST API 轮询获取期权数据（主数据源）
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const curr = currencyRef.current;
    const apiCurr = apiCurrency;
    
    const fetchData = async () => {
      try {
        console.log('[Deribit REST] Fetching options for', curr, 'currency:', apiCurr);
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${apiCurr}&kind=option`);
        const json = await res.json();
        
        if (cancelled) return;
        
        if (json?.result && Array.isArray(json.result)) {
          console.log('[Deribit REST] Received', json.result.length, 'instruments');
          
          const tickers: Record<string, any> = {};
          for (const item of json.result) {
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
                bid: item.best_bid_price != null ? item.best_bid_price : null,
                ask: item.best_ask_price != null ? item.best_ask_price : null,
                lastPrice: item.last_price ?? null,
                change24h: item.price_change ?? 0,
                oi: item.open_interest ?? null,
                volume: item.volume ?? null,
                volumeUsd: item.volume_usd ?? null,
              };
            }
          }
          console.log('[Deribit REST] Processed', Object.keys(tickers).length, 'tickers');
          if (Object.keys(tickers).length > 0) {
            updateRef.current(tickers);
          }
        }
      } catch (e) {
        console.error('[Deribit REST] Failed to fetch:', e);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currency, enabled, apiCurrency]);
  
  // 获取标的价格
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const curr = currencyRef.current;
    
    const fetchUnderlyingPrice = async () => {
      try {
        const instrumentName = apiCurrency === 'USDC' 
          ? `${curr}_USDC-PERPETUAL` 
          : `${curr}-PERPETUAL`;
        const res = await fetch(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`);
        const json = await res.json();
        if (!cancelled && json?.result?.index_price) {
          console.log(`[Deribit] ${curr} index price:`, json.result.index_price);
          setUnderlyingPrice(json.result.index_price);
          underlyingPriceRef.current = json.result.index_price;
        }
      } catch (e) {
        console.error('[Deribit] Failed to fetch underlying price:', e);
      }
    };
    
    fetchUnderlyingPrice();
    const interval = setInterval(fetchUnderlyingPrice, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currency, enabled, apiCurrency]);

  // WebSocket 连接（支持认证）
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const curr = currencyRef.current;
    
    const connect = async () => {
      if (cancelled) return;
      
      try {
        console.log('[Deribit WS] Connecting...');
        const ws = new WebSocket(DERIBIT_WS_URL);
        wsRef.current = ws;
        
        ws.onopen = async () => {
          console.log('[Deribit WS] Connection opened');
          
          // 尝试认证
          const apiKey = import.meta.env.VITE_DERIBIT_API_KEY || import.meta.env.DERIBIT_API_KEY;
          const apiSecret = import.meta.env.VITE_DERIBIT_API_SECRET || import.meta.env.DERIBIT_API_SECRET;
          
          if (apiKey && apiSecret) {
            try {
              const timestamp = Date.now();
              const nonce = 'opencode_' + Math.random().toString(36).substring(2);
              const signature = await signMessage(`${apiKey}\n${nonce}\n${timestamp}`, apiSecret);
              
              reqId += 1;
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: reqId,
                method: 'public/auth',
                params: {
                  grant_type: 'client_signature',
                  client_id: apiKey,
                  timestamp: timestamp,
                  signature: signature,
                  nonce: nonce,
                  scope: 'read',
                },
              }));
              console.log('[Deribit WS] Auth request sent');
            } catch (e) {
              console.error('[Deribit WS] Auth failed:', e);
            }
          }
          
          // 订阅实时 ticker（根据币种订阅对应频道）
          const perpName = apiCurrency === 'USDC' 
            ? `${curr}_USDC-PERPETUAL` 
            : `${curr}-PERPETUAL`;
          reqId += 1;
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            method: 'public/subscribe',
            params: {
              channels: [
                `ticker.${perpName}.raw`,
              ],
            },
          }));
          console.log('[Deribit WS] Subscribed to ticker:', perpName);

          // 订阅当前到期日的期权 Ticker
          const currentExpiry = expiryRef.current;
          if (currentExpiry) {
            try {
              console.log('[Deribit WS] Fetching instruments for expiry:', currentExpiry);
              const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${apiCurrency}&kind=option`);
              const json = await res.json();
              if (json?.result && Array.isArray(json.result)) {
                const instruments = json.result
                  .filter((item: any) => item.instrument_name.includes(currentExpiry))
                  .map((item: any) => item.instrument_name);
                
                if (instruments.length > 0) {
                  console.log(`[Deribit WS] Subscribing to ${instruments.length} option tickers for ${currentExpiry}`);
                  // Deribit 限制每次请求最多 10 个频道，需要分批订阅
                  const batchSize = 10;
                  for (let i = 0; i < instruments.length; i += batchSize) {
                    const batch = instruments.slice(i, i + batchSize);
                    const channels = batch.map(name => `ticker.${name}.100ms`);
                    reqId += 1;
                    ws.send(JSON.stringify({
                      jsonrpc: '2.0',
                      id: reqId,
                      method: 'public/subscribe',
                      params: { channels },
                    }));
                    batch.forEach(name => subscribedInstrumentsRef.current.add(name));
                  }
                  console.log('[Deribit WS] Option ticker subscriptions sent');
                }
              }
            } catch (e) {
              console.error('[Deribit WS] Failed to subscribe to option tickers:', e);
            }
          }
        };
        
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);
            
            // 处理认证响应
            if (msg.result?.access_token) {
              isAuthenticated.current = true;
              console.log('[Deribit WS] Authenticated successfully');
              
              // 认证成功后，订阅用户频道
              const userChannel = apiCurrency === 'USDC' 
                ? `user.changes.${curr}_USDC.100ms` 
                : `user.changes.${curr}.100ms`;
              const tradesChannel = apiCurrency === 'USDC' 
                ? `trades.${curr}_USDC.raw` 
                : `trades.${curr}.raw`;
              reqId += 1;
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: reqId,
                method: 'private/subscribe',
                params: {
                  channels: [
                    userChannel,
                    tradesChannel,
                  ],
                  access_token: msg.result.access_token,
                },
              }));
              console.log('[Deribit WS] Subscribed to user channels:', userChannel, tradesChannel);
              return;
            }
            
            // 处理期权快照数据
            if (msg.id && msg.result && Array.isArray(msg.result)) {
              console.log('[Deribit WS] Received book summary with', msg.result.length, 'instruments');
              
              const tickers: Record<string, any> = {};
              for (const item of msg.result) {
                const name = item.instrument_name;
                const markPrice = item.mark_price;
                if (name && Number.isFinite(markPrice) && markPrice > 0) {
                  tickers[name] = {
                    markPrice,
                    iv: (item.mark_iv ?? item.iv ?? 0) / 100,
                    delta: item.delta ?? 0,
                    gamma: item.gamma ?? 0,
                    theta: item.theta ?? 0,
                    vega: item.vega ?? 0,
                    bid: item.best_bid_price ?? null,
                    ask: item.best_ask_price ?? null,
                    lastPrice: item.last_price ?? null,
                    change24h: item.price_change ?? 0,
                    oi: item.open_interest ?? null,
                    volume: item.volume ?? null,
                    volumeUsd: item.volume_usd ?? null,
                  };
                }
              }
              console.log('[Deribit WS] Processed', Object.keys(tickers).length, 'tickers');
              if (Object.keys(tickers).length > 0) {
                updateRef.current(tickers);
              }
              return;
            }
            
            // 处理实时 ticker 推送
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
                  bid: data.best_bid_price ?? null,
                  ask: data.best_ask_price ?? null,
                  lastPrice: data.last_price ?? null,
                  change24h: data.price_change ?? 0,
                  oi: data.open_interest ?? null,
                  volume: data.volume ?? null,
                };
                updateRef.current(tickers);
              }
              return;
            }
            
            // 处理用户持仓变化
            if (msg.method === 'subscription' && msg.params?.channel?.startsWith('user.changes')) {
              console.log('[Deribit WS] User position change:', JSON.stringify(msg.params.data).substring(0, 200));
              return;
            }
            
            // 处理成交数据
            if (msg.method === 'subscription' && msg.params?.channel?.startsWith('trades.')) {
              const trades = msg.params.data;
              if (Array.isArray(trades) && trades.length > 0) {
                console.log('[Deribit WS] New trades:', trades.length);
              }
              return;
            }
          } catch (e) {
            console.error('[Deribit WS] Parse error:', e);
          }
        };
        
        ws.onclose = (e) => {
          console.log('[Deribit WS] Connection closed:', e.code, e.reason);
          isAuthenticated.current = false;
          subscribedInstrumentsRef.current.clear();
          if (!cancelled) {
            reconnectTimerRef.current = setTimeout(connect, 5000);
          }
        };
        
        ws.onerror = (e) => {
          console.error('[Deribit WS] Error:', e);
          ws.close();
        };
      } catch (e) {
        console.error('[Deribit WS] Connection error:', e);
        if (!cancelled) {
          reconnectTimerRef.current = setTimeout(connect, 5000);
        }
      }
    };
    
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currency, expiry, enabled]);

  return { underlyingPrice };
}
