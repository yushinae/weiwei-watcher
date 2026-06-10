// 关键位叠加蜡烛图 —— 基于 TradingView 开源库 lightweight-charts（替代停更的 klinecharts）。
// 蜡烛 + 成交量 + 关键位价线（Call/Put 墙 / 最大痛点 / ±1σ，并入价轴自动缩放范围）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
} from 'lightweight-charts';
import type {
  IChartApi, ISeriesApi, IPriceLine, UTCTimestamp, CandlestickData, AutoscaleInfo,
} from 'lightweight-charts';
import { useCandles, computeChainLevels, type Resolution, type Candle } from './candles';
import { useDeribitOptions } from '../../registry/monitorWidgetsBase';
import { useLiveSpot } from '../optionsChain/liveData';
import type { Coin } from '../monitor/types';

const UP = '#28C840'; const YELLOW = '#FEBC2E'; const CALL = '#28C840'; const PUT = '#FF5F57'; const EM_C = '#ff9c2e';
const DOWN = '#FF5F57';

const COINS: Coin[] = ['BTC', 'ETH'];
const RESOLUTIONS: Resolution[] = ['5m', '15m', '1h', '4h', '1d', '1w'];
const RES_LABEL: Record<Resolution, string> = { '5m':'5分','15m':'15分','1h':'1时','4h':'4时','1d':'1日','1w':'1周' };

const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US',{maximumFractionDigits:0}) : v.toLocaleString('en-US',{maximumFractionDigits:2});

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
const toVol = (c: Candle) => ({ time: Math.floor(c.t/1000) as UTCTimestamp, value:c.v, color: c.c>=c.o?'rgba(40,200,64,0.22)':'rgba(255,95,87,0.22)' });

export const CandleChartView = () => {
  const [coin,setCoin] = useState<Coin>('BTC');
  const [res,setRes] = useState<Resolution>('1h');
  const [expirySel,setExpirySel] = useState<string|'ALL'>('NEAREST');
  const [showLevels,setShowLevels] = useState(true);
  const [showEM,setShowEM] = useState(true);

  const {candles,loading,error} = useCandles(coin,res);
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
  const volSeriesRef = useRef<ISeriesApi<'Histogram'>|null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const levelPricesRef = useRef<number[]>([]);     // 当前关键位价，供 autoscaleInfoProvider 并入价轴范围
  const fullReloadRef = useRef(true);              // coin/res 切换 → 下一帧 setData 重建（否则 update 增量）
  const [countdown,setCountdown] = useState('0:00');
  const [hoverCandle,setHoverCandle] = useState<{t:string;o:number;h:number;l:number;c:number}|null>(null);

  // 1) 初始化图表（仅挂载一次）
  useEffect(()=>{
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el,{
      autoSize: true,
      layout: { background:{type:ColorType.Solid,color:'transparent'}, textColor:'rgba(255,255,255,0.5)', fontSize:11 },
      grid: { vertLines:{color:'rgba(255,255,255,0.05)'}, horzLines:{color:'rgba(255,255,255,0.05)'} },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor:'rgba(255,255,255,0.10)' },
      timeScale: { borderColor:'rgba(255,255,255,0.10)', timeVisible:true, secondsVisible:false },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor:UP, downColor:DOWN, borderUpColor:UP, borderDownColor:DOWN, wickUpColor:UP, wickDownColor:DOWN,
      priceFormat: { type:'price', precision:0, minMove:1 },
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

    const vol = chart.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'vol' });
    vol.priceScale().applyOptions({ scaleMargins:{ top:0.86, bottom:0 } });
    volSeriesRef.current = vol;

    chart.subscribeCrosshairMove(param=>{
      const d = param.time && param.point ? param.seriesData.get(candleSeries) as CandlestickData|undefined : undefined;
      if (!d || d.open == null){ setHoverCandle(null); return; }
      const dt = new Date((param.time as number)*1000);
      const hh = dt.getHours().toString().padStart(2,'0'), mm = dt.getMinutes().toString().padStart(2,'0');
      setHoverCandle({ t:`${hh}:${mm}`, o:d.open, h:d.high, l:d.low, c:d.close });
    });

    return ()=>{ chart.remove(); chartRef.current=null; candleSeriesRef.current=null; volSeriesRef.current=null; priceLinesRef.current=[]; };
  },[]);

  // 2) coin/res 切换 → 标记需要整图重建
  useEffect(()=>{ fullReloadRef.current = true; },[coin,res]);

  // 3) 喂数据：重建用 setData（重置视图），实时帧用 update（保留缩放/平移）
  useEffect(()=>{
    const series = candleSeriesRef.current, vol = volSeriesRef.current, chart = chartRef.current;
    if (!series || !vol || !chart || candles.length===0) return;
    if (fullReloadRef.current){
      series.setData(candles.map(toCandle));
      vol.setData(candles.map(toVol));
      chart.timeScale().fitContent();
      fullReloadRef.current = false;
    } else {
      const last = candles[candles.length-1];
      series.update(toCandle(last));
      vol.update(toVol(last));
    }
  },[candles]);

  // 4) 关键位 → 价线 + 并入自动缩放
  useEffect(()=>{
    const series = candleSeriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach(pl=>series.removePriceLine(pl));
    priceLinesRef.current = [];
    const prices:number[] = [];
    const add = (price:number|null, color:string, title:string)=>{
      if (price == null || !(price>0)) return;
      priceLinesRef.current.push(series.createPriceLine({ price, color, lineWidth:1, lineStyle:LineStyle.Dashed, axisLabelVisible:true, title }));
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
    levelPricesRef.current = prices;
    // 触发价轴按新关键位重算（applyOptions 会促使重绘；不改动用户的缩放/平移）
    series.applyOptions({});
  },[showLevels,showEM,levels.callWall,levels.putWall,levels.maxPain,levels.emSigma,spot]);

  // 5) 当前蜡烛倒计时
  useEffect(()=>{
    const tick = ()=>{
      const now = Date.now();
      const d = new Date();
      let end: number;
      switch (res){
        case '5m': d.setMinutes(Math.ceil((d.getMinutes()+1)/5)*5,0,0); end=d.getTime(); break;
        case '15m': d.setMinutes(Math.ceil((d.getMinutes()+1)/15)*15,0,0); end=d.getTime(); break;
        case '1h': d.setHours(d.getHours()+1,0,0,0); end=d.getTime(); break;
        case '4h': d.setHours(Math.ceil((d.getHours()+1)/4)*4,0,0,0); end=d.getTime(); break;
        case '1d': d.setDate(d.getDate()+1); d.setHours(0,0,0,0); end=d.getTime(); break;
        case '1w': d.setDate(d.getDate()+((8-d.getDay())%7||7)); d.setHours(0,0,0,0); end=d.getTime(); break;
        default: end = now;
      }
      const s = Math.max(0,Math.floor((end-now)/1000));
      const m = Math.floor(s/60);
      setCountdown(`${m}:${(s%60).toString().padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick,1000);
    return ()=>clearInterval(id);
  },[res]);

  const emPct = levels.emSigma != null && spot ? (levels.emSigma/spot)*100 : null;

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
        <div className="ml-auto text-[11px] text-white/35">价格 Binance · 关键位 Deribit · lightweight-charts</div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto shrink-0 pb-0.5">
        <LevelChip label="现价" value={spot?fmtPx(spot):'—'} color={UP}/>
        <LevelChip label="Call 墙" value={levels.callWall!=null?fmtPx(levels.callWall):'—'} color={CALL}/>
        <LevelChip label="最大痛点" value={levels.maxPain!=null?fmtPx(levels.maxPain):'—'} color={YELLOW}/>
        <LevelChip label="Put 墙" value={levels.putWall!=null?fmtPx(levels.putWall):'—'} color={PUT}/>
        <LevelChip label={`±1σ 预期${levels.emExpiryLabel?`·${levels.emExpiryLabel}`:''}`}
          value={levels.emSigma!=null&&spot?`${fmtPx(spot-levels.emSigma)}–${fmtPx(spot+levels.emSigma)}`:'—'}
          sub={emPct!=null?`±${emPct.toFixed(1)}%`:undefined} color={EM_C}/>
      </div>

      <div className="flex-1 min-h-0 rounded-xl bg-[#17181E] p-1.5 relative overflow-hidden">
        <div ref={containerRef} className="absolute inset-1.5"/>
        {candles.length>0 && !loading && (
          <div className="absolute bottom-2 right-3 z-10 text-[10px] font-mono tabular-nums text-white/35 pointer-events-none select-none">
            ⏱ {countdown}
          </div>
        )}
        {hoverCandle && (
          <div className="absolute top-1.5 left-1.5 z-10 px-2.5 py-1 rounded-md bg-[var(--color-dropdown)]/90 ring-1 ring-inset ring-[var(--color-border-subtle)] text-[11px] font-mono tabular-nums text-white/85 pointer-events-none select-none whitespace-nowrap">
            {coin}USDT · {RES_LABEL[res]}  O{hoverCandle.o.toFixed(0)}  H{hoverCandle.h.toFixed(0)}  L{hoverCandle.l.toFixed(0)}  C<span className={hoverCandle.c >= hoverCandle.o ? 'text-[#28C840]':'text-[#FF5F57]'}>{hoverCandle.c.toFixed(0)}</span>
          </div>
        )}
        {(candles.length===0||loading)&&(
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40 pointer-events-none">
            {error?'数据加载失败，重试中…':loading?'加载 K 线中…':'暂无数据'}
          </div>
        )}
      </div>
    </div>
  );
};

export default CandleChartView;
