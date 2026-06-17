// 关键位叠加蜡烛图 —— 基于 TradingView 开源库 lightweight-charts（替代停更的 klinecharts）。
// 蜡烛 + 成交量 + 关键位价线（Call/Put 墙 / 最大痛点 / ±1σ，并入价轴自动缩放范围）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle, TickMarkType,
} from 'lightweight-charts';
import type {
  IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, HistogramData, AutoscaleInfo, Time,
} from 'lightweight-charts';
import { ChevronDown, Eye, EyeOff, RotateCcw, Save, Settings2, X } from 'lucide-react';
import { useCandles, computeChainLevels, type Resolution, type Candle } from './candles';
import {
  DRAW_TOOLS, NOTE_COLOR, NotePrimitive, loadDrawings, saveDrawings, newId,
  type DrawTool, type Drawing, type DrawingInput,
} from './drawings';
import {
  DEFAULT_NY_MIDNIGHT_OPTIONS, NYMidnightPrimitive, computeNYMidnightEvents,
  type NYMidnightOptions, type NYMidnightLineStyle, type NYMidnightLabelLang,
} from './indicators/nyMidnight';
import { PriceLevelsPrimitive, type PriceLevel } from './indicators/priceLevels';
import { useDeribitOptions } from '../../registry/monitorWidgetsBase';
import { useLiveSpot } from '../optionsChain/liveData';
import type { Coin } from '../monitor/types';

const UP = '#28C840'; const YELLOW = '#FEBC2E'; const CALL = '#28C840'; const PUT = '#FF5F57'; const EM_C = '#ff9c2e';
const DOWN = '#FF5F57';

const COINS: Coin[] = ['BTC', 'ETH'];
const RESOLUTIONS: Resolution[] = ['5m', '15m', '1h', '4h', '1d', '1w'];
const RES_LABEL: Record<Resolution, string> = { '5m':'5分','15m':'15分','1h':'1时','4h':'4时','1d':'1日','1w':'1周' };
const RES_TV_LABEL: Record<Resolution, string> = { '5m':'5','15m':'15','1h':'1h','4h':'4h','1d':'1D','1w':'1W' };
const SYMBOL_LABEL: Record<Coin, string> = { BTC: 'Bitcoin / TetherUS', ETH: 'Ethereum / TetherUS' };
const SYMBOL_ICON: Record<Coin, string> = { BTC: '₿', ETH: 'Ξ' };
const NY_TIME_ZONE = 'America/New_York';

const NY_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hourCycle: 'h12',
  hour: '2-digit',
  minute: '2-digit',
});
const NY_DATE_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  hourCycle: 'h12',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US',{maximumFractionDigits:0}) : v.toLocaleString('en-US',{maximumFractionDigits:2});
const fmtVol = (v: number) => {
  if (v >= 1_000_000) return `${(v/1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v/1_000).toFixed(2)}K`;
  return v.toFixed(2);
};
const fmtSigned = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
const RES_MS: Record<Resolution, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};
const PRICE_LABEL_RIGHT_GAP_PX = 2;
// 默认视图：显示最近这么多根 K 线（不是全部），右侧留几根空白当呼吸位——按 Option+R 复位到这个倍数
const DEFAULT_VISIBLE_BARS = 120;
const DEFAULT_RIGHT_MARGIN_BARS = 20;
// 把视图复位到「最近 N 根、最新贴右」；数据不足 N 根时退回铺满
const applyDefaultView = (chart: IChartApi, count: number) => {
  const ts = chart.timeScale();
  if (count > DEFAULT_VISIBLE_BARS) {
    ts.setVisibleLogicalRange({ from: count - DEFAULT_VISIBLE_BARS, to: count - 1 + DEFAULT_RIGHT_MARGIN_BARS });
  } else {
    ts.fitContent();
  }
};
const formatAxisPrice = (price: number) => price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type LevelLabelDef = { key: string; price: number; color: string };
type CrosshairPriceLabel = { y: number; price: number; width: number } | null;
const timeToDate = (time: Time): Date => {
  if (typeof time === 'number') return new Date(time * 1000);
  if (typeof time === 'string') return new Date(`${time}T00:00:00Z`);
  return new Date(Date.UTC(time.year, time.month - 1, time.day));
};
const partsRecord = (formatter: Intl.DateTimeFormat, date: Date): Record<string, string> =>
  Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
const formatNYAxisTime = (time: Time): string => {
  const p = partsRecord(NY_TIME_PARTS, timeToDate(time));
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
};
const formatNYCrosshairTime = (time: Time): string => {
  const p = partsRecord(NY_DATE_TIME_PARTS, timeToDate(time));
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute} ${p.dayPeriod}`;
};
const formatNYDate = (time: Time, withYear = false): string => {
  const p = partsRecord(NY_DATE_PARTS, timeToDate(time));
  return withYear ? p.year : `${p.day} ${p.month}`;
};
const formatNYTickMark = (time: Time, tickMarkType: TickMarkType): string | null => {
  if (tickMarkType === TickMarkType.Time || tickMarkType === TickMarkType.TimeWithSeconds) return formatNYAxisTime(time);
  if (tickMarkType === TickMarkType.DayOfMonth) return formatNYDate(time);
  if (tickMarkType === TickMarkType.Month) return partsRecord(NY_DATE_PARTS, timeToDate(time)).month;
  if (tickMarkType === TickMarkType.Year) return formatNYDate(time, true);
  return null;
};

const Pill: React.FC<{active:boolean;onClick:()=>void;children:React.ReactNode}> = ({active,onClick,children}) => (
  <button onClick={onClick}
    className={`px-2.5 h-[26px] rounded-md text-[12px] font-semibold transition-colors duration-[120ms] ${
      active?'bg-[#3A3F40] text-[var(--nexus-accent)]':'bg-transparent text-white/50 hover:bg-[#3A3B40] hover:text-white/80'}`}>
    {children}
  </button>
);

const LevelChip = ({label,value,sub,color}:{label:string;value:string;sub?:string;color:string}) => (
  <div className="flex items-center gap-2 px-3 h-[42px] rounded-lg bg-[#2B2D35] hover:bg-[#3A3B40] transition-colors duration-[120ms] shrink-0">
    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{backgroundColor:color}}/>
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-white/45">{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{color}}>{value}{sub&&<span className="text-[10px] font-medium text-white/45 ml-1">{sub}</span>}</span>
    </div>
  </div>
);

const toCandle = (c: Candle): CandlestickData => ({ time: Math.floor(c.t/1000) as UTCTimestamp, open:c.o, high:c.h, low:c.l, close:c.c });
// 成交量柱：涨绿跌红，半透明叠在图表底部约 18%（与蜡烛同一时间轴）
const VOL_UP = 'rgba(40,200,64,0.5)'; const VOL_DOWN = 'rgba(255,95,87,0.5)';
const toVolume = (c: Candle): HistogramData => ({ time: Math.floor(c.t/1000) as UTCTimestamp, value: c.v, color: c.c >= c.o ? VOL_UP : VOL_DOWN });

type LegendCandle = { o:number; h:number; l:number; c:number; v:number; change:number; pct:number };
type NYSettingsTab = 'inputs' | 'style' | 'visibility';
type ResolutionVisibility = Record<Resolution, boolean>;
type NYSavedDefault = { options: NYMidnightOptions; visibleOn: ResolutionVisibility };

const IndicatorIconButton = ({
  title, onClick, children,
}: { title:string; onClick:()=>void; children:React.ReactNode }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className="grid h-[20px] w-[20px] place-items-center rounded text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors duration-[120ms]"
  >
    {children}
  </button>
);

const DEFAULT_RES_VISIBILITY: ResolutionVisibility = {
  '5m': true, '15m': true, '1h': true, '4h': true, '1d': false, '1w': false,
};
const NY_MIDNIGHT_DEFAULTS_KEY = 'ww_indicator_ny_midnight_defaults';

function colorToHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const nums = color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 3) return '#808080';
  return `#${nums.slice(0,3).map(n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0')).join('')}`;
}

function loadNYMidnightDefault(): NYSavedDefault {
  try {
    const raw = localStorage.getItem(NY_MIDNIGHT_DEFAULTS_KEY);
    if (!raw) return { options: DEFAULT_NY_MIDNIGHT_OPTIONS, visibleOn: DEFAULT_RES_VISIBILITY };
    const parsed = JSON.parse(raw) as Partial<NYSavedDefault>;
    return {
      options: { ...DEFAULT_NY_MIDNIGHT_OPTIONS, ...(parsed.options ?? {}) },
      visibleOn: { ...DEFAULT_RES_VISIBILITY, ...(parsed.visibleOn ?? {}) },
    };
  } catch {
    return { options: DEFAULT_NY_MIDNIGHT_OPTIONS, visibleOn: DEFAULT_RES_VISIBILITY };
  }
}

function saveNYMidnightDefault(value: NYSavedDefault): void {
  try { localStorage.setItem(NY_MIDNIGHT_DEFAULTS_KEY, JSON.stringify(value)); } catch { /* ignore */ }
}

// 记住上次看的币种 / 周期，下次打开图表直接回到原样
const CHART_PREFS_KEY = 'ww_chart_prefs';
function loadChartPrefs(): { coin: Coin; res: Resolution } {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHART_PREFS_KEY) ?? '{}') as Partial<{ coin: Coin; res: Resolution }>;
    return {
      coin: COINS.includes(parsed.coin as Coin) ? parsed.coin as Coin : 'BTC',
      res: RESOLUTIONS.includes(parsed.res as Resolution) ? parsed.res as Resolution : '1h',
    };
  } catch {
    return { coin: 'BTC', res: '1h' };
  }
}

export const CandleChartView = ({ active = true }: { active?: boolean }) => {
  const savedNYDefault = useMemo(loadNYMidnightDefault, []);
  const savedChartPrefs = useMemo(loadChartPrefs, []);
  const [coin,setCoin] = useState<Coin>(savedChartPrefs.coin);
  const [res,setRes] = useState<Resolution>(savedChartPrefs.res);
  const [expirySel,setExpirySel] = useState<string|'ALL'>('NEAREST');
  const [showLevels,setShowLevels] = useState(true);
  const [showEM,setShowEM] = useState(true);
  const [showVolume,setShowVolume] = useState(true);
  const [showNYMidnight,setShowNYMidnight] = useState(true);
  const [nyOptions,setNyOptions] = useState<NYMidnightOptions>(savedNYDefault.options);
  const [nyDraftOptions,setNyDraftOptions] = useState<NYMidnightOptions>(savedNYDefault.options);
  const [nySettingsOpen,setNySettingsOpen] = useState(false);
  const [nySettingsTab,setNySettingsTab] = useState<NYSettingsTab>('inputs');
  const [nyDefaultsOpen,setNyDefaultsOpen] = useState(false);
  const [nySavedDefault,setNySavedDefault] = useState<NYSavedDefault>(savedNYDefault);
  const [nyVisibleOn,setNyVisibleOn] = useState<ResolutionVisibility>(savedNYDefault.visibleOn);
  const [nyDraftVisibleOn,setNyDraftVisibleOn] = useState<ResolutionVisibility>(savedNYDefault.visibleOn);

  const {candles,loading,error,loadOlder} = useCandles(coin,res);
  const {data:opt} = useDeribitOptions(coin);
  const liveSpot = useLiveSpot(coin);
  const lastClose = candles.length ? candles[candles.length-1].c : 0;
  const spot = Math.round(liveSpot ?? lastClose ?? opt?.spot ?? 0);
  const expiries = opt?.expiries ?? [];
  const nearest = expiries.find(e=>e.daysToExp>=0.5)?.label ?? expiries[0]?.label ?? '';
  const resolvedExpiry = expirySel === 'NEAREST' ? nearest : expirySel;
  const levels = useMemo(()=>computeChainLevels(opt,resolvedExpiry,spot),[opt,resolvedExpiry,spot]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi|null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'>|null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'>|null>(null);
  const nyMidnightRef = useRef<NYMidnightPrimitive|null>(null);
  const priceLevelsRef = useRef<PriceLevelsPrimitive|null>(null);
  const levelPricesRef = useRef<number[]>([]);     // 当前关键位价，供 autoscaleInfoProvider 并入价轴范围
  const candleCountRef = useRef(0);                // 当前 K 线根数，供 Option+R 复位计算默认可见区
  const prevFirstTRef = useRef(0);                 // 上次首根起始时间，用于识别「历史前插」
  const prevLenRef = useRef(0);                    // 上次根数，用于前插后平移视图保持不跳
  const fullReloadRef = useRef(true);              // coin/res 切换 → 下一帧 setData 重建（否则 update 增量）
  const [countdown,setCountdown] = useState('0:00');
  // 最新价标签 / 关键位价标签：结构（哪些标签、什么颜色）很少变 → React 状态；
  // 位置（缩放/平移时每帧都在动）→ 直接写 DOM 的 transform，不触发整页重渲染。
  const lastPriceLabelRef = useRef<HTMLDivElement|null>(null);
  const [levelLabelDefs,setLevelLabelDefs] = useState<LevelLabelDef[]>([]);
  const levelLabelNodes = useRef<Map<string,HTMLDivElement>>(new Map());
  const [crosshairPriceLabel,setCrosshairPriceLabel] = useState<CrosshairPriceLabel>(null);
  const [hoverCandle,setHoverCandle] = useState<LegendCandle|null>(null);
  const candleMetaRef = useRef<Map<number,{v:number;prevClose:number}>>(new Map());

  // ── 标注层（自定义） ──────────────────────────────────────────────────────
  const [activeTool,setActiveTool] = useState<DrawTool|null>(null);
  const [drawHint,setDrawHint] = useState('');
  const activeToolRef = useRef<DrawTool|null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const drawVisualsRef = useRef<Map<string,{primitive:NotePrimitive}>>(new Map());
  const coinRef = useRef<Coin>(coin);
  coinRef.current = coin;

  // 标记浮层：openNote=展开中的标记 id；notePos=锚点 media 坐标（rAF 跟随 pan/zoom）
  const [openNote,setOpenNote] = useState<string|null>(null);
  const [notePos,setNotePos] = useState<{x:number;y:number}|null>(null);
  const [noteText,setNoteText] = useState('');
  const openNoteRef = useRef<string|null>(null);
  openNoteRef.current = openNote;

  function renderDrawing(d: Drawing) {
    const series = candleSeriesRef.current;
    if (!series) return;
    const prim = new NotePrimitive(d);
    series.attachPrimitive(prim);
    drawVisualsRef.current.set(d.id, { primitive: prim });
  }
  function unrenderDrawing(id: string) {
    const series = candleSeriesRef.current;
    const v = drawVisualsRef.current.get(id);
    if (v && series) {
      series.detachPrimitive(v.primitive);
    }
    drawVisualsRef.current.delete(id);
  }
  function addDrawing(partial: DrawingInput): Drawing {
    const d = { ...partial, id: newId() } as Drawing;
    drawingsRef.current = [...drawingsRef.current, d];
    renderDrawing(d);
    saveDrawings(coinRef.current, drawingsRef.current);
    return d;
  }
  function removeLastDrawing() {
    const last = drawingsRef.current[drawingsRef.current.length-1];
    if (!last) return;
    if (last.id === openNoteRef.current) closeNote();
    unrenderDrawing(last.id);
    drawingsRef.current = drawingsRef.current.slice(0,-1);
    saveDrawings(coinRef.current, drawingsRef.current);
    setDrawHint('');
  }
  function clearDrawings() {
    closeNote();
    drawingsRef.current.forEach(d=>unrenderDrawing(d.id));
    drawingsRef.current = [];
    saveDrawings(coinRef.current, drawingsRef.current);
    setDrawHint('');
  }
  function selectTool(t: DrawTool) {
    const next = activeToolRef.current === t ? null : t;
    activeToolRef.current = next;
    setActiveTool(next);
    setDrawHint(next === 'note' ? '点击图上位置放置标注' : '');
  }

  // ── 标记浮层 ────────────────────────────────────────────────────────────────
  function setNoteActive(id: string|null, v: boolean) {
    if (!id) return;
    const prim = drawVisualsRef.current.get(id)?.primitive;
    if (prim instanceof NotePrimitive) prim.setActive(v);
  }
  function openNoteFor(id: string) {
    const d = drawingsRef.current.find(x=>x.id===id);
    if (!d || d.type!=='note') return;
    setNoteActive(openNoteRef.current, false);
    setNoteText(d.text);
    setNotePos(null);          // 位置由 rAF 同步，先隐藏避免闪到旧位置
    setOpenNote(id);
    setNoteActive(id, true);
  }
  function closeNote() {
    setNoteActive(openNoteRef.current, false);
    setOpenNote(null); setNotePos(null);
  }
  function updateNoteText(text: string) {
    setNoteText(text);
    const d = drawingsRef.current.find(x=>x.id===openNoteRef.current);
    // 原地改文本（primitive 持有同一对象引用；文本只在浮层显示，无需重绘）
    if (d && d.type==='note') { d.text = text; saveDrawings(coinRef.current, drawingsRef.current); }
  }
  function deleteOpenNote() {
    const id = openNoteRef.current;
    if (!id) return;
    unrenderDrawing(id);
    drawingsRef.current = drawingsRef.current.filter(d=>d.id!==id);
    saveDrawings(coinRef.current, drawingsRef.current);
    setOpenNote(null); setNotePos(null);
  }

  useEffect(()=>{
    const meta = new Map<number,{v:number;prevClose:number}>();
    candles.forEach((c, i) => {
      meta.set(Math.floor(c.t/1000), { v:c.v, prevClose:candles[i-1]?.c ?? c.o });
    });
    candleMetaRef.current = meta;
  },[candles]);

  // 1) 初始化图表（仅挂载一次）
  useEffect(()=>{
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el,{
      autoSize: true,
      layout: { background:{type:ColorType.Solid,color:'transparent'}, textColor:'rgba(255,255,255,0.5)', fontSize:11 },
      grid: {
        vertLines:{ visible:false, color:'transparent' },
        horzLines:{ visible:false, color:'transparent' },
      },
      localization: {
        locale: 'en-US',
        timeFormatter: formatNYCrosshairTime,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: '#404347' },
        horzLine: { labelVisible: false },
      },
      handleScale: {
        mouseWheel: false,   // 滚轮/触控板缩放完全自定义（见 onWheel）
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      handleScroll: {
        mouseWheel: false,   // 滚轮/触控板平移也自定义
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      rightPriceScale: { borderColor:'transparent', minimumWidth: 48 },
      timeScale: {
        borderColor:'transparent',
        timeVisible:true,
        secondsVisible:false,
        tickMarkFormatter: formatNYTickMark,
        tickMarkMaxCharacterLength: 8,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:UP, downColor:DOWN, borderUpColor:UP, borderDownColor:DOWN, wickUpColor:UP, wickDownColor:DOWN,
      priceFormat: { type:'custom', minMove:0.01, formatter: formatAxisPrice, tickmarksFormatter: prices => prices.map(formatAxisPrice) },
      lastValueVisible: false,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dotted,
      // 把关键位价并入价轴自动缩放范围（否则远离现价的 Call 墙会被挤出可视区）
      autoscaleInfoProvider: (orig: () => AutoscaleInfo | null): AutoscaleInfo | null => {
        const r = orig();
        const ps = levelPricesRef.current;
        if (!r || ps.length === 0) return r;
        let { minValue, maxValue } = r.priceRange;
        for (const p of ps) { if (p < minValue) minValue = p; if (p > maxValue) maxValue = p; }
        return { priceRange: { minValue, maxValue }, margins: r.margins };
      },
    });
    candleSeriesRef.current = candleSeries;
    // 成交量直方图：独立 overlay 价轴，挤到底部约 18%，不影响蜡烛的价轴缩放
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;
    const nyMidnight = new NYMidnightPrimitive();
    candleSeries.attachPrimitive(nyMidnight);
    nyMidnightRef.current = nyMidnight;
    const priceLevels = new PriceLevelsPrimitive();
    candleSeries.attachPrimitive(priceLevels);
    priceLevelsRef.current = priceLevels;

    chart.subscribeCrosshairMove(param=>{
      const scaleWidth = chart.priceScale('right').width();
      const price = param.point ? candleSeries.coordinateToPrice(param.point.y) : null;
      setCrosshairPriceLabel(param.point && price != null && scaleWidth > 0
        ? { y:param.point.y, price, width:Math.max(66, scaleWidth) }
        : null);
      const d = param.time && param.point ? param.seriesData.get(candleSeries) as CandlestickData|undefined : undefined;
      if (!d || d.open == null){ setHoverCandle(null); return; }
      const time = param.time as number;
      const meta = candleMetaRef.current.get(time);
      const prevClose = meta?.prevClose ?? d.open;
      const change = d.close - prevClose;
      setHoverCandle({ o:d.open, h:d.high, l:d.low, c:d.close, v:meta?.v ?? 0, change, pct:prevClose ? (change/prevClose)*100 : 0 });
    });

    // 点击放置画线点（拖拽仍是平移/缩放，单击不触发平移，故无需拦截鼠标）
    chart.subscribeClick(param=>{
      const s = candleSeriesRef.current;
      if (!s || !param.point) return;
      const tool = activeToolRef.current;
      // 未选工具：点中标记 pin（hitTest 命中）→ 展开/收起；点空白 → 收起浮层
      if (!tool) {
        const rawHitId = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
        const hitId = typeof rawHitId === 'string' ? rawHitId : null;
        const hitDrawing = hitId ? drawingsRef.current.find(d=>d.id===hitId) : null;
        if (hitDrawing) {
          if (openNoteRef.current === hitDrawing.id) closeNote(); else openNoteFor(hitDrawing.id);
        } else if (openNoteRef.current) closeNote();
        return;
      }
      const price = s.coordinateToPrice(param.point.y);
      const time = (param.time ?? chart.timeScale().coordinateToTime(param.point.x)) as number | null;
      if (price == null || time == null) return;
      if (tool === 'note') {
        const d = addDrawing({ type:'note', t:time, p:price, text:'' });
        // 放置后退出工具并立即展开编辑
        activeToolRef.current = null; setActiveTool(null); setDrawHint('');
        openNoteFor(d.id);
      }
    });

    // Option/Alt + R：复位到默认视图——最近 N 根、最新贴右、价格轴自适应（与刚打开图表一致）
    const resetChartScale = () => {
      applyDefaultView(chart, candleCountRef.current);
      chart.priceScale('right').setAutoScale(true);
      candleSeries.applyOptions({});
    };
    // 触控板手感（与 TradingView 一致）：
    //  · 双指横向滑 → 平移 K 线（不缩放）
    //  · 双指在主图纵向滑 → 只缩放时间（K 线疏密），最新一根钉在右边不动
    //  · 双指在价格轴纵向滑 → 只缩放价格（K 线高矮），锚定光标所在价位
    //  · 触控板捏合（ctrlKey）→ 缩放时间
    const onWheel = (event: WheelEvent) => {
      const ts = chart.timeScale();
      const absX = Math.abs(event.deltaX), absY = Math.abs(event.deltaY);
      if (absX === 0 && absY === 0) return;

      // 1) 横向滑动 → 平移
      if (!event.ctrlKey && absX > absY) {
        event.preventDefault();
        event.stopPropagation();
        const barSpacing = ts.options().barSpacing || 6;
        ts.scrollToPosition(ts.scrollPosition() + event.deltaX / barSpacing, false);
        return;
      }

      const rect = el.getBoundingClientRect();
      const scaleWidth = chart.priceScale('right').width();
      const localY = event.clientY - rect.top;

      // 2) 价格轴纵向 → 缩放价格（光标价位为锚点）
      if (!event.ctrlKey && scaleWidth > 0 && event.clientX >= rect.right - scaleWidth) {
        const range = chart.priceScale('right').getVisibleRange();
        if (!range || localY < 0 || localY > el.clientHeight - 28) return;
        event.preventDefault();
        event.stopPropagation();
        const anchor = candleSeries.coordinateToPrice(localY) ?? (range.from + range.to) / 2;
        const clamped = Math.max(-60, Math.min(60, event.deltaY));
        const factor = Math.exp(clamped * 0.0025);            // deltaY>0 → 价格范围变大 → K 线变矮（缩小）
        const minSpan = Math.max(1, Math.abs(anchor) * 0.00001);
        const nextFrom = anchor - (anchor - range.from) * factor;
        const nextTo = anchor + (range.to - anchor) * factor;
        if (nextTo - nextFrom < minSpan) return;
        chart.priceScale('right').setVisibleRange({ from: nextFrom, to: nextTo });
        return;
      }

      // 3) 主图纵向（或捏合）→ 缩放时间，右边缘固定（最新钉右）
      const lr = ts.getVisibleLogicalRange();
      if (!lr) return;
      event.preventDefault();
      event.stopPropagation();
      const clamped = Math.max(-60, Math.min(60, event.ctrlKey ? event.deltaY * 4 : event.deltaY));
      const factor = Math.exp(clamped * 0.0025);              // deltaY>0 → 跨度变大 → K 线更密集（缩小）
      const span = lr.to - lr.from;
      const minSpan = 10;                                     // 最多放大到约 10 根
      const maxSpan = candleCountRef.current + DEFAULT_RIGHT_MARGIN_BARS;
      const newSpan = Math.max(minSpan, Math.min(maxSpan, span * factor));
      ts.setVisibleLogicalRange({ from: lr.to - newSpan, to: lr.to });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!event.altKey || event.code !== 'KeyR') return;
      event.preventDefault();
      resetChartScale();
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', onKeyDown);

    return ()=>{
      el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener('keydown', onKeyDown);
      chart.remove(); chartRef.current=null; candleSeriesRef.current=null; volumeSeriesRef.current=null; nyMidnightRef.current=null; priceLevelsRef.current=null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // 标注：按币种加载/切换并重建
  useEffect(()=>{
    if (!candleSeriesRef.current) return;
    closeNote();
    drawingsRef.current.forEach(d=>unrenderDrawing(d.id));
    drawingsRef.current = loadDrawings(coin);
    drawingsRef.current.forEach(renderDrawing);
    setDrawHint('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[coin]);

  // 标记浮层位置跟随：展开期间每帧把锚点 (t,p) 换算成像素，pan/zoom 时浮层贴着 pin 走
  useEffect(()=>{
    if (!openNote || !active) return;
    let raf = 0;
    const tick = ()=>{
      const chart = chartRef.current, s = candleSeriesRef.current, el = containerRef.current;
      const d = drawingsRef.current.find(x=>x.id===openNote);
      if (chart && s && el && d && d.type==='note'){
        const x = chart.timeScale().timeToCoordinate(d.t as UTCTimestamp);
        const y = s.priceToCoordinate(d.p);
        // 锚点滚出可视区 → 隐藏浮层（保持展开状态，滚回来再现）
        if (x==null || y==null || x<0 || x>el.clientWidth || y<0 || y>el.clientHeight) {
          setNotePos(p=>p===null?p:null);
        } else {
          setNotePos(p => p && Math.abs(p.x-x)<0.5 && Math.abs(p.y-y)<0.5 ? p : {x,y});
        }
      } else setNotePos(p=>p===null?p:null);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return ()=>cancelAnimationFrame(raf);
  },[openNote,active]);

  // 价轴标签位置跟随：每帧把价格换算成像素后「直接写 DOM」（transform/display），
  // 不经过 React 状态，避免缩放/平移时每帧重渲染整个页面。隐藏（切走）时停跑，省电不发热。
  useEffect(()=>{
    if (!active) return;
    let raf = 0;
    const tick = ()=>{
      const chart = chartRef.current, series = candleSeriesRef.current, el = containerRef.current;
      if (chart && series && el) {
        const ch = el.clientHeight, cw = el.clientWidth;
        const scaleWidth = chart.priceScale('right').width();
        const width = Math.max(66, scaleWidth);
        const right = Math.max(0, cw - width - PRICE_LABEL_RIGHT_GAP_PX);

        const lp = lastPriceLabelRef.current;
        if (lp) {
          const y = lastClose > 0 ? series.priceToCoordinate(lastClose) : null;
          if (y == null || y < 0 || y > ch) {
            lp.style.display = 'none';
          } else {
            const top = Math.min(Math.max(7, y - 17), Math.max(7, ch - 41));
            lp.style.display = '';
            lp.style.width = `${width}px`;
            lp.style.transform = `translate(${right}px,${top}px)`;
          }
        }

        for (const def of levelLabelDefs) {
          const node = levelLabelNodes.current.get(def.key);
          if (!node) continue;
          const y = series.priceToCoordinate(def.price);
          if (y == null || y < 0 || y > ch || scaleWidth <= 0) {
            node.style.display = 'none';
          } else {
            const top = Math.min(Math.max(3, y - 10), Math.max(3, ch - 22));
            node.style.display = '';
            node.style.width = `${width}px`;
            node.style.transform = `translate(${right}px,${top}px)`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return ()=>cancelAnimationFrame(raf);
  },[lastClose,levelLabelDefs,active]);

  // 2) coin/res 切换 → 标记需要整图重建，并记住选择供下次打开
  useEffect(()=>{
    fullReloadRef.current = true;
    try { localStorage.setItem(CHART_PREFS_KEY, JSON.stringify({ coin, res })); } catch { /* ignore */ }
  },[coin,res]);

  // 3) 喂数据：
  //  · coin/res 切换 → setData 重建并复位默认视图
  //  · 历史前插（往左滑加载更早）→ setData 后把可见区右移相同根数，画面不跳
  //  · 重连/回前台补齐缺口（尾部多出 >1 根）→ setData，逻辑索引不变、视图保持
  //  · 形成中或新增一根 → update（最省）
  useEffect(()=>{
    const series = candleSeriesRef.current, chart = chartRef.current, vol = volumeSeriesRef.current;
    candleCountRef.current = candles.length;
    if (!series || !chart || candles.length===0) return;
    const firstT = candles[0].t;
    const lenDelta = candles.length - prevLenRef.current;
    if (fullReloadRef.current){
      series.setData(candles.map(toCandle));
      vol?.setData(candles.map(toVolume));
      applyDefaultView(chart, candles.length);
      fullReloadRef.current = false;
    } else if (firstT < prevFirstTRef.current){
      const lr = chart.timeScale().getVisibleLogicalRange();
      series.setData(candles.map(toCandle));
      vol?.setData(candles.map(toVolume));
      if (lr && lenDelta > 0) chart.timeScale().setVisibleLogicalRange({ from: lr.from + lenDelta, to: lr.to + lenDelta });
    } else if (lenDelta > 1){
      series.setData(candles.map(toCandle));
      vol?.setData(candles.map(toVolume));
    } else {
      const last = candles[candles.length-1];
      series.update(toCandle(last));
      vol?.update(toVolume(last));
    }
    prevFirstTRef.current = firstT;
    prevLenRef.current = candles.length;
  },[candles]);

  // 成交量指标开关：隐藏只是不渲染（数据保留，开回来即显示）
  useEffect(()=>{ volumeSeriesRef.current?.applyOptions({ visible: showVolume }); },[showVolume]);

  // 往左滑接近最早一根（逻辑索引靠近 0）→ 自动加载更早历史
  useEffect(()=>{
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();
    const onRange = (range: { from: number; to: number } | null) => {
      if (range && range.from < 10) loadOlder();
    };
    ts.subscribeVisibleLogicalRangeChange(onRange);
    return ()=>ts.unsubscribeVisibleLogicalRangeChange(onRange);
  },[loadOlder]);

  // 午夜线只依赖每根 K 线的「起始时间」，与形成中那根的 OHLC 实时跳动无关。
  // 用「根数 + 首尾起始时间」当指纹，避免每个 WS 帧都对上千根重算（含很慢的 Intl 解析）。
  const candleTimeKey = candles.length ? `${candles.length}:${candles[0].t}:${candles[candles.length - 1].t}` : '';
  const nyMidnightEvents = useMemo(
    () => showNYMidnight && nyVisibleOn[res] ? computeNYMidnightEvents(candles, res, nyOptions) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candleTimeKey, res, showNYMidnight, nyOptions, nyVisibleOn],
  );

  useEffect(()=>{
    nyMidnightRef.current?.setData(nyMidnightEvents, nyOptions);
  },[nyMidnightEvents, nyOptions]);

  // 4) 关键位 → 价线 + 并入自动缩放
  useEffect(()=>{
    const series = candleSeriesRef.current;
    if (!series) return;
    const nextLevels: PriceLevel[] = [];
    const prices:number[] = [];
    const add = (price:number|null, color:string, title:string)=>{
      if (price == null || !(price>0)) return;
      nextLevels.push({ price, color, title });
      prices.push(price);
    };
    if (showLevels){
      add(levels.callWall, CALL, 'Call 墙');
      add(levels.putWall, PUT, 'Put 墙');
      add(levels.maxPain, YELLOW, '痛点');
    }
    if (showEM && levels.emSigma != null && spot>0){
      add(spot+levels.emSigma, EM_C, '+1σ');
      add(spot-levels.emSigma, EM_C, '−1σ');
    }
    priceLevelsRef.current?.setData(nextLevels);
    levelPricesRef.current = prices;
    // 价轴标签的「结构」只在关键位变化时更新一次（位置由 rAF 每帧直接写 DOM）
    setLevelLabelDefs(nextLevels.map(l => ({ key: `${l.title}-${l.price}`, price: l.price, color: l.color })));
    // 触发价轴按新关键位重算（applyOptions 会促使重绘；不改动用户的缩放/平移）
    series.applyOptions({});
  },[showLevels,showEM,levels.callWall,levels.putWall,levels.maxPain,levels.emSigma,spot]);

  // 5) 当前蜡烛倒计时
  useEffect(()=>{
    const tick = ()=>{
      const now = Date.now();
      const last = candles[candles.length-1];
      const end = last ? last.t + RES_MS[res] : now;
      const total = Math.max(0,Math.floor((end-now)/1000));
      const h = Math.floor(total/3600);
      const m = Math.floor((total%3600)/60);
      const s = total%60;
      if (total < 60) {
        setCountdown(`${s.toString().padStart(2,'0')}s`);
      } else if (total < 3600) {
        setCountdown(`${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
      } else {
        setCountdown(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
      }
    };
    tick();
    const id = setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[candles,res]);

  const emPct = levels.emSigma != null && spot ? (levels.emSigma/spot)*100 : null;
  const latestLegend = useMemo<LegendCandle|null>(() => {
    const last = candles[candles.length-1];
    if (!last) return null;
    const prevClose = candles[candles.length-2]?.c ?? last.o;
    const change = last.c - prevClose;
    return {
      o:last.o, h:last.h, l:last.l, c:last.c, v:last.v,
      change,
      pct: prevClose ? (change/prevClose)*100 : 0,
    };
  },[candles]);
  const legendCandle = hoverCandle ?? latestLegend;
  const legendTone = !legendCandle || legendCandle.change >= 0 ? 'text-[#28C840]' : 'text-[#FF5F57]';
  const updateNYDraft = (patch: Partial<NYMidnightOptions>) => setNyDraftOptions(o=>({...o, ...patch}));
  const openNYSettings = () => {
    setNyDraftOptions(nyOptions);
    setNyDraftVisibleOn(nyVisibleOn);
    setNySettingsTab('inputs');
    setNyDefaultsOpen(false);
    setNySettingsOpen(true);
  };
  const closeNYSettings = () => {
    setNySettingsOpen(false);
    setNyDefaultsOpen(false);
  };
  const applyNYSettings = () => {
    setNyOptions(nyDraftOptions);
    setNyVisibleOn(nyDraftVisibleOn);
    setNySettingsOpen(false);
    setNyDefaultsOpen(false);
  };
  const resetNYSettings = () => {
    setNyDraftOptions(nySavedDefault.options);
    setNyDraftVisibleOn(nySavedDefault.visibleOn);
    setNyDefaultsOpen(false);
  };
  const saveNYSettingsAsDefault = () => {
    const next = { options: nyDraftOptions, visibleOn: nyDraftVisibleOn };
    setNySavedDefault(next);
    setNyOptions(next.options);
    setNyVisibleOn(next.visibleOn);
    saveNYMidnightDefault(next);
    setNyDefaultsOpen(false);
  };

  return (
    <div className="price-chart-page absolute inset-0 flex flex-col p-3 gap-2.5 text-white/85">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#17181E]">
          {COINS.map(c=><Pill key={c} active={coin===c} onClick={()=>setCoin(c)}>{c}</Pill>)}
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#17181E]">
          {RESOLUTIONS.map(r=><Pill key={r} active={res===r} onClick={()=>setRes(r)}>{RES_LABEL[r]}</Pill>)}
        </div>
        <div className="w-px h-5 bg-[var(--color-border-subtle)] mx-0.5"/>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-white/40">到期</span>
          <select value={expirySel} onChange={e=>setExpirySel(e.target.value)}
            className="h-[26px] px-2 rounded-md bg-[#2B2D35] text-[12px] font-semibold text-white/80 outline-none cursor-pointer hover:bg-[#3A3B40] transition-colors duration-[120ms]">
            <option value="NEAREST">最近 ({nearest||'—'})</option>
            <option value="ALL">全部聚合</option>
            {expiries.map(e=><option key={e.label} value={e.label}>{e.label}·{Math.round(e.daysToExp)}d</option>)}
          </select>
        </div>
        <Pill active={showLevels} onClick={()=>setShowLevels(v=>!v)}>关键位</Pill>
        <Pill active={showEM} onClick={()=>setShowEM(v=>!v)}>预期波动</Pill>
        <div className="w-px h-5 bg-[var(--color-border-subtle)] mx-0.5"/>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#17181E]">
          {DRAW_TOOLS.map(t=><Pill key={t.tool} active={activeTool===t.tool} onClick={()=>selectTool(t.tool)}>{t.label}</Pill>)}
          <button onClick={removeLastDrawing} title="撤销上一条标注"
            className="px-2 h-[26px] rounded-md text-[12px] font-semibold text-white/45 hover:bg-[#3A3B40] hover:text-white/80 transition-colors duration-[120ms]">撤销</button>
          <button onClick={clearDrawings} title="清除全部标注"
            className="px-2 h-[26px] rounded-md text-[12px] font-semibold text-white/45 hover:bg-[#3A3B40] hover:text-[#FF5F57] transition-colors duration-[120ms]">清除</button>
        </div>
        {drawHint && <span className="text-[11px] text-[var(--nexus-accent)]/80 select-none">{drawHint}</span>}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto shrink-0">
        <LevelChip label="现价" value={spot?fmtPx(spot):'—'} color={UP}/>
        <LevelChip label="Call 墙" value={levels.callWall!=null?fmtPx(levels.callWall):'—'} color={CALL}/>
        <LevelChip label="最大痛点" value={levels.maxPain!=null?fmtPx(levels.maxPain):'—'} color={YELLOW}/>
        <LevelChip label="Put 墙" value={levels.putWall!=null?fmtPx(levels.putWall):'—'} color={PUT}/>
        <LevelChip label={`±1σ 预期${levels.emExpiryLabel?`·${levels.emExpiryLabel}`:''}`}
          value={levels.emSigma!=null&&spot?`${fmtPx(spot-levels.emSigma)}–${fmtPx(spot+levels.emSigma)}`:'—'}
          sub={emPct!=null?`±${emPct.toFixed(1)}%`:undefined} color={EM_C}/>
        <div className="ml-auto shrink-0 text-[11px] text-white/35">价格 Binance · 关键位 Deribit · lightweight-charts</div>
      </div>

      <div className="flex-1 min-h-0 rounded-xl bg-[#17181E] p-1.5 relative overflow-hidden">
        <div ref={containerRef} className="absolute left-1.5 top-1.5 bottom-0 right-0"/>
        <div className="absolute left-3 top-2 z-10 max-w-[calc(100%-92px)] select-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-none text-white/70">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#f7931a] text-[13px] font-black text-white">
              {SYMBOL_ICON[coin]}
            </span>
            <span className="text-[15px] font-semibold text-white/85">{SYMBOL_LABEL[coin]} · {RES_TV_LABEL[res]} · Binance</span>
            {legendCandle && (
              <span className="font-mono tabular-nums text-white/60">
                O{legendCandle.o.toFixed(2)} H{legendCandle.h.toFixed(2)} L{legendCandle.l.toFixed(2)} C
                <span className={legendTone}>{legendCandle.c.toFixed(2)}</span>
                <span className={`ml-2 ${legendTone}`}>{fmtSigned(legendCandle.change)} ({fmtSigned(legendCandle.pct)}%)</span>
                <span className="ml-2">Vol{fmtVol(legendCandle.v)}</span>
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-col items-start gap-1 text-[12px] leading-none">
            <div className={`group flex items-center gap-1.5 ${showNYMidnight ? 'text-white/70' : 'text-white/28'}`}>
              <span>纽约午夜分割线</span>
              <IndicatorIconButton title={showNYMidnight ? '隐藏' : '显示'} onClick={()=>setShowNYMidnight(v=>!v)}>
                {showNYMidnight ? <Eye className="h-3.5 w-3.5"/> : <EyeOff className="h-3.5 w-3.5"/>}
              </IndicatorIconButton>
              <IndicatorIconButton title="设置" onClick={openNYSettings}>
                <Settings2 className="h-3.5 w-3.5"/>
              </IndicatorIconButton>
            </div>
            <div className={`group flex items-center gap-1.5 ${showVolume ? 'text-white/70' : 'text-white/28'}`}>
              <span>成交量</span>
              <IndicatorIconButton title={showVolume ? '隐藏' : '显示'} onClick={()=>setShowVolume(v=>!v)}>
                {showVolume ? <Eye className="h-3.5 w-3.5"/> : <EyeOff className="h-3.5 w-3.5"/>}
              </IndicatorIconButton>
            </div>
          </div>
        </div>
        {(candles.length===0||loading)&&(
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40 pointer-events-none">
            {error?'数据加载失败，重试中…':loading?'加载 K 线中…':'暂无数据'}
          </div>
        )}
        {levelLabelDefs.length > 0 && (
          <div className="absolute left-1.5 top-1.5 bottom-0 right-0 z-20 pointer-events-none">
            {levelLabelDefs.map(label => (
              <div
                key={label.key}
                ref={node => { if (node) levelLabelNodes.current.set(label.key, node); else levelLabelNodes.current.delete(label.key); }}
                className="absolute left-0 top-0 rounded-[4px] px-1.5 py-[3px] text-left font-mono text-[11px] leading-[14px] tabular-nums text-white shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
                style={{ display: 'none', backgroundColor: label.color, willChange: 'transform' }}
              >
                {formatAxisPrice(label.price)}
              </div>
            ))}
          </div>
        )}
        {lastClose > 0 && (
          <div className="absolute left-1.5 top-1.5 bottom-0 right-0 z-20 pointer-events-none">
            <div
              ref={lastPriceLabelRef}
              className="absolute left-0 top-0 rounded-[3px] bg-[#4A4A4A] px-1.5 py-[3px] text-left font-mono tabular-nums leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
              style={{ display: 'none', willChange: 'transform' }}
            >
              <div className="text-[11px] leading-[14px]">{lastClose.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-[11px] leading-[14px] text-white/70">{countdown}</div>
            </div>
          </div>
        )}
        {crosshairPriceLabel && (
          <div className="absolute left-1.5 top-1.5 bottom-0 right-0 z-30 pointer-events-none">
            <div
              className="absolute rounded-[3px] bg-[#404347] px-1.5 py-[3px] text-left font-mono text-[11px] leading-[14px] tabular-nums text-white shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
              style={{
                left: Math.max(0, (containerRef.current?.clientWidth ?? 0) - crosshairPriceLabel.width - PRICE_LABEL_RIGHT_GAP_PX),
                top: Math.min(
                  Math.max(4, crosshairPriceLabel.y - 11),
                  Math.max(4, (containerRef.current?.clientHeight ?? 0) - 23),
                ),
                width: crosshairPriceLabel.width,
              }}
            >
              {formatAxisPrice(crosshairPriceLabel.price)}
            </div>
          </div>
        )}
        {openNote && notePos && (()=>{
          const d = drawingsRef.current.find(x=>x.id===openNote);
          if (!d || d.type!=='note') return null;
          const cw = containerRef.current?.clientWidth ?? 0;
          const cx = Math.min(Math.max(notePos.x,124), Math.max(124, cw-124));   // 水平防出界
          const below = notePos.y < 200;                                         // 锚点太靠上 → 卡片放下方
          const dt = new Date(d.t*1000);
          const pad2 = (n:number)=>n.toString().padStart(2,'0');
          return (
            <div className="absolute left-1.5 top-1.5 bottom-0 right-0 z-20 pointer-events-none overflow-hidden">
              <div className="absolute pointer-events-auto w-[232px] rounded-lg bg-[#22242C]/95 backdrop-blur-sm ring-1 ring-inset ring-white/10 shadow-xl p-2"
                style={below
                  ? {left:cx, top:notePos.y+12, transform:'translateX(-50%)'}
                  : {left:cx, top:notePos.y-46, transform:'translate(-50%,-100%)'}}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{backgroundColor:NOTE_COLOR}}/>
                  <span className="text-[10px] font-semibold text-white/55 truncate">
                    {pad2(dt.getMonth()+1)}-{pad2(dt.getDate())} {pad2(dt.getHours())}:{pad2(dt.getMinutes())} · {fmtPx(d.p)}
                  </span>
                  <button onClick={closeNote} title="收起"
                    className="ml-auto w-[20px] h-[20px] rounded text-[11px] text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors duration-[120ms]">✕</button>
                </div>
                <textarea value={noteText} onChange={e=>updateNoteText(e.target.value)} rows={3} autoFocus
                  placeholder="写点什么…"
                  className="w-full bg-black/25 rounded-md px-1.5 py-1 text-[12px] leading-snug text-white/85 outline-none resize-none placeholder:text-white/25"/>
                <div className="flex items-center mt-1">
                  <span className="text-[10px] text-white/25">自动保存</span>
                  <button onClick={deleteOpenNote}
                    className="ml-auto px-1.5 h-[22px] rounded text-[11px] font-semibold text-[#FF5F57]/80 hover:text-[#FF5F57] hover:bg-white/5 transition-colors duration-[120ms]">删除</button>
                </div>
              </div>
            </div>
          );
        })()}
        {nySettingsOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 px-3 py-3">
            <div className="flex h-[min(560px,86%)] w-[min(400px,calc(100vw-48px))] flex-col overflow-visible rounded-[6px] bg-[#1b1b1b] shadow-2xl ring-1 ring-white/12">
              <div className="flex items-center gap-2 px-6 pt-4">
                <h2 className="text-[18px] font-semibold text-white/90">纽约午夜分割线</h2>
                <button
                  type="button"
                  title="关闭"
                  onClick={closeNYSettings}
                  className="ml-auto grid h-7 w-7 place-items-center rounded-[4px] text-white/70 hover:bg-white/10 hover:text-white transition-colors duration-[120ms]"
                >
                  <X className="h-5 w-5" strokeWidth={1.8}/>
                </button>
              </div>
              <div className="px-6 pt-4">
                <div className="grid grid-cols-3 gap-3 text-[15px] font-semibold text-white/82">
                  {[
                    ['inputs', 'Inputs'],
                    ['style', 'Style'],
                    ['visibility', 'Visibility'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={()=>setNySettingsTab(id as NYSettingsTab)}
                      className={`relative h-8 text-left transition-colors duration-[120ms] ${
                        nySettingsTab === id ? 'text-white/95' : 'text-white/72 hover:text-white/90'
                      }`}
                    >
                      {label}
                      {nySettingsTab === id && <span className="absolute bottom-0 left-0 h-1 w-[62px] rounded-full bg-white/90"/>}
                    </button>
                  ))}
                </div>
                <div className="h-px bg-white/22"/>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {nySettingsTab === 'inputs' && (
                  <div className="grid gap-4 text-[13px] text-white/82">
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>线条颜色</span>
                      <span className="flex items-center gap-2">
                        <span className="relative grid h-8 w-8 place-items-center rounded-[5px] border border-white/25 bg-[#2a2a2a]">
                          <input
                            type="color"
                            value={colorToHex(nyDraftOptions.lineColor)}
                            onChange={e=>updateNYDraft({ lineColor:e.target.value })}
                            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                        </span>
                        <input
                          value={nyDraftOptions.lineColor}
                          onChange={e=>updateNYDraft({ lineColor:e.target.value })}
                          className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[12px] text-white/86 outline-none focus:border-white/50"
                        />
                      </span>
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>线条粗细</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={nyDraftOptions.lineWidth}
                        onChange={e=>updateNYDraft({ lineWidth:Math.min(10,Math.max(1,Number(e.target.value)||1)) })}
                        className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[13px] text-white/86 outline-none focus:border-white/50"
                      />
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>线条样式</span>
                      <select
                        value={nyDraftOptions.lineStyle}
                        onChange={e=>updateNYDraft({ lineStyle:e.target.value as NYMidnightLineStyle })}
                        className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[13px] text-white/86 outline-none focus:border-white/50"
                      >
                        <option value="solid">实线</option>
                        <option value="dashed">虚线</option>
                        <option value="dotted">点线</option>
                      </select>
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>显示星期标签</span>
                      <input
                        type="checkbox"
                        checked={nyDraftOptions.showLabel}
                        onChange={e=>updateNYDraft({ showLabel:e.target.checked })}
                        className="h-4 w-4 accent-white"
                      />
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>标签语言</span>
                      <select
                        value={nyDraftOptions.labelLang}
                        onChange={e=>updateNYDraft({ labelLang:e.target.value as NYMidnightLabelLang })}
                        className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[13px] text-white/86 outline-none focus:border-white/50"
                      >
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>文字颜色</span>
                      <span className="flex items-center gap-2">
                        <span className="relative grid h-8 w-8 place-items-center rounded-[5px] border border-white/25 bg-[#2a2a2a]">
                          <input
                            type="color"
                            value={colorToHex(nyDraftOptions.labelColor)}
                            onChange={e=>updateNYDraft({ labelColor:e.target.value })}
                            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                        </span>
                        <input
                          value={nyDraftOptions.labelColor}
                          onChange={e=>updateNYDraft({ labelColor:e.target.value })}
                          className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[12px] text-white/86 outline-none focus:border-white/50"
                        />
                      </span>
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>标签偏移（小时）</span>
                      <input
                        type="number"
                        min={0}
                        max={24}
                        value={nyDraftOptions.labelHour}
                        onChange={e=>updateNYDraft({ labelHour:Math.min(24,Math.max(0,Number(e.target.value)||0)) })}
                        className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[13px] text-white/86 outline-none focus:border-white/50"
                      />
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>显示天数</span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={nyDraftOptions.showDays}
                        onChange={e=>updateNYDraft({ showDays:Math.min(365,Math.max(1,Number(e.target.value)||1)) })}
                        className="h-8 w-[112px] rounded-[5px] border border-white/25 bg-[#1d1d1d] px-2 text-[13px] text-white/86 outline-none focus:border-white/50"
                      />
                    </label>
                  </div>
                )}
                {nySettingsTab === 'style' && (
                  <div className="grid gap-4 text-[13px] text-white/82">
                    <div className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>线条预览</span>
                      <span
                        className="block h-0 w-[150px] border-t"
                        style={{
                          borderColor: nyDraftOptions.lineColor,
                          borderTopWidth: nyDraftOptions.lineWidth,
                          borderTopStyle: nyDraftOptions.lineStyle === 'solid' ? 'solid' : nyDraftOptions.lineStyle === 'dashed' ? 'dashed' : 'dotted',
                        }}
                      />
                    </div>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>线条颜色</span>
                      <input
                        type="color"
                        value={colorToHex(nyDraftOptions.lineColor)}
                        onChange={e=>updateNYDraft({ lineColor:e.target.value })}
                        className="h-8 w-8 cursor-pointer rounded-[5px] border border-white/25 bg-[#2a2a2a] p-1"
                      />
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>文字颜色</span>
                      <input
                        type="color"
                        value={colorToHex(nyDraftOptions.labelColor)}
                        onChange={e=>updateNYDraft({ labelColor:e.target.value })}
                        className="h-8 w-8 cursor-pointer rounded-[5px] border border-white/25 bg-[#2a2a2a] p-1"
                      />
                    </label>
                    <label className="grid grid-cols-[132px_1fr] items-center gap-4">
                      <span>线条粗细</span>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={nyDraftOptions.lineWidth}
                        onChange={e=>updateNYDraft({ lineWidth:Number(e.target.value) })}
                        className="w-[150px] accent-white"
                      />
                    </label>
                  </div>
                )}
                {nySettingsTab === 'visibility' && (
                  <div className="grid gap-4 text-[13px] text-white/82">
                    {RESOLUTIONS.map(r => (
                      <label key={r} className="grid grid-cols-[132px_1fr] items-center gap-4">
                        <span>{RES_LABEL[r]}</span>
                        <input
                          type="checkbox"
                          checked={nyDraftVisibleOn[r]}
                          onChange={e=>setNyDraftVisibleOn(v=>({...v, [r]:e.target.checked}))}
                          className="h-4 w-4 accent-white"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex items-center gap-2.5 border-t border-white/14 px-6 py-3.5">
                <div className="relative">
                  <button
                    type="button"
                    onClick={()=>setNyDefaultsOpen(v=>!v)}
                    className="flex h-8 items-center gap-1.5 rounded-[5px] border border-white/25 px-2.5 text-[13px] text-white/78 hover:border-white/45 hover:text-white transition-colors duration-[120ms]"
                  >
                    Defaults
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-[120ms] ${nyDefaultsOpen ? 'rotate-180' : ''}`}/>
                  </button>
                  {nyDefaultsOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-[174px] overflow-hidden rounded-[6px] bg-[#242424] py-1.5 shadow-2xl ring-1 ring-white/10">
                      <button
                        type="button"
                        onClick={resetNYSettings}
                        className="flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] text-white/82 hover:bg-white/8"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-white/55"/>
                        Reset settings
                      </button>
                      <button
                        type="button"
                        onClick={saveNYSettingsAsDefault}
                        className="flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] text-white/82 hover:bg-white/8"
                      >
                        <Save className="h-3.5 w-3.5 text-white/55"/>
                        Save as default
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeNYSettings}
                  className="ml-auto h-8 rounded-[5px] border border-white/70 px-4 text-[14px] text-white hover:bg-white/10 transition-colors duration-[120ms]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyNYSettings}
                  className="h-8 rounded-[5px] bg-white px-4 text-[14px] font-semibold text-[#171717] hover:bg-white/90 transition-colors duration-[120ms]"
                >
                  Ok
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CandleChartView;
