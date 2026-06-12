import React, { useMemo } from 'react';
import { X, ArrowRight, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Drawer } from '../../../components/popup/Popup';
import { cn } from '../../../lib/utils';
import type { Coin, MonitorSelection } from '../types';

// ── Black-Scholes approximations ──────────────────────────────────────────────

function normPDF(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Rational approximation for Φ⁻¹ (inverse normal CDF), Beasley-Springer-Moro
function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [0, -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [0, -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [0, -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0, 7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[1]*q+c[2])*q+c[3])*q+c[4])*q+c[5])*q+c[6]) /
           ((((d[1]*q+d[2])*q+d[3])*q+d[4])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[1]*r+a[2])*r+a[3])*r+a[4])*r+a[5])*r+a[6])*q /
           (((((b[1]*r+b[2])*r+b[3])*r+b[4])*r+b[5])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[1]*q+c[2])*q+c[3])*q+c[4])*q+c[5])*q+c[6]) /
             ((((d[1]*q+d[2])*q+d[3])*q+d[4])*q+1);
  }
}

// Delta label → (type, absDelta)
const DELTA_MAP: Record<string, { type: 'C' | 'P'; absDelta: number }> = {
  '10P': { type: 'P', absDelta: 0.10 },
  '25P': { type: 'P', absDelta: 0.25 },
  'ATM': { type: 'C', absDelta: 0.50 },
  '25C': { type: 'C', absDelta: 0.25 },
  '10C': { type: 'C', absDelta: 0.10 },
};

interface Greeks {
  delta: number;
  gamma: number;    // per unit spot move, scaled by S²/100
  theta: number;    // per day (in IV pts)
  vega: number;     // per 1% IV move
  callPrice: number; // approx dollar value per 1 unit notional
}

function computeGreeks(
  S: number,       // spot (per-unit reference; use 1 for normalized)
  T: number,       // years to expiry
  iv: number,      // in %
  absDelta: number,
  type: 'C' | 'P',
): Greeks {
  const sigma = iv / 100;
  if (T <= 0 || sigma <= 0) {
    return { delta: type === 'C' ? absDelta : -absDelta, gamma: 0, theta: 0, vega: 0, callPrice: 0 };
  }
  // d1 from delta (call delta Δc = N(d1))
  const callDelta = type === 'C' ? absDelta : 1 - absDelta;
  const d1 = normInv(callDelta);
  const d2 = d1 - sigma * Math.sqrt(T);
  const phi1 = normPDF(d1);

  const sqrtT = Math.sqrt(T);
  const delta = type === 'C' ? callDelta : callDelta - 1;
  const gamma_norm = phi1 / (S * sigma * sqrtT);      // Γ per $ spot move per share
  const gammaDollar = gamma_norm * S * S / 100;        // $/1% spot move per $100 notional
  const theta = -(S * phi1 * sigma) / (2 * sqrtT) / 365; // per day
  const vega = S * phi1 * sqrtT / 100;                 // per 1% IV move

  // Approximate option price via BS (no rates)
  const normCDF = (x: number) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const w = 1 - normPDF(x) * poly;
    return x >= 0 ? w : 1 - w;
  };
  // Strike K derived from d1: K = S * exp(-d1*sigma*sqrtT + 0.5*sigma²*T)
  const K = S * Math.exp(-d1 * sigma * sqrtT + 0.5 * sigma * sigma * T);
  const callPrice = S * normCDF(d1) - K * normCDF(d2);

  return { delta, gamma: gammaDollar, theta, vega, callPrice };
}

// ── Helper row ────────────────────────────────────────────────────────────────

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
      <span className="text-[11px] text-white/40">{label}</span>
      <span className={cn('font-mono tnum text-[12px] font-bold', color ?? 'text-white/90')}>{value}</span>
    </div>
  );
}

function coinToChainId(coin: Coin) {
  return coin === 'BTC' ? 'BTC-USD' : 'ETH-USD';
}

// Approximate spot from coin (will use real value once available via localStorage fallback)
const APPROX_SPOT: Record<Coin, number> = { BTC: 95_000, ETH: 3_200 };

// ── Main component ────────────────────────────────────────────────────────────

export function InspectorDrawer({
  open,
  selection,
  onClose,
}: {
  open: boolean;
  selection: MonitorSelection;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const title = useMemo(() => {
    switch (selection.type) {
      case 'smilePoint':
        return `${selection.coin} · Smile · ${selection.tenor} · ${selection.label}`;
      case 'skewCell':
        return `${selection.coin} · ${selection.row} × ${selection.col}`;
      default:
        return 'Inspector';
    }
  }, [selection]);

  // Compute BS Greeks for smile or skew selection
  const greeks = useMemo<Greeks | null>(() => {
    if (selection.type === 'none') return null;

    const coin = (selection as any).coin as Coin;
    const S = APPROX_SPOT[coin] ?? 50_000;
    const iv = selection.value;

    // Parse tenor string like "28D", "7D", "2M"
    let T = 30 / 365; // default 30D
    if (selection.type === 'smilePoint') {
      const days = parseFloat(selection.tenor);
      if (!isNaN(days)) T = days / 365;
    } else if (selection.type === 'skewCell') {
      const days = parseFloat(selection.col);
      if (!isNaN(days)) T = days / 365;
    }

    // Determine type and delta from label
    let absDelta = 0.50;
    let optType: 'C' | 'P' = 'C';
    const label = selection.type === 'smilePoint' ? selection.label : selection.row;
    const dm = DELTA_MAP[label];
    if (dm) { absDelta = dm.absDelta; optType = dm.type; }

    return computeGreeks(S, T, iv, absDelta, optType);
  }, [selection]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      width={420}
      className="bg-surface-1 text-white/80 border-l border-border-subtle"
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-white/30">Inspector</div>
            <div className="mt-1 truncate text-[13px] font-extrabold tracking-[-0.01em] text-white/90">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-[10px]',
              'bg-surface-2/70 ring-1 ring-inset ring-border-subtle/70',
              'text-white/45 hover:text-white/80 transition-colors',
            )}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 space-y-3">
          {selection.type === 'none' ? (
            <div className="rounded-[14px] border border-border-subtle bg-bg-card p-4 text-[12px] text-white/30">
              点击任意图表元素查看详情与理论 Greeks。
            </div>
          ) : (
            <>
              {/* Selection info */}
              <div className="rounded-[14px] border border-border-subtle bg-bg-card p-4 space-y-2">
                <div className="text-[11px] font-bold text-white/30 mb-3">选中点</div>
                {'coin' in selection && (
                  <Row label="标的" value={(selection as any).coin} />
                )}
                {selection.type === 'smilePoint' && (
                  <>
                    <Row label="到期" value={selection.tenor} />
                    <Row label="Delta 档位" value={selection.label} />
                    <Row label="隐含波动率" value={`${selection.value.toFixed(2)}%`} color="text-[#24AE64]" />
                  </>
                )}
                {selection.type === 'skewCell' && (
                  <>
                    <Row label="Delta 行" value={selection.row} />
                    <Row label="到期列" value={selection.col} />
                    <Row label="隐含波动率" value={`${selection.value.toFixed(2)}%`} color="text-[#24AE64]" />
                  </>
                )}
              </div>

              {/* BS Greeks */}
              {greeks && (
                <div className="rounded-[14px] border border-border-subtle bg-bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={13} className="text-white/30" />
                    <div className="text-[11px] font-bold text-white/30">Black-Scholes 理论 Greeks</div>
                  </div>
                  <Row
                    label="Δ Delta"
                    value={greeks.delta.toFixed(3)}
                    color={greeks.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}
                  />
                  <Row
                    label="Γ Gamma (每 1% S)"
                    value={`$${greeks.gamma.toFixed(2)}`}
                    color="text-[#FF9C2E]"
                  />
                  <Row
                    label="Θ Theta (每日)"
                    value={`$${greeks.theta.toFixed(2)}`}
                    color="text-rose-400"
                  />
                  <Row
                    label="ν Vega (每 1% IV)"
                    value={`$${greeks.vega.toFixed(2)}`}
                    color="text-[#ff9c2e]"
                  />
                  <Row
                    label="理论价格 (近似)"
                    value={`$${greeks.callPrice.toFixed(2)}`}
                  />
                  <p className="text-[9px] text-white/20 pt-1 px-1">
                    以 {
                      'coin' in selection ? APPROX_SPOT[(selection as any).coin as Coin].toLocaleString() : '—'
                    } 为参考价格 · ATM/±δ 近似 · Black-Scholes（无利率）
                  </p>
                </div>
              )}

              {/* Navigation */}
              {'coin' in selection && (
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/options-chain?coin=${encodeURIComponent(coinToChainId((selection as any).coin))}`);
                    onClose();
                  }}
                  className={cn(
                    'group w-full rounded-[14px] border border-border-subtle bg-bg-card px-4 py-3',
                    'hover:border-border-strong transition-colors',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-bold text-white/90">前往期权链</div>
                      <div className="text-[11px] text-white/30">查看完整报价与成交数据</div>
                    </div>
                    <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-[var(--bb-orange-soft-1)] text-[var(--bb-orange)] group-hover:bg-[var(--bb-orange-soft-2)] transition-colors">
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
