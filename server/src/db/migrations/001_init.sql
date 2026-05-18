-- 001_init.sql

create table if not exists instruments (
  exchange text not null,
  symbol text not null,
  base text not null,
  quote text not null,
  expiry_ts timestamptz not null,
  strike numeric not null,
  option_type text not null check (option_type in ('C','P')),
  status text not null default 'trading',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (exchange, symbol)
);

create index if not exists instruments_exchange_base_expiry_idx
  on instruments (exchange, base, expiry_ts);

create index if not exists instruments_chain_idx
  on instruments (exchange, base, option_type, expiry_ts, strike);

create table if not exists option_chain_snapshots (
  ts timestamptz not null,
  exchange text not null,
  base text not null,
  expiry_ts timestamptz not null,
  underlying_price numeric,
  index_price numeric,
  payload jsonb not null,
  primary key (exchange, base, expiry_ts, ts)
);

create index if not exists option_chain_snapshots_lookup_idx
  on option_chain_snapshots (exchange, base, expiry_ts, ts desc);

create table if not exists iv_surface_points (
  ts timestamptz not null,
  exchange text not null,
  base text not null,
  expiry_ts timestamptz not null,
  moneyness numeric not null,
  delta numeric,
  iv numeric not null,
  primary key (exchange, base, expiry_ts, moneyness, ts)
);

create index if not exists iv_surface_points_lookup_idx
  on iv_surface_points (exchange, base, expiry_ts, ts desc);

create table if not exists iv_skew_metrics (
  ts timestamptz not null,
  exchange text not null,
  base text not null,
  expiry_ts timestamptz not null,
  atm_iv numeric,
  rr25 numeric,
  fly25 numeric,
  primary key (exchange, base, expiry_ts, ts)
);

create index if not exists iv_skew_metrics_lookup_idx
  on iv_skew_metrics (exchange, base, expiry_ts, ts desc);

create table if not exists option_trades_1s (
  bucket_ts timestamptz not null,
  exchange text not null,
  symbol text not null,
  count integer not null,
  buy_qty numeric not null,
  sell_qty numeric not null,
  vwap numeric,
  min_price numeric,
  max_price numeric,
  primary key (exchange, symbol, bucket_ts)
);

create index if not exists option_trades_1s_lookup_idx
  on option_trades_1s (exchange, symbol, bucket_ts desc);

create table if not exists orderbook_samples_1s (
  ts timestamptz not null,
  exchange text not null,
  symbol text not null,
  best_bid numeric,
  best_ask numeric,
  mid numeric,
  spread numeric,
  bid_depth_n numeric,
  ask_depth_n numeric,
  imbalance_n numeric,
  levels jsonb,
  primary key (exchange, symbol, ts)
);

create index if not exists orderbook_samples_1s_lookup_idx
  on orderbook_samples_1s (exchange, symbol, ts desc);

create table if not exists collector_status (
  source text primary key,
  state text not null,
  last_msg_ts timestamptz,
  msg_rate_1m numeric,
  last_error text,
  updated_at timestamptz not null default now()
);

