import React, { useMemo } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { Thermometer, BarChart3, Target, Calendar, Briefcase } from 'lucide-react';
import type { Coin } from '../../features/monitor/types';
import { AccountSummaryCard } from '../../features/accounts/AccountSummaryCard';
import {
  DashCard,
  EnvironmentThermometer,
  VolConeCard,
  GEXKeyLevels,
  EventCalendarStrip,
  StrategyBottom,
} from '../../registry/dashboardWidgets';
import { useTickerSnapshotWS } from '../../registry/monitorWidgetsBase';
import { getUpcomingEvents, formatEventTime, daysUntil, isCalendarStale } from '../../registry/data/economicCalendar';
import { EASE_EMPHASIS } from '../../motion/tokens';
import { cn } from '../../lib/utils';

// Entrance choreography — cards fade + rise + settle (subtle scale) with a short
// stagger on mount. One-time; coin switches don't remount so it won't replay.
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};
const rise = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.44, ease: EASE_EMPHASIS } },
};

// Per-widget error catch
class WidgetErrorBoundary extends React.Component<{ name: string; children: React.ReactNode }, { err: string | null }> {
  state: { err: string | null } = { err: null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  render() {
    if (this.state.err) return (
      <div className="w-full h-full flex items-center justify-center text-[10px] text-red-400/60">
        {/* @ts-expect-error React 19 class component typing quirk */}
        {this.props.name} 异常: {this.state.err}
      </div>
    );
    // @ts-expect-error React 19 class component typing quirk
    return this.props.children;
  }
}
const E = WidgetErrorBoundary;

interface Props {
  coin: Coin;
  setCoin: (c: Coin) => void;
}

// Small coin toggle shown in card headers.
// Active state uses the Bybit-style orange accent; inactive remains neutral.
const CoinBadge = ({ coin, setCoin }: { coin: Coin; setCoin?: (c: Coin) => void }) => {
  if (!setCoin)
    return <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--color-surface-5)] text-white/55 uppercase tracking-wider">{coin}</span>;
  return (
    <div className="bb-coin-toggle inline-flex gap-0.5 rounded-[8px] p-0.5">
      {(['BTC', 'ETH'] as Coin[]).map(c => (
        <button
          key={c}
          type="button"
          onClick={() => setCoin(c)}
          className={cn(
            'bb-coin-toggle-item rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-colors',
            coin === c
              ? 'is-selected'
              : 'text-white/50 hover:text-white/65',
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
};

export default function DashboardPage({ coin, setCoin }: Props) {
  const ticker = useTickerSnapshotWS(coin);

  const eventCountdown = useMemo(() => {
    if (isCalendarStale()) return null; // 排期过期时宁可不显示，也不显示错误倒计时
    const nextHigh = getUpcomingEvents(30).find(e => e.importance === 'high');
    if (!nextHigh) return null;
    const days = daysUntil(nextHigh);
    const timeStr = nextHigh.timeET ? ` ${formatEventTime(nextHigh.timeET)}` : '';
    return { label: `${nextHigh.title}${timeStr}`, days, urgent: days <= 2, warn: days <= 7 };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="dashboard-page flex flex-col gap-3 max-w-[1500px] mx-auto w-full"
      >
        {/* ── Row 1：环境温度计 · 期限结构 · GEX 关键位 ── */}
        <div className="grid grid-cols-3 gap-3">
          <motion.div variants={rise} className="h-full">
            <DashCard icon={Thermometer} title="环境温度计" right={<CoinBadge coin={coin} setCoin={setCoin} />}>
              <E name="温度计"><EnvironmentThermometer coin={coin} ticker={ticker} /></E>
            </DashCard>
          </motion.div>
          <motion.div variants={rise} className="h-full">
            <DashCard icon={BarChart3} title="波动率锥" right={<CoinBadge coin={coin} />}>
              <E name="波动率锥"><VolConeCard coin={coin} /></E>
            </DashCard>
          </motion.div>
          <motion.div variants={rise} className="h-full">
            <DashCard icon={Target} title="GEX 关键位" right={<CoinBadge coin={coin} />} className="gex-card">
              <E name="GEX"><GEXKeyLevels coin={coin} ticker={ticker} /></E>
            </DashCard>
          </motion.div>
        </div>

        {/* ── Row 2：事件日历 + 策略推荐 ── */}
        <div className="grid grid-cols-3 gap-3">
          <motion.div variants={rise} className="h-full">
            <DashCard
              icon={Calendar}
              title="事件日历"
              right={eventCountdown && (
                <span className={`dash-tile text-[13px] font-semibold tabular-nums px-2 py-0.5 rounded-lg bg-[var(--color-surface-2)] ${
                  eventCountdown.urgent ? 'text-[var(--color-sev-extreme)]' :
                  eventCountdown.warn ? 'text-[var(--color-sev-mid)]' :
                  'text-[var(--color-sev-calm)]'
                }`}>
                  {eventCountdown.label} · {eventCountdown.days}d
                </span>
              )}
            >
              <E name="事件日历"><EventCalendarStrip /></E>
            </DashCard>
          </motion.div>
          <motion.div variants={rise} className="col-span-2 h-full">
            <E name="策略推荐"><StrategyBottom coin={coin} /></E>
          </motion.div>
        </div>

        {/* ── Row 3：当前持仓 ── */}
        <motion.div variants={rise} className="widget-card dash-card !p-0">
          <div className="dash-card-head flex items-center px-[18px] pt-[14px] pb-[10px] shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-surface-2)] text-white/55"><Briefcase size={15} /></span>
              <span className="text-[13px] font-semibold uppercase tracking-[0.02em] text-white/65">我的账户 · 实盘</span>
            </div>
          </div>
          <div className="px-[18px] pb-[14px]">
            <E name="账户概览"><AccountSummaryCard /></E>
          </div>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
}
