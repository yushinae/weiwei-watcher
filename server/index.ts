/**
 * weiwei-react 本地后端
 *
 * 作用：替前端把数据存到硬盘上（JSON 文件），这样清浏览器缓存也不丢。
 *
 * 每个数据类型一个文件：
 *   server/data/accounts.json   — 账户配置
 *   server/data/fills.json      — 成交记录
 *   server/data/positions.json  — 手动持仓
 *   server/data/watchlist.json  — 自选列表
 *   server/data/alerts.json     — 告警规则
 *   server/data/journal.json    — 交易日志
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'

// ── 数据目录 ────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const ROOT_DIR = resolve(__dirname, '..')

// 确保数据目录存在
await mkdir(DATA_DIR, { recursive: true })

// ── 简单的 JSON 文件读写 ────────────────────────────────────────────────────
async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(DATA_DIR, file), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJSON<T>(file: string, data: T): Promise<void> {
  await writeFile(join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf-8')
}

async function readMap(file: string): Promise<Record<string, unknown>> {
  return readJSON<Record<string, unknown>>(file, {})
}

async function writeMap(file: string, data: Record<string, unknown>): Promise<void> {
  return writeJSON(file, data)
}

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
  } catch {
    return {}
  }
}

async function readBybitCreds(): Promise<BybitCreds | null> {
  const env = await readDotEnv()
  const envKey = process.env.VITE_BYBIT_API_KEY?.trim() || env.VITE_BYBIT_API_KEY?.trim()
  const envSecret = process.env.VITE_BYBIT_API_SECRET?.trim() || env.VITE_BYBIT_API_SECRET?.trim()
  if (envKey && envSecret) return { apiKey: envKey, apiSecret: envSecret }
  return readJSON<BybitCreds | null>('credentials.json', null)
}

// ── 服务器 ──────────────────────────────────────────────────────────────────
const app = new Hono()

// 允许前端（localhost:3000）跨域请求
app.use('/*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}))

// ── 账户（accounts.json）────────────────────────────────────────────────────
// 存的是交易所账号列表（名称、标签、类型等）
app.get('/api/accounts', async (c) => {
  const data = await readJSON('accounts.json', [])
  return c.json(data)
})

app.put('/api/accounts', async (c) => {
  const body = await c.req.json()
  await writeJSON('accounts.json', body)
  return c.json({ ok: true })
})

// ── 成交记录（fills.json 用 map 存，key = venue:id）────────────────────────
app.get('/api/fills', async (c) => {
  const map = await readMap('fills.json')
  const list = Object.values(map).sort((a: any, b: any) => (b.time ?? 0) - (a.time ?? 0))
  return c.json(list)
})

app.put('/api/fills/merge', async (c) => {
  const fills = await c.req.json() as any[]
  if (!Array.isArray(fills) || fills.length === 0) return c.json({ added: 0 })

  const map = await readMap('fills.json')
  let added = 0
  for (const f of fills) {
    const key = `${f.venue}:${f.id}`
    if (!(key in map)) added++
    map[key] = f
  }
  await writeMap('fills.json', map)
  return c.json({ added })
})

// ── 持仓（positions.json）───────────────────────────────────────────────────
app.get('/api/positions', async (c) => {
  const data = await readJSON('positions.json', [])
  return c.json(data)
})

app.put('/api/positions', async (c) => {
  const body = await c.req.json()
  await writeJSON('positions.json', body)
  return c.json({ ok: true })
})

// ── 自选列表（watchlist.json）───────────────────────────────────────────────
app.get('/api/watchlist', async (c) => {
  const data = await readJSON('watchlist.json', [])
  return c.json(data)
})

app.put('/api/watchlist', async (c) => {
  const body = await c.req.json()
  await writeJSON('watchlist.json', body)
  return c.json({ ok: true })
})

// ── 告警（alerts.json）──────────────────────────────────────────────────────
app.get('/api/alerts', async (c) => {
  const data = await readJSON('alerts.json', [])
  return c.json(data)
})

app.put('/api/alerts', async (c) => {
  const body = await c.req.json()
  await writeJSON('alerts.json', body)
  return c.json({ ok: true })
})

// ── 交易日志（journal.json）────────────────────────────────────────────────
app.get('/api/journal', async (c) => {
  const data = await readJSON('journal.json', [])
  return c.json(data)
})

app.put('/api/journal', async (c) => {
  const body = await c.req.json()
  await writeJSON('journal.json', body)
  return c.json({ ok: true })
})

// ── 模拟期权账本（sim-options.json）─────────────────────────────────────────
// 存全局模拟期权账本：positions / openOrders / orderHistory / fills
app.get('/api/sim-options', async (c) => {
  const data = await readJSON('sim-options.json', { positions: [], openOrders: [], orderHistory: [], fills: [] })
  return c.json(data)
})

app.put('/api/sim-options', async (c) => {
  const body = await c.req.json()
  await writeJSON('sim-options.json', body)
  return c.json({ ok: true })
})

// ── Bybit 凭证 ───────────────────────────────────────────────────────────────
// 存 Key/Secret，不暴露给前端。前端只问"有没有配"、"隐藏显示 Key 前几位"
interface BybitCreds { apiKey: string; apiSecret: string }

app.get('/api/credentials/bybit', async (c) => {
  const creds = await readBybitCreds()
  return c.json({ configured: !!creds, apiKey: creds?.apiKey ?? null })
})

app.put('/api/credentials/bybit', async (c) => {
  const { apiKey, apiSecret } = await c.req.json() as BybitCreds
  await writeJSON('credentials.json', { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() })
  return c.json({ ok: true })
})

app.delete('/api/credentials/bybit', async (c) => {
  await writeJSON('credentials.json', null)
  return c.json({ ok: true })
})

// ── Bybit API 代理 ──────────────────────────────────────────────────────────
// 前端调后端 → 后端用 Key 签名 → 转发到 Bybit → 返回结果
// Key 全程不出服务器

interface ProxyRequest {
  path: string           // 例如 /v5/position/list
  params?: Record<string, string | number | undefined>
  method?: 'GET' | 'POST'
  body?: Record<string, string | number | boolean | undefined>
}

const BYBIT_REST = 'https://api.bybit.com'

app.post('/api/proxy/bybit', async (c) => {
  const creds = await readBybitCreds()
  if (!creds) return c.json({ retCode: 10001, retMsg: '后端未配置 Bybit Key' }, 401)

  const { path, params = {}, method = 'GET', body = {} } = await c.req.json() as ProxyRequest

  // 组装 query string
  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  const queryString = entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  const jsonBody = method === 'POST' ? JSON.stringify(body) : ''

  // 签名（Bybit V5）
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
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🌱 weiwei-server running at http://localhost:${info.port}`)
})
