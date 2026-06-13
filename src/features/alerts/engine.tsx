import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
// 引擎常驻 App 顶层：必须绕开 monitorWidgetsBase barrel，否则首屏被拖入全部 widget
import { DERIBIT_WS } from '../../registry/data/ws';
import {
  evalAlerts, METRIC_META, subscribeAlertTriggers,
  type AlertTriggerEvent,
} from '../../registry/data/store';
import { getBook } from '../accounts/bookStore';
import { fromAccounts, buildBooks } from '../portfolioRisk/aggregate';
import type { Coin } from '../monitor/types';
import { notifyAlert } from './notifications';

const COINS: Coin[] = ['BTC', 'ETH'];

// 可靠性分级见 METRIC_META.tier：live(spot/dvol) 全局常驻、book(netDelta/netVega)
// 盯持仓、foreground(其余) 仅监控页新鲜时评估。引擎每 4s 评估 live + book。

// ── 全局告警引擎 ──────────────────────────────────────────────────────────────
// 挂在 App 顶层一次。直接订阅 DERIBIT_WS 的 spot + DVOL（全局常驻连接，不受
// pauseMonitorPolling 影响），每 4s 用实时值评估 ALERTS_STORE —— 离开监控页也能触发。
export function useGlobalAlertEngine(): void {
  const live = useRef<Record<string, { spot?: number; dvol?: number }>>({ BTC: {}, ETH: {} });

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const c of COINS) {
      const idx = c === 'BTC' ? 'btc_usd' : 'eth_usd';
      unsubs.push(DERIBIT_WS.subscribe<{ price: number }>(
        `deribit_price_index.${idx}`, d => { live.current[c].spot = d.price; }));
      unsubs.push(DERIBIT_WS.subscribe<{ volatility: number }>(
        `deribit_volatility_index.${idx}`, d => { live.current[c].dvol = d.volatility; }));
    }
    // 不 gate document.hidden：Notification 的价值恰恰是 tab 在后台时也提醒（WS 后台仍收消息）。
    const tick = setInterval(() => {
      // 盯持仓告警：用缓存的真实持仓 + 实时现价算每币净 $Delta/$Vega（随价格实时变）
      const book = getBook();
      const spots = { BTC: live.current.BTC.spot ?? 0, ETH: live.current.ETH.spot ?? 0 };
      const coinBooks = book.length ? buildBooks(fromAccounts(book, spots)) : [];
      for (const c of COINS) {
        const lv = live.current[c];
        const cb = coinBooks.find(b => b.coin === c);
        evalAlerts(c, { spot: lv.spot, dvol: lv.dvol, netDelta: cb?.netDelta, netVega: cb?.netVega });
      }
    }, 4000);
    return () => { unsubs.forEach(u => u()); clearInterval(tick); };
  }, []);
}

// ── 应用内 Toast（即使未授权系统通知也能看到）────────────────────────────────
type Toast = AlertTriggerEvent & { key: number };

export const AlertToastHost: React.FC<{ hidden?: boolean }> = ({ hidden = false }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeAlertTriggers(e => {
    const key = Date.now() + Math.random();
    setToasts(t => [...t.slice(-4), { ...e, key }]);
    void notifyAlert(e);
    setTimeout(() => setToasts(t => t.filter(x => x.key !== key)), 9000);
  }), []);

  if (hidden || !toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const meta = METRIC_META[t.metric];
        return (
          <div key={t.key}
            className="pointer-events-auto relative w-[336px] overflow-hidden rounded-[8px]
                       border border-white/[0.07] bg-[rgba(21,23,25,0.92)]
                       shadow-[0_8px_25px_rgba(0,0,0,0.40)] backdrop-blur-[20px]
                       animate-[fadeIn_.16s_cubic-bezier(.2,.8,.2,1)]">
            <span className="absolute left-3 right-3 top-0 h-px bg-[#f7a600]/55" />
            <div className="px-3 py-3">
              <div className="flex items-start gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[#2B2D35]">
                  <img src="/icons/alerts.png" className="h-[22px] w-[22px] rounded-[6px]" alt="" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-semibold leading-5 text-white/92">{t.coin}</span>
                    <span className="rounded-[4px] bg-white/[0.08] px-1.5 py-[2px] text-[10px] font-semibold leading-none text-[#adb1b8]">
                      告警触发
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] leading-4 text-[#71757a]">
                    {new Date(t.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>

                <button onClick={() => setToasts(ts => ts.filter(x => x.key !== t.key))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/72">
                  <X size={15} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-[1fr_auto] gap-1.5">
                <div className="min-w-0 rounded-[4px] bg-[#2B2D35] px-2.5 py-2">
                  <div className="text-[10px] leading-none text-white/38">触发规则</div>
                  <div className="mt-1 truncate text-[12px] font-semibold leading-4 text-white/82">
                    {meta.label} <span className="font-mono tabular-nums">{t.op} {t.threshold}{meta.unit}</span>
                  </div>
                </div>
                <div className="min-w-[116px] rounded-[4px] bg-[#2B2D35] px-2.5 py-2 text-right">
                  <div className="text-[10px] leading-none text-white/38">当前值</div>
                  <div className="mt-1 font-mono text-[14px] font-semibold leading-4 tabular-nums text-[#f7a600]">
                    {t.value.toFixed(2)}{meta.unit}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
