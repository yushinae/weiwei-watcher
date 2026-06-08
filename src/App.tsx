import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import {
  Activity,
  BookOpen,
  Calculator,
  CandlestickChart,
  Eye,
  LayoutDashboard,
  Bell,
  ListOrdered,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useNavigate, useLocation, Navigate, Routes, Route } from 'react-router-dom';

import { cn } from './lib/utils';
import { OptionsHoverMenu } from './features/optionsChain/OptionsHoverMenu';
import DigitalClock from './components/DigitalClock';
import DataHealthIndicator from './components/DataHealthIndicator';
import { UISettings, useTheme } from './features/settings/UISettings';

const MonitorPage = lazy(() => import('./pages/MonitorPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PositionBuilderPage = lazy(() => import('./pages/PositionBuilderPage'));
const BybitPositionsPage = lazy(() => import('./pages/BybitPositionsPage'));
const OptionsChainPage = lazy(() => import('./pages/OptionsChainPage'));
const PriceChartPage = lazy(() => import('./pages/PriceChartPage'));
const JournalPage = lazy(() => import('./pages/JournalPage'));
const PortfolioRiskPage = lazy(() => import('./pages/PortfolioRiskPage'));
const VolHistoryPage = lazy(() => import('./pages/VolHistoryPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));

// 预加载函数 — 悬停导航按钮时提前拉取 chunk，消除首次切换延迟
const preload = {
  dashboard: () => import('./pages/DashboardPage'),
  monitor: () => import('./pages/MonitorPage'),
  positionBuilder: () => import('./pages/PositionBuilderPage'),
  bybitPositions: () => import('./pages/BybitPositionsPage'),
  optionsChain: () => import('./pages/OptionsChainPage'),
  priceChart: () => import('./pages/PriceChartPage'),
  journal: () => import('./pages/JournalPage'),
  portfolioRisk: () => import('./pages/PortfolioRiskPage'),
  volHistory: () => import('./pages/VolHistoryPage'),
  alerts: () => import('./pages/AlertsPage'),
  accounts: () => import('./pages/AccountsPage'),
};

// 全局告警引擎 + 应用内 Toast（始终挂载，不随页面卸载）
import { useGlobalAlertEngine, AlertToastHost } from './features/alerts/engine';

import { startCacheCleanup } from './registry/data/cacheCleanup';
import { DERIBIT_WS } from './registry/data/ws';

// ── Deribit index price hook — via shared WebSocket, no REST polling ───────────

interface TickerState {
  symbol: string;
  price: string;
  up: boolean;
}

interface NavPriceRef { price: number; prev: number; }

function useDeribitIndexPrices(): TickerState[] {
  const [tickers, setTickers] = useState<TickerState[]>([
    { symbol: 'BTCUSDT', price: '—', up: true },
    { symbol: 'ETHUSDT', price: '—', up: true },
  ]);
  const btcRef = useRef<NavPriceRef>({ price: 0, prev: 0 });
  const ethRef = useRef<NavPriceRef>({ price: 0, prev: 0 });
  // Throttle: update UI at most every 1s (nav bar doesn't need sub-second refresh)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fmtPx = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

    const flush = () => {
      flushTimerRef.current = null;
      const b = btcRef.current, e = ethRef.current;
      if (!b.price || !e.price) return;
      setTickers([
        { symbol: 'BTCUSDT', price: fmtPx(b.price), up: b.price >= b.prev },
        { symbol: 'ETHUSDT', price: fmtPx(e.price), up: e.price >= e.prev },
      ]);
    };

    const schedule = () => {
      if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flush, 1000);
    };

    const onTick = (ref: NavPriceRef) => (d: { price: number }) => {
      ref.prev = ref.price || d.price;
      ref.price = d.price;
      schedule();
    };

    // Reuse the shared DERIBIT_WS singleton — no second connection needed
    const u1 = DERIBIT_WS.subscribe<{ price: number }>('deribit_price_index.btc_usd', onTick(btcRef.current));
    const u2 = DERIBIT_WS.subscribe<{ price: number }>('deribit_price_index.eth_usd', onTick(ethRef.current));
    return () => {
      u1(); u2();
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    };
  }, []);

  return tickers;
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
        <polygon points="16,7.5 9.5,12 15,15.5" fill="#F0B90B" />
        <polygon points="16,7.5 17,15.5 22.5,12" fill="#F0B90B" />
        <polygon points="9.5,13 15,16.5 15,19.5 9.5,16" fill="#A08010" />
        <polygon points="9.5,17 15,20.5 16,24.5 9.5,21" fill="#A08010" />
        <polygon points="22.5,13 22.5,16 17,19.5 17,16.5" fill="#C9A012" />
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

const PriceTicker = ({ symbol, price, up }: { symbol: string; price: string; up: boolean; key?: string }) => {
  const [flashColor, setFlashColor] = useState<'text-trade-up' | 'text-trade-down' | null>(null);
  const prevPriceRef = useRef(price);

  useEffect(() => {
    if (price !== prevPriceRef.current) {
      const numPrice = parseFloat(price.replace(/,/g, ''));
      const prevNumPrice = parseFloat(prevPriceRef.current.replace(/,/g, ''));
      if (numPrice > prevNumPrice) setFlashColor('text-trade-up');
      else if (numPrice < prevNumPrice) setFlashColor('text-trade-down');
      prevPriceRef.current = price;
      const timer = setTimeout(() => setFlashColor(null), 200);
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
    <div className="flex items-center gap-0.5 px-2 h-[36px] bg-white/[0.06] hover:bg-white/[0.10] ring-1 ring-inset ring-white/[0.07] hover:scale-[1.02] active:scale-[0.98] transition-all duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] rounded-[8px] cursor-pointer shrink-0">
      <TokenIcon symbol={symbol} />
      <span className={cn(
        "text-[16px] font-bold font-mono tnum transition-colors duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] ml-1.5",
        flashColor ? flashColor : (up ? "text-trade-up" : "text-trade-down")
      )}>{formattedPrice}</span>
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
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/dashboard';
  const isMonitor = location.pathname === '/monitor';
  const isOptionsChain = location.pathname === '/options-chain';
  const isPriceChart = location.pathname === '/price-chart';

  const [navOpen, setNavOpen] = useState(false);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNav = () => {
    if (navTimer.current) { clearTimeout(navTimer.current); navTimer.current = null; }
    setNavOpen(true);
  };
  const closeNav = () => {
    navTimer.current = setTimeout(() => setNavOpen(false), 300);
  };

  // 期权 — hover 弹出标的 + 到期日选择菜单
  const [optOpen, setOptOpen] = useState(false);
  const optTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openOpt = () => {
    if (optTimer.current) { clearTimeout(optTimer.current); optTimer.current = null; }
    setOptOpen(true);
  };
  const closeOpt = () => {
    optTimer.current = setTimeout(() => setOptOpen(false), 300);
  };

  // 九宫格 = 唯一完整菜单，按「我的 / 市场」分组
  const navGroups = [
    { title: '我的', items: [
      { label: '账户', icon: Wallet, to: '/accounts', preload: preload.accounts },
      { label: '组合风险', icon: ShieldAlert, to: '/portfolio-risk', preload: preload.portfolioRisk },
      { label: '日志', icon: BookOpen, to: '/journal', preload: preload.journal },
      { label: '告警', icon: Bell, to: '/alerts', preload: preload.alerts },
      { label: '头寸可视化', icon: Eye, to: '/bybit/positions', preload: preload.bybitPositions },
      { label: '头寸压力测试', icon: Calculator, to: '/position-builder', preload: preload.positionBuilder },
    ] },
    { title: '市场', items: [
      { label: '决策', icon: LayoutDashboard, to: '/dashboard', preload: preload.dashboard },
      { label: '监控', icon: Activity, to: '/monitor', preload: preload.monitor },
      { label: '图表', icon: CandlestickChart, to: '/price-chart', preload: preload.priceChart },
      { label: '期权链', icon: ListOrdered, to: '/options-chain', preload: preload.optionsChain },
      { label: '曲面历史', icon: TrendingUp, to: '/vol-history', preload: preload.volHistory },
    ] },
  ];

  return (
    <div className="relative flex items-center gap-3">
      {/* 九宫格 — 悬停弹出 */}
      <div
        className="relative"
        onMouseEnter={openNav}
        onMouseLeave={closeNav}
      >
        <button
          className={cn(
            "flex items-center justify-center w-[32px] h-[32px] shrink-0 rounded-[8px] transition-colors duration-[120ms]",
            navOpen
              ? "bg-white/[0.10] text-white"
              : "bg-transparent text-white hover:bg-white/[0.08]",
          )}
        >
          <NineDots size={22} />
        </button>

        {navOpen && (
          <div
            onMouseEnter={openNav}
            onMouseLeave={closeNav}
            className="absolute top-full left-0 mt-1 w-[160px] bg-[var(--color-dropdown)] rounded-xl p-1.5 z-[200] ring-1 ring-white/[0.08]
                       shadow-[0_24px_60px_rgba(0,0,0,0.70)]"
          >
            {navGroups.map((group, gi) => (
              <div key={group.title} className={gi > 0 ? 'mt-1 pt-1 border-t border-white/[0.06]' : ''}>
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-white/35">{group.title}</div>
                {group.items.map((it) => {
                  const Icon = it.icon;
                  const active = location.pathname === it.to;
                  return (
                    <button
                      key={it.label}
                      onClick={() => { navigate(it.to); setNavOpen(false); }}
                      onMouseEnter={it.preload}
                      className={cn(
                        'flex items-center gap-3 px-3 h-9 w-full rounded-lg text-left transition-colors',
                        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.07]',
                      )}
                    >
                      <Icon size={16} className={cn('shrink-0', active ? 'text-white/85' : 'text-white/55')} />
                      <span className={cn('text-[13px] font-semibold', active ? 'text-white' : 'text-white/80')}>{it.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => navigate('/monitor')}
        onMouseEnter={preload.monitor}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
          isMonitor ? "bg-white/[0.10] text-white" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85"
        )}>
        监控
      </button>

      <button
        onClick={() => navigate('/dashboard')}
        onMouseEnter={preload.dashboard}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
          isDashboard ? "bg-white/[0.10] text-white" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85",
        )}
      >
        决策
      </button>

      <div className="relative" onMouseEnter={() => { openOpt(); preload.optionsChain(); }} onMouseLeave={closeOpt}>
        <button
          onClick={() => navigate('/options-chain')}
          className={cn(
            "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
            isOptionsChain || optOpen ? "bg-white/[0.10] text-white" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85",
          )}
        >
          期权
        </button>
        {optOpen && (
          <div className="absolute top-full left-0 mt-1 z-[200]">
            <OptionsHoverMenu
              onMouseEnter={openOpt}
              onMouseLeave={closeOpt}
              onPick={() => { setOptOpen(false); navigate('/options-chain'); }}
            />
          </div>
        )}
      </div>

      <button
        onClick={() => navigate('/price-chart')}
        onMouseEnter={preload.priceChart}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
          isPriceChart ? "bg-white/[0.10] text-white" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85",
        )}
      >
        图表
      </button>

    </div>
  );
};

// 页面 loading 占位
const PageFallback = () => (
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-white/10 border-t-brand rounded-full animate-spin" />
      <span className="text-[11px] text-slate-500">加载中...</span>
    </div>
  </div>
);

// 策略：
// - 监控页（重，50+ widget）keep-alive：用 display:none 隐藏，永不卸载，避免反复初始化卡顿
// - 监控页隐藏时暂停轮询（monitorWidgets 内置 visibilitychange 检测）
// - 其他轻量页面正常按需挂载
// - 预加载（hover）保留
function AppRoutes() {
  return (
    <Routes>
      <Route path="/monitor" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <MonitorPage />
          </Suspense>
        </div>
      } />
      <Route path="/dashboard" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <DashboardPage />
          </Suspense>
        </div>
      } />
      <Route path="/position-builder" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <PositionBuilderPage />
          </Suspense>
        </div>
      } />
      <Route path="/bybit/positions" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <BybitPositionsPage />
          </Suspense>
        </div>
      } />
      <Route path="/options-chain" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <OptionsChainPage />
          </Suspense>
        </div>
      } />
      <Route path="/price-chart" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <PriceChartPage />
          </Suspense>
        </div>
      } />
      <Route path="/journal" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <JournalPage />
          </Suspense>
        </div>
      } />
      <Route path="/portfolio-risk" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <PortfolioRiskPage />
          </Suspense>
        </div>
      } />
      <Route path="/vol-history" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <VolHistoryPage />
          </Suspense>
        </div>
      } />
      <Route path="/alerts" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <AlertsPage />
          </Suspense>
        </div>
      } />
      <Route path="/accounts" element={
        <div className="absolute inset-0">
          <Suspense fallback={<PageFallback />}>
            <AccountsPage />
          </Suspense>
        </div>
      } />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

const TickerBar = () => {
  const tickers = useDeribitIndexPrices();
  return (
    <div className="flex items-center w-full h-full justify-end gap-3 min-w-0">
      {tickers.map(({ symbol, price, up }) => (
        <PriceTicker key={symbol} symbol={symbol} price={price} up={up} />
      ))}
    </div>
  );
};



export default function App() {
  const navigate = useNavigate();
  useTheme();
  useGlobalAlertEngine(); // 全局告警引擎：始终在线评估 ALERTS_STORE

  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastScrollTs = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollTs < 100) return;
      lastScrollTs = now;
      document.documentElement.classList.add('is-scrolling');
      clearTimeout(timer);
      timer = setTimeout(() => document.documentElement.classList.remove('is-scrolling'), 800);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    // Cursor-following mint-free spotlight: write pointer position into the
    // hovered card's CSS vars (--mx/--my). One delegated listener covers every
    // .widget-card across the whole site (decision / monitor / bybit / builder).
    const onMove = (e: MouseEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.('.widget-card') as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('mousemove', onMove, { passive: true });

    const stopCacheGC = startCacheCleanup();
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('mousemove', onMove);
      clearTimeout(timer);
      stopCacheGC();
    };
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden selection:bg-brand-blue/30 relative z-[1]">
      <header className="h-[44px] flex items-center px-2 glass-bar glass-bar-shadow shrink-0 relative z-[150]" style={{ background: 'var(--base-strong)' }}>
        <div className="flex items-center gap-6 shrink-0">
          <div className="flex items-center justify-center gap-2 cursor-pointer group">
            <img src="/avatar.png" alt="avatar" className="w-8 h-8 rounded-[6px] object-cover shadow-[0_0_15px_rgba(37,232,137,0.4)] group-hover:shadow-[0_0_22px_rgba(37,232,137,0.6)] transition-shadow duration-500" />
            <span className="font-bold text-sm tracking-tight text-[#25e889]">
              薇薇看板
            </span>
          </div>

          <AppNavigationDropdown />
        </div>

        <div className="hidden lg:flex items-center flex-1 min-w-0 pl-4 h-full">
          <TickerBar />
        </div>

        <div className="flex items-center gap-2 ml-8 shrink-0">
          <div className="flex items-center gap-4">
            <DigitalClock />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(o => !o)}
              className={cn(
                'w-[32px] h-[32px] rounded-[8px] flex items-center justify-center transition-colors duration-[120ms]',
                settingsOpen
                  ? 'bg-white/[0.10] text-white'
                  : 'text-white/55 hover:text-white/85 hover:bg-white/[0.08]',
              )}
              title="UI 设置"
              aria-label="UI 设置"
            >
              <img src="/icons/settings.png" className="w-[22px] h-[22px] rounded-[6px]" alt="" />
            </button>

            <button
              onClick={() => navigate('/alerts')}
              onMouseEnter={preload.alerts}
              className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-white/55 hover:text-white/85 hover:bg-white/[0.08] transition-colors duration-[120ms]"
              title="告警"
              aria-label="告警"
            >
              <img src="/icons/alerts.png" className="w-[22px] h-[22px] rounded-[6px]" alt="" />
            </button>

            <button
              onClick={() => navigate('/accounts')}
              onMouseEnter={preload.accounts}
              className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-white/55 hover:text-white/85 hover:bg-white/[0.08] transition-colors duration-[120ms]"
              title="账户"
              aria-label="账户"
            >
              <img src="/icons/accounts.png" className="w-[22px] h-[22px] rounded-[6px]" alt="" />
            </button>

            <DataHealthIndicator />
          </div>

          {settingsOpen && (
            <>
              <div
                className="fixed inset-0 z-[190]"
                onClick={() => setSettingsOpen(false)}
              />
              <div
                className="absolute top-full right-0 mt-2 w-[300px] p-4 bg-[var(--color-dropdown)] rounded-xl z-[200] ring-1 ring-white/[0.08]
                           shadow-[0_24px_60px_rgba(0,0,0,0.70)]"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-semibold text-white/80">UI 设置</span>
                  <button
                    onClick={() => setSettingsOpen(false)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                  >
                    <span className="text-[14px] leading-none">✕</span>
                  </button>
                </div>
                <UISettings onClose={() => setSettingsOpen(false)} />
              </div>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden z-[1]">
        <AppRoutes />
      </main>

      {/* 全局告警 Toast（应用内，独立于系统通知）*/}
      <AlertToastHost />
    </div>
  );
}
