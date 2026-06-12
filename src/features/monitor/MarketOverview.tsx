import { useEffect, useMemo } from 'react';
import { useCardHeader } from '../../components/card/WidgetCard';
import { cn } from '../../lib/utils';
import {
  CoinLabel,
  computeChainLevels,
  computeNetGex,
  useCoinControl,
  useDeribitHistory,
  useDeribitOptions,
  useFlowData,
  useFuturesBasis,
  useTickerSnapshotWS,
  type CoinControlProps,
  type ExpiryGroup,
} from '../../registry/monitorWidgetsBase';
import {
  FRESH_COLOR,
  freshStateText,
  useAllFreshness,
  useGlobalHealth,
} from '../../registry/data/freshness';

const UP = '#28C840';
const DOWN = '#FF5F57';
const YELLOW = '#FEBC2E';
const MUTE = 'rgba(255,255,255,0.58)';

const fmtPx = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(1));
const fmtSigned = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
const pick = (arr: ExpiryGroup[], target: number) => (
  arr.length ? arr.reduce((best, e) => (Math.abs(e.daysToExp - target) < Math.abs(best.daysToExp - target) ? e : best)) : undefined
);

function VerdictPill({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: string;
  color: string;
  note: string;
}) {
  return (
    <div className="min-w-[136px] flex-1 rounded-[6px] bg-[var(--color-surface-2)] px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-normal text-white/42">{label}</div>
      <div className="mt-1 font-mono text-[16px] font-bold leading-none tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-1 text-[10px] leading-tight text-white/45">{note}</div>
    </div>
  );
}

export function MarketOverviewWidget({ coin: coinProp, onCoinChange }: CoinControlProps) {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const ticker = useTickerSnapshotWS(coin);
  const { data } = useDeribitOptions(coin);
  const { data: hist } = useDeribitHistory(coin);
  const { data: flow } = useFlowData(coin);
  const basis = useFuturesBasis(coin);
  const health = useGlobalHealth();
  const feeds = useAllFreshness();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  const overview = useMemo(() => {
    const spot = ticker?.spot ?? data?.spot ?? 0;
    const chg24 = ticker?.change24hPct ?? 0;
    const dvol = ticker?.dvol ?? data?.dvol30 ?? 0;
    const exp = data?.expiries ?? [];
    const near = exp.find(e => e.daysToExp >= 6);
    const m30 = pick(exp, 30);
    const far = pick(exp, 90);
    const rr25 = m30?.rr25 ?? 0;
    const pcr = data?.pcr ?? 0;
    const term = far && near ? far.atmIV - near.atmIV : 0;
    const ivRank = hist?.ivRankCurrent ?? null;
    const funding = flow?.annFunding ?? ticker?.fundingAnn ?? 0;
    const frontBasis = basis[0]?.annBasis ?? 0;
    const gex = data ? computeNetGex(data) : null;
    const levels = computeChainLevels(data ?? null, 'ALL', spot);

    let directionalScore = 0;
    if (chg24 > 1) directionalScore += 1;
    if (chg24 < -1) directionalScore -= 1;
    if (pcr < 0.75) directionalScore += 1;
    if (pcr > 1.15) directionalScore -= 1;
    if (rr25 > 2.5) directionalScore += 1;
    if (rr25 < -2.5) directionalScore -= 1;
    if (funding < -2 || frontBasis < -2) directionalScore -= 1;
    if (funding > 30 || frontBasis > 30) directionalScore -= 1;

    const directional = directionalScore >= 2
      ? { text: '偏多', color: UP, note: '价格/偏斜/仓位同向' }
      : directionalScore <= -2
        ? { text: '偏空 / 防守', color: DOWN, note: '保护或压力信号占优' }
        : { text: '中性震荡', color: YELLOW, note: '信号分歧，等突破' };

    const vol = ivRank == null
      ? { text: dvol > 0 ? `${dvol.toFixed(1)}%` : '—', color: MUTE, note: '等待历史分位' }
      : ivRank >= 70
        ? { text: 'IV 偏贵', color: DOWN, note: `Rank ${ivRank.toFixed(0)} · 卖方溢价` }
        : ivRank <= 30
          ? { text: 'IV 偏便宜', color: UP, note: `Rank ${ivRank.toFixed(0)} · 买方友好` }
          : { text: 'IV 中性', color: YELLOW, note: `Rank ${ivRank.toFixed(0)} · 双向均可` };

    const gammaPositive = gex
      ? (gex.flip != null ? spot >= gex.flip : gex.totalNet >= 0)
      : true;
    const gamma = {
      text: gammaPositive ? '正 Gamma' : '负 Gamma',
      color: gammaPositive ? UP : DOWN,
      note: gex?.flip ? `翻转点 ${fmtPx(gex.flip)}` : '窗口内无翻转点',
    };

    const overheat = funding > 25 || frontBasis > 30;
    const fundingText = overheat
      ? '杠杆拥挤'
      : funding < -2 || frontBasis < -2
        ? '资金偏空'
        : funding > 2 || frontBasis > 5
          ? '资金偏多'
          : '资金中性';
    const fundingColor = overheat ? YELLOW : fundingText === '资金偏空' ? DOWN : fundingText === '资金偏多' ? UP : MUTE;

    const action = [
      directional.text,
      vol.text,
      gamma.text,
    ].join(' · ');

    return {
      spot,
      chg24,
      directional,
      vol,
      gamma,
      funding: {
        text: fundingText,
        color: fundingColor,
        note: `费率 ${fmtSigned(funding)}% · 基差 ${fmtSigned(frontBasis)}%`,
      },
      healthText: health.level === 'ok' ? '数据正常' : health.level === 'warn' ? '数据延迟' : '数据中断',
      healthColor: health.level === 'ok' ? UP : health.level === 'warn' ? YELLOW : DOWN,
      action,
      levels,
      dvol,
      rr25,
      term,
    };
  }, [basis, data, flow, health.level, hist, ticker]);

  const activeFeeds = feeds
    .filter(f => f.active && (f.critical || f.kind !== 'live'))
    .slice(0, 3);

  return (
    <div className="h-full w-full overflow-y-auto px-3 py-2">
      <div className="flex h-full min-h-[126px] flex-col gap-2 md:flex-row md:items-stretch">
        <div className="flex min-w-[220px] flex-[1.15] flex-col justify-between rounded-[6px] bg-[var(--color-surface-2)] px-3 py-2.5">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[28px] font-bold leading-none tabular-nums text-white/90">
                {overview.spot > 0 ? fmtPx(overview.spot) : '—'}
              </span>
              <span
                className="font-mono text-[13px] font-bold tabular-nums"
                style={{ color: overview.chg24 >= 0 ? UP : DOWN }}
              >
                {fmtSigned(overview.chg24, 2)}%
              </span>
            </div>
            <div className="mt-2 text-[13px] font-semibold leading-snug text-white/82">
              {overview.action}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-white/45">
              Call 墙 {overview.levels.callWall ? fmtPx(overview.levels.callWall) : '—'} · Put 墙 {overview.levels.putWall ? fmtPx(overview.levels.putWall) : '—'} · 25Δ {fmtSigned(overview.rr25)}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-white/45">
            <span>DVOL {overview.dvol.toFixed(1)}%</span>
            <span>期限斜率 {fmtSigned(overview.term)}</span>
            <span>Max Pain {overview.levels.maxPain ? fmtPx(overview.levels.maxPain) : '—'}</span>
          </div>
        </div>

        <div className="grid flex-[2] grid-cols-2 gap-2 lg:grid-cols-4">
          <VerdictPill label="方向" value={overview.directional.text} color={overview.directional.color} note={overview.directional.note} />
          <VerdictPill label="波动率" value={overview.vol.text} color={overview.vol.color} note={overview.vol.note} />
          <VerdictPill label="Gamma" value={overview.gamma.text} color={overview.gamma.color} note={overview.gamma.note} />
          <VerdictPill label="资金面" value={overview.funding.text} color={overview.funding.color} note={overview.funding.note} />
        </div>

        <div className="min-w-[180px] flex-[0.72] rounded-[6px] bg-[var(--color-surface-2)] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-normal text-white/42">数据健康</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ color: overview.healthColor }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: overview.healthColor }} />
              {overview.healthText}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {(activeFeeds.length ? activeFeeds : feeds.slice(0, 3)).map(feed => (
              <div key={feed.key} className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-white/52">{feed.label}</span>
                <span
                  className={cn('shrink-0 font-mono text-[10px] font-semibold tabular-nums')}
                  style={{ color: FRESH_COLOR[feed.kind] }}
                >
                  {freshStateText(feed)}
                </span>
              </div>
            ))}
            {!feeds.length && <div className="text-[11px] text-white/42">等待数据订阅</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
