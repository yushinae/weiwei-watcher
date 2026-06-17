/**
 * hermes_watcher.db — shared SQLite module for the backend server.
 *
 * Uses Node 26 built-in `node:sqlite` (zero dependencies).
 * All I/O is synchronous — acceptable for a local-only single-user server.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_DIR = join(homedir(), '.hermes')
const DB_PATH = join(DB_DIR, 'hermes_watcher.db')

// Ensure ~/.hermes exists
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })

let _db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH)
    _db.exec('PRAGMA journal_mode=WAL')
    _db.exec('PRAGMA busy_timeout=5000')
  }
  return _db
}

// ─── Fills ───────────────────────────────────────────────────────────────────

export function getAllFills(): unknown[] {
  const rows = getDb().prepare(`
    SELECT id, venue, account_id as accountId, coin, side, price as px,
           size, notional as notionalUsd, fee, closed_pnl as closedPnl,
           dir, filled_at as time
    FROM fills ORDER BY filled_at DESC
  `).all()
  return rows
}

export function mergeFills(fills: Array<{
  id: string; venue: string; coin: string; side: string; px: number; size: number;
  notionalUsd?: number; fee?: number; closedPnl?: number; dir?: string; time: number;
  accountId?: string;
}>): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO fills (id, venue, account_id, coin, side, price, size, notional, fee, closed_pnl, dir, filled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let added = 0
  for (const f of fills) {
    const res = stmt.run(f.id, f.venue, f.accountId ?? null, f.coin, f.side, f.px, f.size,
      f.notionalUsd ?? null, f.fee ?? null, f.closedPnl ?? 0, f.dir ?? null, f.time)
    if (res.changes > 0) added++
  }
  return added
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export function getAccounts(): unknown[] {
  return getDb().prepare(`
    SELECT id, venue, label, address, is_active as isActive
    FROM accounts ORDER BY venue, label
  `).all()
}

export function setAccounts(accounts: Array<{ id: string; venue: string; label?: string; address?: string }>): void {
  const db = getDb()
  db.exec('DELETE FROM accounts')
  const stmt = db.prepare('INSERT INTO accounts (id, venue, label, address) VALUES (?, ?, ?, ?)')
  for (const a of accounts) {
    stmt.run(a.id, a.venue, a.label ?? null, a.address ?? null)
  }
}

// ─── Sim options ─────────────────────────────────────────────────────────────

export function getSimOptions(): unknown {
  const db = getDb()
  const positions = db.prepare(`
    SELECT id, symbol, side, qty, avg_entry_price as avgEntryPrice,
           mark_price as markPrice, unrealized_pnl as unrealizedPnL,
           delta, gamma, theta, vega, source, instrument
    FROM sim_positions
  `).all()
  const openOrders = db.prepare(`
    SELECT id, symbol, side, type, price, qty, filled_qty as filledQty, status
    FROM sim_orders WHERE status = 'open'
  `).all()
  const orderHistory = db.prepare(`
    SELECT id, symbol, side, type, price, qty, status, created_at as createdAt
    FROM sim_orders WHERE status != 'open'
  `).all()
  const fills = db.prepare(`
    SELECT id, symbol, side, qty, price, fee, filled_at as timestamp
    FROM sim_fills ORDER BY filled_at
  `).all()
  return { positions, openOrders, orderHistory, fills }
}

export function setSimOptions(data: {
  positions: Array<{id?: unknown; symbol?: unknown; side?: unknown; qty?: unknown; avgEntryPrice?: unknown; markPrice?: unknown; unrealizedPnL?: unknown; delta?: unknown; gamma?: unknown; theta?: unknown; vega?: unknown; source?: unknown; instrument?: unknown}>
  openOrders: Array<{id?: unknown; symbol?: unknown; side?: unknown; type?: unknown; price?: unknown; qty?: unknown; status?: unknown}>
  orderHistory: Array<{id?: unknown; symbol?: unknown; side?: unknown; type?: unknown; price?: unknown; qty?: unknown; status?: unknown}>
  fills: Array<{id?: unknown; symbol?: unknown; side?: unknown; qty?: unknown; price?: unknown; fee?: unknown; timestamp?: unknown}>
}): void {
  const db = getDb()
  db.exec('DELETE FROM sim_positions; DELETE FROM sim_orders; DELETE FROM sim_fills')

  const posStmt = db.prepare(`
    INSERT INTO sim_positions (id, symbol, side, qty, avg_entry_price, mark_price, unrealized_pnl,
      delta, gamma, theta, vega, source, instrument)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const p of data.positions) {
    posStmt.run(p.id as string, p.symbol as string, p.side as string, p.qty as number,
      p.avgEntryPrice as number ?? null, p.markPrice as number ?? null, p.unrealizedPnL as number ?? null,
      p.delta as number ?? 0, p.gamma as number ?? 0, p.theta as number ?? 0, p.vega as number ?? 0,
      p.source as string ?? null, p.instrument as string ?? null)
  }

  const ordStmt = db.prepare(`
    INSERT INTO sim_orders (id, symbol, side, type, price, qty, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const o of [...data.openOrders, ...data.orderHistory]) {
    ordStmt.run(o.id as string, o.symbol as string, o.side as string, (o.type as string) ?? 'limit',
      o.price as number ?? 0, o.qty as number, (o.status as string) ?? 'open')
  }

  const fillStmt = db.prepare(`
    INSERT INTO sim_fills (id, symbol, side, qty, price, fee, filled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const f of data.fills) {
    fillStmt.run(f.id as string, f.symbol as string, f.side as string, f.qty as number,
      f.price as number, f.fee as number ?? 0, f.timestamp as number ?? Date.now())
  }
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export function getAlerts(): unknown[] {
  return getDb().prepare(`
    SELECT id, coin, metric, op, threshold, active FROM alerts ORDER BY created_at
  `).all()
}

export function setAlerts(alerts: Array<{
  id: string; coin: string; metric: string; op: string; threshold: number; active?: boolean
}>): void {
  const db = getDb()
  db.exec('DELETE FROM alerts')
  const stmt = db.prepare('INSERT INTO alerts (id, coin, metric, op, threshold, active) VALUES (?, ?, ?, ?, ?, ?)')
  for (const a of alerts) {
    stmt.run(a.id, a.coin, a.metric, a.op, a.threshold, a.active !== false ? 1 : 0)
  }
}

// ─── Watchlist ───────────────────────────────────────────────────────────────

export function getWatchlist(): unknown[] {
  return getDb().prepare('SELECT coin, label FROM watchlist ORDER BY added_at').all()
}

export function setWatchlist(items: Array<{ coin: string; label?: string }>): void {
  const db = getDb()
  db.exec('DELETE FROM watchlist')
  const stmt = db.prepare('INSERT OR IGNORE INTO watchlist (coin, label) VALUES (?, ?)')
  for (const w of items) {
    stmt.run(w.coin, w.label ?? null)
  }
}

// ─── Market snapshots (NEW) ─────────────────────────────────────────────────

export function saveMarketSnapshot(snapshot: {
  coin: string
  venue: string
  price?: number
  volume24h?: number
  oi?: number
  fundingRate?: number
  snapshotAt?: number
}): void {
  getDb().prepare(`
    INSERT INTO market_snapshots (coin, venue, price, volume_24h, oi, funding_rate, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(snapshot.coin, snapshot.venue, snapshot.price ?? null, snapshot.volume24h ?? null,
    snapshot.oi ?? null, snapshot.fundingRate ?? null, snapshot.snapshotAt)
}

export function getMarketSnapshots(coin: string, limit = 200): unknown[] {
  return getDb().prepare(`
    SELECT * FROM market_snapshots
    WHERE coin = ?
    ORDER BY snapshot_at DESC
    LIMIT ?
  `).all(coin, limit)
}

// ─── Option trades (NEW) ─────────────────────────────────────────────────────

export function saveOptionTrade(trade: {
  instrument: string
  coin: string
  strike: number
  expiry: string
  type: 'call' | 'put'
  side: 'buy' | 'sell'
  price: number
  amount: number
  iv: number
  premiumUSD: number
  notionalUSD: number
  indexPrice: number
  markPrice?: number
  bidPrice?: number
  askPrice?: number
  delta?: number
  gamma?: number
  theta?: number
  vega?: number
  oi?: number
  volume?: number
  snapshotAt: number
}): void {
  const db = getDb()
  // Option trade → save as option_snapshot (the trade itself is a "snapshot" of market state)
  db.prepare(`
    INSERT INTO option_snapshots (coin, strike, expiry, type, mark_price, bid_price, ask_price,
      iv, delta, gamma, theta, vega, oi, volume, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trade.coin, trade.strike, trade.expiry, trade.type,
    trade.markPrice ?? trade.price, trade.bidPrice ?? null, trade.askPrice ?? null,
    trade.iv, trade.delta ?? null, trade.gamma ?? null, trade.theta ?? null, trade.vega ?? null,
    trade.oi ?? null, trade.volume ?? null, trade.snapshotAt
  )
}

export function getOptionSnapshots(coin: string, expiry?: string, limit = 200): unknown[] {
  const db = getDb()
  if (expiry) {
    return db.prepare(`
      SELECT * FROM option_snapshots
      WHERE coin = ? AND expiry = ?
      ORDER BY snapshot_at DESC
      LIMIT ?
    `).all(coin, expiry, limit)
  }
  return db.prepare(`
    SELECT * FROM option_snapshots
    WHERE coin = ?
    ORDER BY snapshot_at DESC
    LIMIT ?
  `).all(coin, limit)
}

// ─── Journal ─────────────────────────────────────────────────────────────────

export function getJournal(): unknown[] {
  return getDb().prepare('SELECT id, title, content, tags, created_at as createdAt FROM journal_entries ORDER BY created_at DESC').all()
}

export function setJournal(entries: Array<{ id: string; title?: string; content?: string; tags?: string }>): void {
  const db = getDb()
  db.exec('DELETE FROM journal_entries')
  const stmt = db.prepare('INSERT INTO journal_entries (id, title, content, tags) VALUES (?, ?, ?, ?)')
  for (const e of entries) {
    stmt.run(e.id, e.title ?? null, e.content ?? null, e.tags ?? null)
  }
}
