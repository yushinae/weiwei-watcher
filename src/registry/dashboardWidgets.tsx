import React, { useMemo } from 'react';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { Tile } from '../components/card/Tile';
import type { Coin } from '../features/monitor/types';
import { useDeribitOptions, useDeribitHistory, useFlowData, VolConeChart } from './monitorWidgetsBase';
import { classifyRegime } from './monitorWidgetsBase';
import { getUpcomingEvents, formatEventTime, type EcoEvent } from './data/economicCalendar';
import type { TickerSnapshot } from './data/ws';

// ═══════════════════════════════════════════════════════════════════════════════
// Card shell
// ═══════════════════════════════════════════════════════════════════════════════

export const DashCard = ({ icon: Icon, title, right, children }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) => (
  <div className="widget-card dash-card !p-0 flex flex-col h-full">
    <div className="flex items-center gap-2.5 px-[18px] pt-[14px] pb-[10px] shrink-0">
      <span className="w-7 h-7 flex items-center justify-center rounded-md bg-white/[0.04] text-white/55">
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

export const EnvironmentThermometer = ({ coin, ticker }: { coin: Coin; ticker: TickerSnapshot | null }) => {
  const { data: hist } = useDeribitHistory(coin);
  const dvol = ticker?.dvol ?? hist?.dvolSeries?.[hist.dvolSeries.length - 1] ?? 0;
  const ivr = hist?.ivRankCurrent ?? 50;
  const vrp = hist?.vrp?.length ? hist.vrp[hist.vrp.length - 1].iv - hist.vrp[hist.vrp.length - 1].rv : 5;
  const impliedMove = typeof dvol === 'number' && !isNaN(dvol) && dvol > 0
    ? (dvol * Math.sqrt(30 / 365) * Math.sqrt(2 / Math.PI)).toFixed(1) : '—';

  // DVOL segment index
  const dvolSegIdx = DVOL_SEGMENTS.findIndex(s => dvol <= s.max);

  // IV Rank pct
  const ivrPct = Math.round(ivr);
  const ivrColor = ivrPct <= 25 ? 'var(--color-sev-calm)' : ivrPct <= 50 ? 'var(--color-sev-mid)' : ivrPct <= 75 ? 'var(--color-sev-high)' : 'var(--color-sev-extreme)';
  const verdictText = ivrPct <= 25 ? 'IV 偏低 → 适合买方策略'
    : ivrPct <= 50 ? 'IV 中等偏低 → 日历价差时机'
    : ivrPct <= 75 ? 'IV 偏高 → 卖方溢价充足'
    : 'IV 高位 → 谨慎卖 Vega';

  return (
    <div className="flex flex-col w-full h-full gap-2.5">
      {/* ---- IV Rank: big number + horizontal bar ---- */}
      <div>
        <div className="flex items-baseline gap-1">
          <AnimatedNumber
            value={ivrPct}
            format={(v) => Math.round(v).toString()}
            pulseOnChange
            className="text-[44px] font-bold tabular-nums leading-none tracking-[-0.03em]"
            style={{ color: ivrColor }}
          />
          <span className="text-[17px] font-semibold text-white/50">%</span>
        </div>
        <div className="text-[11px] text-white/50 mt-1 mb-2">IV Rank（52周百分位）</div>
        {/* Horizontal gauge bar */}
        <div className="relative w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
          {/* Gradient backdrop */}
          <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-sev-calm), var(--color-sev-mid), var(--color-sev-high), var(--color-sev-extreme))' }} />
          {/* Dark mask from the right */}
          <div className="absolute top-0 right-0 h-full rounded-r-full bg-[#111111]" style={{ width: `${100 - ivrPct}%` }} />
          {/* Pointer dot */}
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-[#111111] shadow transition-all duration-700" style={{ left: `calc(${ivrPct}% - 6px)` }} />
        </div>
      </div>

      {/* ---- DVOL segment bar ---- */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50 font-medium w-[34px] shrink-0">DVOL</span>
        <div className="flex gap-[3px] flex-1">
          {DVOL_SEGMENTS.map((seg, i) => (
            <div key={i} className="flex-1 h-[6px] rounded-sm transition-opacity duration-300" style={{ background: seg.color, opacity: i <= dvolSegIdx ? 1 : 0.12 }} />
          ))}
        </div>
        <span className="text-[15px] font-bold tabular-nums text-white/85 w-[48px] text-right">
          <AnimatedNumber value={dvol} format={(v) => v.toFixed(1)} />%
        </span>
      </div>

      {/* ---- Data row ---- */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/50">30d 预期波动 <span className="font-semibold tabular-nums text-white/70">±{impliedMove}%</span></span>
        <span className="text-white/50">VRP <span className="font-semibold tabular-nums" style={{ color: vrp >= 5 ? 'var(--color-trade-up)' : 'var(--color-trade-down)' }}>{vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}pp</span></span>
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

export const GEXKeyLevels = ({ coin, ticker }: { coin: Coin; ticker: TickerSnapshot | null }) => {
  const { data: opt } = useDeribitOptions(coin);
  const spot = ticker?.spot ?? opt?.spot ?? 0;

  const levels = useMemo(() => {
    if (!opt?.expiries.length) return null;
    const allOptions = opt.expiries.flatMap(e => [...e.calls, ...e.puts]);
    const oiMap = new Map<number, { callOi: number; putOi: number }>();
    for (const o of allOptions) {
      if (!oiMap.has(o.strike)) oiMap.set(o.strike, { callOi: 0, putOi: 0 });
      const b = oiMap.get(o.strike)!;
      if (o.type === 'C') b.callOi += o.oi;
      else b.putOi += o.oi;
    }
    const callWall = [...oiMap.entries()].filter(([k]) => k >= spot).sort((a, b) => b[1].callOi - a[1].callOi)[0]?.[0] ?? spot;
    const putWall  = [...oiMap.entries()].filter(([k]) => k <= spot).sort((a, b) => b[1].putOi - a[1].putOi)[0]?.[0] ?? spot;
    const maxPain  = [...oiMap.entries()].sort((a, b) => (b[1].callOi + b[1].putOi) - (a[1].callOi + a[1].putOi))[0]?.[0] ?? spot;
    const totalCallOi = allOptions.filter(o => o.type === 'C').reduce((s, o) => s + o.oi, 0);
    const totalPutOi  = allOptions.filter(o => o.type === 'P').reduce((s, o) => s + o.oi, 0);
    const gexTilt = totalPutOi > totalCallOi * 1.15 ? 'bearish' : totalCallOi > totalPutOi * 1.15 ? 'bullish' : 'neutral';
    const gexUsd = totalPutOi > totalCallOi ? `-$${((totalPutOi - totalCallOi) * spot / 1e6).toFixed(0)}M` : `+$${((totalCallOi - totalPutOi) * spot / 1e6).toFixed(0)}M`;

    // OI-based support/resistance zones from top 3 call/put OI strikes
    const topCalls = [...oiMap.entries()].filter(([k]) => k >= spot).sort((a, b) => b[1].callOi - a[1].callOi).slice(0, 3);
    const topPuts  = [...oiMap.entries()].filter(([k]) => k <= spot).sort((a, b) => b[1].putOi - a[1].putOi).slice(0, 3);
    const resistStrikes = topCalls.filter(([,v]) => v.callOi > 0).map(([k]) => k);
    const supportStrikes = topPuts.filter(([,v]) => v.putOi > 0).map(([k]) => k);
    const resistL = resistStrikes.length >= 2 ? Math.min(...resistStrikes) : spot;
    const resistH = resistStrikes.length >= 2 ? Math.max(...resistStrikes) : spot;
    const supportL = supportStrikes.length >= 2 ? Math.min(...supportStrikes) : spot;
    const supportH = supportStrikes.length >= 2 ? Math.max(...supportStrikes) : spot;

    return { callWall, putWall, maxPain, gexTilt, gexUsd, resistL, resistH, supportL, supportH };
  }, [opt, spot]);

  const fmtPx = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
          { label: 'Call 墙', value: levels?.callWall ?? spot, color: 'var(--color-trade-up)' },
          { label: '最大痛点', value: levels?.maxPain ?? spot, color: 'var(--color-sev-mid)' },
          { label: 'Put 墙',  value: levels?.putWall  ?? spot, color: 'var(--color-trade-down)' },
          { label: 'GEX 总量', value: null, color: 'var(--color-text-muted)', text: levels?.gexUsd ?? '—' },
        ].map((item, i) => (
          <Tile key={i} className="flex flex-col gap-0.5 px-2.5 py-1.5">
            <span className="text-[10px] text-white/55 uppercase tracking-wider">{item.label}</span>
            <span className="text-[15px] font-bold tabular-nums" style={{ color: item.color }}>
              {item.text != null
                ? item.text
                : <AnimatedNumber value={item.value as number} format={fmtPx} pulseOnChange />}
            </span>
          </Tile>
        ))}
      </div>

      {/* Support / Resistance zones */}
      <div className="flex gap-1.5">
        <Tile className="flex-1 flex flex-col gap-0.5 px-2.5 py-1.5">
          <span className="text-[10px] text-white/55 uppercase tracking-wider">支撑区</span>
          <span className="text-[13px] font-bold tabular-nums text-trade-down">
            {levels ? `${fmtPx(levels.supportL)} – ${fmtPx(levels.supportH)}` : (
              <span className="text-white/40">—</span>
            )}
          </span>
        </Tile>
        <Tile className="flex-1 flex flex-col gap-0.5 px-2.5 py-1.5">
          <span className="text-[10px] text-white/55 uppercase tracking-wider">阻力区</span>
          <span className="text-[13px] font-bold tabular-nums text-trade-up">
            {levels ? `${fmtPx(levels.resistL)} – ${fmtPx(levels.resistH)}` : (
              <span className="text-white/40">—</span>
            )}
          </span>
        </Tile>
      </div>

      {/* GEX tilt */}
      {levels && (
        <Tile className={`p-2 text-[12px] font-semibold border-l-[3px] ${
          levels.gexTilt === 'bearish' ? 'text-trade-down border-trade-down' :
          levels.gexTilt === 'bullish' ? 'text-trade-up border-trade-up' :
          'text-white/50 border-white/20'
        }`}>
          {levels.gexTilt === 'bearish' ? '↓ GEX倾向: 空头聚集' : levels.gexTilt === 'bullish' ? '↑ GEX倾向: 多头主导' : 'GEX 中性'}
        </Tile>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EventCalendarStrip
// ═══════════════════════════════════════════════════════════════════════════════

export const EventCalendarStrip = React.memo(() => {
  const events = useMemo(() => getUpcomingEvents(30), []);

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

  const today = new Date();
  const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  const todayEvent = events.find(e => e.date === todayStr);

  const year = new Date().getFullYear();
  const highEvent = events.find(e => e.importance === 'high');
  const daysToHigh = highEvent ? Math.round((new Date(`${year}-${highEvent.date.slice(0, 2)}-${highEvent.date.slice(3, 5)}T08:00:00Z`).getTime() - Date.now()) / 86_400_000) : 99;

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex items-center py-1 px-1.5 -mx-1.5 gap-3 shrink-0 rounded-lg
                      hover:bg-[var(--color-bg-hover)] hover:translate-y-[-1px] hover:shadow-[0_5px_14px_-6px_rgba(0,0,0,0.55)]
                      transition-all duration-[160ms]">
        <span className="text-[11px] font-semibold tabular-nums text-white/55 min-w-[42px]">今天</span>
        <span className="text-[13px] text-white/75 flex-1">{todayEvent ? todayEvent.title : '无事件'}</span>
        {todayEvent?.timeET && <span className="text-[10px] tabular-nums text-white/50">{formatEventTime(todayEvent.timeET)}</span>}
        {todayEvent ? <TagBadge e={todayEvent} /> : <span className="text-[9px] text-white/30">—</span>}
      </div>

      {/* 事件列表 — 超出 ~5 条时上下滚动 */}
      <div className="min-h-0 max-h-[170px] overflow-y-auto dash-scroll flex flex-col gap-1">
        {events.filter(e => e.date !== todayStr).map((e, i) => (
          <div key={i} className="flex items-center py-1.5 px-1.5 -mx-1.5 gap-3 rounded-lg
                                 hover:bg-[var(--color-bg-hover)] hover:translate-y-[-1px] hover:shadow-[0_5px_14px_-6px_rgba(0,0,0,0.55)]
                                 transition-all duration-[160ms]">
            <span className="text-[11px] font-semibold tabular-nums text-white/55 min-w-[42px]">{e.date}</span>
            <span className="text-[13px] text-white/80 flex-1">{e.title}</span>
            {e.timeET && <span className="text-[10px] tabular-nums text-white/50">{formatEventTime(e.timeET)}</span>}
            <TagBadge e={e} />
          </div>
        ))}
      </div>

      <Tile className={`shrink-0 mt-auto pt-2 p-2.5 text-[12px] font-semibold ${
        daysToHigh > 7 ? 'text-[var(--color-sev-calm)]' : daysToHigh > 2 ? 'text-[var(--color-sev-mid)]' : 'text-[var(--color-sev-extreme)]'
      }`}>
        建议: {daysToHigh > 7 ? '事件空白期，适合布置组合策略' : daysToHigh > 2 ? '事件前窗口偏紧' : '事件临近，IV可能上升'}
      </Tile>
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

  const regime = useMemo(() => {
    if (!opt) return null;
    return classifyRegime(opt, hist, flow);
  }, [opt, hist, flow]);

  if (!regime) return null;

  return (
    <div className="widget-card dash-card !p-0 flex h-full">
      <div className="flex gap-5 p-5 w-full">
        <Tile className="flex-1 p-4 bg-[var(--nexus-accent)]/[0.08] border-l-[3px] border-[var(--nexus-accent)]/60">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-white/55 mb-2">主力推荐</div>
          <div className="text-[17px] font-bold text-[var(--nexus-accent)] mb-1.5">{regime.playbook[0] ?? '等待信号'}</div>
          <div className="text-[12px] text-white/55 leading-relaxed mb-1">{regime.description}</div>
          <div className="text-[10px] text-white/45 font-mono">置信度: {regime.confidence}% · {regime.label}</div>
        </Tile>
        <Tile className="flex-1 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-white/55 mb-2">备选</div>
          <div className="text-[17px] font-bold text-white/70 mb-1.5">{regime.playbook[1] ?? '中性观望'}</div>
          <div className="text-[12px] text-white/50 leading-relaxed">{regime.playbook.slice(1, 3).join(' · ') || '多种策略可用'}</div>
        </Tile>
      </div>
    </div>
  );
};
