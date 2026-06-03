import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, RefreshCw, Download, Wallet } from 'lucide-react';
import {
  getAccounts, subscribeAccounts, addAccount, removeAccount, ensureEnvAccounts,
} from './store';
import {
  loadAllFills, mergeFills, getLastSync, setLastSync, clearAccountData, exportFillsJson,
} from './fillStore';
import { ADAPTERS, PENDING_VENUES } from './adapters';
import type { Venue, VenueAccount, UnifiedPosition, UnifiedFill } from './types';

const UP = '#28C840';
const DOWN = '#FF5F57';
const MUTE = 'rgba(255,255,255,0.5)';

const fmtUsd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0);
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}$${s}`;
};
const fmtUsdPlain = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
const sgn = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : MUTE);
const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const inputCls = 'h-[32px] px-2 rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] text-[12px] text-white/85 outline-none focus:ring-white/20';

const Card = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex flex-col rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.06]">
    <div className="flex items-center px-4 pt-3 pb-2 shrink-0">
      <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    <div className="px-3 pb-3">{children}</div>
  </div>
);

interface SyncStat { when?: number; error?: string; added?: number }

export const AccountsHub = () => {
  const [accounts, setAccounts] = useState<VenueAccount[]>([...getAccounts()]);
  const [positions, setPositions] = useState<UnifiedPosition[]>([]);
  const [fills, setFills] = useState<UnifiedFill[]>(() => loadAllFills());
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<Record<string, SyncStat>>({});
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // 新增账户表单
  const [venue, setVenue] = useState<Venue>('Hyperliquid');
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    ensureEnvAccounts();            // 从 .env 自动建账户（HL 地址 / Bybit key）
    setAccounts([...getAccounts()]);
    return subscribeAccounts(() => setAccounts([...getAccounts()]));
  }, []);

  const syncAll = useCallback(async () => {
    const accts = getAccounts();
    if (!accts.length) { setPositions([]); return; }
    setSyncing(true);
    const allPos: UnifiedPosition[] = [];
    const stat: Record<string, SyncStat> = {};
    const BACKFILL_MS = 365 * 86_400_000; // 首次同步回拉最近 1 年
    for (const acct of accts) {
      const adapter = ADAPTERS[acct.venue];
      if (!adapter) { stat[acct.id] = { error: '待接入' }; continue; }
      try {
        const last = getLastSync(acct.venue, acct.id);
        const since = last > 0 ? last : Date.now() - BACKFILL_MS;
        const res = await adapter.sync(acct, since);
        const added = mergeFills(res.fills);
        // 同步成功 → 游标推进到现在（留 60s 重叠，靠 id 去重兜底），下次只增量拉新的
        setLastSync(acct.venue, acct.id, Date.now() - 60_000);
        allPos.push(...res.positions);
        stat[acct.id] = { when: Date.now(), added };
      } catch (e) {
        stat[acct.id] = { error: e instanceof Error ? e.message : '同步失败' };
      }
    }
    setPositions(allPos);
    setFills(loadAllFills());
    setStatus(stat);
    setLastSyncAt(Date.now());
    setSyncing(false);
  }, []);

  // 进入页面 / 账户变化 → 自动同步（syncAll 由 useCallback 稳定）
  useEffect(() => { void syncAll(); }, [accounts.length, syncAll]);

  const submitAdd = () => {
    if (venue === 'Hyperliquid') {
      const addr = address.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { alert('请填入有效的钱包地址（0x 开头 + 40 位）'); return; }
      addAccount({ venue, address: addr, label: label.trim() || `HL ${addr.slice(0, 6)}…${addr.slice(-4)}` });
      setAddress(''); setLabel('');
    } else if (venue === 'Bybit' || venue === 'Deribit') {
      addAccount({ venue, label: label.trim() || `${venue} 账户` });
      setLabel('');
    }
  };

  const onRemove = (a: VenueAccount) => {
    removeAccount(a.id);
    clearAccountData(a.venue, a.id);
    setFills(loadAllFills());
    setPositions(p => p.filter(x => x.accountId !== a.id));
  };

  // 已实现盈亏统计（来自本地累积的成交）
  const pnlByVenue = useMemo(() => {
    const m = new Map<Venue, { closed: number; fee: number; count: number }>();
    for (const f of fills) {
      const e = m.get(f.venue) ?? { closed: 0, fee: 0, count: 0 };
      e.closed += f.closedPnl; e.fee += f.fee; e.count += 1;
      m.set(f.venue, e);
    }
    return m;
  }, [fills]);
  const totalClosed = useMemo(() => fills.reduce((s, f) => s + f.closedPnl, 0), [fills]);
  const totalFee = useMemo(() => fills.reduce((s, f) => s + f.fee, 0), [fills]);

  const recentFills = useMemo(() => [...fills].sort((a, b) => b.time - a.time).slice(0, 60), [fills]);
  const noAccounts = accounts.length === 0;

  return (
    <div className="absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* 顶部：同步 / 导出 */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[13px] font-semibold text-white/75">全账户总览</span>
          <button onClick={() => void syncAll()} disabled={syncing || noAccounts}
            className="h-[30px] px-3 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/10 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-white/[0.1] transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? '同步中…' : '全部同步'}
          </button>
          <button onClick={exportFillsJson} disabled={fills.length === 0}
            className="h-[30px] px-3 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/10 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-white/[0.1] transition-colors disabled:opacity-40">
            <Download size={13} /> 导出备份
          </button>
          <span className="ml-auto text-[11px] text-white/35">
            {lastSyncAt ? `上次同步 ${fmtTime(lastSyncAt)}` : '进入即自动同步'} · 数据来自各所，本地存一份
          </span>
        </div>

        {/* 账户配置 */}
        <Card title="我的账户">
          <div className="flex flex-col gap-2">
            {accounts.map(a => {
              const st = status[a.id];
              return (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.05]">
                  <Wallet size={14} className="text-white/45 shrink-0" />
                  <span className="text-[12px] font-semibold text-white/80 w-[80px]">{a.venue}</span>
                  <span className="text-[12px] text-white/60 font-mono truncate flex-1">{a.label}{a.address ? `  ${a.address.slice(0, 8)}…${a.address.slice(-6)}` : ''}</span>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: st?.error ? DOWN : st?.when ? UP : MUTE }}>
                    {st?.error ? `✕ ${st.error}` : st?.when ? `✓ 同步 ${fmtTime(st.when)}${st.added ? ` · 新增 ${st.added}` : ''}` : '待同步'}
                  </span>
                  <button onClick={() => onRemove(a)} title="移除账户" className="text-white/30 hover:text-[#FF5F57] transition-colors p-1 shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}

            {/* 添加 */}
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/40">交易所</span>
                <select className={inputCls} value={venue} onChange={e => setVenue(e.target.value as Venue)}>
                  <option value="Hyperliquid">Hyperliquid（钱包地址）</option>
                  <option value="Bybit">Bybit（只读 API key）</option>
                  <option value="Deribit">Deribit（只读 API key）</option>
                  {PENDING_VENUES.map(v => <option key={v} value={v} disabled>{v}（待接入）</option>)}
                </select>
              </label>
              {venue === 'Hyperliquid' && (
                <label className="flex flex-col gap-1 flex-1 min-w-[280px]">
                  <span className="text-[10px] text-white/40">钱包地址（只读，不用任何密钥）</span>
                  <input className={`${inputCls} font-mono`} placeholder="0x…" value={address} onChange={e => setAddress(e.target.value)} />
                </label>
              )}
              {(venue === 'Bybit' || venue === 'Deribit') && (
                <div className="flex-1 min-w-[280px] text-[11px] text-white/45 leading-relaxed self-center">
                  使用 .env 里配置的 <b className="text-white/65">{venue} 只读</b> API key（VITE_{venue === 'Bybit' ? 'BYBIT' : 'DERIBIT'}_API_KEY/SECRET）。添加后「全部同步」拉持仓 + 最近 1 年成交。
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/40">备注（可选）</span>
                <input className={inputCls} placeholder={venue === 'Hyperliquid' ? '主钱包' : '我的 Bybit'} value={label} onChange={e => setLabel(e.target.value)} />
              </label>
              <button onClick={submitAdd}
                className="h-[32px] px-3 rounded-md bg-[#25e889]/15 text-[#25e889] ring-1 ring-inset ring-[#25e889]/30 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[#25e889]/25 transition-colors">
                <Plus size={14} /> 添加
              </button>
            </div>
            {noAccounts && (
              <div className="text-[11px] text-white/40 leading-relaxed pt-1">
                还没有账户。Hyperliquid 最简单：把你的**钱包地址**粘进来即可——只读、不需要任何 API 密钥、最安全。
                Bybit / Deribit / Binance 随后接入（需只读 API key）。
              </div>
            )}
          </div>
        </Card>

        {/* 已实现盈亏（来自本地累积成交） */}
        {fills.length > 0 && (
          <Card title="已实现盈亏（累计自本地记录）">
            <div className="flex gap-2.5 flex-wrap">
              <div className="flex-1 min-w-[150px] flex flex-col gap-1 px-4 py-3 rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]">
                <span className="text-[10px] uppercase tracking-wider text-white/45">合计净盈亏（扣费）</span>
                <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: sgn(totalClosed - totalFee) }}>{fmtUsd(totalClosed - totalFee)}</span>
                <span className="text-[10px] text-white/40">毛 {fmtUsd(totalClosed)} · 手续费 {fmtUsdPlain(totalFee)} · {fills.length} 笔</span>
              </div>
              {[...pnlByVenue.entries()].map(([v, e]) => (
                <div key={v} className="flex-1 min-w-[150px] flex flex-col gap-1 px-4 py-3 rounded-xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]">
                  <span className="text-[10px] uppercase tracking-wider text-white/45">{v}</span>
                  <span className="text-[18px] font-bold tabular-nums leading-none" style={{ color: sgn(e.closed - e.fee) }}>{fmtUsd(e.closed - e.fee)}</span>
                  <span className="text-[10px] text-white/40">{e.count} 笔 · 手续费 {fmtUsdPlain(e.fee)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 当前持仓（合并各账户） */}
        <Card title={`当前持仓 · ${positions.length}`}>
          {positions.length === 0 ? (
            <div className="h-[80px] flex items-center justify-center text-[12px] text-white/40">
              {syncing ? '同步中…' : noAccounts ? '添加账户后显示' : '无持仓 / 同步后显示'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium py-1.5 px-2">来源</th>
                    <th className="text-left font-medium py-1.5 px-2">币种</th>
                    <th className="text-right font-medium py-1.5 px-2">数量</th>
                    <th className="text-right font-medium py-1.5 px-2">开仓价</th>
                    <th className="text-right font-medium py-1.5 px-2">标记价</th>
                    <th className="text-right font-medium py-1.5 px-2">名义</th>
                    <th className="text-right font-medium py-1.5 px-2">未实现盈亏</th>
                    <th className="text-right font-medium py-1.5 px-2">强平价</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={`${p.venue}-${p.coin}-${i}`} className="border-t border-white/[0.05] hover:bg-white/[0.025]">
                      <td className="py-1.5 px-2 text-white/50">{p.venue}</td>
                      <td className="py-1.5 px-2 font-bold text-white/80">{p.coin}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: p.size >= 0 ? UP : DOWN }}>{p.size > 0 ? '+' : ''}{p.size}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{p.entryPx != null ? fmtUsdPlain(p.entryPx) : '—'}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{p.markPx != null ? fmtUsdPlain(p.markPx) : '—'}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{fmtUsdPlain(p.notionalUsd)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-semibold" style={{ color: p.unrealizedPnl != null ? sgn(p.unrealizedPnl) : MUTE }}>{p.unrealizedPnl != null ? fmtUsd(p.unrealizedPnl) : '—'}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white/45">{p.liqPx != null ? fmtUsdPlain(p.liqPx) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 成交记录（本地累积，最近 60 笔） */}
        {recentFills.length > 0 && (
          <Card title={`成交记录 · 本地共 ${fills.length} 笔（显示最近 60）`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium py-1.5 px-2">时间</th>
                    <th className="text-left font-medium py-1.5 px-2">来源</th>
                    <th className="text-left font-medium py-1.5 px-2">币种</th>
                    <th className="text-left font-medium py-1.5 px-2">方向</th>
                    <th className="text-right font-medium py-1.5 px-2">价格</th>
                    <th className="text-right font-medium py-1.5 px-2">数量</th>
                    <th className="text-left font-medium py-1.5 px-2">动作</th>
                    <th className="text-right font-medium py-1.5 px-2">已实现盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFills.map(f => (
                    <tr key={`${f.venue}:${f.id}`} className="border-t border-white/[0.05] hover:bg-white/[0.025]">
                      <td className="py-1.5 px-2 tabular-nums text-white/55 whitespace-nowrap">{fmtTime(f.time)}</td>
                      <td className="py-1.5 px-2 text-white/50">{f.venue}</td>
                      <td className="py-1.5 px-2 font-semibold text-white/75">{f.coin}</td>
                      <td className="py-1.5 px-2" style={{ color: f.side === 'buy' ? UP : DOWN }}>{f.side === 'buy' ? '买' : '卖'}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{fmtUsdPlain(f.px)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{f.size}</td>
                      <td className="py-1.5 px-2 text-white/45 whitespace-nowrap">{f.dir}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-semibold" style={{ color: f.closedPnl ? sgn(f.closedPnl) : MUTE }}>{f.closedPnl ? fmtUsd(f.closedPnl) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px] text-white/35 leading-relaxed">
              每次进入本页会从各账户增量拉取最新成交并合并进本地记录（只增不减）；交易所端是源头，本地是加速+多所合并的副本。
              建议偶尔点「导出备份」存一份 JSON，防清浏览器缓存丢数据。
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default AccountsHub;
