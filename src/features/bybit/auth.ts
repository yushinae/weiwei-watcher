// ═══════════════════════════════════════════════════════════════════════════════
// Bybit API credential source — backend-first, then .env, then localStorage.
//
// 安全思路：优先用后端存的 Key（不发到浏览器）；
// 后端没跑时退回到 .env（编译时注入，适合开发）；
// localStorage 是最后保底（用户通过设置面板手动输入）。
//
// 所有对 Bybit 的签名请求走后端代理 (/api/proxy/bybit)，Key 不出服务器。
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'ww_bybit_creds_v2';

interface StoredCreds {
  apiKey: string;
  apiSecret: string;
}

// ── 后端优先 ──────────────────────────────────────────────────────────────

// 同步可读的缓存状态（供 useSyncExternalStore 使用）
let _backendConfigured = false;
let _backendKey: string | null = null;

// 异步刷新后端状态（不阻塞启动）
async function refreshBackendState(): Promise<void> {
  try {
    const res = await fetch('/api/credentials/bybit');
    if (res.ok) {
      const data = await res.json() as { configured: boolean; apiKey: string | null };
      _backendConfigured = data.configured;
      _backendKey = data.apiKey;
      notify();
      return;
    }
  } catch { /* backend 没跑 */ }
  _backendConfigured = false;
  _backendKey = null;
}

refreshBackendState();

// ── .env 保底 ──────────────────────────────────────────────────────────────

function envCreds(): { apiKey: string; secret: string } | null {
  const apiKey = import.meta.env.VITE_BYBIT_API_KEY?.trim();
  const secret = import.meta.env.VITE_BYBIT_API_SECRET?.trim();
  return apiKey && secret ? { apiKey, secret } : null;
}

/** 是否有 .env 配置（编译时注入，不回退后端/localStorage） */
export function isEnvConfigured(): boolean {
  return envCreds() !== null;
}

// ── 公开 API ──────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
function notify(): void { listeners.forEach(fn => fn()); }
export function subscribeAuthState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 同步检查：有任何渠道的凭证就算已配 */
export function isUnlocked(): boolean {
  if (_backendConfigured) return true;
  if (envCreds()) return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try { JSON.parse(raw); return true; } catch { return false; }
}

/** 异步检查：返回最新后端状态（会刷新缓存） */
export async function hasCredentials(): Promise<boolean> {
  await refreshBackendState();
  return isUnlocked();
}

/** 获取 API Key（只返回后几位，供 UI 显示） */
export async function getApiKey(): Promise<string | null> {
  if (_backendConfigured) return _backendKey;
  const env = envCreds();
  if (env) return env.apiKey;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return (JSON.parse(raw) as StoredCreds).apiKey; } catch { return null; }
}

/** 获取完整凭证（仅用于本地签名回退，后端可用时返回 null） */
export async function getCredentials(): Promise<{ apiKey: string; secret: string } | null> {
  if (_backendConfigured) return null; // 走 proxy，不泄露 secret
  const env = envCreds();
  if (env) return env;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const creds = JSON.parse(raw) as StoredCreds;
    return { apiKey: creds.apiKey, secret: creds.apiSecret };
  } catch { return null; }
}

/** 保存凭证到后端（保底到 localStorage） */
export async function saveCredentials(apiKey: string, apiSecret: string): Promise<void> {
  try {
    await fetch('/api/credentials/bybit', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, apiSecret }),
    });
    _backendConfigured = true;
    _backendKey = apiKey;
    notify();
    return;
  } catch { /* 后端没跑，fallback 到 localStorage */ }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, apiSecret }));
  notify();
}

/** 清除凭证（后端 + localStorage） */
export async function clearCredentials(): Promise<void> {
  try { await fetch('/api/credentials/bybit', { method: 'DELETE' }); } catch { /* ignore */ }
  _backendConfigured = false;
  _backendKey = null;
  localStorage.removeItem(STORAGE_KEY);
  notify();
}
