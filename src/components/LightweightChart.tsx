import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';

export const LightweightChart = ({ data, colors }: any) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: colors.backgroundColor },
        textColor: colors.textColor,
      },
      grid: {
        vertLines: { color: colors.gridColor },
        horzLines: { color: colors.gridColor },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    chart.timeScale().fitContent();

    const newSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.upColor,
      downColor: colors.downColor,
      borderDownColor: colors.downColor,
      borderUpColor: colors.upColor,
      wickDownColor: colors.downColor,
      wickUpColor: colors.upColor,
    });

    newSeries.setData(data);

    const handleResize = () => {
      chart.applyOptions({
        width: chartContainerRef.current?.clientWidth,
        height: chartContainerRef.current?.clientHeight,
      });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, colors]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
};