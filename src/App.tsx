import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import {
  Activity,
  Calculator,
  Settings,
} from 'lucide-react';
import { HoverPopover } from './components/popup/Popup';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { cn } from './lib/utils';

const MonitorPage = lazy(() => import('./pages/MonitorPage'));
const PositionBuilderPage = lazy(() => import('./pages/PositionBuilderPage'));

const MARKET_TICKERS = [
  { symbol: 'BTCUSDT', price: '64,123.50', change: '+1.2%', up: true },
  { symbol: 'ETHUSDT', price: '3,425.80', change: '+0.8%', up: true },
];

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

const PriceTicker = ({ symbol, price, change, up }: { symbol: string; price: string; change: string; up: boolean; key?: string }) => {
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
    <div className="flex items-center justify-center px-2 h-[36px] bg-white/5 hover:bg-white/10 transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] rounded-[8px] text-slate-200">
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

const MarginMonitor = ({ rate }: { rate: number }) => {
  const [displayRate, setDisplayRate] = useState(rate);
  const rafRef = useRef<number | null>(null);
  const displayRateRef = useRef(displayRate);
  displayRateRef.current = displayRate;

  useEffect(() => {
    const animate = () => {
      const current = displayRateRef.current;
      const diff = rate - current;
      if (Math.abs(diff) < 0.01) {
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
  }, [rate]);

  const imRate = Math.min(displayRate * 2.5, 100);

  return (
    <div className="hidden md:flex items-center h-[40px] bg-white/5 border border-white/10 rounded-[8px] pl-2.5 pr-0.5 py-0.5 gap-3">
      <div className="flex flex-col justify-center gap-1 mt-px">
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isMonitor = location.pathname === '/monitor';

  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 200);
  };

  return (
    <div className="relative flex items-center gap-4">
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

        <HoverPopover open={isOpen} panelZ={60} panelClassName="absolute top-full left-0 mt-1 overflow-hidden" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <div className="w-[160px] p-2">
            <div className="flex flex-col gap-0.5">
              {([
                { label: '监控', icon: Activity, to: '/monitor' },
                { label: '头寸压力测试', icon: Calculator, to: '/position-builder' },
              ]).map((it) => {
                const Icon = it.icon;
                return (
                  <button
                    key={it.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(it.to);
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-3 px-3 h-9 rounded-[12px] text-left transition-colors hover:bg-[var(--glass-tint-2)]"
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

      <button
        onClick={() => navigate('/monitor')}
        className={cn(
          "flex items-center justify-center px-3 h-[32px] rounded-[8px] transition-colors duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] text-[13px] font-bold outline-none focus:outline-none",
          isMonitor ? "bg-white/15 text-slate-100" : "bg-transparent text-slate-100/80 hover:bg-white/10"
        )}>
        监控
      </button>
    </div>
  );
};

const TickerBar = () => {
  return (
    <div className="flex items-center w-full h-full justify-end gap-1.5 min-w-0">
      {MARKET_TICKERS.map(({ symbol, price, change, up }) => (
        <PriceTicker key={symbol} symbol={symbol} price={price} change={change} up={up} />
      ))}
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
          <button className="flex items-center gap-2.5 px-2.5 h-9 hover:bg-[var(--glass-tint-2)] rounded-[12px] cursor-pointer group transition-colors w-full text-left">
            <Settings size={15} className="text-white/55 group-hover:text-white transition-colors shrink-0" />
            <span className="text-sm text-white/75 group-hover:text-white transition-colors">设置</span>
          </button>
        </div>
      </HoverPopover>
    </div>
  );
};

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

  const [marginRate] = useState(12.5);

  return (
    <div className="flex flex-col h-screen overflow-hidden selection:bg-brand-blue/30 relative z-[1]">
      <header className="h-[44px] flex items-center px-2 glass-bar glass-bar-shadow shrink-0 relative z-[150]">
        <div className="flex items-center gap-6 shrink-0">
          <div className="flex items-center justify-center gap-2 cursor-pointer group">
            <img src="/avatar.png" alt="avatar" className="w-8 h-8 rounded-[6px] object-cover shadow-[0_0_15px_rgba(77,124,255,0.4)]" />
            <span className="font-bold text-sm tracking-tight text-slate-100">
              薇薇看板
            </span>
          </div>

          <AppNavigationDropdown />
        </div>

        <div className="hidden lg:flex items-center flex-1 min-w-0 pl-4 pr-2 h-full">
          <TickerBar />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <MarginMonitor rate={marginRate} />

          <div className="flex items-center gap-6">
            <DigitalClock />
            <div className="flex items-center gap-2">
              <NotificationDropdown />
              <UserDropdown />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden z-[1]">
        <Suspense fallback={<div className="absolute inset-0 bg-[#0A0A0F]" />}>
        <Routes>
            <Route path="/monitor" element={
              <div className="absolute inset-0">
                <MonitorPage />
              </div>
            } />
            <Route path="/position-builder" element={
              <div className="absolute inset-0">
                <PositionBuilderPage />
              </div>
            } />
            <Route path="/" element={<Navigate to="/monitor" replace />} />
            <Route path="*" element={<Navigate to="/monitor" replace />} />
        </Routes>
        </Suspense>
      </main>

      <footer className="h-[34px] glass-bar flex items-center px-1.5 shrink-0 z-10 w-full relative" />
    </div>
  );
}
