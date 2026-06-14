// ═══════════════════════════════════════════════════════════════════════════════
// Black-Scholes price + greeks for the position builder / stress tester.
//
// Price + first-order greeks delegate to the shared bs-math lib so the whole app
// uses one normCDF. bs-math takes IV as a PERCENT; this module works in DECIMAL
// sigma, so the wrappers scale ×100. Higher-order greeks (vanna/volga/charm/speed)
// are position-builder–specific and computed here.
// ═══════════════════════════════════════════════════════════════════════════════

import { normCDF, normPDF, bsCall, bsPut } from '../../registry/lib/bs-math';

export function hoursToYears(h: number) { return h / (24 * 365); }

export function bsPrice(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  return type === 'call' ? bsCall(S, K, T, sigma * 100) : bsPut(S, K, T, sigma * 100);
}

export function bsGreeks(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) {
    let delta = 0;
    if (type === 'call') delta = S > K ? 1 : 0;
    else delta = S < K ? -1 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0, vanna: 0, volga: 0, charm: 0, speed: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPDF(d1);
  let delta: number;
  if (type === 'call') { delta = normCDF(d1); } else { delta = normCDF(d1) - 1; }
  const theta = (-S * pdf * sigma / (2 * sqrtT)) / 365;
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100;
  // Higher-order Greeks (per 1% IV move convention matched to vega)
  // Vanna = ∂Delta/∂σ = -d2/σ × normPDF(d1)  (scaled ×0.01 to match /1% vega)
  const vanna = -(d2 / sigma) * pdf * 0.01;
  // Volga / Vomma = ∂²V/∂σ² = Vega × d1 × d2 / σ  (scaled /100 for vega, then ×0.01 for 1% σ step)
  const volga = vega * d1 * d2 / sigma * 0.01;
  // Charm = ∂Delta/∂t (per calendar day) — numerical: delta after 1 day passes
  const T1 = Math.max(1e-12, T - hoursToYears(24));
  const sqrtT1 = Math.sqrt(T1);
  const d1_1 = (Math.log(S / K) + (sigma * sigma / 2) * T1) / (sigma * sqrtT1);
  const delta1 = type === 'call' ? normCDF(d1_1) : normCDF(d1_1) - 1;
  const charm = delta1 - delta; // negative for long calls: delta drifts toward 0 or 1
  // Speed = ∂Gamma/∂S = -Gamma × (d1/(σ√T) + 1) / S
  const speed = -gamma * (d1 / (sigma * sqrtT) + 1) / S;
  return { delta, gamma, theta, vega, vanna, volga, charm, speed };
}
