/**
 * Better Auth 前端客户端
 *
 * baseURL 留空 = 同源（dev 走 Vite proxy → localhost:8787；生产同域 Caddy 反代）。
 * 会话是 httpOnly cookie，前端不碰 token。
 */
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()

// 是否强制登录：生产构建默认开，VITE_AUTH_REQUIRED=1 强制开 / =0 强制关
export const AUTH_REQUIRED =
  import.meta.env.VITE_AUTH_REQUIRED === '1' ||
  (import.meta.env.PROD && import.meta.env.VITE_AUTH_REQUIRED !== '0')
