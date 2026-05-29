import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import {
  Activity,
  Calculator,
  Eye,
  LayoutDashboard,
} from 'lucide-react';
import { useNavigate, useLocation, Navigate, Routes, Route } from 'react-router-dom';

import { cn } from './lib/utils';
import DigitalClock from './components/DigitalClock';
import WsConnectionIndicator from './components/WsConnectionIndicator';

const MonitorPage = lazy(() => import('./pages/MonitorPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PositionBuilderPage = lazy(() => import('./pages/PositionBuilderPage'));
const BybitPositionsPage = lazy(() => import('./pages/BybitPositionsPage'));

// 预加载函数 — 悬停导航按钮时提前拉取 chunk，消除首次切换延迟
const preload = {
  dashboard: () => import('./pages/DashboardPage'),
  monitor: () => import('./pages/MonitorPage'),
  positionBuilder: () => import('./pages/PositionBuilderPage'),
  bybitPositions: () => import('./pages/BybitPositionsPage'),
};

// Lightweight import: only the WebSocket singleton + cache GC, not the full widget registry
import { DERIBIT_WS, startCacheCleanup } from './registry/monitorWidgetsBase';
// Monitor polling control — pause when monitor page is hidden, resume when shown
import { pauseMonitorPolling, resumeMonitorPolling } from './registry/monitorWidgets';

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
  const isPositionBuilder = location.pathname === '/position-builder';

  const [posOpen, setPosOpen] = useState(false);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openPos = () => {
    if (posTimer.current) { clearTimeout(posTimer.current); posTimer.current = null; }
    setPosOpen(true);
  };
  const closePos = () => {
    posTimer.current = setTimeout(() => setPosOpen(false), 300);
  };

  const [navOpen, setNavOpen] = useState(false);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNav = () => {
    if (navTimer.current) { clearTimeout(navTimer.current); navTimer.current = null; }
    setNavOpen(true);
  };
  const closeNav = () => {
    navTimer.current = setTimeout(() => setNavOpen(false), 300);
  };

  const navItems = [
    { label: '决策', icon: LayoutDashboard, to: '/dashboard', preload: preload.dashboard },
    { label: '监控', icon: Activity, to: '/monitor', preload: preload.monitor },
    { label: '头寸压力测试', icon: Calculator, to: '/position-builder', preload: preload.positionBuilder },
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
            "flex items-center justify-center w-[32px] h-[32px] rounded-[8px] transition-colors duration-[120ms]",
            "bg-transparent text-white/60 hover:bg-white/[0.08] hover:text-white/90",
            navOpen && "bg-white/[0.10] text-white",
          )}
        >
          <NineDots size={24} />
        </button>

        {navOpen && (
          <div
            onMouseEnter={openNav}
            onMouseLeave={closeNav}
            className="absolute top-full left-0 mt-1 w-[150px] bg-[#141414] rounded-xl p-1.5 z-[200] ring-1 ring-white/[0.08]
                       shadow-[0_24px_60px_rgba(0,0,0,0.70)]"
          >
            {navItems.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  onClick={() => { navigate(it.to); setNavOpen(false); }}
                  onMouseEnter={it.preload}
                  className="flex items-center gap-3 px-3 h-9 w-full rounded-lg text-left
                             hover:bg-white/[0.07] transition-colors"
                >
                  <Icon size={16} className="text-white/55 shrink-0" />
                  <span className="text-[13px] font-semibold text-white/80">{it.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        onClick={() => navigate('/dashboard')}
        onMouseEnter={preload.dashboard}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
          isDashboard ? "bg-white/[0.10] text-white ring-1 ring-inset ring-white/[0.12]" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85",
        )}
      >
        决策
      </button>

      <button
        onClick={() => navigate('/monitor')}
        onMouseEnter={preload.monitor}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
          isMonitor ? "bg-white/[0.10] text-white ring-1 ring-inset ring-white/[0.12]" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85"
        )}>
        监控
      </button>
      <div
        className="relative"
        onMouseEnter={openPos}
        onMouseLeave={closePos}
      >
        <button
          onClick={() => navigate('/position-builder')}
          onMouseEnter={preload.positionBuilder}
          className={cn(
            "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] text-[13px] font-bold outline-none",
            isPositionBuilder || posOpen ? "bg-white/[0.10] text-white ring-1 ring-inset ring-white/[0.12]" : "bg-transparent text-white/55 hover:bg-white/[0.07] hover:text-white/85",
          )}
        >
          头寸
        </button>

        {posOpen && (
          <div
            onMouseEnter={openPos}
            onMouseLeave={closePos}
            className="absolute top-full left-0 mt-1 w-[150px] bg-[#141414] rounded-xl p-1.5 z-[200] ring-1 ring-white/[0.08]
                       shadow-[0_24px_60px_rgba(0,0,0,0.70)]"
          >
            {([
              { label: '头寸可视化', icon: Eye, to: '/bybit/positions' },
              { label: '头寸压力测试', icon: Calculator, to: '/position-builder' },
            ]).map(it => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  onClick={() => { navigate(it.to); setPosOpen(false); }}
                  className="flex items-center gap-3 px-3 h-9 w-full rounded-lg text-left
                             hover:bg-white/[0.07] transition-colors"
                >
                  <Icon size={16} className="text-white/55 shrink-0" />
                  <span className="text-[13px] font-semibold text-white/80">{it.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
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
  const { pathname } = useLocation();
  const [monitorMounted, setMonitorMounted] = React.useState(false);

  // 首次访问监控页时挂载，之后永不卸载
  // 切走时暂停所有轮询 + WS，切回来时恢复
  React.useEffect(() => {
    if (pathname === '/monitor') {
      setMonitorMounted(true);
      resumeMonitorPolling();
    } else {
      pauseMonitorPolling();
    }
  }, [pathname]);

  const isMonitor = pathname === '/monitor';

  return (
    <>
      {/* 监控页 keep-alive：挂载后只用 display 切换 */}
      {monitorMounted && (
        <div className="absolute inset-0" style={{ display: isMonitor ? 'block' : 'none' }}>
          <Suspense fallback={<PageFallback />}>
            <MonitorPage />
          </Suspense>
        </div>
      )}

      {/* 其他页面正常路由 */}
      {!isMonitor && (
        <Routes>
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
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      )}
    </>
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
            <WsConnectionIndicator />
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden z-[1]">
        <AppRoutes />
      </main>

      <footer className="h-[34px] glass-bar flex items-center px-1.5 shrink-0 z-10 w-full relative" />
    </div>
  );
}
