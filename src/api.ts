/**
 * 后端 API 调用助手
 *
 * 用法：
 *   import { api } from '@/api'
 *   const accounts = await api('/api/accounts')
 *   await api('/api/accounts', 'PUT', newData)
 */

const BASE = ''  // 走 Vite proxy → localhost:8787

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API ${method} ${path}: ${res.status}`)
  return res.json()
}

// 快捷写法
export const get = <T = any>(path: string) => api<T>(path)
export const put = <T = any>(path: string, body: unknown) => api<T>(path, 'PUT', body)
