import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import {
  ALERTS_STORE, METRIC_META, addAlert, removeAlert, toggleAlert, subscribeAlerts,
  type UserAlert, type AlertMetric, type AlertOp,
} from '../../registry/monitorWidgetsBase';
import type { Coin } from '../monitor/types';
import { ALWAYS_ON_METRICS, BOOK_METRICS } from './engine';
import { ensureAlertNotifications } from './notifications';

const COINS: Coin[] = ['BTC', 'ETH'];
const METRICS = Object.keys(METRIC_META) as AlertMetric[];

const inputCls = 'h-[32px] px-2 rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] text-[12px] text-white/85 outline-none focus:ring-white/20';

type Perm = 'default' | 'granted' | 'denied';
const getPerm = (): Perm => (typeof Notification !== 'undefined' ? (Notification.permission as Perm) : 'denied');

export const AlertsManager = () => {
  const [rules, setRules] = useState<UserAlert[]>([...ALERTS_STORE]);
  const [perm, setPerm] = useState<Perm>(getPerm());

  // 规则增删改 → 重渲染；并每 2s 刷新以显示引擎写入的 lastValue / triggered
  useEffect(() => {
    const unsub = subscribeAlerts(() => setRules([...ALERTS_STORE]));
    const t = setInterval(() => setRules([...ALERTS_STORE]), 2000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  const [coin, setCoin] = useState<Coin>('BTC');
  const [metric, setMetric] = useState<AlertMetric>('spot');
  const [op, setOp] = useState<AlertOp>('>');
  const [threshold, setThreshold] = useState<string>(String(METRIC_META.spot.defaultVal));

  const onMetric = (m: AlertMetric) => { setMetric(m); setThreshold(String(METRIC_META[m].defaultVal)); };

  const requestPerm = async () => {
    const p = await ensureAlertNotifications();
    setPerm(p as Perm);
  };

  const submit = () => {
    const th = Number(threshold);
    if (Number.isNaN(th)) return;
    addAlert({ coin, metric, op, threshold: th });
  };

  const sorted = useMemo(
    () => [...rules].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.triggered) - Number(a.triggered)),
    [rules],
  );

  return (
    <div className="absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* 通知权限条 */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.06] shrink-0">
          {perm === 'granted' ? (
            <><CheckCircle2 size={18} className="text-[#28C840] shrink-0" />
              <span className="text-[12px] text-white/75">浏览器通知已开启 —— 页面在后台时也会弹出系统通知；应用完全关闭后仍需后端常驻监控</span></>
          ) : perm === 'denied' ? (
            <><BellOff size={18} className="text-[#FF5F57] shrink-0" />
              <span className="text-[12px] text-white/75">浏览器通知被拒绝 —— 仍会在应用内弹 Toast；如需系统通知请在浏览器站点设置中允许</span></>
          ) : (
            <><Bell size={18} className="text-[#FEBC2E] shrink-0" />
              <span className="text-[12px] text-white/75">开启浏览器通知，标签页后台时也能收到告警</span>
              <button onClick={requestPerm}
                className="ml-auto h-[30px] px-3 rounded-md bg-[#FEBC2E]/15 text-[#FEBC2E] ring-1 ring-inset ring-[#FEBC2E]/30 text-[12px] font-semibold hover:bg-[#FEBC2E]/25 transition-colors">
                开启通知
              </button></>
          )}
        </div>

        {/* 新建规则 */}
        <div className="flex flex-col gap-2 px-4 py-3 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] shrink-0">
          <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">新建告警规则</span>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">标的</span>
              <select className={inputCls} value={coin} onChange={e => setCoin(e.target.value as Coin)}>
                {COINS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">指标</span>
              <select className={inputCls} value={metric} onChange={e => onMetric(e.target.value as AlertMetric)}>
                {METRICS.map(m => (
                  <option key={m} value={m}>{METRIC_META[m].label}{ALWAYS_ON_METRICS.has(m) ? ' ·常驻' : BOOK_METRICS.has(m) ? ' ·持仓' : ''}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">条件</span>
              <select className={inputCls} value={op} onChange={e => setOp(e.target.value as AlertOp)}>
                <option value=">">大于 &gt;</option>
                <option value="<">小于 &lt;</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">阈值（{METRIC_META[metric].unit}）</span>
              <input type="number" className={`${inputCls} w-[120px] tabular-nums`} value={threshold} onChange={e => setThreshold(e.target.value)} />
            </label>
            <button onClick={submit}
              className="h-[32px] px-3 rounded-md bg-[var(--color-brand)]/15 text-[var(--color-brand)] ring-1 ring-inset ring-[var(--color-brand)]/30 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[var(--color-brand)]/25 transition-colors">
              <Plus size={14} /> 添加
            </button>
          </div>
        </div>

        {/* 规则列表 */}
        <div className="flex flex-col rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06] flex-1">
          <div className="px-4 pt-3 pb-2 text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60 shrink-0">
            告警规则 · {rules.length}
          </div>
          <div className="px-3 pb-3">
            {rules.length === 0 ? (
              <div className="h-[120px] flex items-center justify-center text-[12px] text-white/40">
                还没有规则。用上面新建一条，例如「BTC Spot &lt; 60000」。
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium py-1.5 px-2">状态</th>
                    <th className="text-left font-medium py-1.5 px-2">标的</th>
                    <th className="text-left font-medium py-1.5 px-2">条件</th>
                    <th className="text-right font-medium py-1.5 px-2">当前值</th>
                    <th className="text-left font-medium py-1.5 px-2">触发</th>
                    <th className="py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(a => {
                    const meta = METRIC_META[a.metric];
                    return (
                      <tr key={a.id} className="border-t border-white/[0.05] hover:bg-white/[0.025]">
                        <td className="py-1.5 px-2">
                          <button onClick={() => toggleAlert(a.id)}
                            className={`text-[10px] px-2 py-0.5 rounded font-semibold ${a.active ? 'bg-[#28C840]/15 text-[#28C840]' : 'bg-white/[0.06] text-white/45'}`}>
                            {a.active ? '启用' : '停用'}
                          </button>
                        </td>
                        <td className="py-1.5 px-2 font-bold text-white/80">{a.coin}</td>
                        <td className="py-1.5 px-2 text-white/75 whitespace-nowrap">
                          {meta.label} {a.op} <span className="tabular-nums">{a.threshold}{meta.unit}</span>
                          {ALWAYS_ON_METRICS.has(a.metric) && <span className="ml-1.5 text-[9px] text-[#4ea1ff]">常驻</span>}
                          {BOOK_METRICS.has(a.metric) && <span className="ml-1.5 text-[9px] text-[#a78bfa]">持仓</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-white/65">
                          {a.lastValue != null ? `${a.lastValue.toFixed(2)}${meta.unit}` : '—'}
                        </td>
                        <td className="py-1.5 px-2">
                          {a.triggered
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEBC2E]/15 text-[#FEBC2E] font-semibold">已触发</span>
                            : <span className="text-[10px] text-white/35">监控中</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <button onClick={() => removeAlert(a.id)} title="删除"
                            className="text-white/30 hover:text-[#FF5F57] transition-colors p-1">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-4 pb-3 text-[10px] text-white/35 leading-relaxed">
            <b className="text-white/45">常驻</b> 指标（Spot / DVOL）经全局 WebSocket 实时评估，**离开本页、切到其它标签页时也持续判定并推送**。
            <b className="text-[#a78bfa]">持仓</b> 指标（净$Delta / 净$Vega）基于「账户」页同步的真实持仓 + 实时现价（净Delta随价格实时变）——需先到「账户」页同步过一次。
            其余指标（IV 百分位 / 资金费率 / 情绪 / 资金流）依赖监控页数据，缓存新鲜时评估。
            浏览器后台通知已接入 Service Worker；但交易所行情仍由前端页面维护，应用完全关闭后的持续监控需本地/云端后端。
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertsManager;
