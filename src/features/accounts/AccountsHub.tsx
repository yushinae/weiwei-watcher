import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, RefreshCw, Download, Wallet, Upload, X, Settings } from 'lucide-react';
import {
  getAccounts, subscribeAccounts, addAccount, removeAccount, ensureEnvAccounts,
} from './store';
import {
  loadAllFills, mergeFills, getLastSync, setLastSync, clearAccountData, exportFillsJson,
} from './fillStore';
import { setBook } from './bookStore';
import { ADAPTERS, PENDING_VENUES } from './adapters';
import { parseFile, rowsToFills, type CsvParsed, type Field } from './csvImport';
import type { Venue, VenueAccount, UnifiedPosition, UnifiedFill } from './types';
import { useGlobalOptionBook } from '../optionsChain/optionBookStore';

const ALL_VENUES: Venue[] = ['Hyperliquid', 'Bybit', 'Deribit', 'Binance'];
const FIELD_LABEL: Record<Field, string> = { time: '时间', symbol: '合约', side: '方向', price: '价格', qty: '数量', fee: '手续费', pnl: '已实现盈亏' };

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

const inputCls = 'h-[32px] px-2 rounded-md bg-[var(--color-surface-1)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[12px] text-white/85 outline-none focus:ring-[var(--nexus-accent)]/40';

// 账户筛选 chip 样式
const chipCls = (active: boolean) =>
  `h-[28px] px-3 rounded-full text-[12px] font-medium flex items-center gap-1.5 ring-1 ring-inset transition-colors ${
    active ? 'bg-[var(--color-brand)]/15 text-[var(--color-brand)] ring-[var(--color-brand)]/40'
           : 'bg-[var(--color-surface-2)] text-white/65 ring-[var(--color-border-subtle)] hover:bg-[var(--color-surface-5)]'}`;

const Card = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex flex-col rounded-[8px] bg-[var(--color-bg-card)] ring-1 ring-inset ring-[var(--color-border-subtle)] shadow-[0_8px_22px_-14px_rgba(0,0,0,0.72)]">
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
  const [filterAcctId, setFilterAcctId] = useState<string | null>(null); // null = 全部；'SIM' = 模拟仓
  const [showManage, setShowManage] = useState(false);                   // 账户管理面板默认折叠
  const sim = useGlobalOptionBook();                                     // 与期权链共用的持久化模拟簿
  const isSim = filterAcctId === 'SIM';
  const simNetPnl = useMemo(() => sim.positions.reduce((s, p) => s + p.unrealizedPnL, 0), [sim.positions]);
  const simFee = useMemo(() => sim.fills.reduce((s, f) => s + f.fee, 0), [sim.fills]);
  const simRecent = useMemo(() => [...sim.fills].sort((a, b) => b.timestamp - a.timestamp).slice(0, 40), [sim.fills]);

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
    setBook(allPos); // 供全局告警引擎评估盯持仓告警
    setFills(loadAllFills());
    setStatus(stat);
    setLastSyncAt(Date.now());
    setSyncing(false);
  }, []);

  // 进入页面 / 账户变化 → 自动同步（syncAll 由 useCallback 稳定）
  useEffect(() => { void syncAll(); }, [accounts.length, syncAll]);

  // 被筛选的账户若被移除 → 回到「全部」（'SIM' 模拟仓不属于任何账户，豁免）
  useEffect(() => {
    if (filterAcctId && filterAcctId !== 'SIM' && !accounts.some(a => a.id === filterAcctId)) setFilterAcctId(null);
  }, [accounts, filterAcctId]);

  const submitAdd = () => {
    if (venue === 'Hyperliquid') {
      const addr = address.trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { alert('请填入有效的钱包地址（0x 开头 + 40 位）'); return; }
      addAccount({ venue, address: addr, label: label.trim() || `HL ${addr.slice(0, 6)}…${addr.slice(-4)}` });
      setAddress(''); setLabel('');
    } else if (venue === 'Bybit' || venue === 'Deribit' || venue === 'Binance') {
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

  // 账户筛选（null = 全部）→ 持仓 / 盈亏 / 成交 全部按它过滤
  const viewFills = useMemo(() => filterAcctId ? fills.filter(f => f.accountId === filterAcctId) : fills, [fills, filterAcctId]);
  const viewPositions = useMemo(() => filterAcctId ? positions.filter(p => p.accountId === filterAcctId) : positions, [positions, filterAcctId]);

  // 已实现盈亏统计（来自本地累积的成交，按筛选）
  const pnlByVenue = useMemo(() => {
    const m = new Map<Venue, { closed: number; fee: number; count: number }>();
    for (const f of viewFills) {
      const e = m.get(f.venue) ?? { closed: 0, fee: 0, count: 0 };
      e.closed += f.closedPnl; e.fee += f.fee; e.count += 1;
      m.set(f.venue, e);
    }
    return m;
  }, [viewFills]);
  const totalClosed = useMemo(() => viewFills.reduce((s, f) => s + f.closedPnl, 0), [viewFills]);
  const totalFee = useMemo(() => viewFills.reduce((s, f) => s + f.fee, 0), [viewFills]);

  const recentFills = useMemo(() => [...viewFills].sort((a, b) => b.time - a.time).slice(0, 60), [viewFills]);
  const noAccounts = accounts.length === 0;

  // ── CSV 导入 ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<(CsvParsed & { venue: Venue }) | null>(null);

  const onCsvFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseFile(await file.text());
    const fn = file.name.toLowerCase();
    const guess: Venue = fn.includes('bybit') ? 'Bybit' : fn.includes('deribit') ? 'Deribit'
      : fn.includes('binance') ? 'Binance' : fn.includes('hyper') ? 'Hyperliquid' : 'Bybit';
    setCsv({ ...parsed, venue: guess });
  };

  const csvFills = useMemo(() => (csv ? rowsToFills(csv.dataRows, csv.mapping, csv.venue) : []), [csv]);
  const csvPnl = useMemo(() => csvFills.reduce((s, f) => s + f.closedPnl - f.fee, 0), [csvFills]);

  const confirmImport = () => {
    if (!csvFills.length) return;
    const added = mergeFills(csvFills);
    setFills(loadAllFills());
    setCsv(null);
    if (fileRef.current) fileRef.current.value = '';
    alert(`已导入 ${added} 笔（去重后）`);
  };
  const cancelImport = () => { setCsv(null); if (fileRef.current) fileRef.current.value = ''; };

  return (
    <div className="accounts-page absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full">

        {/* 顶部：同步 / 导出 */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[13px] font-semibold text-white/75">全账户总览</span>
          <button onClick={() => void syncAll()} disabled={syncing || noAccounts}
            className="h-[30px] px-3 rounded-md bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[var(--color-surface-5)] transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? '同步中…' : '全部同步'}
          </button>
          <button onClick={exportFillsJson} disabled={fills.length === 0}
            className="h-[30px] px-3 rounded-md bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[var(--color-surface-5)] transition-colors disabled:opacity-40">
            <Download size={13} /> 导出备份
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="h-[30px] px-3 rounded-md bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[var(--color-surface-5)] transition-colors">
            <Upload size={13} /> 导入 CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => void onCsvFile(e.target.files?.[0])} />
          <span className="ml-auto text-[11px] text-white/35">
            {lastSyncAt ? `上次同步 ${fmtTime(lastSyncAt)}` : '进入即自动同步'} · 数据来自各所，本地存一份
          </span>
        </div>

        {/* CSV 导入预览 */}
        {csv && (
          <div className="flex flex-col gap-2.5 px-4 py-3 rounded-xl bg-[var(--nexus-accent)]/[0.06] ring-1 ring-inset ring-[var(--nexus-accent)]/25 shrink-0">
            <div className="flex items-center gap-2">
              <Upload size={14} className="text-[var(--nexus-accent)]" />
              <span className="text-[12px] font-semibold text-white/80">CSV 导入预览</span>
              <span className="text-[11px] text-white/40">解析 {csv.dataRows.length} 行 · 识别有效成交 {csvFills.length} 笔</span>
              <button onClick={cancelImport} className="ml-auto text-white/35 hover:text-white/70"><X size={15} /></button>
            </div>

            <div className="flex items-end gap-2 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/40">归属交易所</span>
                <select className={inputCls} value={csv.venue} onChange={e => setCsv({ ...csv, venue: e.target.value as Venue })}>
                  {ALL_VENUES.map(v => <option key={v} value={v}>{v}</option>)}
                  <option value="Binance">其它</option>
                </select>
              </label>
              {(Object.keys(FIELD_LABEL) as Field[]).map(f => (
                <label key={f} className="flex flex-col gap-1">
                  <span className="text-[10px] text-white/40">{FIELD_LABEL[f]}{csv.mapping[f] < 0 && f !== 'fee' && f !== 'pnl' ? ' ⚠️' : ''}</span>
                  <select className={`${inputCls} max-w-[130px]`} value={csv.mapping[f]}
                    onChange={e => setCsv({ ...csv, mapping: { ...csv.mapping, [f]: Number(e.target.value) } })}>
                    <option value={-1}>—（无）</option>
                    {csv.header.map((h, i) => <option key={i} value={i}>{h || `列${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>

            {/* 样本预览 */}
            {csvFills.length > 0 && (
              <div className="text-[11px] text-white/55 font-mono tabular-nums overflow-x-auto">
                <div className="text-white/35 mb-0.5">前 3 笔预览：</div>
                {csvFills.slice(0, 3).map((f, i) => (
                  <div key={i} className="whitespace-nowrap">
                    {fmtTime(f.time)} · {f.coin} · {f.side === 'buy' ? '买' : '卖'} · @{f.px} × {f.size} · 盈亏 <span style={{ color: sgn(f.closedPnl) }}>{fmtUsd(f.closedPnl)}</span></div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <span className="text-[12px]">识别已实现盈亏合计 <b style={{ color: sgn(csvPnl) }}>{fmtUsd(csvPnl)}</b></span>
              <button onClick={confirmImport} disabled={!csvFills.length}
                className="ml-auto h-[30px] px-3 rounded-md bg-[var(--color-brand)]/15 text-[var(--color-brand)] ring-1 ring-inset ring-[var(--color-brand)]/30 text-[12px] font-semibold hover:bg-[var(--color-brand)]/25 transition-colors disabled:opacity-40">
                确认导入 {csvFills.length} 笔
              </button>
              <button onClick={cancelImport} className="h-[30px] px-3 rounded-md bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[12px] font-semibold text-white/65 hover:bg-[var(--color-surface-5)]">取消</button>
            </div>
            <div className="text-[10px] text-white/35 leading-relaxed">
              用于补齐 API 够不到的更早历史。⚠️ 与「全部同步」已拉到的同期数据可能重复计入（两者去重 id 不同），建议只导入 API 窗口之外的时段；同一文件重复导入会自动去重。
            </div>
          </div>
        )}

        {/* 账户筛选条（紧凑）+ 管理面板（默认折叠）*/}
        <Card
          title="我的账户"
          right={!noAccounts && (
            <button onClick={() => setShowManage(v => !v)}
              className="h-[26px] px-2.5 rounded-md bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[11px] font-semibold text-white/55 flex items-center gap-1.5 hover:bg-[var(--color-surface-5)] transition-colors">
              <Settings size={12} /> {showManage ? '收起' : '管理'}
            </button>
          )}
        >
          {/* 筛选 chip：全部 + 每个账户（带同步状态点）→ 过滤下方持仓/盈亏/成交 */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setFilterAcctId(null)} className={chipCls(filterAcctId === null)}>全部</button>
            {accounts.map(a => {
              const st = status[a.id];
              const dot = st?.error ? DOWN : st?.when ? UP : MUTE;
              const tip = st?.error ? `✕ ${st.error}` : st?.when ? `✓ 同步 ${fmtTime(st.when)}${st.added ? ` · 新增 ${st.added}` : ''}` : '待同步';
              return (
                <button key={a.id} onClick={() => setFilterAcctId(a.id)} title={tip} className={chipCls(filterAcctId === a.id)}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                  {a.venue}
                </button>
              );
            })}
            <button onClick={() => setFilterAcctId('SIM')} className={chipCls(isSim)} title="期权链页的模拟下单仓位">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#FEBC2E' }} />
              模拟{sim.positions.length ? ` · ${sim.positions.length}` : ''}
            </button>
            {!noAccounts && (
              <span className="ml-auto text-[10px] text-white/30">
                {isSim ? '模拟试盘 · 不影响真实账户' : filterAcctId ? '已筛选 · 点「全部」清除' : `${accounts.length} 个账户`}
              </span>
            )}
          </div>

          {/* 管理面板（增删账户；默认折叠，无账户时强制展开）*/}
          {(showManage || noAccounts) && (
          <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-white/[0.06]">
            {accounts.map(a => {
              const st = status[a.id];
              return (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)]">
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
                  <option value="Binance">Binance（只读 API key）</option>
                  {PENDING_VENUES.map(v => <option key={v} value={v} disabled>{v}（待接入）</option>)}
                </select>
              </label>
              {venue === 'Hyperliquid' && (
                <label className="flex flex-col gap-1 flex-1 min-w-[280px]">
                  <span className="text-[10px] text-white/40">钱包地址（只读，不用任何密钥）</span>
                  <input className={`${inputCls} font-mono`} placeholder="0x…" value={address} onChange={e => setAddress(e.target.value)} />
                </label>
              )}
              {(venue === 'Bybit' || venue === 'Deribit' || venue === 'Binance') && (
                <div className="flex-1 min-w-[280px] text-[11px] text-white/45 leading-relaxed self-center">
                  使用 .env 里配置的 <b className="text-white/65">{venue} 只读</b> API key（VITE_{venue.toUpperCase()}_API_KEY/SECRET）。添加后「全部同步」拉持仓 + 最近 1 年成交。
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/40">备注（可选）</span>
                <input className={inputCls} placeholder={venue === 'Hyperliquid' ? '主钱包' : '我的 Bybit'} value={label} onChange={e => setLabel(e.target.value)} />
              </label>
              <button onClick={submitAdd}
                className="h-[32px] px-3 rounded-md bg-[var(--color-brand)]/15 text-[var(--color-brand)] ring-1 ring-inset ring-[var(--color-brand)]/30 text-[12px] font-semibold flex items-center gap-1.5 hover:bg-[var(--color-brand)]/25 transition-colors">
                <Plus size={14} /> 添加
              </button>
            </div>
            {noAccounts && (
              <div className="text-[11px] text-white/40 leading-relaxed pt-1">
                还没有账户。Hyperliquid 最简单：把你的**钱包地址**粘进来即可——只读、不需要任何 API 密钥、最安全。
                Bybit / Deribit / Binance 需只读 API key。
              </div>
            )}
          </div>
          )}
        </Card>

        {/* 已实现盈亏（来自本地累积成交，按筛选）*/}
        {!isSim && viewFills.length > 0 && (
          <Card title={`已实现盈亏${filterAcctId ? `（${accounts.find(a => a.id === filterAcctId)?.venue ?? ''}）` : '（累计自本地记录）'}`}>
            <div className="flex gap-2.5 flex-wrap">
              <div className="flex-1 min-w-[150px] flex flex-col gap-1 px-4 py-3 rounded-xl bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)]">
                <span className="text-[10px] uppercase tracking-wider text-white/45">{filterAcctId ? '净盈亏（扣费）' : '合计净盈亏（扣费）'}</span>
                <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: sgn(totalClosed - totalFee) }}>{fmtUsd(totalClosed - totalFee)}</span>
                <span className="text-[10px] text-white/40">毛 {fmtUsd(totalClosed)} · 手续费 {fmtUsdPlain(totalFee)} · {viewFills.length} 笔</span>
              </div>
              {/* 仅「全部」时展开各所拆解；筛选到单账户时上面那张已是该所合计 */}
              {filterAcctId === null && [...pnlByVenue.entries()].map(([v, e]) => (
                <div key={v} className="flex-1 min-w-[150px] flex flex-col gap-1 px-4 py-3 rounded-xl bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)]">
                  <span className="text-[10px] uppercase tracking-wider text-white/45">{v}</span>
                  <span className="text-[18px] font-bold tabular-nums leading-none" style={{ color: sgn(e.closed - e.fee) }}>{fmtUsd(e.closed - e.fee)}</span>
                  <span className="text-[10px] text-white/40">{e.count} 笔 · 手续费 {fmtUsdPlain(e.fee)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 当前持仓（合并各账户，按筛选） */}
        {!isSim && (
        <Card title={`当前持仓 · ${viewPositions.length}`}>
          {viewPositions.length === 0 ? (
            <div className="h-[80px] flex items-center justify-center text-[12px] text-white/40">
              {syncing ? '同步中…' : noAccounts ? '添加账户后显示' : filterAcctId ? '该账户无持仓' : '无持仓 / 同步后显示'}
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
                  {viewPositions.map((p, i) => (
                    <tr key={`${p.venue}-${p.coin}-${i}`} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]">
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
        )}

        {/* 成交记录（本地累积，最近 60 笔，按筛选） */}
        {!isSim && recentFills.length > 0 && (
          <Card title={`成交记录 · ${filterAcctId ? '' : '本地'}共 ${viewFills.length} 笔（显示最近 60）`}>
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
                    <tr key={`${f.venue}:${f.id}`} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]">
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

        {/* ── 模拟仓（持久化，来自期权链下单）── */}
        {isSim && (
          <>
            <Card title="模拟仓概览" right={
              (sim.positions.length > 0 || sim.fills.length > 0) ? (
                <button onClick={() => { if (window.confirm('清空所有模拟持仓 / 挂单 / 成交？不可撤销。')) sim.clearBook(); }}
                  className="h-[26px] px-2.5 rounded-md bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] text-[11px] font-semibold text-white/55 hover:text-[#FF5F57] hover:bg-[var(--color-surface-5)] transition-colors">
                  清空模拟
                </button>
              ) : null
            }>
              <div className="flex gap-2.5 flex-wrap">
                <div className="flex-1 min-w-[160px] flex flex-col gap-1 px-4 py-3 rounded-xl bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)]">
                  <span className="text-[10px] uppercase tracking-wider text-white/45">浮动盈亏（盯市）</span>
                  <span className="text-[22px] font-bold tabular-nums leading-none" style={{ color: sgn(simNetPnl) }}>{fmtUsd(simNetPnl)}</span>
                  <span className="text-[10px] text-white/40">{sim.positions.length} 持仓 · {sim.openOrders.length} 挂单 · 手续费 {fmtUsdPlain(simFee)}</span>
                </div>
                <div className="flex-[2] min-w-[220px] flex items-center px-4 py-3 rounded-xl bg-[#FEBC2E]/[0.06] ring-1 ring-inset ring-[#FEBC2E]/20">
                  <span className="text-[11px] text-white/60 leading-relaxed">模拟试盘 —— 来自「期权」页的模拟下单，本地存储（换设备/清缓存会丢）。<b className="text-[#FEBC2E]/90">不影响任何真实账户</b>。标记价在你打开期权链时盯市更新。</span>
                </div>
              </div>
            </Card>

            {sim.positions.length === 0 ? (
              <Card title="模拟持仓 · 0">
                <div className="h-[80px] flex items-center justify-center text-[12px] text-white/40">
                  还没有模拟持仓 —— 去「期权」页选个合约，下个模拟单试试
                </div>
              </Card>
            ) : (
              <Card title={`模拟持仓 · ${sim.positions.length}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                        <th className="text-left font-medium py-1.5 px-2">合约</th>
                        <th className="text-left font-medium py-1.5 px-2">方向</th>
                        <th className="text-right font-medium py-1.5 px-2">数量</th>
                        <th className="text-right font-medium py-1.5 px-2">开仓价</th>
                        <th className="text-right font-medium py-1.5 px-2">标记价</th>
                        <th className="text-right font-medium py-1.5 px-2">浮动盈亏</th>
                        <th className="text-right font-medium py-1.5 px-2">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.positions.map(p => (
                        <tr key={p.id} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]">
                          <td className="py-1.5 px-2 font-semibold text-white/80">{p.symbol}</td>
                          <td className="py-1.5 px-2" style={{ color: p.side === 'long' ? UP : DOWN }}>{p.side === 'long' ? '多' : '空'}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/70">{p.qty}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{p.avgEntryPrice.toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{p.markPrice.toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-semibold" style={{ color: sgn(p.unrealizedPnL) }}>{fmtUsd(p.unrealizedPnL)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/50">{p.delta.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {sim.openOrders.length > 0 && (
              <Card title={`模拟挂单 · ${sim.openOrders.length}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                        <th className="text-left font-medium py-1.5 px-2">合约</th>
                        <th className="text-left font-medium py-1.5 px-2">方向</th>
                        <th className="text-left font-medium py-1.5 px-2">类型</th>
                        <th className="text-right font-medium py-1.5 px-2">数量</th>
                        <th className="text-right font-medium py-1.5 px-2">限价</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.openOrders.map(o => (
                        <tr key={o.id} className="border-t border-[var(--color-border-subtle)]">
                          <td className="py-1.5 px-2 font-semibold text-white/75">{o.symbol}</td>
                          <td className="py-1.5 px-2" style={{ color: o.side === 'buy' ? UP : DOWN }}>{o.side === 'buy' ? '买' : '卖'}</td>
                          <td className="py-1.5 px-2 text-white/50">{o.type}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{o.qty}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{o.price.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {simRecent.length > 0 && (
              <Card title={`模拟成交 · ${sim.fills.length} 笔（显示最近 40）`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-white/40 text-[10px] uppercase tracking-wider">
                        <th className="text-left font-medium py-1.5 px-2">时间</th>
                        <th className="text-left font-medium py-1.5 px-2">合约</th>
                        <th className="text-left font-medium py-1.5 px-2">方向</th>
                        <th className="text-right font-medium py-1.5 px-2">价格</th>
                        <th className="text-right font-medium py-1.5 px-2">数量</th>
                        <th className="text-right font-medium py-1.5 px-2">手续费</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simRecent.map(f => (
                        <tr key={f.id} className="border-t border-[var(--color-border-subtle)]">
                          <td className="py-1.5 px-2 tabular-nums text-white/55 whitespace-nowrap">{fmtTime(f.timestamp)}</td>
                          <td className="py-1.5 px-2 font-semibold text-white/75">{f.symbol}</td>
                          <td className="py-1.5 px-2" style={{ color: f.side === 'buy' ? UP : DOWN }}>{f.side === 'buy' ? '买' : '卖'}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{f.price.toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/65">{f.qty}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-white/45">{fmtUsdPlain(f.fee)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AccountsHub;
