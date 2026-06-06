# 薇薇看板 (weiwei.watcher)

> 加密期权交易决策座舱 — Deribit / Bybit / Hyperliquid 多账户聚合的实时终端

一个本地运行的 React SPA，专注做**加密期权交易决策**：

- **市场速读**：波动率、IV 曲面、期限结构、GEX 敞口、大宗成交流
- **组合风险**：多账户希腊聚合、净 $Delta/$Vega、压力测试
- **策略沙盒**：期权链下单模拟、头寸可视化
- **告警引擎**：基于真实 book 的盯盘告警

## 技术栈

- Vite 6 + React 19 + TypeScript
- Tailwind v4（@theme token + 4 级中性灰设计系统）
- ECharts（图表）+ LightweightCharts（K 线）
- 原生 WebSocket：Deribit 公有频道 + Bybit 私有频道
- Vite 代理：Hyperliquid / Binance / Deribit API

## 本地运行

**前置：** Node.js 18+

```bash
npm install
cp .env.example .env   # 按需填 Bybit 只读 key / Hyperliquid 钱包地址
npm run dev
```

启动后访问 http://localhost:3000/

## 配置（.env）

| 变量 | 必填 | 说明 |
|------|:---:|------|
| `VITE_BYBIT_API_KEY` / `VITE_BYBIT_API_SECRET` | 否 | 头寸可视化用，只读 key，**不要开提现权限** |
| `VITE_HYPERLIQUID_ADDRESS` | 否 | 多账户聚合，逗号分隔多个钱包地址 |
| `API_PROXY_TARGET` | 否 | 后端代理地址，默认 `http://localhost:8787` |
| `DISABLE_HMR` | 否 | 设 `true` 可禁用 HMR（agent 编辑时防闪烁） |

> 浏览器端密钥仅用于个人本地终端，**切勿把带密钥的构建产物部署到公网**。

## 命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（端口 3000） |
| `npm run build` | 生产构建到 `dist/` |
| `npm run lint` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run lint:eslint` | ESLint 检查 |
| `npm test` | 跑测试（vitest） |

## 目录速览

```
src/
├── pages/              路由页（薄壳）
├── features/           业务功能模块
│   ├── optionsChain/   期权链核心
│   ├── monitor/        监控页 4 个 tab
│   ├── accounts/       多账户聚合
│   ├── alerts/         告警引擎
│   └── ...
├── registry/           共享数据层 + 监控 widget 注册
│   ├── data/           WS / 轮询 / REST / 新鲜度追踪
│   ├── lib/            共享数学/颜色/图表工具
│   └── ...
├── components/         通用 UI 组件
└── App.tsx             路由 + 顶部导航 + 全局 WS 价格条
```

详细架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)，视觉规范见 [DESIGN.md](./DESIGN.md)。

## 注意

- 期权行情走 Deribit / Bybit **公有** WS，不需要密钥
- 历史 IV 数据走 Deribit REST，限流 20s 超时
- 监控页 widget 切走时自动暂停轮询，回到页面恢复
