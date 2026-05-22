export interface ParsedOption {
  strike: number;
  type: 'C' | 'P';
  daysToExp: number;
  T: number;
  iv: number;
  spot: number;
  delta: number;
  oi: number;
  volume: number;
}

export interface ExpiryGroup {
  label: string;
  daysToExp: number;
  calls: ParsedOption[];
  puts: ParsedOption[];
  atmIV: number;
  rr25: number;
  bf25: number;
  rr10: number;
  bf10: number;
}

export interface DeribitData {
  spot: number;
  dvol30: number;
  pcr: number;
  expiries: ExpiryGroup[];
  callVol24h: number;
  putVol24h: number;
  fetchedAt: number;
}

export interface VolConeSlice {
  tenors: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

export interface HistoryData {
  vrp: { iv: number; rv: number }[];
  ivr: number[];
  ivRankCurrent: number;
  dvolChange24h: number;
  volCone: VolConeSlice;
  rvByTenor: number[];
  dvolSeries: number[];
  rv30Series: number[];
  fetchedAt: number;
}

export interface SkewSnap {
  ts: number;
  tenors: { label: string; rr25: number; rr10: number; atm: number }[];
  pcr: number;
}

export type DataSub<T> = (data: T) => void;

export interface PollerEntry {
  intervalMs: number;
  subscribers: Set<DataSub<unknown>>;
  lastData: unknown;
  fetcher: () => Promise<unknown>;
  timerId: ReturnType<typeof setInterval> | null;
}
