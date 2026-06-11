import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus } from 'lucide-react';
import { authClient } from '../lib/authClient';

const inputCls = 'h-[38px] px-3 w-full rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] text-[13px] text-white/85 outline-none focus:ring-white/25 placeholder:text-white/25';

// Better Auth 返回英文错误码 → 中文提示
const ERROR_TEXT: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码错误',
  USER_ALREADY_EXISTS: '该邮箱已注册，直接登录即可',
  INVALID_EMAIL: '邮箱格式不对',
  PASSWORD_TOO_SHORT: '密码至少 8 位',
};

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await authClient.signIn.email({ email: email.trim(), password })
        : await authClient.signUp.email({
            email: email.trim(),
            password,
            name: name.trim() || email.split('@')[0],
          });
      if (res.error) {
        setError(ERROR_TEXT[res.error.code ?? ''] ?? res.error.message ?? '操作失败，请重试');
      } else {
        navigate('/', { replace: true });
      }
    } catch {
      setError('无法连接服务器（后端没启动？）');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto text-white/85">
      <form onSubmit={submit}
        className="w-[360px] flex flex-col gap-3 px-6 py-7 rounded-[10px] bg-[var(--color-bg-card)] ring-1 ring-inset ring-[var(--color-border-subtle)] shadow-[0_8px_22px_-14px_rgba(0,0,0,0.72)]">
        <div className="flex flex-col gap-1 mb-1">
          <span className="text-[16px] font-bold text-white/90">期权工作台</span>
          <span className="text-[12px] text-white/45">{mode === 'login' ? '登录你的账户' : '创建新账户'}</span>
        </div>

        {mode === 'register' && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-white/45">昵称（可选）</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="怎么称呼你" autoComplete="nickname" />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-white/45">邮箱</span>
          <input className={inputCls} type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-white/45">密码（至少 8 位）</span>
          <input className={inputCls} type="password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>

        {error && (
          <div className="px-3 py-2 rounded-md bg-[#FF5F57]/10 ring-1 ring-inset ring-[#FF5F57]/30 text-[12px] text-[#FF8A84]">
            {error}
          </div>
        )}

        <button type="submit" disabled={busy}
          className="h-[38px] mt-1 flex items-center justify-center gap-2 rounded-md bg-[var(--bb-orange)]/15 text-[var(--bb-orange)] ring-1 ring-inset ring-[var(--bb-orange)]/30 text-[13px] font-bold hover:bg-[var(--bb-orange)]/25 transition-colors disabled:opacity-50">
          {mode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
        </button>

        <button type="button"
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
          className="text-[12px] text-white/45 hover:text-white/75 transition-colors self-center mt-1">
          {mode === 'login' ? '没有账户？注册一个' : '已有账户？去登录'}
        </button>
      </form>
    </div>
  );
}
