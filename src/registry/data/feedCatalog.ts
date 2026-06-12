// Central catalog for data feeds used by freshness, polling, and runtime policy.
// Keep human labels, expected cadence, and background behavior in one place so
// resource decisions are visible instead of scattered across feature hooks.

export type FeedRunMode =
  | 'critical-background' // keeps running while browser/tab is hidden
  | 'visible-live'        // high-frequency UI feed; visible page only
  | 'slow-cache'          // low-frequency cache refresh
  | 'on-demand';          // component-owned detail/feed

export interface FeedMeta {
  /** Human label used by health UI, e.g. "Deribit option book". */
  label: string;
  /** Data provider label, e.g. "Deribit" / "Bybit". */
  source?: string;
  /** Expected update interval. Age is judged against this value. */
  expectedMs: number;
  /** Whether this feed contributes to global health when active. */
  critical: boolean;
  /** Default resource policy for this feed. */
  mode: FeedRunMode;
}

type FeedCatalogSeed = Omit<FeedMeta, 'expectedMs' | 'mode'> & {
  expectedMs?: number;
  mode?: FeedRunMode;
};

export const DEFAULT_FEED_EXPECTED_MS = 60_000;
export const DEFAULT_FEED_MODE: FeedRunMode = 'critical-background';

export const FEED_CATALOG: Record<string, FeedCatalogSeed> = {
  'ws-deribit': {
    label: 'Deribit 实时行情 (WS)',
    source: 'Deribit',
    critical: true,
    expectedMs: 8_000,
    mode: 'critical-background',
  },
  'options-BTC': {
    label: 'BTC 期权 book',
    source: 'Deribit',
    critical: true,
    mode: 'critical-background',
  },
  'options-ETH': {
    label: 'ETH 期权 book',
    source: 'Deribit',
    critical: true,
    mode: 'critical-background',
  },
  'deribit-chain-BTC': {
    label: 'BTC Deribit 期权链',
    source: 'Deribit',
    critical: true,
    mode: 'critical-background',
  },
  'deribit-chain-ETH': {
    label: 'ETH Deribit 期权链',
    source: 'Deribit',
    critical: true,
    mode: 'critical-background',
  },
  'deribit-usdc-chain-BTC': {
    label: 'BTC Deribit USDC 期权链',
    source: 'Deribit',
    critical: true,
    mode: 'critical-background',
  },
  'deribit-usdc-chain-ETH': {
    label: 'ETH Deribit USDC 期权链',
    source: 'Deribit',
    critical: true,
    mode: 'critical-background',
  },
  'option-chain-BTC': {
    label: 'BTC Bybit 期权链',
    source: 'Bybit',
    critical: true,
    mode: 'visible-live',
  },
  'option-chain-ETH': {
    label: 'ETH Bybit 期权链',
    source: 'Bybit',
    critical: true,
    mode: 'visible-live',
  },
  'flow-BTC': {
    label: 'BTC 资金流 / 大单',
    source: 'Deribit',
    critical: false,
    mode: 'slow-cache',
  },
  'flow-ETH': {
    label: 'ETH 资金流 / 大单',
    source: 'Deribit',
    critical: false,
    mode: 'slow-cache',
  },
  'history-BTC': {
    label: 'BTC 历史波动',
    source: 'Deribit',
    critical: false,
    mode: 'slow-cache',
  },
  'history-ETH': {
    label: 'ETH 历史波动',
    source: 'Deribit',
    critical: false,
    mode: 'slow-cache',
  },
  'sentiment-BTC': {
    label: 'BTC 情绪指数',
    source: 'Deribit',
    critical: false,
    mode: 'slow-cache',
  },
  'sentiment-ETH': {
    label: 'ETH 情绪指数',
    source: 'Deribit',
    critical: false,
    mode: 'slow-cache',
  },
};

export function feedMetaForKey(key: string, expectedMs?: number): FeedMeta {
  const seed = FEED_CATALOG[key];
  return {
    label: seed?.label ?? key,
    source: seed?.source,
    expectedMs: expectedMs ?? seed?.expectedMs ?? DEFAULT_FEED_EXPECTED_MS,
    critical: seed?.critical ?? false,
    mode: seed?.mode ?? DEFAULT_FEED_MODE,
  };
}
