import type { Coin } from '../types';

export const VOL = {
  BTC: {
    dvol: 58.4,
    dvolChange: -2.1,
    ivRank: 42,
    vrp: 6.8,
    iv30: 58.4,
    rv30: 51.6,
    pcr: 0.72,
    pcrChange: -0.05,
    term: [
      { t: '7D', iv: 54.2 },
      { t: '14D', iv: 56.8 },
      { t: '30D', iv: 58.4 },
      { t: '60D', iv: 60.7 },
      { t: '90D', iv: 62.1 },
    ],
  },
  ETH: {
    dvol: 68.2,
    dvolChange: +1.4,
    ivRank: 58,
    vrp: 9.3,
    iv30: 68.2,
    rv30: 58.9,
    pcr: 0.85,
    pcrChange: +0.08,
    term: [
      { t: '7D', iv: 64.1 },
      { t: '14D', iv: 66.5 },
      { t: '30D', iv: 68.2 },
      { t: '60D', iv: 70.1 },
      { t: '90D', iv: 71.4 },
    ],
  },
} as const;

export const BTC_POLY = [
  { q: 'BTC 年底价格突破 $100,000？', yes: 52, vol: '$8.4M', end: '12月31日' },
  { q: 'BTC 在 Q2 末收于 $75,000 以上？', yes: 38, vol: '$3.2M', end: '06月30日' },
  { q: 'BTC ETF 单日净流入超过 $10 亿？', yes: 61, vol: '$2.6M', end: '05月31日' },
  { q: '本周 BTC 期权最大痛点在 $68,000？', yes: 71, vol: '$1.0M', end: '05月09日' },
] as const;

export const ETH_POLY = [
  { q: 'ETH 年底价格突破 $5,000？', yes: 44, vol: '$5.1M', end: '12月31日' },
  { q: 'ETH/BTC 比率 Q2 末回升至 0.06？', yes: 29, vol: '$1.8M', end: '06月30日' },
  { q: 'ETH 现货 ETF 单日净流入超过 $5 亿？', yes: 34, vol: '$1.2M', end: '05月31日' },
  { q: 'ETH 质押率年底超过 35%？', yes: 48, vol: '$0.7M', end: '12月31日' },
] as const;

export const BTC_METRICS = [
  { label: 'DVOL', value: '58.4%', change: '-2.1', up: false },
  { label: 'IVR', value: '42', change: null, up: null },
  { label: 'PCR', value: '0.72', change: '-0.05', up: false },
  { label: 'VRP', value: '+6.8pp', change: null, up: true },
] as const;

export const ETH_METRICS = [
  { label: 'DVOL', value: '68.2%', change: '+1.4', up: true },
  { label: 'IVR', value: '58', change: null, up: null },
  { label: 'PCR', value: '0.85', change: '+0.08', up: true },
  { label: 'VRP', value: '+9.3pp', change: null, up: true },
] as const;

export const SMILE_LABELS = ['10P', '25P', 'ATM', '25C', '10C'] as const;
export const SMILE: Record<Coin, Record<string, number[]>> = {
  BTC: {
    '7D': [72.1, 64.2, 54.2, 61.0, 68.4],
    '30D': [68.4, 62.0, 58.4, 59.8, 64.8],
    '90D': [66.2, 61.0, 62.1, 59.2, 63.2],
  },
  ETH: {
    '7D': [88.4, 78.2, 64.1, 73.0, 82.1],
    '30D': [82.1, 74.0, 68.2, 72.0, 79.2],
    '90D': [78.2, 72.1, 71.4, 70.1, 76.4],
  },
};

export const SKEW_ROWS = ['10P', '25P', 'ATM', '25C', '10C'] as const;
export const SKEW_COLS = ['7D', '14D', '30D', '60D', '90D'] as const;
export const SKEW_DATA: Record<Coin, number[][]> = {
  BTC: [
    [72.1, 70.2, 68.4, 67.1, 66.2],
    [64.2, 63.1, 62.0, 61.5, 61.0],
    [54.2, 56.8, 58.4, 60.7, 62.1],
    [61.0, 60.2, 59.8, 59.5, 59.2],
    [68.4, 66.1, 64.8, 63.9, 63.2],
  ],
  ETH: [
    [88.4, 85.2, 82.1, 79.4, 78.2],
    [78.2, 76.0, 74.0, 72.5, 72.1],
    [64.1, 66.5, 68.2, 70.1, 71.4],
    [73.0, 72.1, 72.0, 71.2, 70.1],
    [82.1, 80.4, 79.2, 77.8, 76.4],
  ],
};

export const VRP_HIST: Record<Coin, Array<{ iv: number; rv: number }>> = {
  BTC: [
    { iv: 62.4, rv: 48.2 },
    { iv: 61.8, rv: 47.9 },
    { iv: 63.1, rv: 49.1 },
    { iv: 64.2, rv: 50.4 },
    { iv: 63.8, rv: 51.2 },
    { iv: 62.1, rv: 50.8 },
    { iv: 60.4, rv: 49.6 },
    { iv: 59.2, rv: 48.4 },
    { iv: 58.8, rv: 47.8 },
    { iv: 57.4, rv: 47.1 },
    { iv: 56.8, rv: 46.8 },
    { iv: 57.2, rv: 47.2 },
    { iv: 58.4, rv: 48.1 },
    { iv: 59.6, rv: 49.2 },
    { iv: 60.8, rv: 50.4 },
    { iv: 61.4, rv: 51.1 },
    { iv: 60.2, rv: 51.8 },
    { iv: 59.4, rv: 51.6 },
    { iv: 58.8, rv: 51.2 },
    { iv: 58.4, rv: 51.4 },
    { iv: 57.8, rv: 51.0 },
    { iv: 58.2, rv: 51.6 },
    { iv: 58.8, rv: 51.8 },
    { iv: 59.4, rv: 52.1 },
    { iv: 59.8, rv: 51.8 },
    { iv: 59.2, rv: 51.6 },
    { iv: 58.8, rv: 51.4 },
    { iv: 58.6, rv: 51.6 },
    { iv: 58.4, rv: 51.6 },
    { iv: 58.4, rv: 51.6 },
  ],
  ETH: [
    { iv: 72.4, rv: 56.2 },
    { iv: 71.8, rv: 55.9 },
    { iv: 73.1, rv: 57.1 },
    { iv: 74.2, rv: 58.4 },
    { iv: 73.8, rv: 59.2 },
    { iv: 72.1, rv: 58.8 },
    { iv: 70.4, rv: 57.6 },
    { iv: 69.2, rv: 56.4 },
    { iv: 68.8, rv: 55.8 },
    { iv: 67.4, rv: 55.1 },
    { iv: 66.8, rv: 54.8 },
    { iv: 67.2, rv: 55.2 },
    { iv: 68.4, rv: 56.1 },
    { iv: 69.6, rv: 57.2 },
    { iv: 70.8, rv: 58.4 },
    { iv: 71.4, rv: 59.1 },
    { iv: 70.2, rv: 59.8 },
    { iv: 69.4, rv: 59.6 },
    { iv: 68.8, rv: 59.2 },
    { iv: 68.4, rv: 59.4 },
    { iv: 67.8, rv: 59.0 },
    { iv: 68.2, rv: 59.6 },
    { iv: 68.8, rv: 59.8 },
    { iv: 69.4, rv: 60.1 },
    { iv: 69.8, rv: 59.8 },
    { iv: 69.2, rv: 59.6 },
    { iv: 68.8, rv: 59.4 },
    { iv: 68.6, rv: 59.6 },
    { iv: 68.4, rv: 58.9 },
    { iv: 68.2, rv: 58.9 },
  ],
};

export const IVR_HIST: Record<Coin, number[]> = {
  BTC: [
    55, 54, 56, 58, 57, 55, 52, 50, 48, 46, 44, 45, 47, 49, 51, 52, 51, 50, 49, 48, 47, 48, 49, 50, 50,
    49, 48, 47, 47, 48, 46, 45, 44, 43, 42, 43, 44, 43, 42, 42, 43, 44, 45, 45, 44, 43, 42, 41, 42, 43,
    44, 45, 44, 43, 43, 44, 43, 43, 42, 43, 44, 43, 42, 41, 41, 42, 42, 41, 41, 42, 43, 44, 44, 43, 43,
    44, 44, 43, 42, 42, 42, 43, 43, 42, 42, 42, 42, 42, 42, 42,
  ],
  ETH: [
    62, 61, 63, 65, 64, 62, 60, 58, 57, 56, 55, 56, 57, 59, 60, 61, 60, 59, 58, 57, 56, 57, 58, 59, 59,
    58, 57, 56, 56, 57, 55, 54, 54, 53, 53, 54, 54, 53, 53, 53, 54, 55, 56, 56, 55, 54, 53, 53, 54, 55,
    56, 57, 56, 55, 55, 56, 55, 55, 55, 56, 57, 56, 55, 55, 55, 56, 56, 55, 55, 56, 57, 58, 58, 57, 58,
    59, 58, 57, 57, 57, 57, 58, 58, 57, 57, 57, 57, 58, 58, 58,
  ],
};

export const OPTIONS_SKEW: Record<
  Coin,
  Array<{ exp: string; atm: number; rr25: number; bf25: number; rr10: number; bf10: number }>
> = {
  BTC: [
    { exp: '7D', atm: 54.2, rr25: -3.2, bf25: 0.8, rr10: -6.1, bf10: 2.1 },
    { exp: '14D', atm: 56.8, rr25: -2.9, bf25: 0.7, rr10: -5.4, bf10: 1.9 },
    { exp: '30D', atm: 58.4, rr25: -2.4, bf25: 0.6, rr10: -4.8, bf10: 1.7 },
    { exp: '60D', atm: 60.7, rr25: -2.1, bf25: 0.5, rr10: -4.2, bf10: 1.5 },
    { exp: '90D', atm: 62.1, rr25: -1.8, bf25: 0.5, rr10: -3.9, bf10: 1.4 },
  ],
  ETH: [
    { exp: '7D', atm: 64.1, rr25: -2.8, bf25: 1.1, rr10: -5.4, bf10: 2.8 },
    { exp: '14D', atm: 66.5, rr25: -2.5, bf25: 1.0, rr10: -4.9, bf10: 2.6 },
    { exp: '30D', atm: 68.2, rr25: -2.1, bf25: 0.9, rr10: -4.2, bf10: 2.4 },
    { exp: '60D', atm: 70.1, rr25: -1.8, bf25: 0.8, rr10: -3.8, bf10: 2.2 },
    { exp: '90D', atm: 71.4, rr25: -1.6, bf25: 0.7, rr10: -3.4, bf10: 2.0 },
  ],
};

export const VOL_CONE: Record<
  Coin,
  { tenors: string[]; p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[]; curr: number[] }
> = {
  BTC: {
    tenors: ['7D', '14D', '30D', '60D', '90D', '180D'],
    p10: [22, 25, 28, 30, 32, 34],
    p25: [32, 35, 38, 40, 42, 44],
    p50: [45, 47, 49, 50, 51, 52],
    p75: [62, 63, 64, 65, 65, 66],
    p90: [82, 80, 78, 76, 75, 74],
    curr: [54.2, 56.8, 58.4, 60.7, 62.1, 63.8],
  },
  ETH: {
    tenors: ['7D', '14D', '30D', '60D', '90D', '180D'],
    p10: [28, 31, 34, 36, 38, 40],
    p25: [40, 43, 46, 48, 50, 52],
    p50: [55, 57, 59, 61, 62, 63],
    p75: [76, 77, 78, 79, 80, 81],
    p90: [98, 96, 94, 92, 91, 90],
    curr: [64.1, 66.5, 68.2, 70.1, 71.4, 72.8],
  },
};

export const FIXED_TENOR_VAR: Record<Coin, { tenors: string[]; varSwap: number[]; rv: number[] }> = {
  BTC: {
    tenors: ['7D', '14D', '30D', '60D', '90D', '180D', '365D'],
    varSwap: [29.4, 32.3, 34.1, 36.8, 38.6, 40.1, 42.8],
    rv: [26.6, 28.9, 26.6, 27.4, 28.0, 28.8, 29.6],
  },
  ETH: {
    tenors: ['7D', '14D', '30D', '60D', '90D', '180D', '365D'],
    varSwap: [41.1, 44.2, 46.5, 49.1, 51.0, 52.8, 55.2],
    rv: [34.7, 37.1, 34.7, 35.8, 36.6, 37.5, 38.6],
  },
};

function lnDist(S: number, iv: number, T: number, pts = 80) {
  const sigma = (iv / 100) * Math.sqrt(T / 365);
  const mu = Math.log(S) - 0.5 * sigma * sigma;
  return Array.from({ length: pts }, (_, i) => {
    const x = S * (0.55 + (i * 0.9) / (pts - 1));
    const z = (Math.log(x) - mu) / sigma;
    return { x, y: Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI)) };
  });
}

export const IMP_DIST = {
  BTC: lnDist(70124, 58.4, 30),
  ETH: lnDist(3740, 68.2, 30),
} as const;

