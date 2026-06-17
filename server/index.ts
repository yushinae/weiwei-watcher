/**
 * weiwei-react 本地后端 — 数据持久化到 hermes_watcher.db (SQLite)
 *
 * 每个 API 对应 hermes_watcher.db 的一张表。
 * SQLite 引擎：Node 26 内置 `node:sqlite`，零依赖。
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { readFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import * as db from './db'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const RUNTIME_DATA_DIR = join(__dirname, 'data', 'runtime')

await mkdir(RUNTIME_DATA_DIR, { recursive: true })

const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}))

// ── 账户 ────────────────────────────────────────────────────────────────────
app.get('/api/accounts', async (c) => c.json(db.getAccounts()))

app.put('/api/accounts', async (c) => {
  const body = await c.req.json() as Array<Record<string, unknown>>
  db.setAccounts(body as any)
  return c.json({ ok: true })
})

// ── 成交记录 ─────────────────────────────────────────────────────────────────
app.get('/api/fills', async (c) => c.json(db.getAllFills()))

app.put('/api/fills/merge', async (c) => {
  const fills = await c.req.json() as any[]
  if (!Array.isArray(fills) || fills.length === 0) return c.json({ added: 0 })
  const added = db.mergeFills(fills)
  return c.json({ added })
})

// ── 持仓 ────────────────────────────────────────────────────────────────────
app.get('/api/positions', async (c) => {
  // 从 SQLite 查询当前持仓（future）
  return c.json([]) // 保持兼容，前端持仓通过 sync 拉取
})

app.put('/api/positions', async (c) => {
  await c.req.json()
  return c.json({ ok: true })
})

// ── 自选列表 ────────────────────────────────────────────────────────────────
app.get('/api/watchlist', async (c) => c.json(db.getWatchlist()))

app.put('/api/watchlist', async (c) => {
  const body = await c.req.json() as Array<Record<string, unknown>>
  db.setWatchlist(body as any)
  return c.json({ ok: true })
})

// ── 告警 ─────────────────────────────────────────────────────────────────────
app.get('/api/alerts', async (c) => c.json(db.getAlerts()))

app.put('/api/alerts', async (c) => {
  const body = await c.req.json() as Array<Record<string, unknown>>
  db.setAlerts(body as any)
  return c.json({ ok: true })
})

// ── 交易日志 ─────────────────────────────────────────────────────────────────
app.get('/api/journal', async (c) => c.json(db.getJournal()))

app.put('/api/journal', async (c) => {
  const body = await c.req.json() as Array<Record<string, unknown>>
  db.setJournal(body as any)
  return c.json({ ok: true })
})

// ── 模拟期权账本 ──────────────────────────────────────────────────────────────
app.get('/api/sim-options', async (c) => c.json(db.getSimOptions()))

app.put('/api/sim-options', async (c) => {
  const body = await c.req.json() as any
  db.setSimOptions(body)
  return c.json({ ok: true })
})

// ── ═════════════════════════════════════════════════════════════════════════
//  行情快照 API（新增）
// ═════════════════════════════════════════════════════════════════════════════

// 保存一条行情快照
app.post('/api/snapshots/market', async (c) => {
  const body = await c.req.json() as {
    coin: string; venue: string; price?: number; volume24h?: number;
    oi?: number; fundingRate?: number; snapshotAt?: number
  }
  db.saveMarketSnapshot({
    coin: body.coin,
    venue: body.venue,
    price: body.price,
    volume24h: body.volume24h,
    oi: body.oi,
    fundingRate: body.fundingRate,
    snapshotAt: body.snapshotAt ?? Date.now(),
  })
  return c.json({ ok: true })
})

// 批量保存行情快照
app.post('/api/snapshots/market/batch', async (c) => {
  const body = await c.req.json() as Array<{
    coin: string; venue: string; price?: number; volume24h?: number;
    oi?: number; fundingRate?: number; snapshotAt?: number
  }>
  for (const s of body) db.saveMarketSnapshot(s)
  return c.json({ ok: true, count: body.length })
})

// 查询行情快照
app.get('/api/snapshots/market', async (c) => {
  const coin = c.req.query('coin') ?? 'BTC'
  const limit = Math.min(Number(c.req.query('limit')) || 200, 10000)
  return c.json(db.getMarketSnapshots(coin, limit))
})

// 保存期权链快照
app.post('/api/snapshots/option', async (c) => {
  const body = await c.req.json() as {
    instrument: string; coin: string; strike: number; expiry: string;
    type: 'call' | 'put'; side?: string; price: number; amount?: number;
    iv?: number; markPrice?: number; bidPrice?: number; askPrice?: number;
    delta?: number; gamma?: number; theta?: number; vega?: number;
    oi?: number; volume?: number; snapshotAt?: number
  }
  db.saveOptionTrade({
    instrument: body.instrument, coin: body.coin, strike: body.strike, expiry: body.expiry,
    type: body.type, side: body.side as any ?? 'buy', price: body.price,
    amount: body.amount ?? 0, iv: body.iv ?? 0,
    premiumUSD: body.price * (body.amount ?? 0) * (body.markPrice ?? body.price),
    notionalUSD: (body.amount ?? 0) * (body.markPrice ?? body.price),
    indexPrice: body.markPrice ?? body.price,
    markPrice: body.markPrice, bidPrice: body.bidPrice, askPrice: body.askPrice,
    delta: body.delta, gamma: body.gamma, theta: body.theta, vega: body.vega,
    oi: body.oi, volume: body.volume,
    snapshotAt: body.snapshotAt ?? Date.now(),
  })
  return c.json({ ok: true })
})

// 批量保存期权链快照
app.post('/api/snapshots/option/batch', async (c) => {
  const body = await c.req.json() as Array<Record<string, unknown>>
  for (const b of body) {
    db.saveOptionTrade(b as any)
  }
  return c.json({ ok: true, count: body.length })
})

// 查询期权链快照
app.get('/api/snapshots/option', async (c) => {
  const coin = c.req.query('coin') ?? 'BTC'
  const expiry = c.req.query('expiry') || undefined
  const limit = Math.min(Number(c.req.query('limit')) || 200, 10000)
  return c.json(db.getOptionSnapshots(coin, expiry, limit))
})

// ── Bybit 凭证 ───────────────────────────────────────────────────────────────
interface BybitCreds { apiKey: string; apiSecret: string }

async function readDotEnv(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(ROOT_DIR, '.env'), 'utf-8')
    const out: Record<string, string> = {}
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      out[key] = value
    }
    return out
  } catch { return {} }
}

async function readBybitCreds(): Promise<BybitCreds | null> {
  const env = await readDotEnv()
  const envKey = process.env.VITE_BYBIT_API_KEY?.trim() || env.VITE_BYBIT_API_KEY?.trim()
  const envSecret = process.env.VITE_BYBIT_API_SECRET?.trim() || env.VITE_BYBIT_API_SECRET?.trim()
  if (envKey && envSecret) return { apiKey: envKey, apiSecret: envSecret }
  // Read credentials from old JSON location for backward compat
  return null
}

app.get('/api/credentials/bybit', async (c) => {
  const creds = await readBybitCreds()
  return c.json({ configured: !!creds, apiKey: creds?.apiKey ?? null })
})

app.put('/api/credentials/bybit', async (c) => {
  const { apiKey, apiSecret } = await c.req.json() as BybitCreds
  // Store inline for this session
  process.env.VITE_BYBIT_API_KEY = apiKey.trim()
  process.env.VITE_BYBIT_API_SECRET = apiSecret.trim()
  return c.json({ ok: true })
})

app.delete('/api/credentials/bybit', async (c) => {
  delete process.env.VITE_BYBIT_API_KEY
  delete process.env.VITE_BYBIT_API_SECRET
  return c.json({ ok: true })
})

// ── Bybit API 代理 ──────────────────────────────────────────────────────────
interface ProxyRequest {
  path: string
  params?: Record<string, string | number | undefined>
  method?: 'GET' | 'POST'
  body?: Record<string, string | number | boolean | undefined>
}

const BYBIT_REST = 'https://api.bybit.com'

app.post('/api/proxy/bybit', async (c) => {
  const creds = await readBybitCreds()
  if (!creds) return c.json({ retCode: 10001, retMsg: '后端未配置 Bybit Key' }, 401)

  const { path, params = {}, method = 'GET', body = {} } = await c.req.json() as ProxyRequest

  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  const queryString = entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  const jsonBody = method === 'POST' ? JSON.stringify(body) : ''

  const timestamp = Date.now().toString()
  const recvWindow = '5000'
  const payload = timestamp + creds.apiKey + recvWindow + (method === 'POST' ? jsonBody : queryString)
  const signature = createHmac('sha256', creds.apiSecret).update(payload).digest('hex')

  const url = `${BYBIT_REST}${path}${queryString ? `?${queryString}` : ''}`
  const resp = await fetch(url, {
    method,
    headers: {
      'X-BAPI-API-KEY':     creds.apiKey,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN':        signature,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: jsonBody } : {}),
  })
  const json = await resp.json()
  return c.json(json)
})

// ── 健康检查 ────────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ ok: true, uptime: process.uptime() }))

// ── 启动 ────────────────────────────────────────────────────────────────────
const PORT = 8787
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`🌱 weiwei-server running at http://localhost:${info.port}`)
})
