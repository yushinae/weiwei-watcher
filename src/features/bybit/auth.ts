// ═══════════════════════════════════════════════════════════════════════════════
// Bybit API credential storage — plain text in localStorage.
// No PIN, no encryption. Your key is read-only (can't withdraw).
// You're on your own machine — no need to lock yourself out.
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'ww_bybit_creds_v2';

interface StoredCreds {
  apiKey: string;
  apiSecret: string;
}

const listeners = new Set<() => void>();
function notify(): void { listeners.forEach(fn => fn()); }
export function subscribeAuthState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function hasCredentials(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function isUnlocked(): boolean {
  return hasCredentials();
}

export function getApiKey(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return (JSON.parse(raw) as StoredCreds).apiKey; } catch { return null; }
}

export function getCredentials(): { apiKey: string; secret: string } | null {
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
