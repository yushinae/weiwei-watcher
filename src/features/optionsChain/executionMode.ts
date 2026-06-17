// 执行模式状态管理 — sim（模拟）vs live（实盘）

import { useState, useEffect } from 'react';
import type { DataSource } from './chainModel';
import type { ExecutionMode } from './execution';

// ── 配置 ─────────────────────────────────────────────────────────
//
// LIFE_ARMED: 是否允许实盘下单（模拟仓也能开实盘模式调适配器）
//   设 VITE_LIVE_ARMED=true 或本地存储 weiwei.live.armed 允许。
//   默认 false，防止手滑送真单。
export const LIVE_ARMED =
  import.meta.env.VITE_LIVE_ARMED === 'true' ||
  localStorage.getItem('weiwei.live.armed') === 'true';

// LIVE_TESTNET: 走测试网还是主网
//   Deribit 测试网 test.deribit.com / Bybit 测试网 stream.bybit.com
export const LIVE_TESTNET =
  import.meta.env.VITE_LIVE_TESTNET !== 'false';

// ── 执行模式 hook ────────────────────────────────────────────────
//
// 持久化到 localStorage，方便跨页/刷新保持。
const STORAGE_KEY = 'weiwei.executionMode';

export function useExecutionMode(): [ExecutionMode, (m: ExecutionMode) => void] {
  const [mode, setMode] = useState<ExecutionMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'sim' || saved === 'live') return saved;
    return 'sim'; // 默认模拟
  });

  const set = (m: ExecutionMode) => {
    localStorage.setItem(STORAGE_KEY, m);
    setMode(m);
  };

  return [mode, set];
}

// ── 就绪状态 ────────────────────────────────────────────────────
//
// 外部组件期望的结构。
export interface LiveReadyState {
  armed: boolean;
  credentials: boolean;
  venueSupported: boolean;
}

// ── 实盘就绪状态 ────────────────────────────────────────────────
//
// 检查当前数据源下实盘所需的凭据是否就绪。
export function useExecutionLiveReady(
  source: DataSource,
  executionMode: ExecutionMode,
): { deribitCredentials: { clientId: string; clientSecret: string } | null; liveReady: LiveReadyState } {
  const [state, setState] = useState<{
    deribitCredentials: { clientId: string; clientSecret: string } | null;
    liveReady: LiveReadyState;
  }>({
    deribitCredentials: null,
    liveReady: { armed: false, credentials: false, venueSupported: false },
  });

  useEffect(() => {
    const bybitKey = import.meta.env.VITE_BYBIT_API_KEY?.trim();
    const bybitSecret = import.meta.env.VITE_BYBIT_API_SECRET?.trim();
    const deribitKey = import.meta.env.VITE_DERIBIT_API_KEY?.trim();
    const deribitSecret = import.meta.env.VITE_DERIBIT_API_SECRET?.trim();

    const hasBybit = !!(bybitKey && bybitSecret);
    const hasDeribit = !!(deribitKey && deribitSecret);

    if (executionMode !== 'live') {
      setState({
        deribitCredentials: null,
        liveReady: {
          armed: LIVE_ARMED,
          credentials: source === 'bybit' ? hasBybit : hasDeribit,
          venueSupported: true,
        },
      });
      return;
    }

    setState({
      deribitCredentials: deribitKey && deribitSecret
        ? { clientId: deribitKey, clientSecret: deribitSecret }
        : null,
      liveReady: {
        armed: LIVE_ARMED,
        credentials: source === 'bybit' ? hasBybit : hasDeribit,
        venueSupported: true,
      },
    });
  }, [source, executionMode]);

  return state;
}

// ── 执行模式状态文本 ────────────────────────────────────────────
//
// 给 ExecutionModeControls 展示用。
export function executionStatusText(
  mode: ExecutionMode,
  liveReady: LiveReadyState,
  source: DataSource,
): string {
  if (mode === 'sim') return '模拟交易';
  if (!liveReady.armed) return '实盘模式（未武装）';
  if (!liveReady.credentials) {
    const label = source === 'bybit' ? 'Bybit' : 'Deribit';
    return `请先配置 ${label} API key`;
  }
  if (!liveReady.venueSupported) return '当前数据源不支持实盘';
  return '实盘就绪';
}
