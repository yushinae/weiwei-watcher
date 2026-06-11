import React, { useEffect, useRef, useState } from 'react';
import { X, BellRing } from 'lucide-react';
import {
  DERIBIT_WS, evalAlerts, METRIC_META, subscribeAlertTriggers,
  type AlertTriggerEvent,
} from '../../registry/monitorWidgetsBase';
import { getBook } from '../accounts/bookStore';
import { fromAccounts, buildBooks } from '../portfolioRisk/aggregate';
import type { Coin } from '../monitor/types';
import { notifyAlert } from './notifications';

const COINS: Coin[] = ['BTC', 'ETH'];

// 始终在线、永远只评估实时可得指标（spot/dvol）的两个；其余在监控数据新鲜时顺带评估。
export const ALWAYS_ON_METRICS = new Set(['spot', 'dvol']);
// 盯持仓指标：基于「账户」页同步的真实持仓 + 实时现价（净 Delta 随价格实时变）。
export const BOOK_METRICS = new Set(['netDelta', 'netVega']);

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
            className="pointer-events-auto relative w-[292px] overflow-hidden rounded-[6px]
                       bg-[#15161d]/96 shadow-[0_10px_28px_rgba(0,0,0,0.45)]
                       ring-1 ring-inset ring-white/[0.08] backdrop-blur-md
                       animate-[fadeIn_.16s_cubic-bezier(.2,.8,.2,1)]">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-[#f7a600]" />
            <div className="flex items-start gap-2.5 px-3 py-2.5 pl-3.5">
              <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-[4px] bg-[#f7a600]/12 ring-1 ring-inset ring-[#f7a600]/18 shrink-0">
                <BellRing size={15} className="text-[#f7a600]" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-white/90">{t.coin}</span>
                  <span className="rounded-[4px] bg-white/[0.06] px-1.5 py-[1px] text-[10px] font-semibold text-[#adb1b8]">
                    告警触发
                  </span>
                </div>
                <div className="mt-1 text-[11px] leading-[15px] text-[#adb1b8]">
                  {meta.label} <span className="font-mono text-white/78">{t.op} {t.threshold}{meta.unit}</span>
                  <span className="text-[#71757a]"> · 当前 </span>
                  <span className="font-mono font-semibold text-[#f7a600] tabular-nums">{t.value.toFixed(2)}{meta.unit}</span>
                </div>
              </div>
              <button onClick={() => setToasts(ts => ts.filter(x => x.key !== t.key))}
                className="mt-0.5 grid h-6 w-6 place-items-center rounded-[4px] text-white/30 hover:bg-white/[0.06] hover:text-white/70 transition-colors shrink-0">
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
