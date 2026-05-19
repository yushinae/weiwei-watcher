import { useEffect, useRef, useState } from 'react';
import { useSimTradingStore } from '../store/useSimTradingStore';

// ─────────────────────────────────────────────────────────────────────────────
// Deribit 期权数据接入（自包含，不引用永续/合约价）
//
// 两条数据通道：
//   1. REST 轮询 get_book_summary_by_currency（10s/次）—— 全量广度数据，
//      每个 instrument 的 mark/bid/ask/iv/oi/volume/underlying_price/interest_rate。
//      此端点 *不* 返回 greeks，下游用 Black-76 自算。
//   2. WS 订阅 ticker.{name}.100ms —— 当前 expiry 所有合约的实时推送，
//      字段包含真实 delta/gamma/theta/vega（Deribit 用对应远期价算出来的）。
//
// hook 返回的 `underlyingPrice` 直接从任意期权的 underlying_price 字段取（同一
// expiry 的所有期权共用一个 forward），不再额外拉永续——期权价 ≠ 合约价。
//
// 关键点：
//   - Deribit 期权是 *Inverse Options*：mark/bid/ask/last 都以币本位计价，
//     需要乘以 underlying_price 才得到 USD。
//   - REST 和 WS 的字段名 *不一样*：REST 用 bid_price/ask_price/last，
//     WS ticker 频道用 best_bid_price/best_ask_price/last_price。
//   - Deribit 无盘口时 bid/ask 返回 0（不是 null），这里映射为 null 表示"无报价"。
// ─────────────────────────────────────────────────────────────────────────────

const DERIBIT_WS_URL = '/deribit-ws';
const REST_POLL_INTERVAL_MS = 10_000;
const WS_SUBSCRIBE_BATCH_SIZE = 10;
const WS_RECONNECT_DELAY_MS = 5_000;

let reqId = 0;

function isOption(instrumentName: string): boolean {
  return /-[CP]$/.test(instrumentName);
}

/** 币本位 → USD 转换；拿不到 forward price 时降级返回币价。 */
function toUsd(coin: number | null | undefined, fwd: number | null | undefined): number | null {
  if (coin == null || !Number.isFinite(coin)) return null;
  if (fwd == null || !Number.isFinite(fwd) || fwd <= 0) return coin;
  return coin * fwd;
}

/** Bid/Ask/Last 专用：Deribit 无盘口时返回 0，这里映射为 null。 */
function quoteToUsd(coin: number | null | undefined, fwd: number | null | undefined): number | null {
  if (coin == null || !Number.isFinite(coin) || coin <= 0) return null;
  return toUsd(coin, fwd);
}

/** 期权专属字段的 USD 化（永续保持原值）。 */
function priceFieldForOption(isOpt: boolean, raw: number | null | undefined, fwd: number | null | undefined): number | null {
  if (isOpt) return quoteToUsd(raw, fwd);
  return raw != null && Number.isFinite(raw) && raw > 0 ? raw : null;
}

interface NormalizedTicker {
  markPrice: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  change24h: number;
  oi: number | null;
  volume: number | null;
  volumeUsd?: number | null;
  underlyingPrice?: number;
  interestRate?: number;
}

/** 标准化 get_book_summary_by_currency 的一条 entry（REST / WS 同一端点共用）。
 *  注意 book_summary 不返回 greeks，留 0；下游用 IV + Black-76 算或被 WS 推送覆盖。 */
function normalizeBookSummary(item: any): { name: string; t: NormalizedTicker } | null {
  const name = item?.instrument_name;
  const mark = item?.mark_price;
  if (!name || !Number.isFinite(mark) || mark <= 0) return null;
  const isOpt = isOption(name);
  const fwd = item.underlying_price;
  const markUsd = isOpt ? toUsd(mark, fwd) ?? mark : mark;
  return {
    name,
    t: {
      markPrice: markUsd,
      iv: (item.mark_iv ?? item.iv ?? 0) / 100,
      delta: 0, gamma: 0, theta: 0, vega: 0,
      bid: priceFieldForOption(isOpt, item.bid_price, fwd),
      ask: priceFieldForOption(isOpt, item.ask_price, fwd),
      lastPrice: priceFieldForOption(isOpt, item.last, fwd),
      change24h: item.price_change ?? 0,
      oi: item.open_interest ?? null,
      volume: item.volume ?? null,
      volumeUsd: item.volume_usd ?? null,
      underlyingPrice: Number.isFinite(fwd) && fwd > 0 ? fwd : undefined,
      interestRate: Number.isFinite(item.interest_rate) ? item.interest_rate : undefined,
    },
  };
}

/** 标准化 ticker.{name}.100ms WS 推送（带真实 greeks）。 */
function normalizeTickerPush(data: any): { name: string; t: NormalizedTicker } | null {
  const name = data?.instrument_name;
  const mark = data?.mark_price;
  if (!name || !Number.isFinite(mark) || mark <= 0) return null;
  const isOpt = isOption(name);
  const fwd = data.underlying_price;
  const markUsd = isOpt ? toUsd(mark, fwd) ?? mark : mark;
  return {
    name,
    t: {
      markPrice: markUsd,
      iv: (data.mark_iv ?? data.iv ?? 0) / 100,
      delta: Number.isFinite(data.delta) ? data.delta : 0,
      gamma: Number.isFinite(data.gamma) ? data.gamma : 0,
      theta: Number.isFinite(data.theta) ? data.theta : 0,
      vega: Number.isFinite(data.vega) ? data.vega : 0,
      bid: priceFieldForOption(isOpt, data.best_bid_price, fwd),
      ask: priceFieldForOption(isOpt, data.best_ask_price, fwd),
      lastPrice: priceFieldForOption(isOpt, data.last_price, fwd),
      change24h: data.price_change ?? 0,
      oi: data.open_interest ?? null,
      volume: data.volume ?? null,
      underlyingPrice: Number.isFinite(fwd) && fwd > 0 ? fwd : undefined,
      interestRate: Number.isFinite(data.interest_rate) ? data.interest_rate : undefined,
    },
  };
}

export function useDeribitOptionsStream(currency = 'BTC', expiry: string | null = null, enabled = true) {
  const updateTickers = useSimTradingStore(s => s.updateTickers);
  const updateRef = useRef(updateTickers);
  updateRef.current = updateTickers;
  const [underlyingPrice, setUnderlyingPrice] = useState<number | null>(null);

  // Deribit USDC 合约币种走单独的路径；其他都按主币种处理
  const apiCurrency = currency === 'BTC' || currency === 'ETH' ? currency : 'USDC';

  // ────────── REST 轮询：所有 instrument 的全量快照 ──────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${apiCurrency}&kind=option`;
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled || !Array.isArray(json?.result)) return;
        const tickers: Record<string, NormalizedTicker> = {};
        let firstFwd: number | null = null;
        for (const item of json.result) {
          const n = normalizeBookSummary(item);
          if (!n) continue;
          tickers[n.name] = n.t;
          if (firstFwd == null && n.t.underlyingPrice && n.t.underlyingPrice > 0) {
            firstFwd = n.t.underlyingPrice;
          }
        }
        if (Object.keys(tickers).length > 0) updateRef.current(tickers);
        // 顶部"标的价"展示直接从期权自带的 underlying_price 取，不引用永续
        if (firstFwd != null) setUnderlyingPrice(firstFwd);
      } catch (e) {
        console.error('[Deribit REST] book_summary failed:', e);
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, REST_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, apiCurrency]);

  // ────────── WS 实时推送：当前 expiry 所有 instrument 的 ticker（带 greeks） ──────────
  useEffect(() => {
    if (!enabled || !expiry) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // 期望的 expiry 格式：'25JUN26'（Deribit 合约名里的形式）
    const expiryNorm = expiry.replace(/\s+/g, '').toUpperCase();

    const connect = async () => {
      if (cancelled) return;

      // 先拿当前 expiry 的 instrument 列表
      let instruments: string[] = [];
      try {
        const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${apiCurrency}&kind=option`;
        const res = await fetch(url);
        const json = await res.json();
        if (Array.isArray(json?.result)) {
          instruments = json.result
            .map((it: any) => it.instrument_name as string)
            .filter((n: string) => typeof n === 'string' && n.includes(expiryNorm));
        }
      } catch (e) {
        console.error('[Deribit WS] fetch instruments failed:', e);
      }
      if (cancelled || instruments.length === 0) return;

      ws = new WebSocket(DERIBIT_WS_URL);

      ws.onopen = () => {
        // Deribit 限制每次 subscribe 最多 10 个 channel
        for (let i = 0; i < instruments.length; i += WS_SUBSCRIBE_BATCH_SIZE) {
          const batch = instruments.slice(i, i + WS_SUBSCRIBE_BATCH_SIZE);
          reqId += 1;
          ws!.send(JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            method: 'public/subscribe',
            params: { channels: batch.map(name => `ticker.${name}.100ms`) },
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.method === 'subscription' && msg.params?.channel?.startsWith('ticker.')) {
            const n = normalizeTickerPush(msg.params.data);
            if (n) updateRef.current({ [n.name]: n.t });
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
      };

      ws.onerror = () => { ws?.close(); };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
    };
  }, [enabled, apiCurrency, expiry]);

  return { underlyingPrice };
}
