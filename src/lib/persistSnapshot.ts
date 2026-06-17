/**
 * 行情快照持久化 — 将 WebSocket 实时数据写入 hermes_watcher.db
 *
 * 通过后端 API 写入，不影响前端渲染性能。
 * 节流策略：行情每 60s 存一次快照；大额成交实时存。
 */

import { api } from '../api'

// ─── 市场行情快照 ───────────────────────────────────────────────────────────

let lastSnapshotSave = 0
const SNAPSHOT_INTERVAL = 60_000 // 每 60 秒

/**
 * 保存当前行情快照（自动节流，每 60s 一次）
 * 在 useTickerSnapshotWS 每次计算出新 snapshot 时调用即可
 */
export function maybeSaveMarketSnapshot(snapshot: {
  coin: string
  spot: number
  dvol: number
  fundingAnn: number
  optOI_M: number
}): void {
  const now = Date.now()
  if (now - lastSnapshotSave < SNAPSHOT_INTERVAL) return
  lastSnapshotSave = now

  // 异步发送，不阻塞 UI
  api('/api/snapshots/market', 'POST', {
    coin: snapshot.coin,
    venue: 'deribit',
    price: snapshot.spot,
    oi: snapshot.optOI_M * 1e6, // 还原为原始 USD 值
    fundingRate: snapshot.fundingAnn,
    snapshotAt: now,
  }).catch(() => {
    // 后端不可用时静默失败（不影响前端）
  })
}

// ─── 期权大额成交快照 ───────────────────────────────────────────────────────

let lastOptionSave = 0
const OPTION_INTERVAL = 30_000 // 每 30s 批量存一次

const pendingTrades: Array<{
  instrument: string; coin: string; strike: number; expiry: string;
  type: 'call' | 'put'; side: 'buy' | 'sell'; price: number; amount: number;
  iv: number; premiumUSD: number; notionalUSD: number; indexPrice: number;
  snapshotAt: number
}> = []

/**
 * 排队一条期权成交（内部批量保存）
 */
export function queueOptionTrade(trade: {
  instrument: string; coin: string; strike: number; expiry: string;
  optType: 'C' | 'P'; direction: 'buy' | 'sell';
  price: number; amount: number; iv: number;
  premiumUSD: number; notionalUSD: number; indexPrice: number;
  ts: number
}): void {
  pendingTrades.push({
    instrument: trade.instrument,
    coin: trade.coin,
    strike: trade.strike,
    expiry: trade.expiry,
    type: trade.optType === 'C' ? 'call' : 'put',
    side: trade.direction,
    price: trade.price,
    amount: trade.amount,
    iv: trade.iv,
    premiumUSD: trade.premiumUSD,
    notionalUSD: trade.notionalUSD,
    indexPrice: trade.indexPrice,
    snapshotAt: trade.ts,
  })

  const now = Date.now()
  if (now - lastOptionSave >= OPTION_INTERVAL && pendingTrades.length > 0) {
    flushOptionTrades()
  }
}

function flushOptionTrades(): void {
  if (pendingTrades.length === 0) return
  lastOptionSave = Date.now()
  const batch = pendingTrades.splice(0, pendingTrades.length)
  api('/api/snapshots/option/batch', 'POST', batch).catch(() => {})
}
