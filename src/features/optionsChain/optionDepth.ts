// ═══════════════════════════════════════════════════════════════════════════════
// useOptionDepth — 真实订单簿深度（只为下单面板里那一个合约）
//
// 打开下单面板时订阅该合约的盘口深度，关闭即退订（便宜：同一时刻只订一个合约）。
// 喂给模拟撮合 → 市价单吃单有真实滑点、限价单按真盘口成交。接 #6 实盘时管道现成。
//
//   • Deribit：DERIBIT_WS  book.{inst}.none.10.100ms（公有，深度限档，每帧即完整 top-N）
//   • Bybit：  下一步用 REST /v5/market/orderbook 轮询（快照式，免 delta 合并）
//
// 价为合约原生计价（Deribit 反向=币本位）；换 USD 的系数由调用方用顶档锚点反推。
// 注册新鲜度 key `depth-{inst}` → 面板可贴「盘口 实时/N秒前」徽章。
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { DERIBIT_WS } from '../../registry/data/ws';
import { markError, markOk } from '../../registry/data/freshness';
import { shouldRunFeedKey, subscribeRuntimePolicy } from '../../registry/data/runtimePolicy';
import type { DataSource } from './chainModel';
import type { DepthLevel } from './simBook';
import { fetchWithRetry } from '../../lib/fetchRetry';

export interface OptionDepth { bids: DepthLevel[]; asks: DepthLevel[]; ts: number }

const FLUSH_MS = 250; // 4Hz，够盘口跳动又不烧 CPU
const BYBIT_POLL_MS = 2_000;

export const depthFeedKey = (instrument: string) => `depth-${instrument}`;

// Deribit 帧里 bids/asks 可能是 [price, amount] 或 [action, price, amount]，统一解析。
function parseLevels(arr: unknown): DepthLevel[] {
  const out: DepthLevel[] = [];
  if (!Array.isArray(arr)) return out;
  for (const e of arr) {
    if (!Array.isArray(e)) continue;
    const price = Number(e.length === 3 ? e[1] : e[0]);
    const size = Number(e.length === 3 ? e[2] : e[1]);
    if (Number.isFinite(price) && size > 0) out.push({ price, size });
  }
  return out;
}

export function useOptionDepth(source: DataSource, instrument: string | undefined): OptionDepth | null {
  const [depth, setDepth] = useState<OptionDepth | null>(null);

  useEffect(() => {
    setDepth(null);
    if (!instrument) return;

    if (source === 'bybit') {
      const feedKey = depthFeedKey(instrument);
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const controller = new AbortController();
      const shouldRun = () => shouldRunFeedKey(feedKey, { mode: 'visible-live' });

      const poll = async () => {
        if (!shouldRun()) {
          if (alive) timer = setTimeout(poll, BYBIT_POLL_MS);
          return;
        }
        try {
          const resp = await fetchWithRetry(
            `/bybit-api/v5/market/orderbook?category=option&symbol=${encodeURIComponent(instrument)}&limit=25`,
            { signal: controller.signal, retries: 2, timeoutMs: 8_000 },
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const json = await resp.json();
          if (json.retCode !== 0) throw new Error(`Bybit ${json.retCode}: ${json.retMsg ?? 'orderbook error'}`);
          const result = json.result ?? {};
          const bids = parseLevels(result.b).sort((a, b) => b.price - a.price);
          const asks = parseLevels(result.a).sort((a, b) => a.price - b.price);
          if (!alive) return;
          setDepth({ bids, asks, ts: Number(result.ts) || Date.now() });
          markOk(feedKey, BYBIT_POLL_MS * 2);
        } catch (e) {
          if (!alive || controller.signal.aborted) return;
          markError(feedKey, e);
        } finally {
          if (alive) timer = setTimeout(poll, BYBIT_POLL_MS);
        }
      };

      void poll();
      return () => {
        alive = false;
        controller.abort();
        if (timer) clearTimeout(timer);
      };
    }

    const feedKey = depthFeedKey(instrument);
    const shouldRun = () => shouldRunFeedKey(feedKey, { mode: 'visible-live' });
    let bids: DepthLevel[] = [], asks: DepthLevel[] = [];
    let dirty = false;
    let unsub: (() => void) | null = null;

    const subscribe = () => {
      if (unsub) return;
      unsub = DERIBIT_WS.subscribe<{ bids?: unknown; asks?: unknown }>(
        `book.${instrument}.none.10.100ms`,
        d => {
          if (!d) return;
          // 深度限档频道每帧即完整 top-N → 直接替换
          bids = parseLevels(d.bids).sort((a, b) => b.price - a.price);
          asks = parseLevels(d.asks).sort((a, b) => a.price - b.price);
          dirty = true;
          markOk(feedKey, 2_000);
        },
      );
    };
    const unsubscribe = () => { unsub?.(); unsub = null; };
    const applyPolicy = () => { if (shouldRun()) subscribe(); else unsubscribe(); };

    applyPolicy();
    const unsubscribePolicy = subscribeRuntimePolicy(applyPolicy);

    const flush = setInterval(() => {
      if (shouldRun() && dirty) { dirty = false; setDepth({ bids, asks, ts: Date.now() }); }
    }, FLUSH_MS);

    return () => { unsubscribe(); unsubscribePolicy(); clearInterval(flush); };
  }, [source, instrument]);

  return depth;
}
