/**
 * 交易所 API key 管理（需登录）
 *
 *   GET    /api/keys        列出当前用户的 key（只回掩码，secret 永不回传）
 *   POST   /api/keys        添加：先调交易所验证有效性 + 权限检查（带提币权限直接拒收），
 *                           通过后 secret 加密入库
 *   DELETE /api/keys/:id    删除
 */
import { Hono } from 'hono'
import { createHmac, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from './db/index'
import { exchangeKeys } from './db/schema'
import { auth } from './auth'
import { encryptSecret } from './vault'

type Env = { Variables: { userId: string } }

export const keysRoutes = new Hono<Env>()

// ── 登录校验 ────────────────────────────────────────────────────────────────
keysRoutes.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: '未登录' }, 401)
  c.set('userId', session.user.id)
  await next()
})

// ── 验证：调交易所确认 key 有效，且不带提币权限 ─────────────────────────────
type Validation = { ok: true; perms: string } | { ok: false; reason: string }

async function validateDeribit(apiKey: string, apiSecret: string): Promise<Validation> {
  try {
    const url = `https://www.deribit.com/api/v2/public/auth?grant_type=client_credentials`
      + `&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(apiSecret)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const json = await res.json() as { error?: { message?: string; code?: number }; result?: { scope?: string } }
    if (json.error) return { ok: false, reason: `Deribit 验证失败：${json.error.message ?? `错误码 ${json.error.code}`}` }
    const scope = json.result?.scope ?? ''
    if (scope.includes('wallet:read_write')) {
      return { ok: false, reason: '该 key 带提币/转账权限（wallet:read_write），出于安全拒收。请在 Deribit 后台创建仅交易权限的 key。' }
    }
    return { ok: true, perms: scope }
  } catch {
    return { ok: false, reason: '无法连接 Deribit 验证 key（网络问题或服务不可达），请稍后重试' }
  }
}

async function validateBybit(apiKey: string, apiSecret: string): Promise<Validation> {
  try {
    const timestamp = Date.now().toString()
    const recvWindow = '5000'
    const signature = createHmac('sha256', apiSecret).update(timestamp + apiKey + recvWindow).digest('hex')
    const res = await fetch('https://api.bybit.com/v5/user/query-api', {
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      },
      signal: AbortSignal.timeout(10_000),
    })
    const json = await res.json() as {
      retCode: number; retMsg: string
      result?: { readOnly?: number; ips?: string[]; permissions?: Record<string, string[]> }
    }
    if (json.retCode !== 0) return { ok: false, reason: `Bybit 验证失败：${json.retMsg}` }
    const perms = Object.entries(json.result?.permissions ?? {})
      .flatMap(([group, list]) => (list ?? []).map((p) => `${group}.${p}`))
    if (perms.some((p) => /withdraw/i.test(p))) {
      return { ok: false, reason: '该 key 带提币权限，出于安全拒收。请在 Bybit 后台创建仅交易权限的 key。' }
    }
    const ips = json.result?.ips ?? []
    const ipNote = ips.length > 0 && ips[0] !== '*' ? 'IP已绑定' : '未绑IP(90天后过期)'
    const readNote = json.result?.readOnly === 1 ? '只读' : '可交易'
    return { ok: true, perms: [readNote, ipNote, ...perms.slice(0, 6)].join(', ') }
  } catch {
    return { ok: false, reason: '无法连接 Bybit 验证 key（网络问题或服务不可达），请稍后重试' }
  }
}

const VALIDATORS: Record<string, (k: string, s: string) => Promise<Validation>> = {
  deribit: validateDeribit,
  bybit: validateBybit,
}

// ── 路由 ────────────────────────────────────────────────────────────────────
const mask = (key: string) => key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••••${key.slice(-4)}`

function toClient(row: typeof exchangeKeys.$inferSelect) {
  return {
    id: row.id,
    venue: row.venue,
    label: row.label,
    apiKeyMasked: mask(row.apiKey),
    perms: row.perms,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }
}

keysRoutes.get('/', async (c) => {
  const rows = await db.select().from(exchangeKeys)
    .where(eq(exchangeKeys.userId, c.get('userId')))
    .orderBy(desc(exchangeKeys.createdAt))
  return c.json(rows.map(toClient))
})

keysRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as
    { venue?: string; label?: string; apiKey?: string; apiSecret?: string } | null
  const venue = body?.venue?.trim().toLowerCase() ?? ''
  const label = body?.label?.trim() || venue
  const apiKey = body?.apiKey?.trim() ?? ''
  const apiSecret = body?.apiSecret?.trim() ?? ''

  const validator = VALIDATORS[venue]
  if (!validator) return c.json({ error: `暂不支持的交易所：${venue || '(空)'}，当前支持 deribit / bybit` }, 400)
  if (!apiKey || !apiSecret) return c.json({ error: 'apiKey 和 apiSecret 不能为空' }, 400)

  const result = await validator(apiKey, apiSecret)
  if (result.ok === false) return c.json({ error: result.reason }, 400)

  const row = {
    id: randomUUID(),
    userId: c.get('userId'),
    venue,
    label,
    apiKey,
    encryptedSecret: await encryptSecret(apiSecret),
    perms: result.perms,
  }
  await db.insert(exchangeKeys).values(row)
  const [inserted] = await db.select().from(exchangeKeys).where(eq(exchangeKeys.id, row.id))
  return c.json(toClient(inserted), 201)
})

keysRoutes.delete('/:id', async (c) => {
  await db.delete(exchangeKeys).where(and(
    eq(exchangeKeys.id, c.req.param('id')),
    eq(exchangeKeys.userId, c.get('userId')),
  ))
  return c.json({ ok: true })
})
