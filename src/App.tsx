/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- 下面这些 import 就像是去商场里买现成的零件 ---

// React 是我们造网页的大框架。useState 帮我们记住东西（比如现在几点），useEffect 帮我们做一些杂事（比如去网上拿数据）。
import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
// Lucide 是一个图标店，我们从这里拿"趋势向上"、"时钟"、"设置"等小图标。
import {
  TrendingUp,
  TrendingDown,
  Clock,
  ChevronDown,
  Activity,
  Search,
  Bell,
  Wallet,
  Settings,
  ArrowUpRight,
  ArrowDownRight,
  PieChart as PieChartIcon,
  BarChart3,
  History,
  LayoutGrid,
  Menu,
  Home,
  Calculator,
  FileText,
  Plus,
  Upload,
  ChevronUp,
  Copy,
  Trash2,
  Edit2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Modal } from './components/popup/Popup';
import { HoverPopover, Popover } from './components/popup/Popup';
// react-router-dom 是网页的"导航员"，负责在"首页"、"账户页"之间切换。
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
const TradeLogPage      = lazy(() => import('./pages/TradeLogPage'));
const AssetsPage        = lazy(() => import('./pages/AssetsPage'));
const MonitorPage       = lazy(() => import('./pages/MonitorPage'));
const OptionsChainPage  = lazy(() => import('./pages/OptionsChainPage'));
const PositionBuilderPage = lazy(() => import('./pages/PositionBuilderPage'));

// 引入一些现成的样式表，让网页的排版和方块挪动效果更好看。
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Recharts 是画图专家，我们用它画各种复杂的行情线。
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
// motion 是动画大师，专门负责让网页里的东西飞入飞出、变大变小，显得很高级。
import { motion, AnimatePresence } from 'motion/react';
// cn 是一个小助手，帮我们方便地组合不同的样式（比如"背景变红"+"字体变粗"）。
import { cn } from './lib/utils';

// --- Mock Data ---
const CHART_DATA = Array.from({ length: 48 }, (_, i) => ({
  time: `${Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '30'}`,
  price: 64200 + Math.random() * 1200 - 600,
  volume: 400 + Math.random() * 800,
}));

const POSITION_DATA = [
  { symbol: 'BTCUSDT', type: 'Long', qty: '1.24', entry: '63,450.0', mark: '64,120.2', pnl: '+831.24', pnlPct: '+1.06%', leverage: '20x' },
  { symbol: 'ETHUSDT', type: 'Short', qty: '15.0', entry: '3,452.1', mark: '3,421.5', pnl: '+459.00', pnlPct: '+0.88%', leverage: '10x' },
  { symbol: 'SOLUSDT', type: 'Long', qty: '142.5', entry: '154.2', mark: '152.8', pnl: '-199.50', pnlPct: '-0.91%', leverage: '5x' },
];

const MARKET_TICKERS = [
  { symbol: 'BTCUSDT', price: '64,123.50', change: '+1.2%', up: true },
  { symbol: 'ETHUSDT', price: '3,425.80', change: '+0.8%', up: true },
];

// --- 组件和状态工具 ---

// 从我们之前写的"管家"那里拿取数据。
import { useWorkspaceStore } from './store/useWorkspaceStore';
import { useLayoutStore } from './store/useLayoutStore';

import { DashboardPage } from './pages/DashboardPage';
import { WIDGET_REGISTRY } from './registry';
import { DERIBIT_EXPIRIES } from './constants/options';
import { useDeribitSpotStream } from './hooks/useDeribitSpotStream';

/**
 * useBinanceTickers：已替换为 Deribit 实时永续合约价格
 */
function useBinanceTickers() {
  const deribitTickers = useDeribitSpotStream();
  return deribitTickers.map(t => ({ ...t, symbol: t.symbol + 'USDT' }));
}

const TokenIcon = ({ symbol }: { symbol: string }) => {
  if (symbol.includes('BTC')) {
    return (
      <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#F7931A" />
        <path d="M22.1 13.7c.4-2.6-1.6-4-4.3-4.9l.9-3.6-2.2-.5-.9 3.5-1.7-.4.9-3.5-2.2-.5-.9 3.6-1.4-.3-3.1-.8-.6 2.4s1.6.4 1.6.4c.9.2 1.1.8 1 1.4l-2.5 10.1c-.1.4-.5.9-1.3.7l-1.6-.4-1.1 2.6 2.9.7 1.7.4-.9 3.7 2.2.5.9-3.7 1.7.4-.9 3.6 2.2.5.9-3.6c3.8.7 6.6.4 7.8-3 1-2.7-.1-4.2-2-5.2 1.4-.3 2.4-1.2 2.7-3zm-4.8 6.7c-.7 2.8-5.4.9-6.9.7l1.2-4.9c1.5.4 6.5.9 5.7 4.2zm.7-6.9c-.6 2.5-4.5.9-5.8.7l1.1-4.4c1.2.3 5.4.8 4.7 3.7z" fill="#FFF" />
      </svg>
    );
  }
  if (symbol.includes('ETH')) {
    return (
      <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#6270E0" />
        <path d="M16 5L15.8 5.8V20.2L16 20.4L23.5 16L16 5Z" fill="#D0D8FF" />
        <path d="M16 5L8.5 16L16 20.4V5Z" fill="#FFF" />
        <path d="M16 21.8L15.8 22V27.5L16 28L23.5 17.4L16 21.8Z" fill="#D0D8FF" />
        <path d="M16 28V21.8L8.5 17.4L16 28Z" fill="#FFF" />
        <path d="M16 20.4L23.5 16L16 12.6V20.4Z" fill="#8A9CE8" />
        <path d="M8.5 16L16 20.4V12.6L8.5 16Z" fill="#D0D8FF" />
      </svg>
    );
  }
  if (symbol.includes('SOL')) {
    return (
      <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="solGrad" x1="7" y1="26.75" x2="25" y2="8.25" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9945FF" />
            <stop offset="100%" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill="#1A0B38" />
        <polygon points="7,11.25 25,8.25 25,11.75 7,14.75" fill="url(#solGrad)" />
        <polygon points="7,17.25 25,14.25 25,17.75 7,20.75" fill="url(#solGrad)" />
        <polygon points="7,23.25 25,20.25 25,23.75 7,26.75" fill="url(#solGrad)" />
      </svg>
    );
  }
  if (symbol.includes('BNB')) {
    return (
      <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#181A20" />
        {/* 顶面：左三角块 */}
        <polygon points="16,7.5 9.5,12 15,15.5" fill="#F0B90B" />
        {/* 顶面：右三角块 */}
        <polygon points="16,7.5 17,15.5 22.5,12" fill="#F0B90B" />
        {/* 左侧面上块 */}
        <polygon points="9.5,13 15,16.5 15,19.5 9.5,16" fill="#A08010" />
        {/* 左侧面下块 */}
        <polygon points="9.5,17 15,20.5 16,24.5 9.5,21" fill="#A08010" />
        {/* 右侧面上块 */}
        <polygon points="22.5,13 22.5,16 17,19.5 17,16.5" fill="#C9A012" />
        {/* 右侧面下块 */}
        <polygon points="22.5,17 22.5,21 16,24.5 17,20.5" fill="#C9A012" />
      </svg>
    );
  }
  return (
    <div className="w-[28px] h-[28px] rounded-full bg-white/10 flex items-center justify-center text-[13px] font-bold text-white uppercase">
      {symbol[0]}
    </div>
  );
};

/**
 * PriceTicker：显示一个小币种的价格标签。
 * 价格涨了会闪一下绿，跌了会闪一下红。
 */
const PriceTicker = ({ symbol, price, change, up }: { symbol: string, price: string, change: string, up: boolean }) => {
  const [flashColor, setFlashColor] = useState<'text-trade-up' | 'text-trade-down' | null>(null);
  const prevPriceRef = useRef(price);

  useEffect(() => {
    // 检查价格是不是变了
    if (price !== prevPriceRef.current) {
      const numPrice = parseFloat(price.replace(/,/g, ''));
      const prevNumPrice = parseFloat(prevPriceRef.current.replace(/,/g, ''));

      if (numPrice > prevNumPrice) {
        setFlashColor('text-trade-up'); // 涨了变绿
      } else if (numPrice < prevNumPrice) {
        setFlashColor('text-trade-down'); // 跌了变红
      }

      prevPriceRef.current = price;

      // 0.2秒后把颜色变回去
      const timer = setTimeout(() => {
        setFlashColor(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [price]);

  const noDecimalSymbols = ['BTC', 'ETH', 'BNB', 'SOL'];
  const rawPrice = price.startsWith('$') ? price.slice(1) : price;
  const displayPrice = noDecimalSymbols.some(s => symbol.includes(s))
    ? rawPrice.replace(/\.\d+$/, '')
    : rawPrice;
  const formattedPrice = `$${displayPrice}`;

  return (
    <div className="flex items-center gap-0.5 px-2 h-[36px] bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[#4D7CFF]/40 hover:shadow-[0_0_10px_rgba(77,124,255,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] rounded-[8px] cursor-pointer shrink-0">
      <TokenIcon symbol={symbol} />
      <span className={cn(
        "text-[16px] font-bold font-mono tnum transition-colors duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] ml-1.5",
        flashColor ? flashColor : (up ? "text-trade-up" : "text-trade-down")
      )}>{formattedPrice}</span>
    </div>
  );
};

const DigitalClock = () => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center justify-center px-2.5 h-[40px] bg-white/5 hover:bg-white/10 transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] rounded-[8px] text-slate-200">
      {(() => {
        const t = time.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const i = t.lastIndexOf(' ');
        return (
          <>
            <span className="text-[18px] font-mono font-bold tnum tracking-wide mt-px text-slate-200">{t.slice(0, i)}</span>
            <span className="text-[11px] font-bold font-mono tnum text-text-muted ml-0.5 mt-px">{t.slice(i + 1)}</span>
          </>
        );
      })()}
    </div>
  );
};

/**
 * MarginMonitor：保证金监控条。
 * 像个小仪表盘，显示你账户里的风险情况。
 */
const MarginMonitor = ({ rate }: { rate: number }) => {
  const [displayRate, setDisplayRate] = useState(rate);
  const rafRef = useRef<number | null>(null);
  // 用 ref 读取最新的 displayRate，避免把它加入 effect 依赖导致每帧重建 effect
  const displayRateRef = useRef(displayRate);
  displayRateRef.current = displayRate;

  useEffect(() => {
    // 用 requestAnimationFrame 驱动动画，帧间执行不阻塞渲染管线
    const animate = () => {
      const current = displayRateRef.current;
      const diff = rate - current;
      if (Math.abs(diff) < 0.01) {
        // 差值极小时直接 snap 到目标值并停止
        if (current !== rate) setDisplayRate(rate);
        return;
      }
      setDisplayRate(prev => Math.abs(diff) < 0.05 ? rate : prev + diff * 0.15);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [rate]); // 只依赖外部 rate；displayRate 通过 ref 读取，不触发 effect 重建

  const imRate = Math.min(displayRate * 2.5, 100);

  return (
    <div className="hidden md:flex items-center h-[40px] bg-white/5 border border-white/10 rounded-[8px] pl-2.5 pr-0.5 py-0.5 gap-3">
      <div className="flex flex-col justify-center gap-1 mt-px">
        {/* IM 进度条 */}
        <div className="flex items-center gap-1.5 text-[13px] leading-none">
          <span className="font-bold text-slate-100 w-[18px] text-right">IM</span>
          <div className="w-14 h-[8px] bg-white/10 rounded-full overflow-hidden relative">
            <motion.div
              style={{ width: `${imRate}%` }}
              className="h-full bg-[#4D7CFF] rounded-full"
            />
          </div>
          <span className="font-mono tnum font-bold text-slate-100 w-[28px] text-right">{imRate.toFixed(0)}%</span>
        </div>
        {/* MM 进度条 */}
        <div className="flex items-center gap-1.5 text-[13px] leading-none">
          <span className="font-bold text-slate-100 w-[18px] text-right">MM</span>
          <div className="w-14 h-[8px] bg-white/10 rounded-full overflow-hidden relative">
            <motion.div
              style={{ width: `${displayRate}%` }}
              className={cn(
                "h-full rounded-full relative overflow-hidden",
                displayRate > 80 ? "bg-trade-down" : displayRate > 50 ? "bg-[#F59E0B]" : "bg-trade-up"
              )}
            >
              <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            </motion.div>
          </div>
          <span className="font-mono tnum font-bold text-slate-100 w-[28px] text-right">{displayRate.toFixed(0)}%</span>
        </div>
      </div>

      <div className="h-full flex items-center justify-center px-3 bg-white/5 hover:bg-white/10 transition-colors rounded-[6px] border border-white/10 cursor-pointer">
        <span className="text-[14px] font-bold tracking-wide">
          <span className="text-brand-blue">S:</span> <span className="text-slate-100 ml-0.5">SM</span>
        </span>
      </div>
    </div>
  );
};

const NineDots = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="5" cy="5" r="2.2" />
    <circle cx="12" cy="5" r="2.2" />
    <circle cx="19" cy="5" r="2.2" />
    <circle cx="5" cy="12" r="2.2" />
    <circle cx="12" cy="12" r="2.2" />
    <circle cx="19" cy="12" r="2.2" />
    <circle cx="5" cy="19" r="2.2" />
    <circle cx="12" cy="19" r="2.2" />
    <circle cx="19" cy="19" r="2.2" />
  </svg>
);

const AppNavigationDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isAssets = location.pathname === '/assets';
  const isMonitor = location.pathname === '/monitor';

  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 120);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative flex items-center gap-4" ref={containerRef}>
      <div
        onMouseEnter={() => { cancelClose(); setIsOpen(true); }}
        onMouseLeave={scheduleClose}
        className="relative"
      >
        <button
          className={cn(
            "flex items-center justify-center w-[30px] h-[30px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            isOpen ? "bg-white/15 text-slate-100" : "bg-transparent text-slate-100/80 hover:bg-white/10"
          )}
        >
          <NineDots size={24} />
        </button>

        <HoverPopover open={isOpen} panelZ={60} panelClassName="absolute top-full left-0 mt-2 overflow-hidden" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <div className="w-[220px] p-2">
            <div className="flex flex-col gap-0.5">
              {([
                { label: '监控', icon: Activity, to: '/monitor' },
                { label: '交易日志', icon: History, to: '/trade-log' },
                { label: '账户概览', icon: Wallet, to: '/assets' },
                { label: '头寸压力测试', icon: Calculator, to: '/position-builder' },
              ]).map((it) => {
                const Icon = it.icon;
                const disabled = !it.to;
                return (
                  <button
                    key={it.label}
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!it.to) return;
                      navigate(it.to);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 px-3 h-11 rounded-[12px] text-left transition-colors",
                      disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/[0.06]"
                    )}
                  >
                    <Icon size={16} className="text-white/55 shrink-0" />
                    <span className="text-[13px] font-semibold text-white/80">{it.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </HoverPopover>
      </div>

      <div
        className={cn(
          "flex items-center justify-center w-[30px] h-[30px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          isAssets ? "bg-white/15 text-slate-100" : "bg-transparent text-slate-100/80 hover:bg-white/10"
        )}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-[24px] h-[24px] mb-px">
          <path d="M11.47 3.84a.75.75 0 011.06 0l8.99 8.99a.75.75 0 11-1.06 1.06L20 13.43V20.25A1.75 1.75 0 0118.25 22H15.5a.75.75 0 01-.75-.75v-3.5a.75.75 0 00-.75-.75h-4a.75.75 0 00-.75.75v3.5a.75.75 0 01-.75.75H5.75A1.75 1.75 0 014 20.25v-6.82l-.46.46a.75.75 0 11-1.06-1.06l8.99-8.99z" />
        </svg>
      </div>

      <button
        onClick={() => navigate('/monitor')}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] text-[13px] font-bold outline-none focus:outline-none",
          isMonitor ? "bg-white/15 text-slate-100" : "bg-transparent text-slate-100/80 hover:bg-white/10"
        )}>
        监控
      </button>
      <OptionsDropdown />
    </div>
  );
};

const LINEAR_COINS_BASE = [
  { base: 'AVAX', color: '#E84142' },
  { base: 'BTC', color: '#F7931A' },
  { base: 'ETH', color: '#627EEA' },
  { base: 'SOL', color: '#9945FF' },
  { base: 'TRX', color: '#EF0027' },
  { base: 'XRP', color: '#346AA9' },
];

// ── OptionsDropdown animation variants ───────────────────────────────────────

const DROP_SPRING = { type: 'spring' as const, stiffness: 260, damping: 25 };

const dropPanelVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { ...DROP_SPRING, staggerChildren: 0.045, delayChildren: 0.04 },
  },
  exit: { opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.13, ease: 'easeIn' } },
};

const dropSectionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: DROP_SPRING },
};

const dropColsVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const dropColVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: DROP_SPRING },
};

const dropRowsVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.018 } },
};

const dropRowVariants = {
  hidden: { opacity: 0, x: -5 },
  visible: { opacity: 1, x: 0, transition: { ...DROP_SPRING, stiffness: 320, damping: 28 } },
};

const OptionsDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [linearSettlement] = useState<'USDC'>('USDC');
  const [expiries, setExpiries] = useState<Record<string, string[]>>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isOptions = location.pathname === '/options';

  // Fetch live expiries from Deribit
  useEffect(() => {
    const fetchExpiries = async (base: string) => {
      try {
        const res = await fetch(
          `https://www.deribit.com/api/v2/public/get_instruments?currency=${base}&kind=option&expired=false`
        );
        const json = await res.json();
        if (json?.result) {
          const expSet = new Set<string>();
          for (const inst of json.result) {
            const name = inst.instrument_name;
            const parts = name.split('-');
            if (parts.length >= 3) {
              const rawExpiry = parts[1];
              const formatted = rawExpiry.replace(/(\d+)([A-Z]{3})(\d{2})/, '$1 $2 $3');
              expSet.add(formatted);
            }
          }
          const sorted = [...expSet].sort((a, b) => {
            const parseDate = (s: string) => {
              const [d, m, y] = s.split(' ');
              const months: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
              return new Date(2000 + parseInt(y), months[m] ?? 0, parseInt(d)).getTime();
            };
            return parseDate(a) - parseDate(b);
          });
          setExpiries(prev => ({ ...prev, [base]: sorted }));
        }
      } catch {
        // ignore
      }
    };
    for (const coin of LINEAR_COINS_BASE) {
      fetchExpiries(coin.base);
    }
  }, []);

  const openPanel = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 6, left: r.left });
    }
    setIsOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 120);
  };
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  return (
    <div className="relative">
      {/* ── Trigger button ── */}
      <button
        ref={buttonRef}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        className={cn(
          "flex items-center justify-center gap-1 px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] text-[13px] font-bold outline-none focus:outline-none",
          isOptions || isOpen
            ? "bg-white/15 text-slate-100"
            : "bg-transparent text-slate-100/80 hover:bg-white/10"
        )}>
        期权
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ ...DROP_SPRING, stiffness: 320 }}
          style={{ display: 'flex' }}
        >
          <ChevronDown size={12} />
        </motion.span>
      </button>

      {/* ── Dropdown panel (fixed, floats above layout) ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={dropPanelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="popup-card options-popup flex overflow-hidden"
            style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999, transformOrigin: 'top left' }}
          >

            {/* ── Inverse Options ── */}
            <motion.div
              variants={dropSectionVariants}
              className="border-r border-[#1E1E28]"
              style={{ width: 280, flexShrink: 0 }}
            >
              <div className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-[#1E1E28] flex items-center gap-2">
                Inverse Options
              </div>

              <motion.div variants={dropColsVariants} className="flex">
                {/* BTC column */}
                <motion.div variants={dropColVariants} className="flex-1 border-r border-[#1E1E28]">
                  <motion.button
                    onClick={() => setIsOpen(false)}
                    whileHover={{ backgroundColor: '#1E1E28', transition: { duration: 0.1 } }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-[#1A1A22]"
                  >
                    <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-amber-400">₿</span>
                    </div>
                    <div className="text-left">
                      <div className="text-[15px] font-bold text-slate-100">BTC</div>
                      <div className="text-[12px] text-slate-600">DVOL 58.4</div>
                    </div>
                  </motion.button>
                  <motion.div variants={dropRowsVariants} className="flex flex-col py-1">
                    {(expiries['BTC'] ?? []).map(exp => (
                      <motion.button
                        key={`btc-${exp}`}
                        variants={dropRowVariants}
                        whileHover={{ backgroundColor: '#1E1E28', color: '#f1f5f9', transition: { duration: 0.1 } }}
                        onClick={() => { setIsOpen(false); navigate(`/options-chain?coin=BTC-USD&expiry=${encodeURIComponent(exp)}`); }}
                        className="px-4 py-1.5 text-[14px] font-bold text-slate-400 text-center flex items-center justify-center"
                      >
                        {exp}
                      </motion.button>
                    ))}
                    <motion.button
                      variants={dropRowVariants}
                      whileHover={{ backgroundColor: '#252530', color: '#e2e8f0', transition: { duration: 0.1 } }}
                      onClick={() => setIsOpen(false)}
                      className="mx-3 my-2 flex items-center justify-center gap-1.5 py-1.5 rounded-[6px] bg-white/5 text-[11px] font-bold text-slate-300"
                    >
                      <span className="text-amber-500/60">₿</span> 组合
                    </motion.button>
                  </motion.div>
                </motion.div>

                {/* ETH column */}
                <motion.div variants={dropColVariants} className="flex-1">
                  <motion.button
                    onClick={() => setIsOpen(false)}
                    whileHover={{ backgroundColor: '#1E1E28', transition: { duration: 0.1 } }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-[#1A1A22]"
                  >
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-blue-400">Ξ</span>
                    </div>
                    <div className="text-left">
                      <div className="text-[15px] font-bold text-slate-100">ETH</div>
                      <div className="text-[12px] text-slate-600">DVOL 68.2</div>
                    </div>
                  </motion.button>
                  <motion.div variants={dropRowsVariants} className="flex flex-col py-1">
                    {(expiries['ETH'] ?? []).map(exp => (
                      <motion.button
                        key={`eth-${exp}`}
                        variants={dropRowVariants}
                        whileHover={{ backgroundColor: '#1E1E28', color: '#f1f5f9', transition: { duration: 0.1 } }}
                        onClick={() => { setIsOpen(false); navigate(`/options-chain?coin=ETH-USD&expiry=${encodeURIComponent(exp)}`); }}
                        className="px-4 py-1.5 text-[14px] font-bold text-slate-400 text-center flex items-center justify-center"
                      >
                        {exp}
                      </motion.button>
                    ))}
                    <motion.button
                      variants={dropRowVariants}
                      whileHover={{ backgroundColor: '#252530', color: '#e2e8f0', transition: { duration: 0.1 } }}
                      onClick={() => setIsOpen(false)}
                      className="mx-3 my-2 flex items-center justify-center gap-1.5 py-1.5 rounded-[6px] bg-white/5 text-[11px] font-bold text-slate-300"
                    >
                      <span className="text-blue-400/60">Ξ</span> 组合
                    </motion.button>
                  </motion.div>
                </motion.div>
              </motion.div>
            </motion.div>

            {/* ── Linear Options ── */}
            <motion.div variants={dropSectionVariants} style={{ width: 660, flexShrink: 0 }}>
              <div className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-[#1E1E28] flex items-center gap-2">
                Linear Options
              </div>

              {/* Coin columns — re-animate on settlement change */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={linearSettlement}
                  variants={dropColsVariants}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  className="flex"
                >
                  {LINEAR_COINS_BASE.map((coin, ci) => {
                    const label = `${coin.base}-${linearSettlement}`;
                    return (
                      <motion.div
                        key={label}
                        variants={dropColVariants}
                        className={cn('flex-1', ci < LINEAR_COINS_BASE.length - 1 && 'border-r border-[#1E1E28]')}
                      >
                        <motion.button
                          onClick={() => setIsOpen(false)}
                          whileHover={{ backgroundColor: '#1E1E28', transition: { duration: 0.1 } }}
                          className="w-full flex items-center justify-center gap-1.5 px-2 py-2.5 border-b border-[#1A1A22]"
                        >
                          <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: coin.color + '33', border: `1px solid ${coin.color}66` }}>
                            <div className="w-full h-full rounded-full" style={{ backgroundColor: coin.color, opacity: 0.7 }} />
                          </div>
                          <span className="text-[11px] font-bold text-slate-300 whitespace-nowrap">{label}</span>
                        </motion.button>

                        <motion.div variants={dropRowsVariants} className="flex flex-col py-1">
                          {(expiries[coin.base] ?? []).map(exp => (
                            <motion.button
                              key={`${label}-${exp}`}
                              variants={dropRowVariants}
                              whileHover={{ backgroundColor: '#1E1E28', color: '#f1f5f9', transition: { duration: 0.1 } }}
                              onClick={() => { setIsOpen(false); navigate(`/options-chain?coin=${coin.base}-${linearSettlement}&expiry=${encodeURIComponent(exp)}`); }}
                              className="px-3 py-1.5 text-[14px] font-bold text-slate-400 text-center flex items-center justify-center"
                            >
                              {exp}
                            </motion.button>
                          ))}
                          <motion.button
                            variants={dropRowVariants}
                            whileHover={{ backgroundColor: '#252530', color: '#e2e8f0', transition: { duration: 0.1 } }}
                            onClick={() => setIsOpen(false)}
                            className="mx-2 my-2 flex items-center justify-center gap-1 py-1.5 rounded-[6px] bg-white/5 text-[11px] font-bold text-slate-300"
                          >
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: coin.color, opacity: 0.6 }} />
                            组合
                          </motion.button>
                        </motion.div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </motion.div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * TickerBar：自包含的行情条，内部持有 WS hook。
 * 放在 App 外部，避免每次 ticker 推送导致整个 App 重渲染。
 */
const TickerBar = () => {
  const liveTickers = useBinanceTickers();
  const widgets = useWorkspaceStore(state => state.widgets);
  return <DynamicTickerContainer tickers={liveTickers} widgets={widgets} />;
};

const DynamicTickerContainer = ({ tickers, widgets }: { tickers: any[], widgets: Record<string, boolean | undefined> }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const enabledTickers = tickers.filter(t => widgets[t.symbol] !== false);
  const disabledTickers = tickers.filter(t => widgets[t.symbol] === false);
  const [visibleCount, setVisibleCount] = useState(enabledTickers.length);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const updateCount = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const dropDownButtonWidth = 42; // button + gap
      const itemWidth = 145; // average ticker width + gap

      let maxTickers = Math.floor(containerWidth / itemWidth);
      // Reserve space for the dropdown button if there will be hidden tickers
      // (either due to overflow OR due to being toggled off in widget settings).
      if (maxTickers < enabledTickers.length || disabledTickers.length > 0) {
        maxTickers = Math.floor((containerWidth - dropDownButtonWidth) / itemWidth);
      }

      setVisibleCount(Math.max(0, Math.min(enabledTickers.length, maxTickers)));
    };

    const observer = new ResizeObserver(() => requestAnimationFrame(updateCount));
    if (containerRef.current) observer.observe(containerRef.current);

    updateCount();
    return () => observer.disconnect();
  }, [enabledTickers.length, disabledTickers.length]);

  // When elements overflow, we hide the "oldest" ones on the left.
  const overflowCount = Math.max(0, enabledTickers.length - visibleCount);
  const overflowTickers = enabledTickers.slice(0, overflowCount);
  const visibleTickers = enabledTickers.slice(overflowCount);
  // Tickers hidden because they overflow OR because the user toggled them off.
  const hiddenTickers = [...overflowTickers, ...disabledTickers];

  return (
    <div className="flex items-center w-full h-full justify-end gap-1.5 min-w-0" ref={containerRef}>
      {/* Dropdown at the far left if we have any hidden tickers */}
      {hiddenTickers.length > 0 && (
        <div
          className="relative flex items-center shrink-0"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          <button
            className={cn(
              "flex items-center justify-center w-[40px] h-[36px] rounded-[8px] bg-transparent border border-border-subtle text-slate-400 transition-all cursor-pointer relative z-10",
              isOpen ? "bg-surface-2 text-slate-200" : "hover:bg-surface-2 hover:border-border-strong hover:text-slate-200"
            )}
          >
            <ChevronDown size={20} strokeWidth={3} className={cn("transition-transform duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] text-slate-100", isOpen ? "rotate-180" : "rotate-0")} />
          </button>

          <HoverPopover
            open={isOpen}
            panelZ={60}
            panelClassName="absolute top-full left-0 mt-2 min-w-[150px]"
          >
            <div className="p-1.5 flex flex-col gap-1 w-full">
              {hiddenTickers.map(ticker => (
                <PriceTicker key={ticker.symbol} {...ticker} />
              ))}
            </div>
          </HoverPopover>
        </div>
      )}

      {/* Visible tickers on the right */}
      {visibleTickers.map(ticker => (
        <PriceTicker key={ticker.symbol} {...ticker} />
      ))}
    </div>
  );
};

const WidgetToggle: React.FC<{ label: string, checked: boolean, onChange: () => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between px-2 py-2 hover:bg-surface-3 rounded-[4px] cursor-pointer group transition-colors">

    <span className="text-xs text-[#848E9C] group-hover:text-slate-200 transition-colors">{label}</span>
    <input type="checkbox" checked={checked} onChange={onChange} className="hidden" />
    <div className={cn("w-7 h-4 rounded-full relative transition-colors duration-200", checked ? "bg-[#4D7CFF]" : "bg-white/10")}>
      <div className={cn("absolute top-0.5 left-0.5 w-3 h-3 rounded-full transition-transform duration-200 shadow-sm", checked ? "translate-x-3 bg-white" : "translate-x-0 bg-slate-400")} />
    </div>
  </label>
);

const TopBarSettingsDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widgets = useWorkspaceStore(state => state.widgets);
  const toggleWidget = useWorkspaceStore(state => state.toggleWidget);

  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 120);
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); setIsOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button className={cn("flex items-center justify-center w-[32px] h-[32px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] outline-none focus:outline-none", isOpen ? "bg-white/15 text-slate-100" : "bg-transparent text-slate-100/80 hover:bg-white/10")}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-[26px] h-[26px]">
          <path fillRule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z" clipRule="evenodd" />
        </svg>
      </button>
      <HoverPopover
        open={isOpen}
        panelZ={60}
        panelClassName="absolute top-full right-0 mt-2 w-48"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="p-2 flex flex-col gap-1">
          <div className="px-2 py-1 text-[11px] font-bold text-white/55 tracking-wider uppercase">行情组件 (Tickers)</div>
          <div className="h-px w-full bg-white/10 my-1" />
          <div className="flex flex-col gap-0.5">
            {MARKET_TICKERS.map(t => (
              <WidgetToggle
                key={t.symbol}
                label={t.symbol.replace('USDT', '')}
                checked={widgets[t.symbol] ?? true}
                onChange={() => toggleWidget(t.symbol)}
              />
            ))}
            <div className="h-px w-full bg-white/10 my-1" />
            <div className="px-2 py-1 text-[11px] font-bold text-white/55 tracking-wider uppercase">其它 (Others)</div>
            <WidgetToggle label="保证金" checked={widgets.margin} onChange={() => toggleWidget('margin')} />
            <WidgetToggle label="平台时间" checked={widgets.time} onChange={() => toggleWidget('time')} />
          </div>
        </div>
      </HoverPopover>
    </div>
  );
};

const NotificationDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 120);
  };
  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); setIsOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button className={cn("flex items-center justify-center w-[32px] h-[32px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] outline-none focus:outline-none", isOpen ? "bg-white/15 text-slate-100" : "bg-transparent text-slate-100/80 hover:bg-white/10")}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-[26px] h-[26px]">
          <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
        </svg>
      </button>
      <HoverPopover
        open={isOpen}
        panelZ={60}
        panelClassName="absolute top-full right-0 mt-2 w-64"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="p-2 flex flex-col gap-1">
          <div className="px-2 py-1 text-[11px] font-bold text-white/55 tracking-wider uppercase">通知中心</div>
          <div className="h-px w-full bg-white/10 my-1" />
          <div className="px-2 py-3 text-sm text-white/45 text-center">暂无新通知</div>
        </div>
      </HoverPopover>
    </div>
  );
};

const UserDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 120);
  };
  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); setIsOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <div className={cn("flex items-center justify-center w-[32px] h-[32px] rounded-[8px] cursor-pointer transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] outline-none focus:outline-none", isOpen ? "bg-white/15" : "bg-transparent hover:bg-white/10")}>
        <div className="w-7 h-7 rounded-[5px] overflow-hidden">
          <img
            src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
            alt="Avatar"
            className="w-full h-full object-cover"
          />
        </div>
      </div>
      <HoverPopover
        open={isOpen}
        panelZ={60}
        panelClassName="absolute top-full right-0 mt-2 w-48 overflow-hidden"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="px-3 py-2.5 flex flex-col" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <span className="text-sm font-bold text-white/90">User</span>
          <span className="text-xs text-white/45">user@nexus.com</span>
        </div>
        <div className="h-px w-full bg-white/10" />
        <div className="flex flex-col p-1.5 gap-0.5">
          <button
            onClick={() => { navigate('/assets'); setIsOpen(false); }}
            className="flex items-center gap-2.5 px-2.5 py-2 hover:bg-white/[0.06] rounded-[8px] cursor-pointer group transition-colors w-full text-left"
          >
            <Wallet size={15} className="text-white/55 group-hover:text-white transition-colors shrink-0" />
            <span className="text-sm text-white/75 group-hover:text-white transition-colors">账户</span>
          </button>
          <button className="flex items-center gap-2.5 px-2.5 py-2 hover:bg-white/[0.06] rounded-[8px] cursor-pointer group transition-colors w-full text-left">
            <Settings size={15} className="text-white/55 group-hover:text-white transition-colors shrink-0" />
            <span className="text-sm text-white/75 group-hover:text-white transition-colors">设置</span>
          </button>
        </div>
      </HoverPopover>
    </div>
  );
};



type FooterTabProps = {
  tab: { id: string, label: string },
  isActive: boolean,
  onClick: () => void,
  onEdit: (newLabel: string) => void,
  onClone: () => void,
  onDelete: () => void
};

const FooterTab: React.FC<FooterTabProps> = React.memo(({
  tab,
  isActive,
  onClick,
  onEdit,
  onClone,
  onDelete
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsMenuOpen(false), 120);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEditSave = () => {
    setIsEditing(false);
    if (editValue.trim() !== '' && editValue !== tab.label) {
      onEdit(editValue.trim());
    } else {
      setEditValue(tab.label); // Revert on empty
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(tab.label);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(); // Make sure it becomes active
    setIsMenuOpen(true);
  };

  return (
    <div
      className="relative h-full flex"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); scheduleClose(); }}
      onContextMenu={handleContextMenu}
    >
      {/* 
        This wrapper is needed to avoid overflow:hidden clipping the menu popup,
        we apply overflow:hidden only to the button background/slide area. 
      */}
      <div
        className={cn(
          "relative h-full rounded-[8px] overflow-hidden flex items-center transition-colors",
          isActive ? "bg-white/10 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
        )}
      >
        {/* Main Tab Button */}
        <button
          onClick={onClick}
          className="flex items-center px-4 h-full text-[13px] font-bold z-0 relative min-w-[60px]"
        >
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleEditSave}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="bg-transparent text-white outline-none w-[60px] relative z-20"
            />
          ) : (
            tab.label
          )}
        </button>

        {/* Sliding Chevron — slides in from the right, overlays the tab's right portion */}
        <button
          onClick={handleChevronClick}
          className={cn(
            "absolute top-1 bottom-1 right-1 bg-[#E2E8F0] hover:bg-[#D1D5DB] text-[#111827] flex items-center justify-center transition-transform duration-200 ease-out z-30 outline-none rounded-[6px] w-7 cursor-pointer",
            (isActive && (isHovered || isMenuOpen)) ? "translate-x-0" : "translate-x-[calc(100%+0.5rem)] pointer-events-none"
          )}
        >
          {isMenuOpen ? <ChevronUp size={18} strokeWidth={2} /> : <ChevronDown size={18} strokeWidth={2} />}
        </button>
      </div>

      {/* Dropdown Menu */}
      <Popover
        open={!!(isMenuOpen && isActive)}
        onClose={() => setIsMenuOpen(false)}
        backdropZ={90}
        panelZ={91}
        panelClassName="absolute bottom-full mb-2 left-0 min-w-[124px] p-1 after:absolute after:-bottom-2 after:left-0 after:w-full after:h-2"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <button className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-bold text-slate-200 hover:bg-surface-5 rounded-[4px] transition-colors text-left" onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); setIsEditing(true); }}>
          <Edit2 size={14} strokeWidth={2} />
          编辑标签
        </button>
        <button className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-bold text-slate-200 hover:bg-surface-5 rounded-[4px] transition-colors text-left" onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); onClone(); }}>
          <Copy size={14} strokeWidth={2} />
          复制选项卡
        </button>
        <button className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-bold text-[#F05252] hover:bg-surface-5 rounded-[4px] transition-colors text-left mt-0.5" onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); onDelete(); }}>
          <Trash2 size={14} strokeWidth={2} />
          删除选项卡
        </button>
      </Popover>
    </div>
  );
});

FooterTab.displayName = 'FooterTab';

const AddTabModal = ({
  isOpen,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (isOpen) setName('');
  }, [isOpen]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      zIndex={100}
      className="w-full max-w-[360px] border border-white/10"
    >
      <motion.div
        layoutId="addTabModalBackground"
        className="p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, delay: 0.08 }}
      >
        <h2 className="text-white text-lg font-bold mb-6">添加自定义标签</h2>
        <div className="mb-8">
          <label className="block text-white/55 text-[13px] mb-2 font-bold">标签名</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onSave(name.trim()); } }}
            className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 focus:border-white/25 focus:outline-none text-white px-3.5 py-2.5 rounded-[8px] transition-colors text-[14px]"
            placeholder="输入标签名称..."
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose}
            className="px-5 py-2 rounded-[8px] border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors text-[13px] font-bold">
            取消
          </button>
          <button
            onClick={() => { if (name.trim()) { onSave(name.trim()); } }}
            className="px-5 py-2 rounded-[8px] bg-[#007bff] hover:bg-[#0056b3] text-white transition-colors text-[13px] font-bold">
            保存
          </button>
        </div>
      </motion.div>
    </Modal>
  );
};


/**
 * WorkspaceFooterTabs：底部标签栏（左侧区域）
 * 独立持有 pages/activePageId 订阅，避免 setActivePage 触发 App 整树重渲染。
 */
const WorkspaceFooterTabs = () => {
  const navigate = useNavigate();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const pages        = useWorkspaceStore(state => state.pages);
  const activePageId = useWorkspaceStore(state => state.activePageId);
  const addPage      = useWorkspaceStore(state => state.addPage);
  const removePage   = useWorkspaceStore(state => state.removePage);
  const setActivePage = useWorkspaceStore(state => state.setActivePage);
  const renamePage   = useWorkspaceStore(state => state.renamePage);
  const clonePage    = useWorkspaceStore(state => state.clonePage);

  // stateRef: 让 memoized 回调在调用时读到最新值，避免 stale closure
  // 注意：只在调用时读取（call-site），不在创建时捕获
  const stateRef = useRef({ pages, activePageId, removePage, setActivePage, renamePage, clonePage, navigate });
  stateRef.current = { pages, activePageId, removePage, setActivePage, renamePage, clonePage, navigate };

  // 按 pageId 缓存回调 — 只在 pages 引用变化时重新生成
  // setActivePage 是 Zustand 稳定引用，pages 在 setActivePage 时不变引用 → 每次切 tab 时这批回调 identity 不变
  const pageCallbacks = useMemo(() => {
    const map = new Map<string, {
      onClick: () => void;
      onEdit: (label: string) => void;
      onClone: () => void;
      onDelete: () => void;
    }>();
    for (const page of pages) {
      const pid = page.id;
      const routePath = page.routePath;
      map.set(pid, {
        onClick: () => {
          const { setActivePage, navigate } = stateRef.current;
          if (routePath) { navigate(routePath); setActivePage(pid); }
          else { setActivePage(pid); if (window.location.pathname !== '/') navigate('/'); }
        },
        onEdit: (newLabel: string) => stateRef.current.renamePage(pid, newLabel),
        onClone: () => stateRef.current.clonePage(pid),
        onDelete: () => {
          const { pages, activePageId, removePage, setActivePage, navigate } = stateRef.current;
          const remaining = pages.filter(p => p.id !== pid);
          removePage(pid);
          if (activePageId === pid) {
            const next = remaining[0];
            if (next) {
              if (next.routePath) navigate(next.routePath);
              else { setActivePage(next.id); navigate('/'); }
            }
          }
        },
      });
    }
    return map;
  }, [pages]); // pages 在 setActivePage 时不会变引用 → 切 tab 时此 memo 命中缓存

  const activeTab = window.location.pathname !== '/'
    ? (pages.find(p => p.routePath === window.location.pathname)?.id ?? '')
    : activePageId;

  return (
    <>
      <div className="flex items-center gap-1 h-full py-0.5">
        {pages.map((page) => {
          const cbs = pageCallbacks.get(page.id)!;
          return (
          <FooterTab
            key={page.id}
            tab={{ id: page.id, label: page.label }}
            isActive={activeTab === page.id}
            onClick={cbs.onClick}
            onEdit={cbs.onEdit}
            onClone={cbs.onClone}
            onDelete={cbs.onDelete}
          />
          );
        })}
        {/* "+"按钮：用来添加新标签 */}
        <div className="relative h-full flex items-center group">
          <motion.button
            layoutId="addTabModalBackground"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center w-10 h-full bg-white/[0.08] border border-slate-700/50 text-slate-400 hover:border-white hover:text-white hover:bg-[#2c323f] active:scale-[0.97] transition-colors rounded-[8px] outline-none"
            style={{ pointerEvents: isAddModalOpen ? "none" : "auto" }}
          >
            <motion.div animate={{ opacity: isAddModalOpen ? 0 : 1 }} transition={{ duration: 0.1 }}>
              <Plus size={16} strokeWidth={2} />
            </motion.div>
          </motion.button>
          {!isAddModalOpen && (
            <div className="absolute bottom-[calc(100%+12px)] left-1/2 -translate-x-1/2 px-3 py-1.5 text-white text-xs font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
              style={{ background: 'rgba(30, 30, 30, 0.85)', backdropFilter: 'blur(24px) saturate(1.6)', WebkitBackdropFilter: 'blur(24px) saturate(1.6)', boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.15)', borderRadius: '10px' }}
            >
              添加选项卡
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45"
                style={{ background: 'rgba(30, 30, 30, 0.85)' }}
              />
            </div>
          )}
        </div>
      </div>
      <AddTabModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={(name) => {
          addPage(name);
          setIsAddModalOpen(false);
          navigate('/');
        }}
      />
    </>
  );
};

/**
 * App：这是整个网页的主管。
 */
export default function App() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      document.documentElement.classList.add('is-scrolling');
      clearTimeout(timer);
      timer = setTimeout(() => document.documentElement.classList.remove('is-scrolling'), 800);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('scroll', onScroll, true); clearTimeout(timer); };
  }, []);

  const activePageId = useWorkspaceStore(state => state.activePageId);
  const addInstance = useWorkspaceStore(state => state.addInstance);
  const widgets = useWorkspaceStore(state => state.widgets);
  const isComponentLibraryOpen = useWorkspaceStore(state => state.isComponentLibraryOpen);
  const componentLibraryPreset = useWorkspaceStore(state => state.componentLibraryPreset);
  const openComponentLibrary = useWorkspaceStore(state => state.openComponentLibrary);
  const closeComponentLibrary = useWorkspaceStore(state => state.closeComponentLibrary);
  const appendOptionsChainTab = useWorkspaceStore(state => state.appendOptionsChainTab);

  const isEditMode = useLayoutStore(state => state.isEditMode);
  const addDraftWidget = useLayoutStore(state => state.addDraftWidget);

  const [marginRate] = useState(12.5);
  const [activeWidgetCategory, setActiveWidgetCategory] = useState('all');
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [hoveredWidgetId, setHoveredWidgetId] = useState<string | null>(null);
  const [widgetConfig, setWidgetConfig] = useState<Record<string, string>>({});
  const [widgetSearchQuery, setWidgetSearchQuery] = useState<string>('');

  // 允许从不同页面打开组件库，并预选组件与配置（例如：期权链页点 +）
  useEffect(() => {
    if (!isComponentLibraryOpen) return;
    if (!componentLibraryPreset) return;
    if (componentLibraryPreset.category) setActiveWidgetCategory(componentLibraryPreset.category);
    if (componentLibraryPreset.widgetId) setSelectedWidgetId(componentLibraryPreset.widgetId);
    if (componentLibraryPreset.initialConfig) setWidgetConfig(componentLibraryPreset.initialConfig);
  }, [isComponentLibraryOpen, componentLibraryPreset]);

  return (
    <div className="flex flex-col h-screen overflow-hidden selection:bg-brand-blue/30 relative z-[1]">
      {/* Top Header — 毛玻璃效果 */}
      {/* 顶部栏需要高层级，否则会被页面内 sticky 标题栏遮挡（如下拉面板/弹出卡片） */}
      <header className="h-[44px] flex items-center px-2 glass-bar glass-bar-shadow shrink-0 relative z-[150]">
        {/* Logo and Nav */}
        <div className="flex items-center gap-6 shrink-0">
          <div className="flex items-center justify-center gap-2 cursor-pointer group">
            <img src="/avatar.png" alt="avatar" className="w-8 h-8 rounded-[6px] object-cover shadow-[0_0_15px_rgba(77,124,255,0.4)]" />
            <span className="font-bold text-sm tracking-tight text-slate-100">
              薇薇看板
            </span>
          </div>

          <AppNavigationDropdown />
        </div>

        {/* Market Tickers */}
        <div className="hidden lg:flex items-center flex-1 min-w-0 pl-4 pr-2 h-full">
          <TickerBar />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Margin Rate Bar */}
          {widgets.margin && <MarginMonitor rate={marginRate} />}

          {/* Clock & Actions */}
          <div className="flex items-center gap-6">
            {widgets.time && <DigitalClock />}
            <div className="flex items-center gap-2">
              <TopBarSettingsDropdown />
              <NotificationDropdown />
              <UserDropdown />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden z-[1]">
        <Suspense fallback={<div className="absolute inset-0 bg-[#0A0A0F]" />}>
        <Routes>
            <Route path="/market" element={
              <div
                className="absolute inset-0 flex p-2 gap-3 overflow-y-auto"
              >
                {/* Left Panel: Charts & Stats */}
                <section className="flex-1 flex flex-col gap-6 min-w-0">
                  {/* Main Chart View */}
                  <div className="flex-1 glass rounded-xl p-6 flex flex-col relative group">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                          BTCUSDT PERP <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] rounded uppercase">Live</span>
                        </h2>
                        <div className="flex items-center gap-1 bg-white/5 rounded-md p-1">
                          {['1M', '5M', '15M', '1H', '4H', '1D'].map(tf => (
                            <button
                              key={tf}
                              className={cn(
                                "px-2 py-0.5 text-[10px] font-bold rounded transition-colors",
                                tf === '15M' ? "bg-brand-blue text-white" : "text-slate-500 hover:text-slate-300"
                              )}
                            >
                              {tf}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="p-1.5 text-slate-400 hover:bg-slate-800 rounded">
                          <Settings size={16} />
                        </button>
                        <button className="p-1.5 text-slate-400 hover:bg-slate-800 rounded">
                          <Menu size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 -ml-8 -mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={CHART_DATA}>
                          <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#4D7CFF" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#4D7CFF" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1F1F27" vertical={false} />
                          <XAxis
                            dataKey="time"
                            hide
                          />
                          <YAxis
                            domain={['auto', 'auto']}
                            orientation="right"
                            stroke="#4B5565"
                            fontSize={10}
                            fontFamily="JetBrains Mono"
                            tickFormatter={(v) => `$${v.toLocaleString()}`}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#131318', border: '1px solid #23232A', borderRadius: '8px' }}
                            itemStyle={{ color: '#F1F5F9', fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                            labelStyle={{ color: '#64748B', marginBottom: '4px', fontSize: '10px' }}
                          />
                          <Area
                            type="monotone"
                            dataKey="price"
                            stroke="#4D7CFF"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorPrice)"
                            animationDuration={1000}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Real-time Order Book Preview (Overlay Right) */}
                    <div className="absolute right-8 top-28 bottom-8 w-44 glass-light rounded-xl p-3 flex flex-col gap-4 invisible xl:visible opacity-0 group-hover:opacity-100 transition-opacity">
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Order Book</h3>
                      <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                        {[...Array(8)].map((_, i) => (
                          <div key={`sell-${i}`} className="flex justify-between text-[11px] tnum font-mono text-rose-400">
                            <span>64,2{(i * 1.5).toFixed(1)}</span>
                            <span className="text-slate-400">0.245</span>
                          </div>
                        ))}
                        <div className="h-px bg-border-subtle my-2" />
                        {[...Array(8)].map((_, i) => (
                          <div key={`buy-${i}`} className="flex justify-between text-[11px] tnum font-mono text-emerald-400">
                            <span>64,1{(9 - i * 1.2).toFixed(1)}</span>
                            <span className="text-slate-400">1.120</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: '昨日总盈亏', value: '$2,450.80', trend: '+12.5%', icon: ArrowUpRight, color: 'text-emerald-400' },
                      { label: '账户总权益', value: '$68,124.20', trend: '+2.1%', icon: Wallet, color: 'text-brand-blue' },
                      { label: '最大回撤', value: '4.2%', trend: '-0.3%', icon: ArrowDownRight, color: 'text-rose-400' },
                      { label: '高胜率因子', value: '62.5%', trend: '+4.2%', icon: TrendingUp, color: 'text-emerald-400' },
                    ].map((stat, i) => (
                      <div
                        key={stat.label}
                        className="bg-white/5 p-4 rounded-xl flex flex-col gap-2 hover:bg-white/10 transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-slate-500">
                          <span className="text-xs font-bold">{stat.label}</span>
                          <stat.icon size={16} className={stat.color} />
                        </div>
                        <div className="flex items-end justify-between">
                          <span className="text-xl font-bold font-mono tracking-tight tnum">{stat.value}</span>
                          <span className={cn("text-[10px] font-mono font-bold tnum", stat.color)}>{stat.trend}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Right Panel: Side Data / Watchlist */}
                <aside className="w-80 hidden lg:flex flex-col gap-6 overflow-hidden shrink-0">
                  <div className="flex-1 glass rounded-xl flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-border-subtle/30 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <Activity size={16} className="text-brand-blue" />
                        自选行情 (WATCHLIST)
                      </h3>
                      <Search size={14} className="text-slate-500 cursor-pointer hover:text-slate-300" />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                      <div className="space-y-1">
                        {MARKET_TICKERS.map((ticker) => (
                          <div key={ticker.symbol} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/30 group transition-all cursor-pointer">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-100">{ticker.symbol}</span>
                              <span className="text-[10px] text-slate-500 uppercase font-mono tracking-tight">Perpetual</span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-xs font-mono font-bold tnum text-slate-100">{ticker.price}</span>
                              <span className={cn("text-[10px] font-mono font-bold tnum", ticker.up ? "text-emerald-400" : "text-rose-400")}>
                                {ticker.change}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Quick Trade Panel (Simplified) */}
                    <div className="p-4 border-t border-border-subtle/30 bg-bg-deep">
                      <div className="grid grid-cols-2 gap-2">
                        <button className="py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[8px] text-xs font-bold transition-all active:scale-95">
                          BUY / LONG
                        </button>
                        <button className="py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-[8px] text-xs font-bold transition-all active:scale-95">
                          SELL / SHORT
                        </button>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            } />

            <Route path="/positions" element={
              <div
                className="absolute inset-0 p-2 overflow-y-auto"
              >
                <div className="glass rounded-xl p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-4 border-b border-border-subtle/30 pb-4">
                    <h3 className="text-sm font-bold text-slate-100">当前持仓与委托 (POSITIONS & ORDERS)</h3>
                    <div className="flex items-center gap-6 text-xs font-bold">
                      <span className="text-slate-400">总持仓价值: <span className="text-slate-100 font-mono tnum">$124,500.20</span></span>
                      <span className="text-slate-400">未实现损益: <span className="text-emerald-400 font-mono tnum">+$1,290.74</span></span>
                    </div>
                  </div>
                  <div className="pr-2">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-white/5 z-10 before:absolute before:inset-0 before:border-b before:border-white/10 before:pointer-events-none">
                        <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                          <th className="py-3 px-2">合约</th>
                          <th className="py-3 px-2">仓位 / 杠杆</th>
                          <th className="py-3 px-2">入口价格</th>
                          <th className="py-3 px-2">标记价格</th>
                          <th className="py-3 px-2">未实现损益 (P&L)</th>
                          <th className="py-3 px-2 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs">
                        {POSITION_DATA.map((pos) => (
                          <tr key={pos.symbol} className="border-b border-white/10 hover:bg-white/5 transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]">
                            <td className="py-4 px-2 font-bold text-slate-100">{pos.symbol}</td>
                            <td className="py-4 px-2">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold",
                                  pos.type === 'Long' ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                                )}>
                                  {pos.type}
                                </span>
                                <span className="font-mono tnum text-slate-300">{pos.qty}</span>
                                <span className="text-[10px] text-slate-500 font-bold">{pos.leverage}</span>
                              </div>
                            </td>
                            <td className="py-4 px-2 font-mono tnum text-slate-400">{pos.entry}</td>
                            <td className="py-4 px-2 font-mono tnum text-slate-100">{pos.mark}</td>
                            <td className="py-4 px-2">
                              <div className="flex flex-col">
                                <span className={cn("font-mono font-bold tnum", pos.pnl.startsWith('+') ? "text-emerald-400" : "text-rose-400")}>
                                  {pos.pnl}
                                </span>
                                <span className={cn("text-[10px] font-mono tnum", pos.pnl.startsWith('+') ? "text-emerald-500" : "text-rose-500")}>
                                  ({pos.pnlPct})
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-2 text-right">
                              <button className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-[6px] transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] font-bold">
                                平仓
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            } />

            <Route path="/logs" element={
              <div
                className="absolute inset-0 p-2 overflow-y-auto"
              >
                <div className="glass rounded-xl p-6 flex flex-col">
                  <h3 className="text-sm font-bold text-slate-100 mb-4 border-b border-border-subtle/30 pb-4 uppercase tracking-wider">最近交易日志 (RECENT TRADE LOGS)</h3>
                  <div className="space-y-3 pr-2">
                    {[...Array(12)].map((_, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-bg-deep rounded-lg border border-border-subtle/30 hover:border-border-subtle/80 transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]">
                        <div className="flex items-center gap-4">
                          <div className={cn("w-2 h-2 rounded-full", i % 2 === 0 ? "bg-emerald-500" : "bg-rose-500")} />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-200">{i % 2 === 0 ? 'Buy / Long' : 'Sell / Short'} BTCUSDT</span>
                            <span className="text-[10px] text-slate-500">2024-05-05 14:24:{30 + i}</span>
                          </div>
                        </div>
                        <div className="flex gap-10 items-center font-mono text-xs">
                          <div className="flex flex-col items-end">
                            <span className="text-slate-500 text-[10px]">价格</span>
                            <span className="text-slate-100 tnum font-bold">64,120.5</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-slate-500 text-[10px]">数量</span>
                            <span className="text-slate-100 tnum font-bold">0.024</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-slate-500 text-[10px]">手续费</span>
                            <span className="text-slate-500 tnum">0.0001 BTC</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            } />

            <Route path="/stats" element={
              <div
                className="absolute inset-0 p-2 overflow-auto"
              >
                <div className="glass rounded-xl p-6 h-full">
                  <div className="grid grid-cols-3 gap-8 h-full">
                    <div className="col-span-1 space-y-6 flex flex-col items-center justify-center border-r border-border-subtle/30 pr-8">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest text-center">盈利因子 (PROFIT FACTOR)</h4>
                      <div className="h-40 w-40 mx-auto relative flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="80" cy="80" r="72" stroke="#1F1F27" strokeWidth="12" fill="transparent" />
                          <circle cx="80" cy="80" r="72" stroke="#4D7CFF" strokeWidth="12" fill="transparent" strokeDasharray="452.4" strokeDashoffset="113.1" strokeLinecap="round" />
                        </svg>
                        <span className="absolute font-mono font-bold text-3xl tnum text-slate-100">2.41</span>
                      </div>
                      <p className="text-xs text-center text-slate-400 max-w-[200px] leading-relaxed">近30天平均获利能力出色，盈亏比维持在健康水平。</p>
                    </div>
                    <div className="col-span-2 space-y-6 flex flex-col justify-center pl-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">单周胜率统计 (WIN RATE)</h4>
                      <div className="h-48 flex items-end gap-3 max-w-lg">
                        {[45, 62, 58, 42, 75, 68, 55].map((h, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-3 group">
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: `${h}%` }}
                              transition={{ duration: 0.5, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                              className={cn("w-full rounded-t-sm transition-colors duration-[120ms]", i === 4 ? "bg-brand-blue" : "bg-slate-700/50 group-hover:bg-slate-600")}
                            />
                            <span className="text-[10px] text-slate-500 font-mono font-bold">D{i + 1}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            } />
            <Route path="/trade-log" element={
              <div
                className="absolute inset-0 overflow-hidden"
              >
                <TradeLogPage />
              </div>
            } />
            <Route path="/assets" element={
              <div
                className="absolute inset-0 overflow-hidden"
              >
                <AssetsPage />
              </div>
            } />
            <Route path="/monitor" element={
              <div
                className="absolute inset-0"
              >
                <MonitorPage />
              </div>
            } />
            <Route path="/options-chain" element={
              <div
                className="absolute inset-0 p-1"
                style={{ backgroundColor: '#0A0A0D' }}
              >
                <div className="w-full h-full rounded-[8px] overflow-hidden border border-[rgba(255,255,255,0.06)]">
                  <OptionsChainPage mode="deribit" />
                </div>
              </div>
            } />
            <Route path="/position-builder" element={
              <div
                className="absolute inset-0"
              >
                <PositionBuilderPage />
              </div>
            } />
            <Route path="/" element={<DashboardPage />} />
            <Route path="*" element={<DashboardPage />} />
        </Routes>
        </Suspense>
      </main>

      {/* 底部导航栏和活动条 */}
      <footer className="h-[34px] glass-bar flex items-center justify-between px-1.5 shrink-0 z-10 w-full relative">
        <WorkspaceFooterTabs />

        <div className="flex items-center gap-1.5 h-full py-0.5">
          <motion.button
            layoutId="addWidgetModalBackground"
            onClick={() => openComponentLibrary()}
            className={cn(
              "flex items-center justify-center gap-1.5 px-3 h-full bg-white/[0.08] border border-transparent rounded-[8px] text-[13px] font-bold text-slate-200 transition-colors overflow-hidden",
              !isComponentLibraryOpen && "hover:bg-[#31333F] hover:shadow-[0_0_8px_rgba(255,255,255,0.08)] hover:border-slate-500/40 cursor-pointer"
            )}
            style={{ pointerEvents: isComponentLibraryOpen ? "none" : "auto" }}
          >
            <motion.div
              initial={false}
              animate={{ opacity: isComponentLibraryOpen ? 0 : 1 }}
              transition={{ duration: 0.1 }}
              className="flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus size={14} strokeWidth={2} />
              <span>添加组件</span>
            </motion.div>
          </motion.button>
          <button className="flex items-center justify-center w-8 h-full bg-transparent hover:bg-surface-4 transition-colors rounded-[8px] text-slate-300">
            <Upload size={16} strokeWidth={2} />
          </button>
        </div>
      </footer>

      <AnimatePresence>
        {isComponentLibraryOpen && (
          <Modal
            open={isComponentLibraryOpen}
            onClose={() => closeComponentLibrary()}
            zIndex={220}
            className="relative flex overflow-hidden rounded-[16px]"
            style={{
              background: '#1e1e20',
              border: '1px solid #333335',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
              width: 'calc(100vw - 64px)',
              height: 'calc(100vh - 64px)',
              maxWidth: '1600px',
              maxHeight: '960px',
            }}
          >
            <motion.div
              layoutId="addWidgetModalBackground"
              className="flex w-full h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, delay: 0.08 }}
            >
              {/* Left Sidebar */}
              <div className="w-[180px] flex flex-col shrink-0" style={{ background: '#1e1e20', borderRight: '1px solid #2a2a2c' }}>
                <div className="flex items-center justify-between px-4 pt-5 pb-4">
                  <span className="text-[13px] font-semibold" style={{ color: '#b7b7b9' }}>组件库</span>
                  <button onClick={() => closeComponentLibrary()} className="transition-colors hover:opacity-70" style={{ color: '#727274' }}>
                    <Plus size={16} className="rotate-45" />
                  </button>
                </div>
                <div className="px-3 mb-3">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#4a4a4c' }} />
                    <input type="text" placeholder="搜索组件..." value={widgetSearchQuery}
                      onChange={e => setWidgetSearchQuery(e.target.value)}
                      className="w-full h-[32px] text-[12px] pl-8 pr-2 rounded-[8px] outline-none"
                      style={{ background: '#17161b', border: '1px solid #2b2b2d', color: '#dfdee0' }}
                    />
                  </div>
                </div>
                <div className="flex flex-col px-2 gap-0.5 overflow-y-auto">
                  {([['all','全部'],['options','期权卡面'],['account','账户'],['charts','图表'],['monitor','监控'],['tools','工具']] as [string,string][]).map(([cat, label]) => {
                    const count = Object.values(WIDGET_REGISTRY).filter(w => cat === 'all' || w.category === cat).length;
                    const isActive = activeWidgetCategory === cat;
                    return (
                      <button key={cat} onClick={() => setActiveWidgetCategory(cat as any)}
                        className="flex items-center justify-between px-3 py-2 rounded-[8px] text-[13px] text-left w-full transition-colors"
                        style={{ background: isActive ? '#2f2e33' : 'transparent', color: isActive ? '#dfdee0' : '#727274' }}
                      >
                        <span>{label}</span>
                        {isActive && <span style={{ color: '#6c6b70', fontSize: '12px' }}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Right Content */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: '#171719' }}>
                <div className="px-8 pt-7 pb-5 shrink-0">
                  <h2 className="text-[22px] font-bold mb-1.5" style={{ color: '#eaeaec' }}>选择一个组件放入主页面</h2>
                  <p className="text-[13px]" style={{ color: '#737375' }}>点击卡片即可添加（位置会自动放在页面底部，可拖拽调整）。</p>
                </div>
                {/* CARD_GRID_PLACEHOLDER */}
                <div className="flex-1 overflow-y-auto px-8 pb-6">
                  <div className="grid grid-cols-3 gap-4">
                    {Object.values(WIDGET_REGISTRY)
                      .filter(w => {
                        const matchCat = activeWidgetCategory === 'all' || w.category === activeWidgetCategory;
                        const q = widgetSearchQuery.trim().toLowerCase();
                        return matchCat && (!q || w.label.toLowerCase().includes(q) || w.description.toLowerCase().includes(q));
                      })
                      .map((widget) => (
                        <div
                          key={widget.id}
                          onClick={() => {
                            const defn = WIDGET_REGISTRY[widget.id];
                            const finalProps: Record<string, string> = {};
                            (defn.configSchema ?? []).forEach(f => { finalProps[f.key] = f.default; });
                            if (defn.kind === 'action' && defn.id === 'options-chain') {
                              appendOptionsChainTab(finalProps.coinId ?? 'BTC-USD', DERIBIT_EXPIRIES[0] ?? '15 MAY 26');
                            } else {
                              const instanceId = `${widget.id}-${Date.now()}`;
                              const layout = {
                                x: 0, y: Infinity,
                                w: defn.defaultSize.w, h: defn.defaultSize.h,
                                minW: defn.defaultSize.minW, minH: defn.defaultSize.minH,
                              };
                              addInstance(activePageId, widget.id, layout, Object.keys(finalProps).length > 0 ? finalProps : undefined);
                              if (isEditMode) {
                                addDraftWidget(activePageId,
                                  { i: instanceId, ...layout },
                                  { id: instanceId, type: widget.id, visible: true, title: defn.label, config: Object.keys(finalProps).length > 0 ? finalProps : undefined }
                                );
                              }
                            }
                            closeComponentLibrary();
                          }}
                          className="group overflow-hidden cursor-pointer transition-all rounded-[12px]"
                          style={{ background: '#272729', border: '1px solid #333335' }}
                        >
                          <div className="relative h-[200px] flex items-center justify-center p-4 overflow-hidden" style={{ background: '#272729' }}>
                            <div className="w-full h-full flex items-center justify-center pointer-events-none">
                              {widget.preview}
                            </div>
                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
                              <span className="px-4 py-2 rounded-[8px] text-[13px] font-semibold" style={{ background: '#e8e8ea', color: '#1e1e20' }}>+ 添加 →</span>
                            </div>
                          </div>
                          <div className="px-4 py-3" style={{ background: '#1e1d23', borderTop: '1px solid #333335' }}>
                            <h3 className="text-[13px] font-semibold mb-1 truncate" style={{ color: '#dcdcdd' }}>{widget.label}</h3>
                            <p className="text-[12px] leading-relaxed line-clamp-2" style={{ color: '#6b6a6f' }}>{widget.description}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </Modal>
        )}
      </AnimatePresence>

    </div>
  );
}
