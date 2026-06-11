import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, MonitorSmartphone, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { authClient } from '../lib/authClient';

const inputCls = 'h-[34px] px-3 rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] text-[12px] text-white/85 outline-none focus:ring-white/25 placeholder:text-white/25';
const btnCls = 'h-[32px] px-3 rounded-md text-[12px] font-semibold ring-1 ring-inset transition-colors disabled:opacity-50';

const fmtTime = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—';

const Card = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex flex-col gap-3 px-4 py-3 rounded-[8px] bg-[var(--color-bg-card)] ring-1 ring-inset ring-[var(--color-border-subtle)] shrink-0">
    <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.02em] text-white/60">
      {icon}{title}
    </span>
    {children}
  </div>
);

// ── 交易所 API key ───────────────────────────────────────────────────────────
interface KeyRow {
  id: string; venue: string; label: string; apiKeyMasked: string;
  perms: string | null; createdAt: string; lastUsedAt: string | null;
}

const ExchangeKeysCard = () => {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [venue, setVenue] = useState('deribit');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/keys');
    if (res.ok) setRows(await res.json());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue, label, apiKey, apiSecret }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? `添加失败（${res.status}）` });
      } else {
        setMsg({ ok: true, text: '验证通过，已加密保存' });
        setLabel(''); setApiKey(''); setApiSecret('');
        await refresh();
      }
    } catch {
      setMsg({ ok: false, text: '无法连接服务器' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: KeyRow) => {
    if (!window.confirm(`删除 ${row.venue} key「${row.label}」？删除后无法恢复，需要重新添加。`)) return;
    await fetch(`/api/keys/${row.id}`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <Card title="交易所 API key" icon={<KeyRound size={14} />}>
      {rows.length === 0 ? (
        <span className="text-[12px] text-white/40">还没有绑定任何交易所 key</span>
      ) : (
        <div className="flex flex-col">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2 border-t border-white/[0.06] first:border-t-0">
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-semibold text-white/85">{r.venue} · {r.label}</span>
                <span className="text-[11px] font-mono text-white/40">{r.apiKeyMasked}</span>
              </div>
              <span className="text-[11px] text-white/35 truncate flex-1" title={r.perms ?? ''}>{r.perms ?? ''}</span>
              <span className="text-[11px] text-white/30 shrink-0">添加于 {fmtTime(r.createdAt)}</span>
              <button onClick={() => void remove(r)} title="删除"
                className="p-1.5 rounded-md text-white/35 hover:text-[#FF5F57] hover:bg-[#FF5F57]/10 transition-colors shrink-0">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 pt-2 border-t border-white/[0.06]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/40">交易所</span>
          <select className={inputCls} value={venue} onChange={(e) => setVenue(e.target.value)}>
            <option value="deribit">Deribit</option>
            <option value="bybit">Bybit</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/40">备注名</span>
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="主账户" />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-[10px] text-white/40">API key</span>
          <input className={`${inputCls} w-full`} required value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-[10px] text-white/40">API secret</span>
          <input className={`${inputCls} w-full`} required type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" />
        </label>
        <button type="submit" disabled={busy}
          className={`${btnCls} flex items-center gap-1.5 bg-[var(--bb-orange)]/15 text-[var(--bb-orange)] ring-[var(--bb-orange)]/30 hover:bg-[var(--bb-orange)]/25`}>
          <Plus size={13} />{busy ? '验证中…' : '添加'}
        </button>
      </form>

      {msg && (
        <span className={`text-[12px] ${msg.ok ? 'text-[#28C840]' : 'text-[#FF8A84]'}`}>{msg.text}</span>
      )}
      <span className="text-[11px] text-white/30">
        添加时服务端会先调交易所验证：带提币权限的 key 直接拒收。secret 加密入库后不再显示、不回传前端。
      </span>
    </Card>
  );
};

// ── 修改密码 ─────────────────────────────────────────────────────────────────
const PasswordCard = () => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (res.error) {
      setMsg({ ok: false, text: res.error.code === 'INVALID_PASSWORD' ? '当前密码不对' : (res.error.message ?? '修改失败') });
    } else {
      setMsg({ ok: true, text: '已修改，其它设备已全部下线' });
      setCurrent(''); setNext('');
    }
  };

  return (
    <Card title="修改密码" icon={<ShieldCheck size={14} />}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/40">当前密码</span>
          <input className={inputCls} type="password" required value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/40">新密码（至少 8 位）</span>
          <input className={inputCls} type="password" required minLength={8} value={next}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <button type="submit" disabled={busy}
          className={`${btnCls} bg-white/[0.06] text-white/75 ring-white/[0.1] hover:bg-white/[0.1]`}>
          {busy ? '提交中…' : '修改密码'}
        </button>
      </form>
      {msg && <span className={`text-[12px] ${msg.ok ? 'text-[#28C840]' : 'text-[#FF8A84]'}`}>{msg.text}</span>}
    </Card>
  );
};

// ── 登录设备 ─────────────────────────────────────────────────────────────────
interface SessionRow {
  token: string; userAgent?: string | null; ipAddress?: string | null;
  createdAt: string | Date; expiresAt: string | Date;
}

const SessionsCard = ({ currentToken }: { currentToken: string | undefined }) => {
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const refresh = useCallback(async () => {
    const res = await authClient.listSessions();
    if (res.data) setSessions(res.data as SessionRow[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = async (token: string) => {
    await authClient.revokeSession({ token });
    await refresh();
  };

  return (
    <Card title="登录设备" icon={<MonitorSmartphone size={14} />}>
      <div className="flex flex-col">
        {sessions.map((s) => {
          const isCurrent = s.token === currentToken;
          return (
            <div key={s.token} className="flex items-center gap-3 py-2 border-t border-white/[0.06] first:border-t-0">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[12px] text-white/75 truncate">{s.userAgent || '未知设备'}</span>
                <span className="text-[11px] text-white/35">{s.ipAddress || '—'} · 登录于 {fmtTime(s.createdAt)}</span>
              </div>
              {isCurrent ? (
                <span className="text-[11px] text-[#28C840] shrink-0">当前会话</span>
              ) : (
                <button onClick={() => void revoke(s.token)}
                  className={`${btnCls} bg-white/[0.06] text-white/60 ring-white/[0.1] hover:text-[#FF8A84] shrink-0`}>
                  注销
                </button>
              )}
            </div>
          );
        })}
        {sessions.length === 0 && <span className="text-[12px] text-white/40">加载中…</span>}
      </div>
    </Card>
  );
};

// ── 页面 ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  const logout = async () => {
    await authClient.signOut();
    navigate('/login', { replace: true });
  };

  if (isPending) {
    return <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40">加载中…</div>;
  }

  if (!session) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-[10px] bg-[var(--color-bg-card)] ring-1 ring-inset ring-[var(--color-border-subtle)]">
          <span className="text-[13px] text-white/70">设置页需要先登录</span>
          <Link to="/login"
            className="h-[34px] px-4 flex items-center rounded-md bg-[var(--bb-orange)]/15 text-[var(--bb-orange)] ring-1 ring-inset ring-[var(--bb-orange)]/30 text-[13px] font-bold hover:bg-[var(--bb-orange)]/25 transition-colors">
            去登录 / 注册
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto dash-scroll text-white/85">
      <div className="flex flex-col gap-3 p-3 min-h-full max-w-[920px]">
        <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-[var(--color-surface-2)] ring-1 ring-inset ring-[var(--color-border-subtle)] shrink-0">
          <div className="w-9 h-9 rounded-full bg-[var(--bb-orange)]/20 flex items-center justify-center text-[13px] font-bold text-[var(--bb-orange)] shrink-0">
            {(session.user.name || session.user.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-white/85">{session.user.name || '未设置昵称'}</span>
            <span className="text-[12px] text-white/45">{session.user.email}</span>
          </div>
          <button onClick={() => void logout()}
            className={`${btnCls} ml-auto flex items-center gap-1.5 bg-white/[0.06] text-white/60 ring-white/[0.1] hover:text-[#FF8A84]`}>
            <LogOut size={13} />退出登录
          </button>
        </div>

        <ExchangeKeysCard />
        <PasswordCard />
        <SessionsCard currentToken={session.session?.token} />
      </div>
    </div>
  );
}
