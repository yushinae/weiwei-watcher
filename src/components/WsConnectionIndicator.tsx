import { useState, useEffect, useRef } from 'react';
import { DERIBIT_WS } from '../registry/data/ws';
import { BYBIT_PRIVATE_WS } from '../features/bybit/ws';
import { BYBIT_OPTION_WS } from '../features/optionsChain/bybitOptionWs';

type WsStatus = 'disconnected' | 'connecting' | 'connected';

const STATUS_COLORS: Record<WsStatus, string> = {
  disconnected: '#EF4444', // red
  connecting:    '#F59E0B', // amber
  connected:     '#22C55E', // green
};

const STATUS_LABELS: Record<WsStatus, string> = {
  disconnected: '已断连',
  connecting:    '连接中…',
  connected:     '已连接',
};

export default function WsConnectionIndicator() {
  const [deribit, setDeribit] = useState<WsStatus>('disconnected');
  const [bybitOpt, setBybitOpt] = useState<WsStatus>('disconnected'); // 期权行情（公有）
  const [bybitAcct, setBybitAcct] = useState<WsStatus>('disconnected'); // 账户/持仓（私有，需 API key）
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u1 = DERIBIT_WS.subscribeStatus(setDeribit);
    const u2 = BYBIT_OPTION_WS.subscribeStatus(setBybitOpt);
    const u3 = BYBIT_PRIVATE_WS.subscribeStatus(s => setBybitAcct(s === 'auth' ? 'connected' : (s as WsStatus)));
    return () => { u1(); u2(); u3(); };
  }, []);

  // Overall reflects the live DATA feeds (Deribit + Bybit 期权). The private account
  // WS is optional (only when API keys are set) so it's informational, not in overall.
  const overall: WsStatus =
    deribit === 'connected' && bybitOpt === 'connected'
      ? 'connected'
      : deribit === 'connecting' || bybitOpt === 'connecting'
        ? 'connecting'
        : 'disconnected';

  const color = STATUS_COLORS[overall];

  const animClass =
    overall === 'connecting' ? 'anim-ping' :
    overall === 'connected'  ? 'anim-breathe' :
    'anim-alert';

  const open = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setShowTooltip(true);
  };
  const close = () => {
    tooltipTimer.current = setTimeout(() => setShowTooltip(false), 250);
  };

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <style>{`
        @keyframes ws-breathe {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.2; transform: scale(1.35); }
        }
        @keyframes ws-ping {
          0%   { transform: scale(1);   opacity: 0.7; }
          50%  { transform: scale(1.8); opacity: 0.3; }
          100% { transform: scale(2.2); opacity: 0;   }
        }
        @keyframes ws-alert {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
        .anim-breathe { animation: ws-breathe 2.5s ease-in-out infinite; }
        .anim-ping    { animation: ws-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .anim-alert   { animation: ws-alert 1.2s ease-in-out infinite; }
      `}</style>
      <div className="flex items-center justify-center rounded-full w-[30px] h-[30px] bg-white/[0.06] hover:bg-white/[0.10] hover:scale-[1.02] active:scale-[0.98] transition-all duration-[120ms] cursor-pointer">
        <span className="relative flex h-4 w-4 items-center justify-center">
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${animClass}`}
            style={{ backgroundColor: color }}
          />
          <span
            className="relative h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        </span>
      </div>

      {showTooltip && (
        <div
          onMouseEnter={open}
          onMouseLeave={close}
          className="absolute right-0 top-full mt-1.5 z-[300] min-w-[150px] bg-[var(--color-dropdown)] rounded-xl p-3 ring-1 ring-white/[0.08] shadow-[0_24px_60px_rgba(0,0,0,0.70)]"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-white/60">Deribit</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[deribit] }} />
                <span className="text-[11px] font-semibold text-white/80">{STATUS_LABELS[deribit]}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-white/60">Bybit 期权</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[bybitOpt] }} />
                <span className="text-[11px] font-semibold text-white/80">{STATUS_LABELS[bybitOpt]}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-white/60">Bybit 账户</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[bybitAcct] }} />
                <span className="text-[11px] font-semibold text-white/80">{STATUS_LABELS[bybitAcct]}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
