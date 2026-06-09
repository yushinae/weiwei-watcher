import React, { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import {
  hasCredentials,
  saveCredentials, clearCredentials,
  getApiKey,
} from './auth';
import { useBybitAuthState } from './usePositions';

// ─────────────────────────────────────────────────────────────────────────────
// Simplified settings: just API key + secret, no PIN, no lock/unlock.
// ─────────────────────────────────────────────────────────────────────────────

export function BybitSettingsPanel({ onClose }: { onClose?: () => void }) {
  useBybitAuthState();
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    hasCredentials().then(setConfigured);
    const interval = setInterval(() => hasCredentials().then(setConfigured), 2000);
    return () => clearInterval(interval);
  }, []);

  if (configured === null) return <div className="text-[11px] text-white/40 p-3">检查凭证状态…</div>;
  if (!configured) return <SetupForm onSaved={() => { setConfigured(true); onClose?.(); }} />;
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
  'w-full bg-[#2B2D35] rounded-lg px-3 py-2 text-[12px] font-mono text-slate-200 outline-none focus:bg-[#3A3B40] placeholder:text-white/30 transition-colors';
const btnPrimary =
  'h-9 px-4 rounded-lg text-[12px] font-semibold bg-brand/15 border border-brand/40 text-brand hover:bg-brand/25 transition-colors';
const btnGhost =
  'h-9 px-4 rounded-lg text-[12px] font-semibold bg-[#2B2D35] text-white/70 hover:bg-[#3A3B40] transition-colors';

function SetupForm({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) { setErr('API key 和 secret 都要填'); return; }
    setSaving(true);
    try {
      await saveCredentials(apiKey.trim(), apiSecret.trim());
      onSaved?.();
    } catch {
      setErr('保存失败');
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <div className="text-[11px] leading-relaxed text-white/55 bg-[#2B2D35] rounded-lg p-3">
        到 Bybit → API → 创建 key，<strong>只勾 Read 权限</strong>，强烈建议绑定 IP 白名单。
        Key 存在本地后端（server/data/credentials.json），不出浏览器。
      </div>
      <Field label="API Key">
        <input className={inputCls} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="xxxxxxxxxxxxxxxxxxxx" />
      </Field>
      <Field label="API Secret" hint="存到后端，前端不保留明文">
        <input className={inputCls} type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} />
      </Field>
      {err && <div className="text-[11px] text-rose-400">{err}</div>}
      <div className="flex gap-2 pt-1">
        <button className={btnPrimary} onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  );
}

function ManageForm({ onClose }: { onClose?: () => void }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  useEffect(() => { getApiKey().then(setApiKey); }, []);

  return (
    <div className="flex flex-col gap-3 max-w-[360px]">
      <div className="text-[11px] text-white/55">
        已连接 · key <span className="font-mono text-white/50">{apiKey?.slice(0, 6)}…{apiKey?.slice(-4)}</span>
      </div>
      <div className="flex gap-2">
        <button
          className={cn(btnGhost, 'text-rose-300/80 border-rose-400/30')}
          onClick={async () => { if (confirm('清除已保存的 key？')) { await clearCredentials(); onClose?.(); } }}
        >清除 key</button>
      </div>
    </div>
  );
}
