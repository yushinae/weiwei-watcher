// 已配置账户列表（存哪些账户：Hyperliquid 地址 / 交易所 key 引用）。
import type { VenueAccount } from './types';

const KEY = 'weiwei.accounts.v1';
const listeners = new Set<() => void>();

function load(): VenueAccount[] {
  try { const r = localStorage.getItem(KEY); return r ? (JSON.parse(r) as VenueAccount[]) : []; } catch { return []; }
}

let ACCOUNTS: VenueAccount[] = load();

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(ACCOUNTS)); } catch { /* ignore */ }
  listeners.forEach(f => f());
}

export function getAccounts(): VenueAccount[] { return ACCOUNTS; }

export function subscribeAccounts(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function addAccount(a: Omit<VenueAccount, 'id'>): VenueAccount {
  const acct: VenueAccount = { ...a, id: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
  ACCOUNTS = [...ACCOUNTS, acct];
  persist();
  return acct;
}

export function removeAccount(id: string): void {
  ACCOUNTS = ACCOUNTS.filter(a => a.id !== id);
  persist();
}

// 从 .env 自动建账户（幂等）：填好 .env 即出现，不用在界面手动加。
//   VITE_HYPERLIQUID_ADDRESS=0x…（可逗号分隔多个）
//   VITE_BYBIT_API_KEY/SECRET → 自动加一个 Bybit 账户
//   VITE_BINANCE_API_KEY/SECRET → 自动加一个 Binance 账户
// 注意：env 是来源，界面里删掉后下次刷新会再出现（改 .env 才是永久）。
export function ensureEnvAccounts(): void {
  const has = (pred: (a: VenueAccount) => boolean) => ACCOUNTS.some(pred);

  const hlRaw = import.meta.env.VITE_HYPERLIQUID_ADDRESS?.trim();
  if (hlRaw) {
    for (const addr of hlRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (/^0x[0-9a-fA-F]{40}$/.test(addr) &&
          !has(a => a.venue === 'Hyperliquid' && a.address?.toLowerCase() === addr.toLowerCase())) {
        addAccount({ venue: 'Hyperliquid', address: addr, label: `HL ${addr.slice(0, 6)}…${addr.slice(-4)}` });
      }
    }
  }

  if (import.meta.env.VITE_BYBIT_API_KEY?.trim() && !has(a => a.venue === 'Bybit')) {
    addAccount({ venue: 'Bybit', label: 'Bybit（.env）' });
  }

  if (import.meta.env.VITE_DERIBIT_API_KEY?.trim() && !has(a => a.venue === 'Deribit')) {
    addAccount({ venue: 'Deribit', label: 'Deribit（.env）' });
  }

  if (import.meta.env.VITE_BINANCE_API_KEY?.trim() && !has(a => a.venue === 'Binance')) {
    addAccount({ venue: 'Binance', label: 'Binance（.env）' });
  }
}
