# Options Execution Boundary

The options-chain ticket submits a normalized `TradeIntent` through an `ExecutionAdapter`.

Current adapters:

- `createSimExecutionAdapter(book)` sends intents to the local simulated options book.
- `createDeribitLiveAdapter(config)` maps live intents to Deribit JSON-RPC methods, but refuses every request unless `config.armed === true` and credentials are present.
- `createBybitLiveAdapter(config)` maps live intents to Bybit V5 `/v5/order/create`, `/v5/order/cancel`, and `/v5/order/amend`. It refuses requests unless `config.armed === true` and Bybit credentials are configured. Bybit testnet is currently rejected because the app proxy is wired to mainnet.
- `liveExecutionDisabledAdapter` is a hard-fail placeholder for any UI path that should look live-aware without being able to trade.

Do not wire a live adapter directly to a button without a visible LIVE/SIM selector, an explicit armed switch, and the shared `runRiskGate` result displayed in the ticket.

Recommended live flow:

1. Build a `TradeIntent` from the ticket.
2. Run `runRiskGate` with `mode: 'live'`.
3. Block hard failures, show warnings clearly.
4. Pass the intent to the venue adapter.
5. Reconcile open orders/fills from private exchange state after every response.
