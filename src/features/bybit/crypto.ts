// ═══════════════════════════════════════════════════════════════════════════════
// Web Crypto helpers — used to encrypt the Bybit API secret at rest in
// localStorage with a user-chosen PIN, and to HMAC-sign Bybit V5 requests.
//
// Everything is in-browser, no external dependencies.
// ═══════════════════════════════════════════════════════════════════════════════

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(buf: ArrayBuffer): string {
  let bin = '';
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── HMAC-SHA256 — Bybit V5 signature ─────────────────────────────────────────

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return bytesToHex(sig);
}

// ── AES-GCM with PBKDF2-derived key — used to encrypt API secret ─────────────

const PBKDF2_ITERATIONS = 250_000;
const AES_KEY_BITS = 256;

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedBlob {
  v: 1;
  salt: string;  // base64
  iv: string;    // base64
  ct: string;    // base64
}

export async function encryptWithPin(plaintext: string, pin: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(pin, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    v: 1,
    salt: bytesToBase64(salt.buffer),
    iv:   bytesToBase64(iv.buffer),
    ct:   bytesToBase64(ct),
  };
}

export async function decryptWithPin(blob: EncryptedBlob, pin: string): Promise<string> {
  const salt = base64ToBytes(blob.salt);
  const iv   = base64ToBytes(blob.iv);
  const ct   = base64ToBytes(blob.ct);
  const key  = await deriveKey(pin, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}
