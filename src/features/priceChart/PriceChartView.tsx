import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, LineStyle, CrosshairMode,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
  type CreatePriceLineOptions, type CandlestickData,
} from 'lightweight-charts';
import { useDeribitOptions } from '../../registry/monitorWidgetsBase';
import { useLiveSpot } from '../optionsChain/liveData';
import type { Coin } from '../monitor/types';
import {
  useCandles, computeChainLevels, RESOLUTION_LABEL, COIN_SYMBOL,
  type Resolution,
} from './candles';

// 颜色（与 index.css token 对齐）
const UP = '#28C840';
const DOWN = '#FF5F57';
const YELLOW = '#FEBC2E';
const CALL = '#28C840';
const PUT = '#FF5F57';
const SPOT_C = 'rgba(255,255,255,0.92)';
const EM_C = '#4ea1ff';

const COINS: Coin[] = ['BTC', 'ETH'];
const RESOLUTIONS: Resolution[] = ['15m', '1h', '4h', '1d'];

const fmtPx = (v: number) =>
  v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
            : v.toLocaleString('en-US', { maximumFractionDigits: 2 });

// ── 小控件 ───────────────────────────────────────────────────────────────────

const Pill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={
      'px-2.5 h-[26px] rounded-md text-[12px] font-semibold transition-colors duration-[120ms] ' +
      (active
        ? 'bg-white/[0.12] text-white ring-1 ring-inset ring-white/[0.14]'
        : 'bg-transparent text-white/50 hover:bg-white/[0.07] hover:text-white/80')
    }
  >
    {children}
  </button>
);

const LevelChip = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) => (
  <div className="flex items-center gap-2 px-3 h-[42px] rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.05] shrink-0">
    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-white/45">{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color }}>
        {value}{sub && <span className="text-[10px] font-medium text-white/45 ml-1">{sub}</span>}
      </span>
    </div>
  </div>
);

// ── 主视图 ───────────────────────────────────────────────────────────────────

export const PriceChartView = () => {
  const [coin, setCoin] = useState<Coin>('BTC');
  const [res, setRes] = useState<Resolution>('1h');
  const [expirySel, setExpirySel] = useState<string | 'ALL'>('NEAREST');
  const [showLevels, setShowLevels] = useState(true);
  const [showEM, setShowEM] = useState(true);

  const { candles, loading, error } = useCandles(coin, res);
  const { data: opt } = useDeribitOptions(coin);
  const liveSpot = useLiveSpot(coin);

  // 现价：实时 WS 优先，回退到 K 线收盘 / 期权快照；取整避免 1Hz 抖动
  const lastClose = candles.length ? candles[candles.length - 1].c : 0;
  const spot = Math.round(liveSpot ?? lastClose ?? opt?.spot ?? 0);

  // 到期列表 + 解析选中到期
  const expiries = opt?.expiries ?? [];
  const nearest = expiries.find(e => e.daysToExp >= 0.5)?.label ?? expiries[0]?.label ?? '';
  const resolvedExpiry = expirySel === 'NEAREST' ? nearest : expirySel;
  const levels = useMemo(
    () => computeChainLevels(opt, resolvedExpiry, spot),
    [opt, resolvedExpiry, spot],
  );

  // ── Lightweight Charts 实例 ──
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // 各语义线独立持有，靠 applyOptions 增量更新，避免 1Hz 全量重建
  const lineRefs = useRef<Record<string, IPriceLine | null>>({});
  const lastKeyRef = useRef('');
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number } | null>(null);

  // 1) 创建图表（仅一次）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' },
        textColor: 'rgba(255,255,255,0.45)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.22)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#4ea1ff' },
        horzLine: { color: 'rgba(255,255,255,0.22)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#4ea1ff' },
      },
    });
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
      priceLineVisible: false, lastValueVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(series) as CandlestickData | undefined;
      if (d && typeof d.open === 'number') setHover({ o: d.open, h: d.high, l: d.low, c: d.close });
      else setHover(null);
    });

    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; lineRefs.current = {}; };
  }, []);

  // 2) 喂数据；数据集（coin/res）切换时 fitContent，轮询刷新时保持当前缩放
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    // 去重 + 升序（setData 要求 time 严格递增且唯一）
    const seen = new Set<number>();
    const data = candles
      .map(c => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }))
      .filter(d => (seen.has(d.time as number) ? false : (seen.add(d.time as number), true)));
    series.setData(data);
    const key = `${coin}-${res}`;
    if (lastKeyRef.current !== key) {
      chartRef.current?.timeScale().fitContent();
      lastKeyRef.current = key;
    }
  }, [candles, coin, res]);

  // 价格线 upsert 工具
  const upsert = (key: string, params: CreatePriceLineOptions | null) => {
    const series = seriesRef.current;
    if (!series) return;
    const cur = lineRefs.current[key];
    if (!params || params.price == null || !Number.isFinite(params.price)) {
      if (cur) { series.removePriceLine(cur); lineRefs.current[key] = null; }
      return;
    }
    if (cur) cur.applyOptions(params);
    else lineRefs.current[key] = series.createPriceLine(params);
  };

  // 3a) 关键位线（墙 / 痛点）— 仅在数值变化时更新
  useEffect(() => {
    upsert('callWall', showLevels && levels.callWall != null
      ? { price: levels.callWall, color: CALL, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Call墙' } : null);
    upsert('putWall', showLevels && levels.putWall != null
      ? { price: levels.putWall, color: PUT, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'Put墙' } : null);
    upsert('maxPain', showLevels && levels.maxPain != null
      ? { price: levels.maxPain, color: YELLOW, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '痛点' } : null);
  }, [showLevels, levels.callWall, levels.putWall, levels.maxPain]);

  // 3b) EM ±1σ 线 — 跟随现价（增量更新）
  useEffect(() => {
    const on = showEM && levels.emSigma != null && spot > 0;
    upsert('emUp', on ? { price: spot + levels.emSigma!, color: EM_C, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '+1σ' } : null);
    upsert('emDn', on ? { price: spot - levels.emSigma!, color: EM_C, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '−1σ' } : null);
  }, [showEM, levels.emSigma, spot]);

  // 3c) 现价线 — 跟随实时现价
  useEffect(() => {
    upsert('spot', spot > 0
      ? { price: spot, color: SPOT_C, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '现价' } : null);
  }, [spot]);

  // 3d) 把启用中的关键位并入价格轴缩放范围 —— 否则落在蜡烛区间外的线（如 −1σ）会被挤出可视区。
  //     重新赋值 autoscaleInfoProvider 即可触发价格轴按新范围重算。
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const vals: number[] = [];
    if (spot > 0) vals.push(spot);
    if (showLevels) [levels.callWall, levels.putWall, levels.maxPain].forEach(v => { if (v != null) vals.push(v); });
    if (showEM && levels.emSigma != null && spot > 0) vals.push(spot + levels.emSigma, spot - levels.emSigma);
    series.applyOptions({
      autoscaleInfoProvider: (base) => {
        const b = base();
        if (!b || !b.priceRange || vals.length === 0) return b;
        return {
          ...b,
          priceRange: {
            minValue: Math.min(b.priceRange.minValue, ...vals),
            maxValue: Math.max(b.priceRange.maxValue, ...vals),
          },
        };
      },
    });
  }, [spot, showLevels, showEM, levels.callWall, levels.putWall, levels.maxPain, levels.emSigma]);

  const emPct = levels.emSigma != null && spot ? (levels.emSigma / spot) * 100 : null;

  // 悬停读数：优先光标处，否则最新一根
  const readout = hover ?? (candles.length ? { o: lastClose, h: candles[candles.length - 1].h, l: candles[candles.length - 1].l, c: lastClose } : null);
  const readoutUp = readout ? readout.c >= readout.o : true;
  const readoutChg = readout && readout.o ? ((readout.c - readout.o) / readout.o) * 100 : 0;

  return (
    <div className="absolute inset-0 flex flex-col p-3 gap-2.5 text-white/85">
      {/* ── 工具栏 ── */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.05]">
          {COINS.map(c => <Pill key={c} active={coin === c} onClick={() => setCoin(c)}>{c}</Pill>)}
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.05]">
          {RESOLUTIONS.map(r => <Pill key={r} active={res === r} onClick={() => setRes(r)}>{RESOLUTION_LABEL[r]}</Pill>)}
        </div>

        <div className="w-px h-5 bg-white/[0.08] mx-0.5" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-white/40">到期</span>
          <select
            value={expirySel}
            onChange={e => setExpirySel(e.target.value)}
            className="h-[26px] px-2 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/[0.08] text-[12px] font-semibold text-white/80 outline-none cursor-pointer hover:bg-white/[0.09]"
          >
            <option value="NEAREST">最近 ({nearest || '—'})</option>
            <option value="ALL">全部聚合</option>
            {expiries.map(e => (
              <option key={e.label} value={e.label}>{e.label} · {Math.round(e.daysToExp)}d</option>
            ))}
          </select>
        </div>

        <div className="w-px h-5 bg-white/[0.08] mx-0.5" />

        <Pill active={showLevels} onClick={() => setShowLevels(v => !v)}>关键位</Pill>
        <Pill active={showEM} onClick={() => setShowEM(v => !v)}>预期波动</Pill>

        <div className="ml-auto text-[11px] text-white/35">
          价格 Binance · {COIN_SYMBOL[coin]} ｜ 关键位 Deribit
        </div>
      </div>

      {/* ── 关键位读数条 ── */}
      <div className="flex items-center gap-2 overflow-x-auto shrink-0 pb-0.5">
        <LevelChip label="现价" value={spot ? fmtPx(spot) : '—'} color={SPOT_C} />
        <LevelChip label="Call 墙" value={levels.callWall != null ? fmtPx(levels.callWall) : '—'} color={CALL} />
        <LevelChip label="最大痛点" value={levels.maxPain != null ? fmtPx(levels.maxPain) : '—'} color={YELLOW} />
        <LevelChip label="Put 墙" value={levels.putWall != null ? fmtPx(levels.putWall) : '—'} color={PUT} />
        <LevelChip
          label={`±1σ 预期${levels.emExpiryLabel ? ` · ${levels.emExpiryLabel}` : ''}`}
          value={levels.emSigma != null && spot ? `${fmtPx(spot - levels.emSigma)} – ${fmtPx(spot + levels.emSigma)}` : '—'}
          sub={emPct != null ? `±${emPct.toFixed(1)}%` : undefined}
          color={EM_C}
        />
      </div>

      {/* ── 图表 ── */}
      <div className="flex-1 min-h-0 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.05] p-1.5 relative">
        <div ref={containerRef} className="absolute inset-1.5" />

        {/* 悬停 OHLC 读数 */}
        {readout && (
          <div className="absolute top-2.5 left-3 z-10 flex items-center gap-2.5 text-[11px] font-mono tabular-nums pointer-events-none">
            <span className="font-bold text-white/70">{coin}</span>
            <span className="text-white/45">开 <span className="text-white/75">{fmtPx(readout.o)}</span></span>
            <span className="text-white/45">高 <span className="text-white/75">{fmtPx(readout.h)}</span></span>
            <span className="text-white/45">低 <span className="text-white/75">{fmtPx(readout.l)}</span></span>
            <span className="text-white/45">收 <span style={{ color: readoutUp ? UP : DOWN }}>{fmtPx(readout.c)}</span></span>
            <span style={{ color: readoutUp ? UP : DOWN }}>{readoutChg >= 0 ? '+' : ''}{readoutChg.toFixed(2)}%</span>
          </div>
        )}

        {candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40 pointer-events-none">
            {error ? '数据加载失败，重试中…' : loading ? '加载 K 线中…' : '暂无数据'}
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceChartView;
