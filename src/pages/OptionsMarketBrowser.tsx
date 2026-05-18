import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { X, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import OptionsPage from './OptionsPage';

// ── Animation presets ─────────────────────────────────────────────────────────

const SPRING = { type: 'spring' as const, stiffness: 260, damping: 25 };

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

const STAGGER_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } },
};

// ── Data ──────────────────────────────────────────────────────────────────────

type CoinBase = 'BTC' | 'ETH' | 'SOL' | 'AVAX' | 'XRP' | 'TRX';
type Settlement = 'USDC' | 'USDT';

interface SelectedOption {
  type: 'inverse' | 'linear';
  coin: CoinBase;
  settlement: Settlement;
  expiry: string;
}

const SPOT: Record<CoinBase, number> = {
  BTC: 81577, ETH: 3420, SOL: 152, AVAX: 38, XRP: 0.62, TRX: 0.14,
};

const COIN_COLOR: Record<string, string> = {
  BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF',
  AVAX: '#E84142', XRP: '#346AA9', TRX: '#EF0027',
};

const DVOL: Record<string, number> = {
  BTC: 58.4, ETH: 68.2, SOL: 85.1, AVAX: 92.3, XRP: 110.2, TRX: 124.8,
};

const INVERSE_COINS = [
  {
    coin: 'BTC' as CoinBase, icon: '₿',
    expiries: [
      '07 MAY 26','08 MAY 26','09 MAY 26','10 MAY 26',
      '15 MAY 26','22 MAY 26','29 MAY 26','26 JUN 26',
      '31 JUL 26','25 SEP 26','25 DEC 26','26 MAR 27',
    ],
  },
  {
    coin: 'ETH' as CoinBase, icon: 'Ξ',
    expiries: [
      '07 MAY 26','08 MAY 26','09 MAY 26','10 MAY 26',
      '15 MAY 26','22 MAY 26','29 MAY 26','26 JUN 26',
      '31 JUL 26','25 SEP 26','25 DEC 26','26 MAR 27',
    ],
  },
];

const LINEAR_COINS = [
  { coin: 'AVAX' as CoinBase, expiries: ['07 MAY 26','08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'] },
  { coin: 'BTC'  as CoinBase, expiries: ['07 MAY 26','08 MAY 26','09 MAY 26','10 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'] },
  { coin: 'ETH'  as CoinBase, expiries: ['07 MAY 26','08 MAY 26','09 MAY 26','10 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'] },
  { coin: 'SOL'  as CoinBase, expiries: ['07 MAY 26','08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'] },
  { coin: 'TRX'  as CoinBase, expiries: ['07 MAY 26','08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'] },
  { coin: 'XRP'  as CoinBase, expiries: ['07 MAY 26','08 MAY 26','15 MAY 26','29 MAY 26','26 JUN 26'] },
];

// ── IV sparkline (seeded, no flicker) ─────────────────────────────────────────

function seededRand(seed: number) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const IVSparkline = ({ coin }: { coin: CoinBase }) => {
  const base = DVOL[coin] ?? 70;
  const pts = Array.from({ length: 30 }, (_, i) =>
    base + (seededRand(i * 7 + base) - 0.5) * 18
  );
  const W = 300, H = 56;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const n = (v: number) => H - ((v - lo) / (hi - lo || 1)) * (H - 8) - 4;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * W);
  const ys = pts.map(n);
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const isUp = pts[pts.length - 1] >= pts[0];
  const stroke = isUp ? '#4ade80' : '#f87171';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`ivg-${coin}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#ivg-${coin})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

// ── Greeks cards data ─────────────────────────────────────────────────────────

const getGreeks = (coin: CoinBase) => [
  { label: 'Delta Δ',  value: '+0.52',                      color: '#60A5FA' },
  { label: 'Gamma Γ',  value: '0.0018',                     color: '#4ade80' },
  { label: 'Theta Θ',  value: '-42.3',                      color: '#f87171' },
  { label: 'Vega ν',   value: `+${(DVOL[coin]*1.5).toFixed(1)}`, color: '#a78bfa' },
  { label: 'IV ATM',   value: `${DVOL[coin]}%`,             color: '#fb923c' },
  { label: 'DVOL',     value: `${DVOL[coin]}`,              color: '#fbbf24' },
];

// ── Detail overlay ────────────────────────────────────────────────────────────

const DetailOverlay = ({
  selected,
  layoutId,
  onClose,
}: {
  selected: SelectedOption;
  layoutId: string;
  onClose: () => void;
}) => {
  const color  = COIN_COLOR[selected.coin];
  const spot   = SPOT[selected.coin];
  const greeks = getGreeks(selected.coin);
  const coinIcon = selected.coin === 'BTC' ? '₿' : selected.coin === 'ETH' ? 'Ξ' : selected.coin[0];

  return (
    <>
      {/* ── Backdrop — 毛玻璃 ── */}
      <motion.div
        className="absolute inset-0 z-40 bg-[#070710]/60 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />

      {/* ── Shared-element card — 毛玻璃 ── */}
      <motion.div
        layoutId={layoutId}
        className="absolute inset-0 z-50 flex flex-col overflow-hidden"
        style={{ background: 'rgba(13,13,24,0.7)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '16px', boxShadow: '0 24px 60px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.07)' }}
        transition={SPRING}
      >
        {/* Header — fades in after layout settles */}
        <motion.header
          className="flex items-center gap-3 px-5 py-3 border-b border-[#1E1E2E] shrink-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.13, duration: 0.18 }}
        >
          <motion.button
            onClick={onClose}
            className="p-1.5 rounded-[6px] text-slate-500 hover:text-slate-100 hover:bg-[#1A1A28] transition-colors"
            whileTap={{ scale: 0.88, transition: { duration: 0.08 } }}
          >
            <ChevronLeft size={16} />
          </motion.button>

          <div className="w-px h-5 bg-[#252530]" />

          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: color + '22', color }}
          >
            {coinIcon}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-slate-100">{selected.coin}</span>
            <span className="text-[12px] text-slate-600">—</span>
            <span className="text-[12px] font-medium text-slate-400">{selected.settlement}</span>
            <span className="font-mono text-[11px] text-slate-300 bg-[#1A1A28] border border-[#252535] px-2 py-0.5 rounded">
              {selected.expiry}
            </span>
            <span className="text-[9px] capitalize text-slate-600 bg-[#111118] border border-[#1A1A28] px-1.5 py-0.5 rounded">
              {selected.type}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <span className="text-[12px] font-mono text-slate-500">
              标的 <span className="text-slate-200 font-semibold">${spot.toLocaleString()}</span>
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[6px] text-slate-500 hover:text-slate-100 hover:bg-[#1A1A28] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </motion.header>

        {/* Body — stagger children */}
        <motion.div
          className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3"
          variants={STAGGER_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {/* Greeks row */}
          <motion.div className="grid grid-cols-6 gap-3" variants={ITEM_VARIANTS}>
            {greeks.map(g => (
              <motion.div
                key={g.label}
                variants={ITEM_VARIANTS}
                className="bg-[#111118] border border-[#1E1E2E] rounded-[8px] px-3 py-2.5 flex flex-col gap-1"
              >
                <span className="text-[10px] text-slate-500">{g.label}</span>
                <span className="text-[15px] font-bold font-mono" style={{ color: g.color }}>{g.value}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-3">
            <motion.div
              variants={ITEM_VARIANTS}
              className="col-span-2 bg-[#111118] border border-[#1E1E2E] rounded-[8px] p-3"
            >
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">IV 历史走势 (30d)</div>
              <div className="h-14"><IVSparkline coin={selected.coin} /></div>
            </motion.div>

            <motion.div
              variants={ITEM_VARIANTS}
              className="bg-[#111118] border border-[#1E1E2E] rounded-[8px] p-3"
            >
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">波动率指标</div>
              <div className="flex flex-col gap-1.5">
                {[['DVOL', `${DVOL[selected.coin]}`], ['IV Rank', '63rd'], ['到期剩余', '21:29m'], ['未平仓量', '8,241']].map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500">{k}</span>
                    <span className="text-[11px] font-mono font-medium text-slate-200">{v}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Full options chain */}
          <motion.div
            variants={ITEM_VARIANTS}
            className="relative overflow-hidden rounded-[8px] border border-[#1E1E2E]"
            style={{ minHeight: 320, flex: '1 1 0' }}
          >
            <OptionsPage
              initialCoin={selected.coin}
              initialSettlement={selected.settlement}
              initialExpiry={selected.expiry}
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
};

// ── Single expiry date cell ────────────────────────────────────────────────────

const ExpiryCell = ({
  expiry,
  isSelected,
  onClick,
}: {
  layoutId: string;
  expiry: string;
  isSelected: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "mx-3 my-1 h-[32px] w-auto text-left px-3 rounded-[10px] border text-[12px] font-semibold tracking-tight transition-colors duration-100",
      isSelected
        ? "bg-[#2F6BFF]/20 border-[#2F6BFF]/40 text-[#9BB6FF]"
        : "bg-white/[0.03] border-white/[0.08] text-white/70 hover:bg-white/[0.06] hover:text-white/90"
    )}
  >
    {expiry}
  </button>
);

// ── Coin column ────────────────────────────────────────────────────────────────

const CoinColumn = ({
  type,
  coin,
  icon,
  settlement,
  expiries,
  selectedOption,
  onSelect,
  isLast = false,
}: {
  type: 'inverse' | 'linear';
  coin: CoinBase;
  icon?: string;
  settlement: Settlement;
  expiries: string[];
  selectedOption: SelectedOption | null;
  onSelect: (s: SelectedOption) => void;
  isLast?: boolean;
}) => {
  const navigate = useNavigate();
  const color = COIN_COLOR[coin];
  const label = type === 'inverse' ? coin : `${coin}-${settlement}`;

  return (
    <div className={cn('flex-1 min-w-0 flex flex-col', !isLast && 'border-r border-[#1A1A22]')}>
      {/* Column header */}
      <button
        className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0 hover:bg-white/[0.04] transition-colors w-full text-left"
        style={{ transition: 'background-color 0.1s linear' }}
      >
        <div
          className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
          style={{ background: color + '22', color }}
        >
          {icon ?? null}
          {!icon && <div className="w-full h-full rounded-full" style={{ background: color, opacity: 0.75 }} />}
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-white/90 whitespace-nowrap leading-tight">{label}</div>
          {type === 'inverse' && (
            <div className="text-[10px] text-white/35 leading-tight">DVOL {DVOL[coin]}</div>
          )}
        </div>
      </button>

      {/* Expiry list */}
      <div className="flex flex-col py-1 flex-1 overflow-y-auto">
        {expiries.map(exp => {
          const lid = `cell-${type}-${coin}-${settlement}-${exp}`;
          const isSel =
            selectedOption?.coin === coin &&
            selectedOption?.expiry === exp &&
            selectedOption?.type === type &&
            selectedOption?.settlement === settlement;
          return (
            <React.Fragment key={lid}>
              <ExpiryCell
                layoutId={lid}
                expiry={exp}
                isSelected={isSel}
                onClick={() => {
                  const coinId = type === 'inverse' ? `${coin}-USD` : `${coin}-${settlement}`;
                  const url = `/options-chain?coin=${coinId}&expiry=${encodeURIComponent(exp)}`;
                  console.log('[navigate]', url);
                  navigate(url);
                }}
              />
            </React.Fragment>
          );
        })}

        {/* 组合 footer button */}
        <button className="mx-3 mt-1 mb-2 flex items-center justify-center gap-1.5 py-1.5 rounded-[6px] bg-[#111118] hover:bg-[#1A1A24] text-[11px] font-bold text-slate-500 hover:text-slate-300 border border-[#1A1A22] hover:border-[#252530] shrink-0"
          style={{ transition: 'all 0.1s linear' }}
        >
          {icon
            ? <span style={{ color, opacity: 0.7 }}>{icon}</span>
            : <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, opacity: 0.65 }} />
          }
          组合
        </button>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OptionsMarketBrowser() {
  const [selected, setSelected]         = useState<SelectedOption | null>(null);
  const [linearSettlement, setLinear]   = useState<Settlement>('USDC');

  const handleSelect = useCallback((s: SelectedOption) => setSelected(s), []);
  const handleClose  = useCallback(() => setSelected(null), []);

  const activeLayoutId = selected
    ? `cell-${selected.type}-${selected.coin}-${selected.settlement}-${selected.expiry}`
    : null;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden select-none">
      <LayoutGroup>

        {/* ── Grid ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* INVERSE OPTIONS */}
          <div className="flex flex-col border-r border-white/[0.06] shrink-0" style={{ width: 300 }}>
            <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
              <span className="text-[12px] font-bold text-white/75 tracking-tight">Inverse Options</span>
              <span className="text-[11px] text-white/30">Deribit</span>
            </div>
            <div className="flex flex-1 min-h-0 overflow-y-auto">
              {INVERSE_COINS.map((c, i) => (
                <React.Fragment key={c.coin}>
                  <CoinColumn
                    type="inverse"
                    coin={c.coin}
                    icon={c.icon}
                    settlement="USDC"
                    expiries={c.expiries}
                    selectedOption={selected}
                    onSelect={handleSelect}
                    isLast={i === INVERSE_COINS.length - 1}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* LINEAR OPTIONS */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
              <span className="text-[12px] font-bold text-white/75 tracking-tight">Linear Options</span>

              {/* USDC / USDT toggle */}
              <div className="flex gap-0.5 bg-white/[0.03] rounded-[10px] p-1 ml-1 border border-white/[0.06]">
                {(['USDC', 'USDT'] as Settlement[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setLinear(s)}
                    className={cn(
                      'text-[11px] font-bold px-3 py-1 rounded-[8px] transition-colors',
                      linearSettlement === s
                        ? s === 'USDC' ? 'bg-[#2F6BFF]/20 text-[#9BB6FF]' : 'bg-[#2F6BFF]/20 text-[#9BB6FF]'
                        : 'text-white/35 hover:text-white/60',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <span className="text-[11px] text-white/30">Deribit</span>
            </div>

            <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto">
              {LINEAR_COINS.map((c, i) => (
                <React.Fragment key={`${c.coin}-${linearSettlement}`}>
                  <CoinColumn
                    type="linear"
                    coin={c.coin}
                    settlement={linearSettlement}
                    expiries={c.expiries}
                    selectedOption={selected}
                    onSelect={handleSelect}
                    isLast={i === LINEAR_COINS.length - 1}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* ── Detail overlay (shared-element expand) ── */}
        <AnimatePresence>
          {selected && activeLayoutId && (
            <React.Fragment key={activeLayoutId}>
              <DetailOverlay
                selected={selected}
                layoutId={activeLayoutId}
                onClose={handleClose}
              />
            </React.Fragment>
          )}
        </AnimatePresence>

      </LayoutGroup>
    </div>
  );
}
