type BybitInstrument = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  optionsType: string; // Call/Put?
  deliveryTime: string;
  strike: string;
};

export async function fetchBybitOptionInstruments(baseCoin: string) {
  const apiBase = (process.env.BYBIT_ENV ?? 'testnet').toLowerCase() === 'mainnet' ? 'https://api.bybit.com' : 'https://api-testnet.bybit.com';
  const url = new URL('/v5/market/instruments-info', apiBase);
  url.searchParams.set('category', 'option');
  url.searchParams.set('baseCoin', baseCoin);

  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`bybit instruments-info failed: ${res.status}`);
  const json: any = await res.json();
  const list: any[] = json?.result?.list ?? [];

  const items: BybitInstrument[] = list.map((x) => ({
    symbol: String(x?.symbol),
    baseCoin: String(x?.baseCoin),
    quoteCoin: String(x?.quoteCoin),
    status: String(x?.status),
    optionsType: String(x?.optionsType),
    deliveryTime: String(x?.deliveryTime),
    strike: String(x?.strike),
  }));

  return items;
}
