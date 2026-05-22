export function rollingRV(logRets: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = window - 1; i < logRets.length; i++) {
    const w = logRets.slice(i - window + 1, i + 1);
    const mean = w.reduce((s, r) => s + r, 0) / w.length;
    const v = w.reduce((s, r) => s + (r - mean) ** 2, 0) / w.length;
    out.push(Math.sqrt(v * 252) * 100);
  }
  return out;
}

export function percentileAt(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (idx - lo) * ((sorted[hi] ?? sorted[lo]) - sorted[lo]);
}
