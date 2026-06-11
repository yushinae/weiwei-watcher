import React, { useMemo } from 'react';
import { TrafficCone } from 'lucide-react';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { Tile } from '../components/card/Tile';
import type { Coin } from '../features/monitor/types';
import { useDeribitOptions, useDeribitHistory, useFlowData, VolConeChart } from './monitorWidgetsBase';
import { classifyRegime, computeNetGex, computeChainLevels } from './monitorWidgetsBase';
import {
  getUpcomingEvents, formatEventTime, formatEventDay, daysUntil,
  isCalendarStale, CALENDAR_MAINTAINED_THROUGH, type EcoEvent,
} from './data/economicCalendar';
import type { TickerSnapshot } from './data/ws';

// ═══════════════════════════════════════════════════════════════════════════════
// Card shell
// ═══════════════════════════════════════════════════════════════════════════════

export const DashCard = ({ icon: Icon, title, right, children, className }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) => (
  <div className={`widget-card dash-card !p-0 flex flex-col h-full ${className ?? ''}`}>
    <div className="dash-card-head flex items-center gap-2.5 px-[18px] pt-[14px] pb-[10px] shrink-0">
      <span className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-surface-2)] text-white/55">
        <Icon size={15} />
      </span>
      <span className="text-[13px] font-semibold uppercase tracking-[0.02em] text-white/65">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    <div className="flex-1 min-h-0 px-[18px] pb-[16px]">{children}</div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EnvironmentThermometer — ECharts gauge + DVOL/VRP stats
// ═══════════════════════════════════════════════════════════════════════════════

const DVOL_SEGMENTS = [
  { max: 35, color: 'var(--color-sev-calm)' },
  { max: 50, color: 'var(--color-sev-low)' },
  { max: 65, color: 'var(--color-sev-mid)' },
  { max: 80, color: 'var(--color-sev-high)' },
  { max: 999, color: 'var(--color-sev-extreme)' },
];

// 诚实原则：历史数据没到就显示 '—' 并说明原因，绝不拿 50%/5pp 之类
// 「看起来正常」的默认值冒充实测（IV Rank 50 和 IV Rank 缺失是两种完全不同的决策输入）。
export const EnvironmentThermometer = ({ coin, ticker }: { coin: Coin; ticker: TickerSnapshot | null }) => {
  const { data: hist, timedOut } = useDeribitHistory(coin);

  const dvolRaw = ticker?.dvol ?? hist?.dvolSeries?.[hist.dvolSeries.length - 1];
  const dvol = typeof dvolRaw === 'number' && Number.isFinite(dvolRaw) && dvolRaw > 0 ? dvolRaw : null;
  const ivrPct = hist ? Math.round(hist.ivRankCurrent) : null;
  const lastVrp = hist?.vrp?.length ? hist.vrp[hist.vrp.length - 1] : null;
  const vrp = lastVrp ? lastVrp.iv - lastVrp.rv : null;
  const impliedMove = dvol != null ? (dvol * Math.sqrt(30 / 365) * Math.sqrt(2 / Math.PI)).toFixed(1) : null;

  // DVOL segment index（-1 = 无数据，全部熄灭）
  const dvolSegIdx = dvol != null ? DVOL_SEGMENTS.findIndex(s => dvol <= s.max) : -1;

  const ivrColor = ivrPct == null ? 'rgba(255,255,255,0.35)'
    : ivrPct <= 25 ? 'var(--color-sev-calm)' : ivrPct <= 50 ? 'var(--color-sev-mid)' : ivrPct <= 75 ? 'var(--color-sev-high)' : 'var(--color-sev-extreme)';
  const verdictText = ivrPct == null
    ? (timedOut ? 'Deribit 历史无响应 — 无法判定' : '等待历史数据…')
    : ivrPct <= 25 ? 'IV 偏低 → 适合买方策略'
    : ivrPct <= 50 ? 'IV 中等偏低 → 日历价差时机'
    : ivrPct <= 75 ? 'IV 偏高 → 卖方溢价充足'
    : 'IV 高位 → 谨慎卖 Vega';

  return (
    <div className="flex flex-col w-full h-full gap-2.5">
      {/* ---- IV Rank: big number + horizontal bar ---- */}
      <div>
        <div className="flex items-baseline gap-1">
          {ivrPct != null ? (
            <>
              <AnimatedNumber
                value={ivrPct}
                format={(v) => Math.round(v).toString()}
                pulseOnChange
                className="text-[44px] font-bold tabular-nums leading-none tracking-[-0.03em]"
                style={{ color: ivrColor }}
              />
              <span className="text-[17px] font-semibold text-white/50">%</span>
            </>
          ) : (
            <span className="text-[44px] font-bold leading-none tracking-[-0.03em] text-white/30">—</span>
          )}
        </div>
        <div className="text-[11px] text-white/50 mt-1 mb-2">IV Rank（52周百分位）</div>
        {/* Horizontal gauge bar */}
        <div className="relative w-full h-2 rounded-full bg-[var(--color-surface-1)] overflow-hidden">
          {/* Gradient backdrop */}
          <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-sev-calm), var(--color-sev-mid), var(--color-sev-high), var(--color-sev-extreme))', opacity: ivrPct != null ? 1 : 0.25 }} />
          {/* Dark mask from the right */}
          <div className="absolute top-0 right-0 h-full rounded-r-full bg-[var(--color-card)]" style={{ width: `${100 - (ivrPct ?? 0)}%` }} />
          {/* Pointer dot */}
          {ivrPct != null && (
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-[var(--color-card)] shadow transition-all duration-700" style={{ left: `calc(${ivrPct}% - 6px)` }} />
          )}
        </div>
      </div>

      {/* ---- DVOL segment bar ---- */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50 font-medium w-[34px] shrink-0">DVOL</span>
        <div className="flex gap-[3px] flex-1">
          {DVOL_SEGMENTS.map((seg, i) => (
            <div key={i} className="flex-1 h-[6px] rounded-sm transition-opacity duration-300" style={{ background: seg.color, opacity: dvolSegIdx >= 0 && i <= dvolSegIdx ? 1 : 0.12 }} />
          ))}
        </div>
        <span className="text-[15px] font-bold tabular-nums text-white/85 w-[48px] text-right">
          {dvol != null ? <><AnimatedNumber value={dvol} format={(v) => v.toFixed(1)} />%</> : <span className="text-white/35">—</span>}
        </span>
      </div>

      {/* ---- Data row ---- */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/50">30d 预期波动 <span className="font-semibold tabular-nums text-white/70">{impliedMove != null ? `±${impliedMove}%` : '—'}</span></span>
        <span className="text-white/50">VRP {vrp != null
          ? <span className="font-semibold tabular-nums" style={{ color: vrp >= 5 ? 'var(--color-trade-up)' : 'var(--color-trade-down)' }}>{vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}pp</span>
          : <span className="font-semibold text-white/35">—</span>}</span>
      </div>

      {/* ---- Verdict ---- */}
      <Tile className="mt-auto p-2 text-[12px] leading-relaxed text-white/50">
        <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: ivrColor }} />
        判定: <em className="not-italic font-semibold text-white/80">{verdictText}</em>
      </Tile>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. VolConeCard — historical RV boxplot cone + current ATM IV line
// ═══════════════════════════════════════════════════════════════════════════════

const CONE_TENORS = [7, 14, 30, 60, 90, 180];

export const VolConeCard = ({ coin }: { coin: Coin }) => {
  const { data: opt } = useDeribitOptions(coin);
  const { data: hist } = useDeribitHistory(coin);

  const cone = hist?.volCone;
  const currIVs = useMemo(() => {
    if (!opt?.expiries.length) return CONE_TENORS.map(() => 0);
    return CONE_TENORS.map(t => {
      const closest = opt.expiries.reduce((best, e) =>
        Math.abs(e.daysToExp - t) < Math.abs(best.daysToExp - t) ? e : best
      );
      return closest.atmIV;
    });
  }, [opt]);
  const labels = CONE_TENORS.map(t => `${t}D`);

  // Term structure summary (skew + slope)
  const summary = useMemo(() => {
    const expiries = opt?.expiries ?? [];
    if (!expiries.length) return null;
    const bars = expiries
      .filter(e => e.daysToExp >= 1 && e.daysToExp <= 180)
      .slice(0, 6);
    if (!bars.length) return null;
    const exp30 = expiries.find(e => Math.abs(e.daysToExp - 30) < 5) ?? bars[0];
    const slope = bars[bars.length - 1].atmIV - bars[0].atmIV;
    return {
      slope,
      morph: slope >= 2 ? '正向 ✅' : slope <= -2 ? '倒挂 ⚠️' : '平坦',
      morphColor: slope >= 2 ? 'var(--color-trade-up)' : slope <= -2 ? 'var(--color-trade-down)' : 'var(--color-sev-mid)',
      putSkew: exp30.rr25 < 0 ? `${exp30.rr25.toFixed(1)}%` : '—',
      callSkew: exp30.rr25 > 0 ? `+${exp30.rr25.toFixed(1)}%` : '—',
    };
  }, [opt]);

  if (!cone) return <div className="text-[11px] text-white/45 flex items-center justify-center h-full">加载中…</div>;

  return (
    <div className="flex flex-col w-full h-full gap-1.5">
      <div className="flex-1 min-h-0">
        <VolConeChart cone={cone} currIVs={currIVs} tenorLabels={labels} />
      </div>
      {summary && (
        <Tile className="flex items-center gap-3 py-1.5 px-2 text-[11px]">
          <span>形态 <span className="font-semibold" style={{ color: summary.morphColor }}>{summary.morph}</span></span>
          <span>Put 25Δ <span className="font-semibold tabular-nums text-trade-down">{summary.putSkew}</span></span>
          <span>Call 25Δ <span className="font-semibold tabular-nums text-trade-up">{summary.callSkew}</span></span>
          <div className="flex-1" />
          {summary.slope >= 2 ? <span className="font-semibold px-1.5 py-0.5 rounded bg-[var(--nexus-accent)]/10 text-[var(--nexus-accent)]">日历价差适配</span>
           : summary.slope <= -2 ? <span className="font-semibold px-1.5 py-0.5 rounded bg-trade-down/10 text-trade-down">谨慎卖近月</span>
           : <span className="text-white/50">近月Put/远月Call</span>}
        </Tile>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GEXKeyLevels — big price + 2×2 levels + zones + tilt
// ═══════════════════════════════════════════════════════════════════════════════

// 口径与监控页完全一致：墙/痛点 = computeChainLevels（真 max pain，最小化总赔付），
// 净 GEX/区制 = computeNetGex（Σ bsGamma×OI×S²/100）。两页数字必须互相对得上。
export const GEXKeyLevels = ({ coin, ticker }: { coin: Coin; ticker: TickerSnapshot | null }) => {
  const { data: opt } = useDeribitOptions(coin);
  const spot = ticker?.spot ?? opt?.spot ?? 0;

  const levels = useMemo(() => computeChainLevels(opt, 'ALL', spot), [opt, spot]);
  const gex = useMemo(() => (opt?.expiries.length && opt.spot ? computeNetGex(opt) : null), [opt]);

  // OI 支撑/阻力区：现价上方 Call OI Top3 / 下方 Put OI Top3 的价带
  const zones = useMemo(() => {
    if (!opt?.expiries.length || !spot) return null;
    const callOi = new Map<number, number>();
    const putOi = new Map<number, number>();
    for (const e of opt.expiries) {
      for (const c of e.calls) callOi.set(c.strike, (callOi.get(c.strike) ?? 0) + c.oi);
      for (const p of e.puts) putOi.set(p.strike, (putOi.get(p.strike) ?? 0) + p.oi);
    }
    const top3 = (m: Map<number, number>, keep: (k: number) => boolean) =>
      [...m.entries()].filter(([k, v]) => keep(k) && v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    const resist = top3(callOi, k => k >= spot);
    const support = top3(putOi, k => k <= spot);
    if (resist.length < 2 || support.length < 2) return null;
    return {
      resistL: Math.min(...resist), resistH: Math.max(...resist),
      supportL: Math.min(...support), supportH: Math.max(...support),
    };
  }, [opt, spot]);

  // Gamma 区制：现价相对翻转点（无翻转点时退回总净额符号）— 同监控页 Gamma 速读
  const isPos = gex ? (gex.flip != null ? spot >= gex.flip : gex.totalNet >= 0) : null;

  const fmtPx = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtGexM = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(v / 1e6).toFixed(1)}M`;

  return (
    <div className="flex flex-col w-full h-full gap-2">
      {/* Spot price — big and bold */}
      <div className="flex items-baseline gap-1">
        <span className="text-[44px] font-bold tabular-nums leading-none tracking-[-0.03em] text-white/90">
          {fmtPx(spot).replace('$', '')}
        </span>
        <span className="text-[16px] font-semibold text-white/50">USD</span>
      </div>

      {/* 2×2 key levels */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: 'Call 墙', value: levels.callWall, color: 'var(--color-trade-up)' },
          { label: '最大痛点', value: levels.maxPain, color: 'var(--color-sev-mid)' },
          { label: 'Put 墙',  value: levels.putWall, color: 'var(--color-trade-down)' },
          { label: '净 GEX / 1%', value: null,
            color: gex ? (gex.totalNet >= 0 ? 'var(--color-trade-up)' : 'var(--color-trade-down)') : 'var(--color-text-muted)',
            text: gex ? fmtGexM(gex.totalNet) : '—' },
        ].map((item, i) => (
          <Tile key={i} className="gex-key-tile flex flex-col gap-0.5 px-2.5 py-1.5">
            <span className="text-[10px] text-white/55 uppercase tracking-wider">{item.label}</span>
            <span className="text-[15px] font-bold tabular-nums" style={{ color: item.color }}>
              {item.text != null
                ? item.text
                : item.value != null
                  ? <AnimatedNumber value={item.value} format={fmtPx} pulseOnChange />
                  : <span className="text-white/45">—</span>}
            </span>
          </Tile>
        ))}
      </div>

      {/* Support / Resistance zones */}
      <div className="flex gap-1.5">
        <Tile className="gex-key-tile flex-1 flex flex-col gap-0.5 px-2.5 py-1.5">
          <span className="text-[10px] text-white/55 uppercase tracking-wider">支撑区</span>
          <span className="text-[13px] font-bold tabular-nums text-trade-down">
            {zones ? `${fmtPx(zones.supportL)} – ${fmtPx(zones.supportH)}` : (
              <span className="text-white/45">—</span>
            )}
          </span>
        </Tile>
        <Tile className="gex-key-tile flex-1 flex flex-col gap-0.5 px-2.5 py-1.5">
          <span className="text-[10px] text-white/55 uppercase tracking-wider">阻力区</span>
          <span className="text-[13px] font-bold tabular-nums text-trade-up">
            {zones ? `${fmtPx(zones.resistL)} – ${fmtPx(zones.resistH)}` : (
              <span className="text-white/45">—</span>
            )}
          </span>
        </Tile>
      </div>

      {/* Gamma 区制（口径同监控页 Gamma 速读） */}
      {gex && isPos != null && (
        <Tile className={`gex-key-tile p-2 text-[12px] font-semibold ${isPos ? 'text-trade-up' : 'text-trade-down'}`}>
          {isPos
            ? `↑ 正 Gamma · 压制波动${gex.flip != null ? ` · 跌破 ${fmtPx(gex.flip)} 转放大` : ''}`
            : `↓ 负 Gamma · 助涨助跌${gex.flip != null ? ` · 站上 ${fmtPx(gex.flip)} 转压制` : ''}`}
        </Tile>
      )}
    </div>
  );
};

// ═══════════════════���═══════════════════════════════════════════════════════════
// 4. EventCalendarStrip
// ═══════════════════════════════════════════════════════════════════════════════

export const EventCalendarStrip = React.memo(() => {
  const events = useMemo(() => getUpcomingEvents(30), []);
  const stale = isCalendarStale();

  const tagColor = (e: EcoEvent) => {
    if (e.importance === 'high') return 'var(--color-sev-extreme)';   // #FF5F57
    if (e.importance === 'medium') return 'var(--color-sev-mid)';     // #FEBC2E
    return 'var(--color-sev-calm)';                                   // #28C840
  };
  const tagLabel = (e: EcoEvent) => e.importance === 'high' ? '重要' : e.importance === 'medium' ? '中等' : '低';
  const TagBadge = ({ e }: { e: EcoEvent }) => (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
      style={{ background: `color-mix(in srgb, ${tagColor(e)} 14%, transparent)`, color: tagColor(e) }}>
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: tagColor(e) }} />
      {tagLabel(e)}
    </span>
  );

  const todayEvent = events.find(e => daysUntil(e) === 0);
  const highEvent = events.find(e => e.importance === 'high');
  const daysToHigh = highEvent ? daysUntil(highEvent) : null;

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="dashboard-inner-row flex items-center py-1 px-1.5 -mx-1.5 gap-3 shrink-0 rounded-lg transition-colors duration-[160ms]">
        <span className="text-[11px] font-semibold tabular-nums text-white/55 min-w-[42px]">今天</span>
        <span className="text-[13px] text-white/75 flex-1">{todayEvent ? todayEvent.title : '无事件'}</span>
        {todayEvent?.timeET && <span className="text-[10px] tabular-nums text-white/50">{formatEventTime(todayEvent.timeET)}</span>}
        {todayEvent ? <TagBadge e={todayEvent} /> : <span className="text-[9px] text-white/45">—</span>}
      </div>

      {/* 事件列表 — 超出 ~5 条时上下滚动 */}
      <div className="min-h-0 max-h-[170px] overflow-y-auto dash-scroll flex flex-col gap-1">
        {events.filter(e => daysUntil(e) > 0).map((e, i) => (
          <div key={i} className="dashboard-inner-row flex items-center py-1.5 px-1.5 -mx-1.5 gap-3 rounded-lg transition-colors duration-[160ms]">
            <span className="text-[11px] font-semibold tabular-nums text-white/55 min-w-[42px]">{formatEventDay(e)}</span>
            <span className="text-[13px] text-white/80 flex-1">{e.title}</span>
            {e.timeET && <span className="text-[10px] tabular-nums text-white/50">{formatEventTime(e.timeET)}</span>}
            <TagBadge e={e} />
          </div>
        ))}
      </div>

      {/* 过期护栏：排期数据超出维护范围时明示，绝不显示「无事件→适合布置策略」的假建议 */}
      {stale ? (
        <Tile className="shrink-0 mt-auto pt-2 p-2.5 text-[12px] font-semibold text-[var(--color-sev-mid)]">
          ⚠ 日历未维护（排期数据截至 {CALENDAR_MAINTAINED_THROUGH}）— 事件信息不可信，请更新 economicCalendar.ts
        </Tile>
      ) : (
        <Tile className={`shrink-0 mt-auto pt-2 p-2.5 text-[12px] font-semibold ${
          daysToHigh == null ? 'text-white/50' :
          daysToHigh > 7 ? 'text-[var(--color-sev-calm)]' : daysToHigh > 2 ? 'text-[var(--color-sev-mid)]' : 'text-[var(--color-sev-extreme)]'
        }`}>
          建议: {daysToHigh == null ? '30 天内无已排期的重大事件'
            : daysToHigh > 7 ? '事件空白期，适合布置组合策略'
            : daysToHigh > 2 ? '事件前窗口偏紧' : '事件临近，IV可能上升'}
        </Tile>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. StrategyBottom — dual-column recommendation
// ═══════════════════════════════════════════════════════════════════════════════

export const StrategyBottom = ({ coin }: { coin: Coin }) => {
  const { data: opt } = useDeribitOptions(coin);
  const { data: hist } = useDeribitHistory(coin);
  const { data: flow } = useFlowData(coin);

  const result = useMemo(() => {
    if (!opt) return null; // no option data yet — show loading
    return classifyRegime(opt, hist, flow);
  }, [opt, hist, flow]);

  // ── Loading state ──
  if (!opt) {
    return (
      <div className="widget-card dash-card !p-0 flex h-full min-h-[100px]">
        <div className="flex flex-col items-center justify-center gap-1.5 w-full">
          <div className="text-[13px] text-white/50">加载期权链数据…</div>
          <div className="text-[10px] text-white/30 flex items-center gap-2">
            <span>Deribit REST</span>
          </div>
        </div>
      </div>
    );
  }

  const { primary, secondary, dataMissing } = result;

  // ── Data quality indicator ──
  const missingBadge = dataMissing.length > 0
    ? <span className="text-[10px] text-white/35 px-2 py-0.5 rounded bg-white/5">缺 {dataMissing.join('、')}</span>
    : null;

  return (
    <div className="widget-card dash-card !p-0 flex flex-col w-full h-full">
      {/* Header */}
      <div className="flex items-center gap-2.5 shrink-0 px-[18px] pt-[14px] pb-[10px]">
        <span className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--color-surface-2)] text-white/55">
          <TrafficCone size={15} />
        </span>
        <span className="text-[13px] font-semibold uppercase tracking-[0.02em] text-white/65">
          策略推荐
        </span>
        <div className="ml-auto flex items-center gap-2">
          {missingBadge}
        </div>
      </div>

      {/* Main content: 2-column layout */}
      <div className="flex gap-3 px-[18px] pb-[16px] flex-1 min-h-0">
        {/* ── Primary recommendation ── */}
        <Tile className="flex-1 flex flex-col p-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-white/55">主力推荐</span>
            <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: primary.color }}>
              {primary.confidence}%
            </span>
          </div>
          <div className="text-[15px] font-bold mb-1.5" style={{ color: primary.color }}>
            {primary.playbook[0]}
          </div>
          <div className="text-[11px] text-white/55 leading-relaxed mb-1.5">{primary.description}</div>
          <div className="mt-auto flex flex-wrap gap-1">
            {primary.playbook.slice(0, 3).map((tip, i) => (
              <span key={i} className="text-[10px] bg-white/5 text-white/60 px-1.5 py-0.5 rounded">
                {i + 1}. {tip}
              </span>
            ))}
          </div>
        </Tile>

        {/* ── Secondary recommendation ── */}
        <Tile className="flex-1 flex flex-col p-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-white/55">
              {secondary ? '备选策略' : '备选信号'}
            </span>
            {secondary && (
              <span className="text-[10px] font-mono font-bold tabular-nums text-white/50">
                {secondary.confidence}%
              </span>
            )}
          </div>
          <div className="text-[15px] font-bold mb-1.5" style={{ color: secondary?.color ?? 'rgba(255,255,255,0.3)' }}>
            {secondary?.playbook[0] ?? '信号强度不足'}
          </div>
          <div className="text-[11px] text-white/50 leading-relaxed mb-1.5">
            {secondary?.description ?? '当前市场条件未形成明确的第二候选波谱，可参考主力推荐。'}
          </div>
          <div className="mt-auto flex flex-wrap gap-1">
            {(secondary?.playbook.slice(0, 3) ?? ['关注主力推荐']).map((tip, i) => (
              <span key={i} className="text-[10px] bg-white/5 text-white/45 px-1.5 py-0.5 rounded">
                {i + 1}. {tip}
              </span>
            ))}
          </div>
        </Tile>
      </div>

      {/* ── Footer: raw signal breakdown ── */}
      <div className="flex items-center gap-3 px-[18px] pb-[12px] shrink-0">
        <span className="text-[10px] text-white/35">
          波谱: <span style={{ color: primary.color }}>▸ {primary.label}</span>
          {secondary && <span className="text-white/35"> ｜<span style={{ color: secondary.color }}> {secondary.label}</span></span>}
        </span>
        <span className="text-[10px] text-white/35">
          拟合度 {primary.rawScore} / {(secondary?.rawScore ?? 0)}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-white/25">
          {dataMissing.length > 0 ? `部分数据缺失（${dataMissing.join('、')}），评分可能存在偏差` : '全数据源正常'}
        </span>
      </div>
    </div>
  );
};
