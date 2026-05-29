import type { ExpiryGroup, ParsedOption } from '../data/deribit';
import { closestDeltaIV } from '../data/deribit';
import { TXT, BRAND, YELLOW, BLUE } from './widget-colors';

// ═══════════════════════════════════════════════════════════════════════════════
// Smile chart constants & builder
// ═══════════════════════════════════════════════════════════════════════════════

export const SMILE_GRID = [0.10, 0.25, 0.50, 0.75, 0.90] as const;
export const SMILE_LABELS_LIVE = ['10P', '25P', 'ATM', '25C', '10C'] as const;

export interface SmileRow { label: string; values: number[] }

export function buildSmileRows(expiries: ExpiryGroup[]): { rows: SmileRow[]; lines: { label: string; color: string }[] } {
  const lines: { label: string; color: string }[] = expiries.map((e, i) => ({
    label: e.label,
    color: [BRAND, YELLOW, BLUE][i] ?? TXT,
  }));
  const rows: SmileRow[] = SMILE_LABELS_LIVE.map((lbl, gi) => {
    const values = expiries.map(e => {
      if (lbl === 'ATM') return e.atmIV;
      const isCall = lbl.endsWith('C');
      const targetDelta = lbl.startsWith('10') ? 0.10 : 0.25;
      return closestDeltaIV(isCall ? e.calls : e.puts, targetDelta);
    });
    return { label: lbl, values };
  });
  return { rows, lines };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pick representative expiries
// ═══════════════════════════════════════════════════════════════════════════════

export function pickExpiries(expiries: ExpiryGroup[], targets: number[]): ExpiryGroup[] {
  const result: ExpiryGroup[] = [];
  const used = new Set<number>();
  for (const t of targets) {
    if (!expiries.length) break;
    const e = expiries.reduce((best, ex) =>
      Math.abs(ex.daysToExp - t) < Math.abs(best.daysToExp - t) ? ex : best
    , expiries[0]);
    if (e && !used.has(e.daysToExp)) { result.push(e); used.add(e.daysToExp); }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Correlation + returns
// ═══════════════════════════════════════════════════════════════════════════════

export function dailyReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  return r;
}

export function rollingCorr(x: number[], y: number[], win: number): number[] {
  const n = Math.min(x.length, y.length);
  return Array.from({ length: n }, (_, i) => {
    if (i < win - 1) return NaN;
    const xs = x.slice(i - win + 1, i + 1);
    const ys = y.slice(i - win + 1, i + 1);
    const mx = xs.reduce((a, b) => a + b, 0) / win;
    const my = ys.reduce((a, b) => a + b, 0) / win;
    let cov = 0, vx = 0, vy = 0;
    for (let j = 0; j < win; j++) {
      const dx = xs[j] - mx; const dy = ys[j] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    const d = Math.sqrt(vx * vy);
    return d > 0 ? cov / d : 0;
  });
}
