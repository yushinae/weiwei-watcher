import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Plotly from 'plotly.js-dist';
import { cn } from '../lib/utils';

const PRESETS: Record<string, { spot: number; iv: number; strikeStep: number }> = {
  BTC: { spot: 65000, iv: 0.55, strikeStep: 1000 },
  ETH: { spot: 3000, iv: 0.70, strikeStep: 50 },
  SOL: { spot: 150, iv: 0.85, strikeStep: 5 },
};

function normCdf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + (x < 0 ? -1 : 1) * y);
}
function normPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
function hoursToYears(h: number) { return h / (24 * 365); }

function bsPrice(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) return Math.max(0, type === 'call' ? S - K : K - S);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return type === 'call' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}

function bsGreeks(S: number, K: number, T: number, sigma: number, type: 'call' | 'put') {
  if (T <= 1e-12 || sigma <= 1e-12) {
    let delta = 0;
    if (type === 'call') delta = S > K ? 1 : 0;
    else delta = S < K ? -1 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  let delta: number;
  if (type === 'call') { delta = normCdf(d1); } else { delta = normCdf(d1) - 1; }
  const theta = (-S * pdf * sigma / (2 * sqrtT)) / 365;
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100;
  return { delta, gamma, theta, vega };
}

interface Leg {
  id: number;
  side: 1 | -1;
  type: 'call' | 'put';
  K: number;
  qty: number;
  hoursToExpiry: number;
  entryPremium: number;
}

const N_POINTS = 120;
const TRACE = { GREEN_FILL: 0, RED_FILL: 1, EXPIRY: 2, CURRENT: 3, MARKER: 4, BREAKEVEN: 5 };

function formatHours(h: number) {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h - d * 24;
  return rh === 0 ? `${d}d` : `${d}d${rh}h`;
}

function roundStrike(price: number, step: number) {
  return Math.round(price / step) * step;
}

const TEMPLATES: Record<string, (spot: number, step: number, nextId: () => number) => Leg[]> = {
  longCall: (spot, step, nextId) => [{ id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 }],
  longPut: (spot, step, nextId) => [{ id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 }],
  coveredCall: (spot, step, nextId) => [{ id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.05, step), qty: 1, hoursToExpiry: 24 * 30, entryPremium: 0 }],
  bullCallSpread: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.10, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  bearPutSpread: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.90, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  longStraddle: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
  ],
  shortStrangle: (spot, step, nextId) => [
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.90, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.10, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  ironCondor: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot * 0.85, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.92, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.08, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot * 1.15, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  calendar: (spot, step, nextId) => [
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 30, entryPremium: 0 },
  ],
};

export const PositionBuilderPage = () => {
  const [symbol, setSymbol] = useState('BTC');
  const [spot, setSpot] = useState(PRESETS.BTC.spot);
  const [baseIv, setBaseIv] = useState(PRESETS.BTC.iv);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [nextId, setNextId] = useState(1);
  const [hoursForward, setHoursForward] = useState(0);
  const [ivAdjust, setIvAdjust] = useState(0);
  const [spotPctOffset, setSpotPctOffset] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInitialized = useRef(false);

  const currentS = spot * (1 + spotPctOffset / 100);
  const sigma = Math.max(0.01, baseIv + ivAdjust);

  const maxHours = useMemo(() => legs.reduce((m, l) => Math.max(m, l.hoursToExpiry), 0), [legs]);

  const repriceEntry = useCallback((leg: Leg) => {
    const T = hoursToYears(leg.hoursToExpiry);
    return { ...leg, entryPremium: bsPrice(spot, leg.K, T, baseIv, leg.type) };
  }, [spot, baseIv]);

  const addLeg = useCallback((partial: Partial<Leg> = {}) => {
    const defaultK = roundStrike(spot, PRESETS[symbol].strikeStep);
    const leg: Leg = {
      id: nextId, side: 1, type: 'call', K: defaultK, qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0, ...partial,
    };
    const priced = repriceEntry(leg);
    setNextId(n => n + 1);
    setLegs(prev => [...prev, priced]);
  }, [spot, symbol, nextId, repriceEntry]);

  const removeLeg = useCallback((id: number) => {
    setLegs(prev => prev.filter(l => l.id !== id));
  }, []);

  const updateLeg = useCallback((id: number, patch: Partial<Leg>) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...patch };
      return repriceEntry(updated);
    }));
  }, [repriceEntry]);

  const applyTemplate = useCallback((key: string) => {
    const fn = TEMPLATES[key];
    if (!fn) return;
    let idCounter = 1;
    const newLegs = fn(spot, PRESETS[symbol].strikeStep, () => idCounter++);
    const priced = newLegs.map(repriceEntry);
    setLegs(priced);
    setNextId(idCounter);
  }, [spot, symbol, repriceEntry]);

  const clearAll = useCallback(() => {
    setLegs([]);
    setNextId(1);
    setHoursForward(0);
  }, []);

  const resetScenario = useCallback(() => {
    setHoursForward(0);
    setIvAdjust(0);
    setSpotPctOffset(0);
  }, []);

  const changeSymbol = useCallback((newSymbol: string) => {
    const p = PRESETS[newSymbol];
    setSymbol(newSymbol);
    setSpot(p.spot);
    setBaseIv(p.iv);
    setLegs([]);
    setNextId(1);
  }, []);

  function legCurrentValue(leg: Leg, S: number, hf: number, ivAdj: number) {
    const remH = Math.max(0, leg.hoursToExpiry - hf);
    const T = hoursToYears(remH);
    const sig = Math.max(0.01, baseIv + ivAdj);
    return bsPrice(S, leg.K, T, sig, leg.type);
  }

  function legPL(leg: Leg, S: number, hf: number, ivAdj: number) {
    const cur = legCurrentValue(leg, S, hf, ivAdj);
    return leg.side * leg.qty * (cur - leg.entryPremium);
  }

  function positionPL(S: number, hf: number, ivAdj: number) {
    return legs.reduce((sum, l) => sum + legPL(l, S, hf, ivAdj), 0);
  }

  function positionGreeks(S: number, hf: number, ivAdj: number) {
    let d = 0, g = 0, t = 0, v = 0;
    const sig = Math.max(0.01, baseIv + ivAdj);
    for (const leg of legs) {
      const remH = Math.max(0, leg.hoursToExpiry - hf);
      const T = hoursToYears(remH);
      const grk = bsGreeks(S, leg.K, T, sig, leg.type);
      d += leg.side * leg.qty * grk.delta;
      g += leg.side * leg.qty * grk.gamma;
      t += leg.side * leg.qty * grk.theta;
      v += leg.side * leg.qty * grk.vega;
    }
    return { delta: d, gamma: g, theta: t, vega: v };
  }

  const chartXs = useMemo(() => {
    const lo = spot * 0.5;
    const hi = spot * 1.5;
    return Array.from({ length: N_POINTS + 1 }, (_, i) => lo + (hi - lo) * i / N_POINTS);
  }, [spot]);

  const expiryPL = useMemo(() => {
    const maxH = legs.reduce((m, l) => Math.max(m, l.hoursToExpiry), 0);
    return chartXs.map(x => positionPL(x, maxH, 0));
  }, [legs, chartXs, baseIv]);

  const currentPL = useMemo(() => {
    return chartXs.map(x => positionPL(x, hoursForward, ivAdjust));
  }, [legs, chartXs, hoursForward, ivAdjust, baseIv]);

  const grk = useMemo(() => positionGreeks(currentS, hoursForward, ivAdjust), [legs, currentS, hoursForward, ivAdjust, baseIv]);
  const pl = useMemo(() => positionPL(currentS, hoursForward, ivAdjust), [legs, currentS, hoursForward, ivAdjust, baseIv]);

  useEffect(() => {
    if (!chartRef.current || legs.length === 0) return;

    const breakevens: number[] = [];
    for (let i = 1; i < chartXs.length; i++) {
      if (expiryPL[i - 1] * expiryPL[i] < 0) {
        const x = chartXs[i - 1] + (chartXs[i] - chartXs[i - 1]) * (-expiryPL[i - 1]) / (expiryPL[i] - expiryPL[i - 1]);
        breakevens.push(x);
      }
    }

    const currentY = positionPL(currentS, hoursForward, ivAdjust);
    const zeroes = new Array(chartXs.length).fill(0);
    const expiryForFill = expiryPL;

    const shapes: any[] = [
      { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: '#2a3447', width: 1 } },
      { type: 'line', x0: spot, x1: spot, yref: 'paper', y0: 0, y1: 1, line: { color: '#8a93a6', width: 1, dash: 'dot' } },
    ];
    const seen = new Set<string>();
    legs.forEach(leg => {
      const k = `${leg.K}-${leg.type}`;
      if (seen.has(k)) return;
      seen.add(k);
      shapes.push({
        type: 'line', x0: leg.K, x1: leg.K, yref: 'paper', y0: 0, y1: 0.06,
        line: { color: leg.type === 'call' ? '#4ea1ff' : '#fbbf24', width: 1.5 },
      });
    });

    const traces = [
      { x: chartXs, y: expiryForFill.map(v => Math.max(0, v)), type: 'scatter', mode: 'lines', line: { color: 'rgba(0,0,0,0)' }, fill: 'tozeroy', fillcolor: 'rgba(52,211,153,0.10)', hoverinfo: 'skip', showlegend: false },
      { x: chartXs, y: expiryForFill.map(v => Math.min(0, v)), type: 'scatter', mode: 'lines', line: { color: 'rgba(0,0,0,0)' }, fill: 'tozeroy', fillcolor: 'rgba(248,113,113,0.10)', hoverinfo: 'skip', showlegend: false },
      { x: chartXs, y: expiryPL, type: 'scatter', mode: 'lines', name: '到期 P/L', line: { color: '#aaa', dash: 'dash', width: 1.5 }, hovertemplate: '标的 %{x:.2f}<br>到期 P/L %{y:.2f}<extra></extra>' },
      { x: chartXs, y: currentPL, type: 'scatter', mode: 'lines', name: '当前 P/L', line: { color: '#4ea1ff', width: 2.5 }, hovertemplate: '标的 %{x:.2f}<br>当前 P/L %{y:.2f}<extra></extra>' },
      { x: [currentS], y: [currentY], type: 'scatter', mode: 'markers', marker: { size: 10, color: '#fbbf24', line: { color: '#fff', width: 2 } }, name: '情景点', hovertemplate: '当前点<br>标的 %{x:.2f}<br>P/L %{y:.2f}<extra></extra>' },
      { x: breakevens, y: breakevens.map(() => 0), type: 'scatter', mode: 'markers', marker: { size: 8, color: '#34d399', symbol: 'diamond', line: { color: '#0b0f17', width: 1 } }, name: '盈亏平衡', hovertemplate: '盈亏平衡 %{x:.2f}<extra></extra>' },
    ];

    const layout = {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
      font: { color: '#e5e9f0', size: 12 },
      margin: { l: 60, r: 20, t: 10, b: 40 },
      xaxis: { title: `${symbol} 价格`, gridcolor: '#1a2233', zerolinecolor: '#2a3447', tickfont: { size: 11 } },
      yaxis: { title: 'P/L (USDT)', gridcolor: '#1a2233', zerolinecolor: '#2a3447', tickfont: { size: 11 } },
      shapes,
      showlegend: false,
      hovermode: 'x unified' as const,
    };

    Plotly.react(chartRef.current, traces, layout, { displayModeBar: false, responsive: true });
    chartInitialized.current = true;
  }, [legs, chartXs, expiryPL, currentPL, symbol, spot, baseIv]);

  useEffect(() => {
    if (!chartInitialized.current || legs.length === 0) return;
    const currentY = positionPL(currentS, hoursForward, ivAdjust);
    Plotly.restyle(chartRef.current!, { y: [currentPL] }, [TRACE.CURRENT]);
    Plotly.restyle(chartRef.current!, { x: [[currentS]], y: [[currentY]] }, [TRACE.MARKER]);
  }, [hoursForward, ivAdjust, spotPctOffset]);

  const gClass = (val: number) => val > 0 ? 'text-green' : (val < 0 ? 'text-red' : '');

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ background: '#0b0f17', color: '#e5e9f0' }}>
      <header className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3" style={{ borderColor: '#2a3447' }}>
        <div className="flex items-center gap-3">
          <div className="text-xl font-bold">仓位构建器</div>
          <div className="text-xs" style={{ color: '#8a93a6' }}>U 本位 · 策略训练沙盒</div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11, color: '#8a93a6' }}>标的</span>
            <select value={symbol} onChange={e => changeSymbol(e.target.value)}
              className="!w-24 px-2 py-1 rounded text-sm"
              style={{ background: '#1a2233', border: '1px solid #2a3447', color: '#e5e9f0' }}>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="SOL">SOL</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11, color: '#8a93a6' }}>入场基准价</span>
            <input type="number" value={spot} onChange={e => { const v = parseFloat(e.target.value); if (v > 0) { setSpot(v); setLegs(prev => prev.map(l => repriceEntry(l))); } }}
              className="!w-28 input-style" />
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11, color: '#8a93a6' }}>基础 IV</span>
            <input type="number" value={(baseIv * 100).toFixed(0)} onChange={e => { const v = parseFloat(e.target.value); if (v > 0) { setBaseIv(v / 100); setLegs(prev => prev.map(l => repriceEntry(l))); } }}
              className="!w-20 input-style" />
            <span style={{ fontSize: 11, color: '#8a93a6' }}>%</span>
          </div>
        </div>
      </header>

      <main className="px-6 py-4 grid gap-4" style={{ gridTemplateColumns: '380px 1fr' }}>
        <aside className="panel p-4 space-y-3" style={{ height: 'fit-content' }}>
          <div className="flex items-center justify-between">
            <div className="font-semibold">策略组合</div>
            <div className="flex gap-2">
              <select onChange={e => { if (e.target.value) { applyTemplate(e.target.value); e.target.value = ''; } }}
                className="!w-32 text-xs px-2 py-1 rounded"
                style={{ background: '#1a2233', border: '1px solid #2a3447', color: '#e5e9f0' }}>
                <option value="">-- 模板 --</option>
                <option value="longCall">单腿看涨</option>
                <option value="longPut">单腿看跌</option>
                <option value="coveredCall">备兑看涨</option>
                <option value="bullCallSpread">牛市价差</option>
                <option value="bearPutSpread">熊市价差</option>
                <option value="longStraddle">买入跨式</option>
                <option value="shortStrangle">卖出宽跨</option>
                <option value="ironCondor">铁鹰</option>
                <option value="calendar">日历价差</option>
              </select>
              <button onClick={clearAll} className="btn text-xs" style={{ color: '#f87171' }}>清空</button>
            </div>
          </div>

          <div id="legsContainer" className="space-y-2">
            {legs.length === 0 ? (
              <div className="text-sm italic py-4 text-center" style={{ color: '#8a93a6' }}>还没有腿。点 "+ 添加一腿" 或选择上方模板。</div>
            ) : legs.map((leg, idx) => {
              const remH = Math.max(0, leg.hoursToExpiry - hoursForward);
              const T = hoursToYears(remH);
              const g = bsGreeks(currentS, leg.K, T, sigma, leg.type);
              const d = leg.side * leg.qty * g.delta;
              const gm = leg.side * leg.qty * g.gamma;
              const th = leg.side * leg.qty * g.theta;
              const v = leg.side * leg.qty * g.vega;
              return (
                <div key={leg.id} className="leg-row">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: '#8a93a6' }}>#{idx + 1}</span>
                      <span className={`pill ${leg.side === 1 ? 'pill-long' : 'pill-short'}`}>{leg.side === 1 ? '买入' : '卖出'}</span>
                      <span className={`pill ${leg.type === 'call' ? 'pill-call' : 'pill-put'}`}>{leg.type === 'call' ? 'Call' : 'Put'}</span>
                    </div>
                    <button onClick={() => removeLeg(leg.id)} className="btn text-xs" style={{ color: '#f87171' }}>×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="label">方向</label>
                      <select value={leg.side} onChange={e => updateLeg(leg.id, { side: parseInt(e.target.value) as 1 | -1 })}
                        className="input-style">
                        <option value="1">买入 (Long)</option>
                        <option value="-1">卖出 (Short)</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">类型</label>
                      <select value={leg.type} onChange={e => updateLeg(leg.id, { type: e.target.value as 'call' | 'put' })}
                        className="input-style">
                        <option value="call">看涨 Call</option>
                        <option value="put">看跌 Put</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">行权价</label>
                      <input type="number" step="any" value={leg.K} onChange={e => updateLeg(leg.id, { K: parseFloat(e.target.value) })} className="input-style" />
                    </div>
                    <div>
                      <label className="label">数量</label>
                      <input type="number" step="0.1" min="0.1" value={leg.qty} onChange={e => updateLeg(leg.id, { qty: parseFloat(e.target.value) })} className="input-style" />
                    </div>
                    <div>
                      <label className="label">到期 (小时)</label>
                      <input type="number" step="1" min="1" value={leg.hoursToExpiry} onChange={e => updateLeg(leg.id, { hoursToExpiry: Math.max(1, Math.round(parseFloat(e.target.value))) })} className="input-style" />
                    </div>
                    <div>
                      <label className="label">入场权利金 (自动)</label>
                      <div className="text-sm font-medium pt-1">{leg.entryPremium.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: '#8a93a6' }}>≈ {formatHours(leg.hoursToExpiry)} · 入场总额 {(leg.side * leg.qty * leg.entryPremium).toFixed(2)}</div>
                  <div className="flex gap-3 text-xs mt-1.5 pt-1.5 border-t" style={{ borderColor: '#2a3447' }}>
                    <span style={{ color: '#8a93a6' }}>δ</span><span className={gClass(d)}>{d.toFixed(3)}</span>
                    <span style={{ color: '#8a93a6' }}>γ</span><span className={gClass(gm)}>{gm.toFixed(5)}</span>
                    <span style={{ color: '#8a93a6' }}>θ</span><span className={gClass(th)}>{th.toFixed(2)}</span>
                    <span style={{ color: '#8a93a6' }}>ν</span><span className={gClass(v)}>{v.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={() => addLeg()} className="btn w-full text-sm py-2">+ 添加一腿</button>

          <div className="text-xs leading-relaxed pt-2 border-t" style={{ color: '#8a93a6', borderColor: '#2a3447' }}>
            入场价按当前 标的/IV 用 Black-Scholes 估算。修改腿参数后会重算入场价；之后调"入场基准价/IV/时间"滑块只改变浮盈浮亏，不动入场价。
          </div>
        </aside>

        <section className="space-y-4">
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">损益曲线</div>
              <div className="text-xs" style={{ color: '#8a93a6' }}>
                <span className="inline-block w-3 h-1 align-middle mr-1" style={{ background: '#4ea1ff' }}></span>当前
                <span className="inline-block w-3 h-0 align-middle mx-1 ml-3" style={{ borderTop: '1px dashed #aaa' }}></span>到期
              </div>
            </div>
            <div ref={chartRef} style={{ width: '100%', height: 380 }} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">时间快进</div>
                <div className="text-sm" style={{ color: '#8a93a6' }}>{formatHours(hoursForward)}</div>
              </div>
              <input type="range" min="0" max={Math.max(1, maxHours)} value={hoursForward} onChange={e => setHoursForward(parseInt(e.target.value))} className="w-full" />
              <div className="text-xs mt-1" style={{ color: '#8a93a6' }}>把"当前"时间点向前推，看 theta 怎么吃仓位</div>
            </div>
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">IV 偏移</div>
                <div className="text-sm" style={{ color: '#8a93a6' }}>{(ivAdjust * 100).toFixed(0) >= '0' ? '+' : ''}{(ivAdjust * 100).toFixed(0)}%</div>
              </div>
              <input type="range" min="-30" max="50" value={ivAdjust * 100} onChange={e => setIvAdjust(parseInt(e.target.value) / 100)} className="w-full" />
              <div className="text-xs mt-1" style={{ color: '#8a93a6' }}>基础 IV 上的加减，测 vega 敏感度</div>
            </div>
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">情景标的价偏移</div>
                <div className="text-sm" style={{ color: '#8a93a6' }}>{spotPctOffset >= 0 ? '+' : ''}{spotPctOffset}%</div>
              </div>
              <input type="range" min="-40" max="40" value={spotPctOffset} onChange={e => setSpotPctOffset(parseInt(e.target.value))} className="w-full" />
              <div className="text-xs mt-1" style={{ color: '#8a93a6' }}>假设标的从入场基准价涨跌 X%，落在图上的"当前"标记位</div>
            </div>
          </div>

          <div className="flex justify-center">
            <button onClick={resetScenario} className="btn flex items-center gap-1.5 px-4 py-2 text-sm">
              <span>↺</span> 重置情景
            </button>
          </div>

          <div className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">希腊字母（按情景调整后的当前持仓）</div>
              <div className="text-sm">
                {legs.length === 0 ? (
                  <span style={{ color: '#8a93a6' }}>（无持仓）</span>
                ) : (
                  <span>情景下 P/L <span className={cn('font-semibold', pl > 0 ? 'text-green' : pl < 0 ? 'text-red' : '')}>
                    {pl >= 0 ? '+' : ''}{pl.toFixed(2)} USDT
                  </span></span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Delta (Δ)', val: grk.delta, decimals: 3, desc: '标的涨 1 单位仓位变化' },
                { label: 'Gamma (Γ)', val: grk.gamma, decimals: 5, desc: 'Delta 的变化率' },
                { label: 'Theta (Θ) /天', val: grk.theta, decimals: 2, desc: '每天时间衰减' },
                { label: 'Vega (ν) /1%', val: grk.vega, decimals: 2, desc: 'IV 涨 1 个百分点' },
              ].map(({ label, val, decimals, desc }) => (
                <div key={label} className="greek-card">
                  <div className="text-xs" style={{ color: '#8a93a6' }}>{label}</div>
                  <div className={cn('text-lg font-semibold mt-1', legs.length === 0 ? '' : gClass(val))}>
                    {legs.length === 0 ? '—' : `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}`}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#8a93a6' }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="px-6 py-4 text-xs border-t mt-4" style={{ color: '#8a93a6', borderColor: '#2a3447' }}>
        训练用工具 · 仅供学习 · 不构成任何投资建议
      </footer>

      <style>{`
        .panel { background: #121826; border: 1px solid #2a3447; border-radius: 10px; }
        .leg-row { background: #1a2233; border: 1px solid #2a3447; border-radius: 8px; padding: 10px; }
        .greek-card { background: #1a2233; border: 1px solid #2a3447; border-radius: 8px; padding: 10px 12px; }
        .input-style { background: #1a2233; border: 1px solid #2a3447; border-radius: 6px; padding: 4px 8px; color: #e5e9f0; font-size: 13px; width: 100%; }
        .input-style:focus { outline: none; border-color: #4ea1ff; }
        .btn { background: #1a2233; border: 1px solid #2a3447; border-radius: 6px; padding: 4px 10px; font-size: 13px; color: #e5e9f0; transition: all 0.15s; }
        .btn:hover { background: #233048; border-color: #4ea1ff; }
        .pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .pill-long { background: rgba(52,211,153,0.15); color: #34d399; }
        .pill-short { background: rgba(248,113,113,0.15); color: #f87171; }
        .pill-call { background: rgba(78,161,255,0.15); color: #4ea1ff; }
        .pill-put { background: rgba(251,191,36,0.15); color: #fbbf24; }
        .label { font-size: 11px; color: #8a93a6; margin-bottom: 2px; display: block; }
        .text-green { color: #34d399; }
        .text-red { color: #f87171; }
        input[type="range"] { -webkit-appearance: none; width: 100%; height: 4px; background: #2a3447; border-radius: 4px; outline: none; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: #4ea1ff; border-radius: 50%; cursor: pointer; border: 2px solid #0b0f17; }
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
        select { cursor: pointer; }
      `}</style>
    </div>
  );
};

export default PositionBuilderPage;
