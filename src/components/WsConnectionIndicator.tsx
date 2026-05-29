import { useState, useEffect, useRef } from 'react';
import { DERIBIT_WS } from '../registry/data/ws';
import { BYBIT_PRIVATE_WS } from '../features/bybit/ws';

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
  const [bybit, setBybit]     = useState<WsStatus>('disconnected');
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u1 = DERIBIT_WS.subscribeStatus(setDeribit);
    const u2 = BYBIT_PRIVATE_WS.subscribeStatus(setBybit);
    return () => { u1(); u2(); };
  }, []);

  // Overall status: if both connected → green, one connecting → amber, any disconnected → red
  const overall: WsStatus =
    deribit === 'connected' && bybit === 'connected'
      ? 'connected'
      : deribit === 'connecting' || bybit === 'connecting'
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
          className="absolute right-0 top-full mt-1.5 z-[300] min-w-[150px] bg-[#141414] rounded-xl p-3 ring-1 ring-white/[0.08] shadow-[0_24px_60px_rgba(0,0,0,0.70)]"
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
              <span className="text-[12px] text-white/60">Bybit</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[bybit] }} />
                <span className="text-[11px] font-semibold text-white/80">{STATUS_LABELS[bybit]}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
