import React, { useEffect, useRef, useState } from 'react';
import { X, BellRing } from 'lucide-react';
import {
  DERIBIT_WS, evalAlerts, METRIC_META, subscribeAlertTriggers,
  type AlertTriggerEvent,
} from '../../registry/monitorWidgetsBase';
import type { Coin } from '../monitor/types';

const COINS: Coin[] = ['BTC', 'ETH'];

// 始终在线、永远只评估实时可得指标（spot/dvol）的两个；其余在监控数据新鲜时顺带评估。
export const ALWAYS_ON_METRICS = new Set(['spot', 'dvol']);

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
      for (const c of COINS) {
        const lv = live.current[c];
        evalAlerts(c, { spot: lv.spot, dvol: lv.dvol });
      }
    }, 4000);
    return () => { unsubs.forEach(u => u()); clearInterval(tick); };
  }, []);
}

// ── 应用内 Toast（即使未授权系统通知也能看到）────────────────────────────────
type Toast = AlertTriggerEvent & { key: number };

export const AlertToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeAlertTriggers(e => {
    const key = Date.now() + Math.random();
    setToasts(t => [...t.slice(-4), { ...e, key }]);
    setTimeout(() => setToasts(t => t.filter(x => x.key !== key)), 9000);
  }), []);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[300] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const meta = METRIC_META[t.metric];
        return (
          <div key={t.key}
            className="pointer-events-auto w-[300px] flex items-start gap-2.5 px-3.5 py-3 rounded-xl
                       bg-[#1a1410] ring-1 ring-inset ring-[#FEBC2E]/40 shadow-[0_16px_40px_rgba(0,0,0,0.55)]
                       animate-[fadeIn_.18s_ease-out]">
            <span className="w-7 h-7 rounded-lg bg-[#FEBC2E]/15 flex items-center justify-center shrink-0">
              <BellRing size={15} className="text-[#FEBC2E]" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-white/90">{t.coin} 告警触发</div>
              <div className="text-[11px] text-white/60 mt-0.5">
                {meta.label} {t.op} {t.threshold}{meta.unit}
                <span className="text-white/40"> · 当前 </span>
                <span className="font-semibold text-[#FEBC2E] tabular-nums">{t.value.toFixed(2)}{meta.unit}</span>
              </div>
            </div>
            <button onClick={() => setToasts(ts => ts.filter(x => x.key !== t.key))}
              className="text-white/30 hover:text-white/70 transition-colors shrink-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
