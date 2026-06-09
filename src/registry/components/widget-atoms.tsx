// ═══════════════════════════════════════════════════════════════════════════════
// 共享 widget UI 原子：CoinTabs / LiveBadge / Skeleton / HistLoadErr
// ═══════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { cn } from '../../lib/utils';
import type { Coin } from '../../features/monitor/types';

// 币种切换 tab（BTC/ETH）
export const CoinTabs = ({ v, set }: { v: Coin; set: (c: Coin) => void }) => (
  <div className="bb-coin-toggle flex gap-0.5 rounded-lg p-0.5">
    {(['BTC', 'ETH'] as Coin[]).map(c => (
      <button key={c} onClick={() => set(c)}
        className={cn('bb-coin-toggle-item text-[12px] font-bold px-2.5 py-0.5 rounded-md transition-colors duration-[120ms] outline-none',
          v === c
            ? 'is-selected'
            : 'text-white/55 hover:text-white/80'
        )}>
        {c}
      </button>
    ))}
  </div>
);

// 静态币种标签（只读，无切换功能）
export const CoinLabel = ({ coin }: { coin: Coin }) => (
  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">
    {coin}
  </span>
);

// 「实时」徽章：绿点 + 文字
export const LiveBadge = () => (
  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/80 uppercase tracking-wider">
    <span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]" />
    实时
  </span>
);

// 数据加载中骨架屏（shimmer 渐变 + 占位块）
export const Skeleton = () => (
  <div className="w-full h-full flex flex-col gap-2 p-3 overflow-hidden">
    <div className="relative flex-1 min-h-0 rounded-[10px] overflow-hidden bg-white/[0.03]">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-2 w-1/3 rounded-full skel-block" />
        <div className="h-7 w-full rounded-[8px] skel-block" />
        <div className="grid grid-cols-3 gap-2 mt-1">
          <div className="h-6 rounded-[6px] skel-block" />
          <div className="h-6 rounded-[6px] skel-block" />
          <div className="h-6 rounded-[6px] skel-block" />
        </div>
        <div className="h-2 w-2/3 rounded-full skel-block mt-1" />
      </div>
    </div>
  </div>
);

// 历史数据加载失败提示（Deribit 历史 API 超时 20s 后展示）
export const HistLoadErr = () => (
  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-center px-4">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="opacity-40">
      <circle cx="10" cy="10" r="9" stroke="#FF5F57" strokeWidth="1.5"/>
      <path d="M10 5.5v5M10 13.5v1" stroke="#FF5F57" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
    <span className="text-[11px] text-white/55">历史数据加载失败</span>
    <span className="text-[10px] text-white/55">Deribit 历史 API 无响应，请刷新重试</span>
  </div>
);
