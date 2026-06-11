import { preTradeChecks, type PreTradeInput, type PreTradeResult } from '../preTradeChecks';
import type { ExecutionMode } from './types';

export interface RiskGateInput extends PreTradeInput {
  mode: ExecutionMode;
  notional: number;
  deltaNotional: number;
  liveReady?: {
    armed: boolean;
    credentials: boolean;
    venueSupported: boolean;
  };
}

const LIVE_MAX_PREMIUM_USD = 2_000;
const LIVE_MAX_DELTA_NOTIONAL_USD = 50_000;

export function runRiskGate(input: RiskGateInput): PreTradeResult {
  const base = preTradeChecks(input);
  if (input.mode !== 'live') return base;

  const liveChecks = [...base.checks];
  if (!input.liveReady?.venueSupported) {
    liveChecks.push({
      id: 'live-venue',
      level: 'block',
      label: '实盘通道',
      detail: '当前交易所还没有接入实盘适配器',
    });
  }
  if (!input.liveReady?.credentials) {
    liveChecks.push({
      id: 'live-credentials',
      level: 'block',
      label: '实盘密钥',
      detail: '未检测到 Deribit API key',
    });
  }
  if (!input.liveReady?.armed) {
    liveChecks.push({
      id: 'live-armed',
      level: 'block',
      label: '实盘开关',
      detail: 'LIVE 尚未 armed',
    });
  }
  if (input.notional > LIVE_MAX_PREMIUM_USD) {
    liveChecks.push({
      id: 'live-premium-cap',
      level: 'block',
      label: '实盘权利金',
      detail: `权利金超过 ${LIVE_MAX_PREMIUM_USD} USDC 上限`,
    });
  }
  if (input.deltaNotional > LIVE_MAX_DELTA_NOTIONAL_USD) {
    liveChecks.push({
      id: 'live-delta-cap',
      level: 'block',
      label: '实盘 Delta',
      detail: `Delta 名义超过 ${LIVE_MAX_DELTA_NOTIONAL_USD} USDC 上限`,
    });
  }

  const level = liveChecks.some(c => c.level === 'block')
    ? 'block'
    : liveChecks.some(c => c.level === 'warn')
      ? 'warn'
      : 'ok';
  return { level, blocking: liveChecks.some(c => c.level === 'block'), checks: liveChecks };
}
