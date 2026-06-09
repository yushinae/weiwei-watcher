import { useState, useEffect, useRef } from 'react';
import { DERIBIT_WS } from '../registry/data/ws';
import { BYBIT_PRIVATE_WS } from '../features/bybit/ws';
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

type WsStatus = 'disconnected' | 'connecting' | 'connected';

const STATUS_COLORS: Record<WsStatus, string> = {
  disconnected: '#EF4444',
  connecting:   '#F59E0B',
  connected:    '#22C55E',
};
const STATUS_LABELS: Record<WsStatus, string> = {
  disconnected: '已断连',
  connecting:   '连接中…',
  connected:    '已连接',
};

export default function DataHealthIndicator() {
  const [deribit, setDeribit]   = useState<WsStatus>('disconnected');
  const [bybitOpt, setBybitOpt] = useState<WsStatus>('disconnected'); // 期权行情（公有）
  const [bybitAcct, setBybitAcct] = useState<WsStatus>('disconnected'); // 账户/持仓（私有，需 API key）
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const health = useGlobalHealth();
  const feeds  = useAllFreshness();

  useEffect(() => {
    const u1 = DERIBIT_WS.subscribeStatus(setDeribit);
    const u2 = BYBIT_OPTION_WS.subscribeStatus(setBybitOpt);
    const u3 = BYBIT_PRIVATE_WS.subscribeStatus(s => setBybitAcct(s === 'auth' ? 'connected' : (s as WsStatus)));
    return () => { u1(); u2(); u3(); };
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
          className="bb-top-popover absolute right-0 top-full mt-1.5 z-[300] w-[230px] p-3"
        >
          {/* 连接 */}
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/35 mb-1.5">连接</div>
          <div className="flex flex-col gap-1.5">
            {([['Deribit', deribit], ['Bybit 期权', bybitOpt], ['Bybit 账户', bybitAcct]] as const).map(([name, st]) => (
              <div key={name} className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-white/60">{name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[st] }} />
                  <span className="text-[11px] font-semibold text-white/80">{STATUS_LABELS[st]}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 数据新鲜度 */}
          {freshRows.length > 0 && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/35 mt-3 mb-1.5">数据新鲜度</div>
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
            绿=实时 · 黄=延迟/暂停 · 红=中断 · 灰=示例
          </div>
        </div>
      )}
    </div>
  );
}
