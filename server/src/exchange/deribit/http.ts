type DeribitInstrument = {
  instrument_name: string;
  kind: string;
  currency: string;
  expiration_timestamp: number;
  strike: number;
  option_type: string; // call|put
};

export async function fetchDeribitInstruments(currency: string) {
  const base = (process.env.DERIBIT_ENV ?? 'testnet').toLowerCase() === 'mainnet' ? 'https://www.deribit.com' : 'https://test.deribit.com';
  const url = new URL('/api/v2/public/get_instruments', base);
  url.searchParams.set('currency', currency);
  url.searchParams.set('kind', 'option');
  url.searchParams.set('expired', 'false');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`deribit get_instruments failed: ${res.status}`);
  const json: any = await res.json();
  const list: any[] = json?.result ?? [];
  const items: DeribitInstrument[] = list.map((x) => ({
    instrument_name: String(x?.instrument_name),
    kind: String(x?.kind),
    currency: String(x?.currency),
    expiration_timestamp: Number(x?.expiration_timestamp),
    strike: Number(x?.strike),
    option_type: String(x?.option_type),
  }));
  return items;
}
