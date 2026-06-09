import { useState, useEffect, useMemo, useRef } from 'react';
import { DERIBIT_WS } from '../registry/data/ws';
import { BYBIT_PRIVATE_WS } from '../features/bybit/ws';
import { hasBrowserWsCredentials, hasCredentials, subscribeAuthState } from '../features/bybit/auth';
import { BYBIT_OPTION_WS } from '../features/optionsChain/bybitOptionWs';
import {
  useGlobalHealth, useAllFreshness, freshStateText, FRESH_COLOR,
  type FreshKind,
} from '../registry/data/freshness';

// ═══════════════════════════════════════════════════════════════════════════════
// 数据健康指示器（顶栏总闸）
//
// 合并了「WS 连接状态」+「数据新鲜度护栏」——一个点说清「我现在能不能信这些数」。
//   • 安静绿：一切实时 → 仅一个呼吸的绿点。
//   • 降级喊：任一关键 feed 延迟/中断/因失焦暂停 → 变黄/红 + 旁边出现文字。
//   • 下拉：上段「连接」(WS) + 下段「数据新鲜度」(每个 feed 多久没更新)。
// ═══════════════════════════════════════════════════════════════════════════════

type WsStatus = 'idle' | 'rest' | 'missing' | 'disconnected' | 'connecting' | 'connected';

const STATUS_COLORS: Record<WsStatus, string> = {
  idle:         '#8A8F98',
  rest:         '#22C55E',
  missing:      '#8A8F98',
  disconnected: '#EF4444',
  connecting:   '#F59E0B',
  connected:    '#22C55E',
};
const STATUS_LABELS: Record<WsStatus, string> = {
  idle:         '按需打开',
  rest:         'REST 代理',
  missing:      '未配置',
  disconnected: '已断连',
  connecting:   '连接中…',
  connected:    '已连接',
};

const STATUS_HINTS: Record<WsStatus, string> = {
  idle: '没有打开这个页面/合约时不会连接',
  rest: '密钥在本地后端，账户数据走代理',
  missing: '没有配置 API key',
  disconnected: '已尝试连接，但当前断开',
  connecting: '正在建立连接或鉴权',
  connected: 'WebSocket 已打开',
};

export default function DataHealthIndicator() {
  const [deribit, setDeribit]   = useState<WsStatus>('disconnected');
  const [bybitOpt, setBybitOpt] = useState<WsStatus>('disconnected'); // 期权行情（公有）
  const [bybitAcct, setBybitAcct] = useState<WsStatus>('missing'); // 账户/持仓（私有，需 API key）
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const health = useGlobalHealth();
  const feeds  = useAllFreshness();

  useEffect(() => {
    const u1 = DERIBIT_WS.subscribeStatus(setDeribit);
    const u2 = BYBIT_OPTION_WS.subscribeStatus(s => {
      setBybitOpt(s === 'disconnected' && BYBIT_OPTION_WS.subscriptionCount() === 0 ? 'idle' : s);
    });
    const updateBybitAccount = (s?: string) => {
      if (hasBrowserWsCredentials()) {
        setBybitAcct(s === 'auth' ? 'connected' : (s as WsStatus | undefined) ?? 'disconnected');
        return;
      }
      void hasCredentials().then(ok => setBybitAcct(ok ? 'rest' : 'missing'));
    };
    const u3 = BYBIT_PRIVATE_WS.subscribeStatus(updateBybitAccount);
    const u4 = subscribeAuthState(() => updateBybitAccount());
    updateBybitAccount();
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // 整体严重度 = 新鲜度护栏（只看「当前活跃」的关键 feed；闲置 feed 不报警）。
  // WS 连接已通过 ws-deribit feed 计入健康度，无需再单算连接维度——避免「Bybit 期权 WS
  // 在非期权页本就未订阅」造成的误报。
  const sev = health.level === 'down' ? 3 : health.level === 'warn' ? 2 : 0;

  const color = sev >= 3 ? '#EF4444' : sev >= 2 ? '#F59E0B' : '#22C55E';
  const animClass = sev >= 3 ? 'anim-alert' : sev >= 2 ? 'anim-ping' : 'anim-breathe';

  // 新鲜度清单：只列「当前活跃」的 feed —— 关键 feed 全列 + 已降级的非关键 feed。
  const degradedKinds: FreshKind[] = ['aging', 'stale', 'error', 'paused'];
  const freshRows = feeds
    .filter(f => f.active && (f.critical || degradedKinds.includes(f.kind)))
    .sort((a, b) => (FRESH_COLOR[b.kind] === '#EF4444' ? 1 : 0) - (FRESH_COLOR[a.kind] === '#EF4444' ? 1 : 0));

  const connectionRows = useMemo(() => ([
    { name: 'Deribit 行情 WS', status: deribit, note: '现价、DVOL、Deribit 合约推送' },
    { name: 'Bybit 期权 WS', status: bybitOpt, note: '只在 Bybit 期权页订阅合约时打开' },
    { name: 'Bybit 账户通道', status: bybitAcct, note: STATUS_HINTS[bybitAcct] },
  ]), [deribit, bybitOpt, bybitAcct]);

  const open = () => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); setShowTooltip(true); };
  const close = () => { tooltipTimer.current = setTimeout(() => setShowTooltip(false), 250); };

  return (
    <div className="relative inline-flex items-center shrink-0 self-stretch" onMouseEnter={open} onMouseLeave={close}>
      <style>{`
        @keyframes ws-breathe { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:.2;transform:scale(1.35);} }
        @keyframes ws-ping { 0%{transform:scale(1);opacity:.7;} 50%{transform:scale(1.8);opacity:.3;} 100%{transform:scale(2.2);opacity:0;} }
        @keyframes ws-alert { 0%,100%{opacity:1;} 50%{opacity:.4;} }
        .anim-breathe { animation: ws-breathe 2.5s ease-in-out infinite; }
        .anim-ping    { animation: ws-ping 1.5s cubic-bezier(0,0,.2,1) infinite; }
        .anim-alert   { animation: ws-alert 1.2s ease-in-out infinite; }
      `}</style>

      <div className="bb-topbar-button flex h-[30px] w-[30px] items-center justify-center rounded-full active:scale-[0.98] transition-all duration-[120ms] cursor-pointer">
        <span className="relative flex h-4 w-4 items-center justify-center">
          <span className={`absolute inline-flex h-full w-full rounded-full ${animClass}`} style={{ backgroundColor: color }} />
          <span className="relative h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        </span>
      </div>

      {showTooltip && (
        <div
          onMouseEnter={open}
          onMouseLeave={close}
          className="bb-top-popover absolute right-0 top-full mt-1.5 z-[300] w-[300px] p-3"
        >
          {/* 连接 */}
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/35 mb-1.5">WS / 账户通道</div>
          <div className="flex flex-col gap-2">
            {connectionRows.map(row => (
              <div key={row.name} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                <span className="text-[12px] text-white/65">{row.name}</span>
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[row.status] }} />
                  <span className="text-[11px] font-semibold text-white/85">{STATUS_LABELS[row.status]}</span>
                </div>
                <span className="col-span-2 text-[10px] text-white/32 leading-snug">{row.note}</span>
              </div>
            ))}
          </div>

          {/* 数据新鲜度 */}
          {freshRows.length > 0 && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/35 mt-3 mb-1.5">正在使用的数据</div>
              <div className="flex flex-col gap-1.5">
                {freshRows.map(fr => (
                  <div key={fr.key} className="flex items-center justify-between gap-3" title={fr.error ?? undefined}>
                    <span className="text-[12px] text-white/60 truncate">{fr.label}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FRESH_COLOR[fr.kind] }} />
                      <span className="text-[11px] font-semibold tabular-nums" style={{ color: FRESH_COLOR[fr.kind] }}>
                        {freshStateText(fr)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-2.5 pt-2 border-t border-white/[0.06] text-[10px] text-white/35 leading-snug">
            上半区是通道是否打开；下半区是当前页面正在用的数据多久前成功更新。灰色通常代表暂未用到。
          </div>
        </div>
      )}
    </div>
  );
}
