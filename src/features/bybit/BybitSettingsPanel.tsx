import React, { useState } from 'react';
import { cn } from '../../lib/utils';
import {
  hasCredentials, isUnlocked,
  saveCredentials, clearCredentials,
  getApiKey,
} from './auth';
import { useBybitAuthState } from './usePositions';

// ─────────────────────────────────────────────────────────────────────────────
// Simplified settings: just API key + secret, no PIN, no lock/unlock.
// ─────────────────────────────────────────────────────────────────────────────

export function BybitSettingsPanel({ onClose }: { onClose?: () => void }) {
  const unlocked = useBybitAuthState();
  const stored = hasCredentials();

  if (!stored) return <SetupForm onSaved={onClose} />;
  return <ManageForm onClose={onClose} />;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-white/55 font-semibold">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-white/50">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[12px] font-mono text-slate-200 outline-none focus:border-white/30 placeholder:text-slate-700';
const btnPrimary =
  'h-9 px-4 rounded-lg text-[12px] font-semibold bg-brand/15 border border-brand/40 text-brand hover:bg-brand/25 transition-colors';
const btnGhost =
  'h-9 px-4 rounded-lg text-[12px] font-semibold border border-white/12 text-white/70 hover:bg-white/8 transition-colors';

function SetupForm({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    if (!apiKey.trim() || !apiSecret.trim()) { setErr('API key 和 secret 都要填'); return; }
    saveCredentials(apiKey.trim(), apiSecret.trim());
    onSaved?.();
  };

  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <div className="text-[11px] leading-relaxed text-white/55 bg-white/[0.03] border border-white/10 rounded-lg p-3">
        到 Bybit → API → 创建 key，<strong>只勾 Read 权限</strong>，强烈建议绑定 IP 白名单。
        Key 和 secret 存到本机 localStorage，不再需要 PIN 解锁。
      </div>
      <Field label="API Key">
        <input className={inputCls} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="xxxxxxxxxxxxxxxxxxxx" />
      </Field>
      <Field label="API Secret" hint="明文存储；read-only key 提不了币">
        <input className={inputCls} type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} />
      </Field>
      {err && <div className="text-[11px] text-rose-400">{err}</div>}
      <div className="flex gap-2 pt-1">
        <button className={btnPrimary} onClick={submit}>保存</button>
      </div>
    </div>
  );
}

function ManageForm({ onClose }: { onClose?: () => void }) {
  const apiKey = getApiKey();
  return (
    <div className="flex flex-col gap-3 max-w-[360px]">
      <div className="text-[11px] text-white/55">
        已连接 · key <span className="font-mono text-white/50">{apiKey?.slice(0, 6)}…{apiKey?.slice(-4)}</span>
      </div>
      <div className="flex gap-2">
        <button
          className={cn(btnGhost, 'text-rose-300/80 border-rose-400/30')}
          onClick={() => { if (confirm('清除已保存的 key？')) { clearCredentials(); onClose?.(); } }}
        >清除 key</button>
      </div>
    </div>
  );
}
