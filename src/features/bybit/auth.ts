// ═══════════════════════════════════════════════════════════════════════════════
// Bybit API credential source — env-first, then localStorage.
//
// Preferred: put a READ-ONLY key in a gitignored `.env` (see .env.example):
//   VITE_BYBIT_API_KEY=...
//   VITE_BYBIT_API_SECRET=...
// Read at dev/build time via import.meta.env (restart the dev server after editing
// .env). If env is set it wins; otherwise we fall back to a value saved from the
// in-app settings panel (plain text in localStorage).
//
// Note: signing is HMAC'd client-side, so the secret is necessarily in the browser
// either way. Use a READ-ONLY key (no withdraw/trade), and don't deploy this on a
// shared/public origin with your keys baked into the bundle.
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'ww_bybit_creds_v2';

interface StoredCreds {
  apiKey: string;
  apiSecret: string;
}

/** Credentials from .env (VITE_BYBIT_API_KEY / _SECRET), if both are present. */
function envCreds(): { apiKey: string; secret: string } | null {
  const apiKey = import.meta.env.VITE_BYBIT_API_KEY?.trim();
  const secret = import.meta.env.VITE_BYBIT_API_SECRET?.trim();
  return apiKey && secret ? { apiKey, secret } : null;
}

/** True when credentials come from .env (read-only setup, no in-app UI needed). */
export function isEnvConfigured(): boolean {
  return envCreds() !== null;
}

const listeners = new Set<() => void>();
function notify(): void { listeners.forEach(fn => fn()); }
export function subscribeAuthState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function hasCredentials(): boolean {
  return envCreds() !== null || localStorage.getItem(STORAGE_KEY) !== null;
}

export function isUnlocked(): boolean {
  return hasCredentials();
}

export function getApiKey(): string | null {
  const env = envCreds();
  if (env) return env.apiKey;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return (JSON.parse(raw) as StoredCreds).apiKey; } catch { return null; }
}

export function getCredentials(): { apiKey: string; secret: string } | null {
  const env = envCreds();
  if (env) return env;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const creds = JSON.parse(raw) as StoredCreds;
    return { apiKey: creds.apiKey, secret: creds.apiSecret };
  } catch {
    return null;
  }
}

export function saveCredentials(apiKey: string, apiSecret: string): void {
  const stored: StoredCreds = { apiKey, apiSecret };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  notify();
}

export function clearCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
  notify();
}
