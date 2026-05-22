function normCdf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + (x < 0 ? -1 : 1) * y);
}

function normPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsPrice(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) return Math.max(0, type === 'call' ? S - K : K - S);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return type === 'call' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}

function hoursToYears(h: number) { return h / (24 * 365); }

interface WorkerLeg {
  side: 1 | -1;
  type: 'call' | 'put';
  K: number;
  qty: number;
  hoursToExpiry: number;
  entryPremium: number;
  legIv?: number;
}

function legCurrentValue(leg: WorkerLeg, S: number, hf: number, ivAdj: number, baseIv: number) {
  const remH = Math.max(0, leg.hoursToExpiry - hf);
  const T = hoursToYears(remH);
  const sig = Math.max(0.01, (leg.legIv ?? baseIv) + ivAdj);
  return bsPrice(S, leg.K, T, sig, leg.type);
}

function legPL(leg: WorkerLeg, S: number, hf: number, ivAdj: number, baseIv: number) {
  const cur = legCurrentValue(leg, S, hf, ivAdj, baseIv);
  return leg.side * leg.qty * (cur - leg.entryPremium);
}

function positionPL(S: number, hf: number, ivAdj: number, legs: WorkerLeg[], baseIv: number) {
  return legs.reduce((sum, l) => sum + legPL(l, S, hf, ivAdj, baseIv), 0);
}

self.onmessage = (e: MessageEvent) => {
  const { spot: _spot, sigma, baseIv, legs, baseS, numPaths, varSeed } = e.data as {
    spot: number;
    sigma: number;
    baseIv: number;
    legs: WorkerLeg[];
    baseS: number;
    numPaths: number;
    varSeed: number;
  };

  if (legs.length === 0) {
    self.postMessage(null);
    return;
  }

  const N = numPaths;
  const T1 = hoursToYears(24);
  const sig = sigma;

  let rngState = (varSeed * 1664525 + 1013904223 + legs.length * 6364136 + Math.round(sig * 1000)) >>> 0;
  function lcgRand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
  }

  const pls: number[] = new Array(N);
  const base0 = positionPL(baseS, 0, 0, legs, baseIv);
  for (let i = 0; i < N; i++) {
    const u1 = lcgRand() + 1e-15, u2 = lcgRand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const S1 = baseS * Math.exp((-sig * sig / 2) * T1 + sig * Math.sqrt(T1) * z);
    pls[i] = positionPL(S1, 24, 0, legs, baseIv) - base0;
  }
  pls.sort((a, b) => a - b);

  const var95 = pls[Math.floor(N * 0.05)];
  const var99 = pls[Math.floor(N * 0.01)];
  const cvar95 = pls.slice(0, Math.floor(N * 0.05)).reduce((s, v) => s + v, 0) / Math.floor(N * 0.05);
  const cvar99 = pls.slice(0, Math.floor(N * 0.01)).reduce((s, v) => s + v, 0) / Math.floor(N * 0.01);

  const HIST_N = 30;
  const hMin = pls[0], hMax = pls[N - 1];
  const hWidth = (hMax - hMin) / HIST_N || 1;
  const histCounts = new Array(HIST_N).fill(0) as number[];
  for (const v of pls) {
    const bi = Math.min(HIST_N - 1, Math.floor((v - hMin) / hWidth));
    histCounts[bi]++;
  }
  const histEdges = Array.from({ length: HIST_N }, (_, i) => hMin + i * hWidth);

  self.postMessage({ var95, var99, cvar95, cvar99, baseS, histEdges, histCounts, hWidth });
};
