import CandleChartView from '../features/priceChart/CandleChartView';

export default function PriceChartPage({ active = true }: { active?: boolean }) {
  return <CandleChartView active={active} />;
}
