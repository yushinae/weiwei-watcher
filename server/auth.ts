/**
 * Better Auth 配置 —— 注册 / 登录 / 会话全在这里
 *
 * 挂载方式见 index.ts：app.on(['GET','POST'], '/api/auth/*', c => auth.handler(c.req.raw))
 * 端点（全部由 Better Auth 提供，不用自己写）：
 *   POST /api/auth/sign-up/email      注册
 *   POST /api/auth/sign-in/email      登录
 *   POST /api/auth/sign-out           登出
 *   GET  /api/auth/get-session        当前会话
 *   POST /api/auth/change-password    改密码
 *   GET  /api/auth/list-sessions      设备列表 / POST revoke-session 注销
 *
 * 会话 = httpOnly cookie，存在 session 表里。
 * BETTER_AUTH_SECRET 不设时自动生成并持久化到 server/data/.auth-secret（开发方便）；
 * 生产建议显式设环境变量。
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db/index'
import * as schema from './db/schema'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function loadOrCreateSecret(): Promise<string> {
  const env = process.env.BETTER_AUTH_SECRET?.trim()
  if (env) return env
  const file = join(__dirname, 'data', '.auth-secret')
  try {
    const existing = (await readFile(file, 'utf-8')).trim()
    if (existing) return existing
  } catch { /* 文件不存在 → 生成 */ }
  const secret = randomBytes(32).toString('hex')
  await writeFile(file, secret, { mode: 0o600 })
  return secret
}

const extraOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: await loadOrCreateSecret(),
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
  trustedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000', ...extraOrigins],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // TODO 上线前接 Resend 开 requireEmailVerification
  },
})

export type AuthSession = typeof auth.$Infer.Session
