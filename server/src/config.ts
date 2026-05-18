import process from 'node:process';

export type Env = {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  corsOrigin: string;
  enableCollectors: boolean;
  bybitEnv: 'testnet' | 'mainnet';
  deribitEnv: 'testnet' | 'mainnet';
  bybitSymbols: string[];
  bybitBaseCoins: string[];
  deribitCurrencies: string[];
};

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8787);
  const databaseUrl = String(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/nexus');
  const corsOrigin = String(process.env.CORS_ORIGIN ?? 'http://localhost:3000');
  const enableCollectors = String(process.env.ENABLE_COLLECTORS ?? 'false') === 'true';
  const bybitEnv = (String(process.env.BYBIT_ENV ?? 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet') as
    | 'testnet'
    | 'mainnet';
  const deribitEnv = (String(process.env.DERIBIT_ENV ?? 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet') as
    | 'testnet'
    | 'mainnet';
  const bybitSymbols = String(process.env.BYBIT_SYMBOLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bybitBaseCoins = String(process.env.BYBIT_BASE_COINS ?? 'BTC,ETH')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const deribitCurrencies = String(process.env.DERIBIT_CURRENCIES ?? 'BTC,ETH')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    nodeEnv: String(process.env.NODE_ENV ?? 'development'),
    port: Number.isFinite(port) ? port : 8787,
    databaseUrl,
    corsOrigin,
    enableCollectors,
    bybitEnv,
    deribitEnv,
    bybitSymbols,
    bybitBaseCoins,
    deribitCurrencies,
  };
}
