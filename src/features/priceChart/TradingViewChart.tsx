// 嵌入完整 TradingView 高级图表（免费 widget，无需 key）。
// 给出全套 TA：指标、画线工具、所有周期。代价：封闭 iframe，无法叠加我们的期权关键位
//（那些走「关键位叠加」模式 + 上方读数条）。价格用 Binance 现货。
import React, { useEffect, useRef } from 'react';
import type { Coin } from '../monitor/types';

declare global {
  interface Window { TradingView?: { widget: new (cfg: Record<string, unknown>) => unknown } }
}

const TV_SRC = 'https://s3.tradingview.com/tv.js';
let tvPromise: Promise<void> | null = null;
function loadTv(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  if (tvPromise) return tvPromise;
  tvPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TV_SRC; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { tvPromise = null; reject(new Error('tv.js 加载失败')); };
    document.head.appendChild(s);
  });
  return tvPromise;
}

export const TradingViewChart: React.FC<{ coin: Coin }> = ({ coin }) => {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef(`tv_${Math.random().toString(36).slice(2, 9)}`);
  const failRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadTv().then(() => {
      if (!alive || !ref.current || !window.TradingView) return;
      ref.current.innerHTML = '';
      new window.TradingView.widget({
        container_id: idRef.current,
        symbol: `BINANCE:${coin}USDT`,
        interval: '60',
        timezone: 'Asia/Shanghai',
        theme: 'dark',
        style: '1',
        locale: 'zh_CN',
        autosize: true,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        backgroundColor: '#131313',
        withdateranges: true,
      });
    }).catch(() => {
      if (alive && failRef.current) failRef.current.style.display = 'flex';
    });
    return () => { alive = false; };
  }, [coin]);

  return (
    <div className="w-full h-full relative">
      <div id={idRef.current} ref={ref} className="w-full h-full" />
      <div ref={failRef} style={{ display: 'none' }}
        className="absolute inset-0 items-center justify-center text-[12px] text-white/40 pointer-events-none">
        TradingView 加载失败（可能被网络拦截），可切回「关键位叠加」
      </div>
    </div>
  );
};

export default TradingViewChart;
