// KLineChart 关键位叠加图表 + 懒加载 + 跳转日期
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { init, dispose } from 'klinecharts';
import type { Chart } from 'klinecharts';
import { useCandles, fetchCandlesBefore, computeChainLevels, COIN_SYMBOL, LIMIT, type Resolution } from './candles';
import { useDeribitOptions } from '../../registry/monitorWidgetsBase';
import { useLiveSpot } from '../optionsChain/liveData';
import type { Coin } from '../monitor/types';

const UP = '#28C840';
const YELLOW = '#FEBC2E';
const CALL = '#28C840';
const PUT = '#FF5F57';
const EM_C = '#4ea1ff';

const COINS: Coin[] = ['BTC', 'ETH'];
const RESOLUTIONS: Resolution[] = ['5m', '15m', '1h', '4h', '1d', '1w'];
const RES_LABEL: Record<Resolution, string> = { '5m': '5分', '15m': '15分', '1h': '1时', '4h': '4时', '1d': '1日', '1w': '1周' };

const fmtPx = (v: number) =>
  v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
            : v.toLocaleString('en-US', { maximumFractionDigits: 2 });

const RES_TO_PERIOD: Record<Resolution, { type: string; span: number }> = {
  '5m':  { type: 'minute', span: 5 },
  '15m': { type: 'minute', span: 15 },
  '1h':  { type: 'hour',   span: 1 },
  '4h':  { type: 'hour',   span: 4 },
  '1d':  { type: 'day',    span: 1 },
  '1w':  { type: 'week',   span: 1 },
};

const STORAGE_PREFIX = 'kc_ov_';

const Pill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={'px-2.5 h-[26px] rounded-md text-[12px] font-semibold transition-colors duration-[120ms] ' +
      (active ? 'bg-white/[0.12] text-white ring-1 ring-inset ring-white/[0.14]' : 'bg-transparent text-white/50 hover:bg-white/[0.07] hover:text-white/80')}>
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

function storageKey(coin: Coin, res: Resolution) { return STORAGE_PREFIX + coin + '_' + res; }

function saveOverlays(chart: Chart | null, coin: Coin, res: Resolution) {
  if (!chart) return;
  try {
    const data = chart.getOverlays().map(o => ({
      name: o.name, points: o.points, styles: o.styles,
      totalStep: o.totalStep, currentStep: o.currentStep,
    }));
    localStorage.setItem(storageKey(coin, res), JSON.stringify(data));
  } catch { /* ignore */ }
}

function loadOverlays(chart: Chart | null, coin: Coin, res: Resolution) {
  if (!chart) return;
  try {
    const data = JSON.parse(localStorage.getItem(storageKey(coin, res)) || '[]');
    if (!Array.isArray(data)) return;
    for (const item of data) {
      if (item.name && item.points) chart.createOverlay(item);
    }
  } catch { /* ignore */ }
}

function toKData(candles: { t: number; o: number; h: number; l: number; c: number; v: number }[]) {
  return candles.map(c => ({ timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
}

export const KLineChartView = () => {
  const [coin, setCoin] = useState<Coin>('BTC');
  const [res, setRes] = useState<Resolution>('1h');
  const [expirySel, setExpirySel] = useState<string | 'ALL'>('NEAREST');
  const [showLevels, setShowLevels] = useState(true);
  const [showEM, setShowEM] = useState(true);
  const [showDrawTools, setShowDrawTools] = useState(true);
  const [goToDate, setGoToDate] = useState('');

  const { candles, loading, error } = useCandles(coin, res);
  const { data: opt } = useDeribitOptions(coin);
  const liveSpot = useLiveSpot(coin);

  const lastClose = candles.length ? candles[candles.length - 1].c : 0;
  const spot = Math.round(liveSpot ?? lastClose ?? opt?.spot ?? 0);

  const expiries = opt?.expiries ?? [];
  const nearest = expiries.find(e => e.daysToExp >= 0.5)?.label ?? expiries[0]?.label ?? '';
  const resolvedExpiry = expirySel === 'NEAREST' ? nearest : expirySel;
  const levels = useMemo(() => computeChainLevels(opt, resolvedExpiry, spot), [opt, resolvedExpiry, spot]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const levelIdsRef = useRef<string[]>([]);
  const storeRef = useRef({ coin, res, chartReady: false });
  storeRef.current = { coin, res, chartReady: !!chartRef.current };

  // 1) 初始化
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = init(containerRef.current, { styles: 'dark' });
    if (!chart) return;
    chartRef.current = chart;
    storeRef.current.chartReady = true;
    const onUnload = () => saveOverlays(chart, coin, res);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      saveOverlays(chart, coin, res);
      window.removeEventListener('beforeunload', onUnload);
      dispose(containerRef.current!);
      chartRef.current = null;
      storeRef.current.chartReady = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 自动保存（每 5 秒）
  useEffect(() => {
    const id = setInterval(() => {
      const { coin: c, res: r, chartReady } = storeRef.current;
      if (chartReady) saveOverlays(chartRef.current, c, r);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // 3) 数据层——懒加载 DataLoader
  // 用 ref 记录是否已初始化 DataLoader（切换币种/周期时重置）
  const loaderInitRef = useRef(false);
  const prevCoinResRef = useRef({ coin, res });

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    const cur = { coin, res };
    const prev = prevCoinResRef.current;
    const isNewSetup = !loaderInitRef.current || cur.coin !== prev.coin || cur.res !== prev.res;
    prevCoinResRef.current = cur;

    if (!isNewSetup) {
      // 轮询刷新：仅更新最后一根 K 线的收盘价
      const c = candles[candles.length - 1];
      if (c) {
        (chart as any)._addData({
          timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
        });
      }
      return;
    }

    // 首次 或 切换币种/周期：重建 DataLoader
    loaderInitRef.current = true;
    const initialData = toKData(candles);
    saveOverlays(chart, coin, res);

    chart.setSymbol({ ticker: COIN_SYMBOL[coin], pricePrecision: 0, volumePrecision: 2 });
    chart.setPeriod(RES_TO_PERIOD[res] as any);
    chart.setDataLoader({
      getBars: async (params: any) => {
        if (params.type === 'init') {
          params.callback(initialData, { backward: true, forward: false });
        } else if (params.type === 'backward' && params.timestamp) {
          try {
            const older = await fetchCandlesBefore(coin, res, params.timestamp);
            if (older.length > 0) {
              params.callback(toKData(older), { backward: older.length >= LIMIT[res], forward: false });
            } else {
              params.callback([], { backward: false, forward: false });
            }
          } catch {
            params.callback([], { backward: false, forward: false });
          }
        }
      },
    });
    loadOverlays(chart, coin, res);
  }, [candles, coin, res]);

  // 4) 跳转日期
  const handleGoToDate = async () => {
    if (!goToDate) return;
    const chart = chartRef.current;
    if (!chart) return;
    const targetMs = new Date(goToDate).getTime();
    if (isNaN(targetMs)) return;
    try {
      const older = await fetchCandlesBefore(coin, res, targetMs + 86_400_000); // 目标日期 +1d 作为 endTime
      if (older.length === 0) return;
      saveOverlays(chart, coin, res);
      // 用 init 类型替换数据
      (chart as any)._addData(toKData(older), 'init', { backward: older.length >= LIMIT[res], forward: false });
      loadOverlays(chart, coin, res);
    } catch { /* ignore */ }
  };

  // 6) 关键位叠加
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    levelIdsRef.current.forEach(id => chart.removeOverlay({ id }));
    levelIdsRef.current = [];
    if (!showLevels && !showEM) return;
    const ids: string[] = [];
    if (showLevels) {
      if (levels.callWall != null) {
        const id = chart.createOverlay({ name: 'priceLine', points: [{ value: levels.callWall }], styles: { line: { color: CALL, size: 1 } } });
        if (id) ids.push(id);
      }
      if (levels.putWall != null) {
        const id = chart.createOverlay({ name: 'priceLine', points: [{ value: levels.putWall }], styles: { line: { color: PUT, size: 1 } } });
        if (id) ids.push(id);
      }
      if (levels.maxPain != null) {
        const id = chart.createOverlay({ name: 'priceLine', points: [{ value: levels.maxPain }], styles: { line: { color: YELLOW, size: 1 } } });
        if (id) ids.push(id);
      }
    }
    if (showEM && levels.emSigma != null && spot > 0) {
      const id1 = chart.createOverlay({ name: 'priceLine', points: [{ value: spot + levels.emSigma }], styles: { line: { color: EM_C, size: 1 } } });
      if (id1) ids.push(id1);
      const id2 = chart.createOverlay({ name: 'priceLine', points: [{ value: spot - levels.emSigma }], styles: { line: { color: EM_C, size: 1 } } });
      if (id2) ids.push(id2);
    }
    levelIdsRef.current = ids;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLevels, showEM, levels.callWall, levels.putWall, levels.maxPain, levels.emSigma, spot]);

  const emPct = levels.emSigma != null && spot ? (levels.emSigma / spot) * 100 : null;

  const OVERLAY_TOOLS = [
    { name: 'segment',        label: '线段' },
    { name: 'straightLine',   label: '直线' },
    { name: 'rayLine',        label: '射线' },
    { name: 'horizontalStraightLine', label: '水平' },
    { name: 'verticalStraightLine',   label: '垂直' },
    { name: 'priceChannelLine',       label: '通道' },
    { name: 'fibonacciLine',          label: '斐波那契' },
    { name: 'simpleAnnotation',       label: '标注' },
    { name: 'priceLine',              label: '价位' },
    { name: 'brush',                  label: '画笔' },
  ];
  const [drawTool, setDrawTool] = useState<string | null>(null);
  const handleDrawTool = (name: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (drawTool === name) setDrawTool(null);
    else { chart.createOverlay(name); setDrawTool(name); }
  };

  return (
    <div className="absolute inset-0 flex flex-col p-3 gap-2.5 text-white/85">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.05]">
          {COINS.map(c => <Pill key={c} active={coin === c} onClick={() => setCoin(c)}>{c}</Pill>)}
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-inset ring-white/[0.05]">
          {RESOLUTIONS.map(r => <Pill key={r} active={res === r} onClick={() => setRes(r)}>{RES_LABEL[r]}</Pill>)}
        </div>
        <div className="w-px h-5 bg-white/[0.08] mx-0.5" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-white/40">到期</span>
          <select value={expirySel} onChange={e => setExpirySel(e.target.value)}
            className="h-[26px] px-2 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/[0.08] text-[12px] font-semibold text-white/80 outline-none cursor-pointer hover:bg-white/[0.09]">
            <option value="NEAREST">最近 ({nearest || '—'})</option>
            <option value="ALL">全部聚合</option>
            {expiries.map(e => <option key={e.label} value={e.label}>{e.label} · {Math.round(e.daysToExp)}d</option>)}
          </select>
        </div>
        <Pill active={showLevels} onClick={() => setShowLevels(v => !v)}>关键位</Pill>
        <Pill active={showEM} onClick={() => setShowEM(v => !v)}>预期波动</Pill>

        {/* 跳转日期 */}
        <div className="flex items-center gap-1 ml-1">
          <input type="date" value={goToDate} onChange={e => setGoToDate(e.target.value)}
            className="h-[26px] px-2 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/[0.08] text-[11px] text-white/70 outline-none cursor-pointer [color-scheme:dark]"
          />
          <button onClick={handleGoToDate}
            className="h-[26px] px-2 rounded-md bg-white/[0.08] hover:bg-white/[0.13] text-[11px] font-medium text-white/60 hover:text-white/80 transition-colors duration-[120ms]">
            跳转
          </button>
        </div>

        <div className="ml-auto text-[11px] text-white/35">价格 Binance · 关键位 Deribit</div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto shrink-0 pb-0.5">
        <LevelChip label="现价" value={spot ? fmtPx(spot) : '—'} color={UP} />
        <LevelChip label="Call 墙" value={levels.callWall != null ? fmtPx(levels.callWall) : '—'} color={CALL} />
        <LevelChip label="最大痛点" value={levels.maxPain != null ? fmtPx(levels.maxPain) : '—'} color={YELLOW} />
        <LevelChip label="Put 墙" value={levels.putWall != null ? fmtPx(levels.putWall) : '—'} color={PUT} />
        <LevelChip label={`±1σ 预期${levels.emExpiryLabel ? ` · ${levels.emExpiryLabel}` : ''}`}
          value={levels.emSigma != null && spot ? `${fmtPx(spot - levels.emSigma)} – ${fmtPx(spot + levels.emSigma)}` : '—'}
          sub={emPct != null ? `±${emPct.toFixed(1)}%` : undefined} color={EM_C} />
      </div>

      <div className="flex-1 min-h-0 flex gap-1.5">
        <div className={`flex flex-col gap-0.5 shrink-0 transition-all duration-[160ms] overflow-hidden ${
          showDrawTools ? 'w-[36px] opacity-100' : 'w-0 opacity-0'
        }`}>
          {OVERLAY_TOOLS.map(t => (
            <button key={t.name} onClick={() => handleDrawTool(t.name)}
              className={`w-[36px] h-[36px] flex items-center justify-center rounded-md text-[10px] font-medium transition-colors duration-[120ms] ${
                drawTool === t.name ? 'bg-brand text-white' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/80'
              }`} title={t.label}>
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowDrawTools(v => !v)}
          className="shrink-0 w-[18px] self-center flex items-center justify-center h-[40px] rounded-md bg-white/[0.03] hover:bg-white/[0.07] text-white/30 hover:text-white/60 transition-colors duration-[120ms] text-[8px]"
          title={showDrawTools ? '收起画线' : '展开画线'}>
          {showDrawTools ? '◀' : '▶'}
        </button>
        <div className="flex-1 min-w-0 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.05] p-1.5 relative overflow-hidden">
          <div ref={containerRef} className="absolute inset-1.5" />
          {(candles.length === 0 || loading) && (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40 pointer-events-none">
              {error ? '数据加载失败，重试中…' : loading ? '加载 K 线中…' : '暂无数据'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KLineChartView;
