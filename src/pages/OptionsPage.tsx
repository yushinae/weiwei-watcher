import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Plus, X, Check, FileDown } from 'lucide-react';
import { cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type Settlement = 'USDC' | 'USDT';
type CoinBase = 'BTC' | 'ETH' | 'SOL' | 'AVAX' | 'XRP' | 'TRX';
type FilterKey = 'atm_range' | 'strike_range' | 'price_move';

interface OptionTab {
  id: string;
  coin: CoinBase;
  settlement: Settlement;
  expiry: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const SPOT: Record<CoinBase, number> = {
  BTC: 81577, ETH: 3420, SOL: 152, AVAX: 38, XRP: 0.62, TRX: 0.14,
};

const EXPIRIES: Record<CoinBase, string[]> = {
  BTC:  ['08 MAY 26','09 MAY 26','10 MAY 26','15 MAY 26','22 MAY 26','29 MAY 26','26 JUN 26','31 JUL 26'],
  ETH:  ['08 MAY 26','09 MAY 26','10 MAY 26','15 MAY 26','22 MAY 26','29 MAY 26','26 JUN 26','31 JUL 26'],
  SOL:  ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
  AVAX: ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
  XRP:  ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
  TRX:  ['08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'],
};

function seededRand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function genStrikes(coin: CoinBase): number[] {
  const S = SPOT[coin];
  const step = S > 10000 ? 500 : S > 100 ? 5 : S > 1 ? 0.05 : 0.005;
  const count = 15;
  const base = Math.round(S / step) * step;
  return Array.from({ length: count * 2 + 1 }, (_, i) => +(base + (i - count) * step).toFixed(6));
}

function bsPrice(S: number, K: number, T: number, iv: number, isCall: boolean) {
  if (T <= 0) return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const t = T / 365, sigma = iv / 100;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const Phi = (x: number) => {
    const a = Math.abs(x);
    const k = 1 / (1 + 0.2316419 * a);
    const p = phi(a) * k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  };
  if (isCall) return S * Phi(d1) - K * Math.exp(-0.02 * t) * Phi(d2);
  return K * Math.exp(-0.02 * t) * Phi(-d2) - S * Phi(-d1);
}

function buildChain(coin: CoinBase, expiry: string) {
  const S = SPOT[coin];
  const parts = expiry.split(' ');
  const dayNum = parseInt(parts[0]);
  const T = Math.max(1, dayNum - new Date().getDate());
  const strikes = genStrikes(coin);

  return strikes.map((K, idx) => {
    const r1 = seededRand(idx * 3 + 1);
    const r2 = seededRand(idx * 3 + 2);
    const r3 = seededRand(idx * 3 + 3);

    const moneyness = K / S;
    const base = coin === 'BTC' ? 58 : coin === 'ETH' ? 68 : 80;
    const callSkew = moneyness > 1 ? (moneyness - 1) * 30 : -(1 - moneyness) * 15;
    const putSkew  = moneyness < 1 ? (1 - moneyness) * 40 : -(moneyness - 1) * 10;
    const callIV = Math.max(20, base + callSkew + (r1 - 0.5) * 2);
    const putIV  = Math.max(20, base + putSkew  + (r2 - 0.5) * 2);

    const callPrice = bsPrice(S, K, T, callIV, true);
    const putPrice  = bsPrice(S, K, T, putIV, false);

    const itm = K < S * 0.999;
    const atm = Math.abs(K - S) / S < 0.003;
    const otm = !itm && !atm;
    const distPct = ((K - S) / S) * 100;

    const spread = 0.015;

    return {
      K,
      callIV, putIV,
      callBid: callPrice * (1 - spread),
      callAsk: callPrice * (1 + spread),
      putBid:  putPrice  * (1 - spread),
      putAsk:  putPrice  * (1 + spread),
      callOI:    Math.round(r1 * 800 + 10),
      putOI:     Math.round(r2 * 800 + 10),
      callBidSz: Math.round(r2 * 400 + 25),
      putAskSz:  Math.round(r3 * 400 + 25),
      itm, atm, otm, distPct,
    };
  });
}

type ChainRow = ReturnType<typeof buildChain>[number];

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(v: number, coin: CoinBase): string {
  const S = SPOT[coin];
  if (S > 10000) return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);
  if (S > 100)   return v.toFixed(2);
  if (S > 1)     return v.toFixed(4);
  return v.toFixed(5);
}

function fmtK(v: number, coin: CoinBase): string {
  const S = SPOT[coin];
  if (S > 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (S > 100)   return v.toFixed(0);
  if (S > 1)     return v.toFixed(2);
  return v.toFixed(4);
}

const MON: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

function calcDTE(expiry: string): string {
  const [d, m, y] = expiry.split(' ');
  const exp = new Date(2000 + parseInt(y), MON[m], parseInt(d), 8, 0, 0);
  const diff = exp.getTime() - Date.now();
  if (diff <= 0) return '已到期';
  const h = Math.floor(diff / 3600000);
  const min = Math.floor((diff % 3600000) / 60000);
  const days = Math.floor(h / 24);
  if (days > 0) return `${days}天 ${h % 24}h`;
  return `${h}:${String(min).padStart(2, '0')}m`;
}

function formatExpiryFull(e: string): string {
  const [d, m, y] = e.split(' ');
  return `${d} ${m[0]}${m.slice(1).toLowerCase()} 20${y}`;
}

// ── IV stats ──────────────────────────────────────────────────────────────────

function calcIVStats(rows: ChainRow[]) {
  const atm = rows.find(r => r.atm) ?? rows[Math.floor(rows.length / 2)];
  const lo  = rows[Math.floor(rows.length * 0.28)];
  const hi  = rows[Math.floor(rows.length * 0.72)];
  const putWing  = lo.callIV - atm.callIV;
  const callWing = hi.callIV - atm.callIV;
  return {
    mid: atm.callIV.toFixed(1),
    lo:  putWing  >= 0 ? `+${putWing.toFixed(4)}`  : putWing.toFixed(4),
    hi:  callWing >= 0 ? `+${callWing.toFixed(4)}` : callWing.toFixed(4),
  };
}

// ── Click outside ─────────────────────────────────────────────────────────────

function useClickOutside(ref: React.RefObject<HTMLElement>, cb: () => void) {
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, cb]);
}

// ── Filled funnel icon ────────────────────────────────────────────────────────

const FunnelIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 2h14L9.5 8.5V14l-3-1.5V8.5L1 2z" />
  </svg>
);

// ── Filter dropdown ───────────────────────────────────────────────────────────

const FILTER_OPTS: { key: FilterKey; label: string; hasInput?: boolean }[] = [
  { key: 'atm_range',    label: 'ATM周围',    hasInput: true },
  { key: 'strike_range', label: '行权价范围' },
  { key: 'price_move',   label: '预期价格变动' },
];

const FilterDropdown = ({ active, atmRange, onToggle, onAtmRange, onClose }: {
  active: Set<FilterKey>;
  atmRange: number;
  onToggle: (k: FilterKey) => void;
  onAtmRange: (v: number) => void;
  onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null!);
  useClickOutside(ref, onClose);
  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 bg-[#111118] border border-[#252535] rounded-[8px] shadow-[0_12px_40px_rgba(0,0,0,0.85)] z-50 py-1.5 min-w-[210px]">
      {FILTER_OPTS.map(o => (
        <button
          key={o.key}
          onClick={() => onToggle(o.key)}
          className="w-full text-left px-4 py-3 text-[13px] font-medium text-slate-200 hover:bg-[#18181F] transition-colors flex items-center gap-3 select-none"
        >
          {/* check / box indicator */}
          <span className="w-5 shrink-0 flex items-center justify-center">
            {active.has(o.key)
              ? <Check size={14} strokeWidth={2.5} className="text-[#4A82F7]" />
              : <span className="w-[14px] h-[14px] rounded-[2px] border border-[#4A4A55] inline-block" />
            }
          </span>
          <span className="flex-1">{o.label}</span>
          {o.hasInput && (
            <input
              type="number"
              value={atmRange}
              min={1}
              max={30}
              onChange={e => onAtmRange(Math.max(1, Math.min(30, parseInt(e.target.value) || 7)))}
              onClick={e => e.stopPropagation()}
              className="w-10 bg-[#2A2A38] text-slate-100 text-center text-[13px] rounded-[5px] border border-transparent focus:border-[#3B5FBB] outline-none py-0.5 font-mono leading-none"
            />
          )}
        </button>
      ))}
    </div>
  );
};

// ── Chain table ───────────────────────────────────────────────────────────────

const ChainTable = ({ tab }: { tab: OptionTab }) => {
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(
    new Set<FilterKey>(['atm_range', 'price_move'])
  );
  const [atmRange, setAtmRange] = useState(7);
  const [showDist, setShowDist] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const rows     = useMemo(() => buildChain(tab.coin, tab.expiry), [tab.coin, tab.expiry]);
  const ivStats  = useMemo(() => calcIVStats(rows), [rows]);
  const dte      = calcDTE(tab.expiry);
  const expiryFull = formatExpiryFull(tab.expiry);

  const toggleFilter = (k: FilterKey) =>
    setActiveFilters(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const filteredRows = useMemo(() => {
    if (!activeFilters.has('atm_range')) return rows;
    const atmIdx = rows.findIndex(r => r.atm);
    const center = atmIdx >= 0 ? atmIdx : Math.floor(rows.length / 2);
    return rows.filter((_, i) => Math.abs(i - center) <= atmRange);
  }, [rows, activeFilters, atmRange]);

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 z-10">

          {/* ── Section header ── */}
          <tr className="bg-[#0D0D18] border-b border-[#1E1E30]">

            {/* Call side: CSV + 看涨期权 + 过滤 + Dist */}
            <td colSpan={4} className="py-2 pl-3">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#1A2840] border border-[#2A4870] text-[#60A5FA] text-[11px] font-bold hover:bg-[#1E3050] transition-colors">
                  <FileDown size={11} />
                  CSV
                </button>
                <span className="text-[12px] font-bold text-slate-300">看涨期权</span>

                <div className="relative ml-1">
                  <button
                    onClick={() => setFilterOpen(p => !p)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[12px] font-medium border border-[#4A82F7] text-slate-100 bg-transparent hover:bg-[#1A2840] transition-colors select-none"
                  >
                    <FunnelIcon size={12} />
                    过滤
                  </button>
                  {filterOpen && (
                    <FilterDropdown
                      active={activeFilters}
                      atmRange={atmRange}
                      onToggle={toggleFilter}
                      onAtmRange={setAtmRange}
                      onClose={() => setFilterOpen(false)}
                    />
                  )}
                </div>

                {/* vertical divider */}
                <div className="w-px h-4 bg-[#2A2A35] shrink-0" />

                <button
                  onClick={() => setShowDist(v => !v)}
                  className="flex items-center gap-2 text-[12px] font-medium text-slate-200 hover:text-slate-100 transition-colors select-none"
                >
                  <span className={cn(
                    "w-[14px] h-[14px] rounded-[2px] border flex items-center justify-center shrink-0 transition-colors",
                    showDist ? "bg-[#2A6ADF] border-[#2A6ADF]" : "border-[#4A4A55] bg-[#1A1A22]"
                  )}>
                    {showDist && <Check size={9} strokeWidth={2.5} className="text-white" />}
                  </span>
                  Dist
                </button>
              </div>
            </td>

            {/* Center: expiry date */}
            <td className="py-2 px-3 text-center whitespace-nowrap">
              <span className="text-[12px] font-semibold text-slate-200">{expiryFull}</span>
            </td>

            {/* Put side: 看跌期权 + DTE + IV */}
            <td colSpan={4} className="py-2 pr-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-300">看跌期权</span>
                <div className="flex items-center gap-3 font-mono text-[11px]">
                  <span>
                    <span className="text-slate-500">数据刷新: </span>
                    <span className="text-slate-300">{dte}</span>
                    <span className="text-slate-600"> (每周)</span>
                  </span>
                  <span>
                    <span className="text-slate-500">IV: </span>
                    <span className="text-slate-100 font-semibold">{ivStats.mid}%</span>
                    <span className="text-slate-600"> (</span>
                    <span className="text-[#f87171]">{ivStats.lo}</span>
                    <span className="text-slate-600">, </span>
                    <span className="text-[#4ade80]">{ivStats.hi}</span>
                    <span className="text-slate-600">)</span>
                  </span>
                </div>
              </div>
            </td>
          </tr>

          {/* ── Column headers ── */}
          <tr className="bg-[#0A0A12] border-b border-[#1E1E30]">
            {(['未平仓量', '大小', 'IV', '买价'] as const).map(h => (
              <th key={`c-${h}`} className="px-3 py-2 text-right text-[11px] font-medium text-slate-600 whitespace-nowrap">{h}</th>
            ))}
            <th className="px-3 py-2 text-center text-[11px] font-medium text-slate-600 w-32 min-w-[7rem]">执行价</th>
            {(['卖价', 'IV', '大小', '未平仓量'] as const).map(h => (
              <th key={`p-${h}`} className="px-3 py-2 text-left text-[11px] font-medium text-slate-600 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {filteredRows.map((r, i) => (
            <tr
              key={r.K}
              className={cn(
                "border-b border-[#0F0F1A] transition-colors cursor-pointer h-10",
                r.atm
                  ? "bg-[#131830] hover:bg-[#182040]"
                  : r.itm
                  ? i % 2 === 0 ? "bg-[#0E1118] hover:bg-[#131820]" : "bg-[#0B0E15] hover:bg-[#101520]"
                  : i % 2 === 0 ? "bg-[#0D0D14] hover:bg-[#121220]" : "bg-[#0A0A11] hover:bg-[#0F0F1C]"
              )}
            >
              {/* Call side */}
              <td className="px-3 py-0 text-right font-mono tnum text-slate-500">{r.callOI}</td>
              <td className="px-3 py-0 text-right font-mono tnum text-slate-500">{r.callBidSz}</td>
              <td className="px-3 py-0 text-right font-mono tnum text-slate-400">{r.callIV.toFixed(1)}%</td>
              <td className="px-3 py-0 text-right font-mono tnum text-[#4ade80] font-medium">{fmt(r.callBid, tab.coin)}</td>

              {/* Strike */}
              <td className="px-3 py-0 text-center font-mono">
                <div className={cn(
                  "font-bold text-[13px] leading-tight",
                  r.atm ? "text-[#60A5FA]" : r.itm ? "text-slate-200" : "text-slate-400"
                )}>
                  {fmtK(r.K, tab.coin)}
                  {r.atm && <span className="ml-1 text-[9px] text-[#60A5FA]/60 font-normal">ATM</span>}
                </div>
                {showDist && (
                  <div className={cn(
                    "text-[10px] leading-tight font-normal mt-0.5",
                    r.distPct > 0 ? "text-[#f87171]/70" : r.distPct < 0 ? "text-[#4ade80]/70" : "text-slate-600"
                  )}>
                    {r.distPct > 0 ? '+' : ''}{r.distPct.toFixed(1)}%
                  </div>
                )}
              </td>

              {/* Put side */}
              <td className="px-3 py-0 text-left font-mono tnum text-[#f87171] font-medium">{fmt(r.putAsk, tab.coin)}</td>
              <td className="px-3 py-0 text-left font-mono tnum text-slate-400">{r.putIV.toFixed(1)}%</td>
              <td className="px-3 py-0 text-left font-mono tnum text-slate-500">{r.putAskSz}</td>
              <td className="px-3 py-0 text-left font-mono tnum text-slate-500">{r.putOI}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

let tabIdCounter = 0;
function newTabId() { return `tab-${++tabIdCounter}`; }

const COIN_COLOR: Record<CoinBase, string> = {
  BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF',
  AVAX: '#E84142', XRP: '#346AA9', TRX: '#EF0027',
};

export default function OptionsPage({ initialCoin = 'BTC', initialSettlement = 'USDC', initialExpiry }: {
  initialCoin?: CoinBase;
  initialSettlement?: Settlement;
  initialExpiry?: string;
}) {
  const [tabs, setTabs] = useState<OptionTab[]>(() => [{
    id: newTabId(),
    coin: initialCoin,
    settlement: initialSettlement,
    expiry: initialExpiry ?? EXPIRIES[initialCoin][0],
  }]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

  const addTab = useCallback(() => {
    const id = newTabId();
    setTabs(prev => [...prev, { ...activeTab, id }]);
    setActiveId(id);
  }, [activeTab]);

  const removeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    const next = tabs[idx + 1] ?? tabs[idx - 1];
    setTabs(prev => prev.filter(t => t.id !== id));
    if (id === activeId) setActiveId(next.id);
  };

  return (
    <div className="absolute inset-0 flex flex-col">

      {/* ── Tab bar — 毛玻璃效果 ── */}
      <div className="flex items-center h-9 border-b border-white/10 px-2 gap-0.5 shrink-0" style={{ background: 'rgba(13,13,22,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        {tabs.map(tab => {
          const isActive = tab.id === activeId;
          const isHovered = tab.id === hoveredId;
          const color = COIN_COLOR[tab.coin];
          return (
            <button
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              onMouseEnter={() => setHoveredId(tab.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 h-full text-[12px] font-semibold transition-colors rounded-t-[4px] shrink-0 pr-2",
                isActive ? "text-slate-100 bg-[#13131E]" : "text-slate-500 hover:text-slate-300 hover:bg-[#0F0F18]"
              )}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, opacity: isActive ? 1 : 0.5 }} />
              期权 ({tab.coin}-{tab.settlement})
              <span
                className={cn(
                  "ml-1 w-4 h-4 flex items-center justify-center rounded-full transition-all",
                  isHovered && tabs.length > 1
                    ? "opacity-100 bg-[#2A2A3A] text-slate-300 hover:bg-[#3A3A4A]"
                    : "opacity-0 pointer-events-none"
                )}
                onClick={isHovered ? e => removeTab(tab.id, e) : undefined}
              >
                <X size={9} />
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full" style={{ backgroundColor: color }} />
              )}
            </button>
          );
        })}
        <button
          onClick={addTab}
          className="flex items-center justify-center w-6 h-6 ml-1 rounded-[4px] text-slate-600 hover:text-slate-300 hover:bg-[#1A1A28] transition-colors"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* ── Chain table ── */}
      <ChainTable tab={activeTab} />

    </div>
  );
}
