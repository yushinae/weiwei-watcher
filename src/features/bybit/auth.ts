// ═══════════════════════════════════════════════════════════════════════════════
// Bybit credential source.
//
// Current policy:
//   1. .env wins and is immediately usable in this local app.
//   2. If .env is empty, the local backend may hold credentials and signed REST
//      requests go through /api/proxy/bybit.
//   3. No API secret is stored in browser localStorage.
// ═══════════════════════════════════════════════════════════════════════════════

interface BackendState {
  configured: boolean;
  apiKey: string | null;
}

let _backendConfigured = false;
let _backendKey: string | null = null;
const listeners = new Set<() => void>();

function notify(): void { listeners.forEach(fn => fn()); }

export function subscribeAuthState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function envCreds(): { apiKey: string; secret: string } | null {
  const apiKey = import.meta.env.VITE_BYBIT_API_KEY?.trim();
  const secret = import.meta.env.VITE_BYBIT_API_SECRET?.trim();
  return apiKey && secret ? { apiKey, secret } : null;
}

export function isEnvConfigured(): boolean {
  return envCreds() !== null;
}

export function getEnvCredentials(): { apiKey: string; secret: string } | null {
  return envCreds();
}

export function hasBrowserWsCredentials(): boolean {
  return isEnvConfigured();
}

async function refreshBackendState(): Promise<void> {
  try {
    const res = await fetch('/api/credentials/bybit');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as BackendState;
    _backendConfigured = data.configured;
    _backendKey = data.apiKey;
  } catch {
    _backendConfigured = false;
    _backendKey = null;
  }
  notify();
}

void refreshBackendState();

export function isConfigured(): boolean {
  return isEnvConfigured() || _backendConfigured;
}

export async function hasCredentials(): Promise<boolean> {
  if (isEnvConfigured()) return true;
  await refreshBackendState();
  return _backendConfigured;
}

export async function getApiKey(): Promise<string | null> {
  const env = envCreds();
  if (env) return env.apiKey;
  await refreshBackendState();
  return _backendKey;
}

export async function saveCredentials(apiKey: string, apiSecret: string): Promise<void> {
  await fetch('/api/credentials/bybit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, apiSecret }),
  });
  _backendConfigured = true;
  _backendKey = apiKey;
  notify();
}

export async function clearCredentials(): Promise<void> {
  try { await fetch('/api/credentials/bybit', { method: 'DELETE' }); } catch { /* ignore */ }
  _backendConfigured = false;
  _backendKey = null;
  notify();
}
