# 本地后端（Express + Postgres）

## 快速开始（推荐）
1) 启动数据库 + API（Docker）
```bash
docker compose up --build
```

2) 前端开发服务器
```bash
npm install
npm run dev
```

前端已在 `vite.config.ts` 配置了 `/api` 与 `/ws` 的 dev proxy，默认指向 `http://localhost:8787`。

## 环境变量
- `PORT`：API 端口（默认 8787）
- `DATABASE_URL`：Postgres 连接串
- `CORS_ORIGIN`：前端 origin（默认 http://localhost:3000）
- `ENABLE_COLLECTORS`：是否启用交易所采集器（默认 false）
- `BYBIT_BASE_COINS`：Bybit baseCoin 列表（默认 BTC,ETH）
- `DERIBIT_CURRENCIES`：Deribit currency 列表（默认 BTC,ETH）
- `BYBIT_SYMBOLS`：Bybit 期权 symbol 列表（逗号分隔）。如果为空则只连接不订阅（后续可改为由 instruments 动态订阅）。

## 可用接口
- `GET /api/health`
- `GET /api/status`
- `GET /api/stream/status`（SSE）
- `GET /api/instruments`
- `GET /api/options/chain/latest?exchange=bybit&base=BTC&expiry=...`

