// ═══════════════════════════════════════════════════════════════════════════════
// Black-Scholes + AR(1) 数学库
// IV 输入约定：百分比形式（e.g. 33.8 而非 0.338），内部 /100 转 sigma。
// 价格输出与 S 同单位（USD per coin）。r = q = 0（加密期权惯例）。
// ═══════════════════════════════════════════════════════════════════════════════

export function normCDF(x: number): number {
  const a1 = 0.319381530, a2 = -0.356563782, a3 = 1.781477937,
        a4 = -1.821255978, a5 = 1.330274429;
  const L = Math.abs(x);
  const k = 1.0 / (1.0 + 0.2316419 * L);
  const w = 1.0 - (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * L * L) *
    k * (a1 + k * (a2 + k * (a3 + k * (a4 + k * a5))));
  return x >= 0 ? w : 1.0 - w;
}

export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function bsGamma(S: number, K: number, T: number, iv: number): number {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) return 0;
  const sigma = iv / 100;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return normPDF(d1) / (S * sigma * sqrtT);
}

// Vanna: ΔΔ per 1% IV move (numerical bump)
export function bsVanna(S: number, K: number, T: number, iv: number, type: 'C' | 'P'): number {
  if (T <= 0 || iv < 2) return 0;
  return (bsDelta(S, K, T, iv + 1, type) - bsDelta(S, K, T, iv - 1, type)) / 2;
}

// Charm: ΔΔ per 1 calendar day (numerical bump)
export function bsCharm(S: number, K: number, T: number, iv: number, type: 'C' | 'P'): number {
  if (T <= 2 / 365) return 0;
  return bsDelta(S, K, T - 1 / 365, iv, type) - bsDelta(S, K, T, iv, type);
}

// Diverging heatmap cell colour (green pos / red neg)
export function heatColor(val: number, maxAbs: number): string {
  if (maxAbs === 0 || val === 0) return 'rgba(255,255,255,0.04)';
  const t = Math.max(-1, Math.min(1, val / maxAbs));
  const i = Math.abs(t);
  if (t > 0) return `rgba(37,232,137,${(0.10 + 0.55 * i).toFixed(2)})`;
  return `rgba(248,113,113,${(0.10 + 0.55 * i).toFixed(2)})`;
}

export function bsDelta(S: number, K: number, T: number, iv: number, type: 'C' | 'P'): number {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) return type === 'C' ? (S >= K ? 1 : 0) : (S <= K ? -1 : 0);
  const sigma = iv / 100;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return type === 'C' ? normCDF(d1) : normCDF(d1) - 1;
}

// Vega: $ change per 1% IV move (dV/dσ × 0.01)
export function bsVega(S: number, K: number, T: number, iv: number): number {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) return 0;
  const sigma = iv / 100;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return S * normPDF(d1) * sqrtT * 0.01; // per 1% IV
}

// Theta: $ change per 1 calendar day (negative = decay).
// Sub-1-day theta blows up (∝ 1/√T) and is unreliable, so it's guarded to 0 — the
// shared convention every consumer (strategy builder, monitor $greeks, chain) relies on.
export function bsTheta(S: number, K: number, T: number, iv: number): number {
  if (T <= 1 / 365 || iv <= 0 || S <= 0 || K <= 0) return 0;
  const sigma = iv / 100;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return -(S * normPDF(d1) * sigma) / (2 * sqrtT * 365);
}

// AR(1) OLS fit: y_t = α + β·y_{t-1}
export function fitAR1(series: number[]): { alpha: number; beta: number; mu: number } {
  const n = series.length - 1;
  if (n < 4) return { alpha: series[series.length - 1] * 0.02, beta: 0.98, mu: series[series.length - 1] };
  const X = series.slice(0, n);
  const Y = series.slice(1);
  const Xm = X.reduce((s, v) => s + v, 0) / n;
  const Ym = Y.reduce((s, v) => s + v, 0) / n;
  const Sxy = X.reduce((s, v, i) => s + (v - Xm) * (Y[i] - Ym), 0);
  const Sxx = X.reduce((s, v) => s + (v - Xm) ** 2, 0);
  const beta  = Sxx > 0 ? Math.max(-0.999, Math.min(0.999, Sxy / Sxx)) : 0.97;
  const alpha = Ym - beta * Xm;
  const mu    = Math.abs(1 - beta) > 1e-6 ? alpha / (1 - beta) : Xm;
  return { alpha, beta, mu };
}

// Multi-step AR(1) forecast: E[y_{t+h}] = μ + β^h·(y_t − μ)
export function forecastAR1(current: number, alpha: number, beta: number, horizon: number): number {
  const mu = Math.abs(1 - beta) > 1e-6 ? alpha / (1 - beta) : current;
  return mu + Math.pow(beta, horizon) * (current - mu);
}

// Full BS call price (r = q = 0, crypto convention)
export function bsCall(S: number, K: number, T: number, iv: number): number {
  if (S <= 0 || K <= 0 || iv <= 0) return Math.max(0, S - K);
  if (T <= 0) return Math.max(0, S - K);
  const sigma = iv / 100;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return S * normCDF(d1) - K * normCDF(d2);
}

// Full BS put price
export function bsPut(S: number, K: number, T: number, iv: number): number {
  if (S <= 0 || K <= 0 || iv <= 0) return Math.max(0, K - S);
  if (T <= 0) return Math.max(0, K - S);
  const sigma = iv / 100;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return K * normCDF(-d2) - S * normCDF(-d1);
}
