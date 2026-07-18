<div align="center">

# 薇薇看板 · weiwei-watcher

**加密期权交易决策座舱** — Deribit / Bybit / Hyperliquid 多账户实时终端

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF)](https://vitejs.dev/)

</div>

---

一个本地运行的交易终端，专注**加密期权交易决策**：从市场监控 → 策略构建 → 风险分析，一站式完成。

不需要架设云端服务器，所有行情数据直接在浏览器里通过 WebSocket 从交易所拉取。

## 功能一览

| 模块 | 说明 |
|------|------|
| 📊 **市场监控** | 波动率曲面 / IV 期限结构 / 大宗成交追踪 / GEX / OI 热力图 |
| 📋 **期权链** | 实时期权链 + 订单簿深度(含 IV) + 下单面板 + 模拟/实盘执行 |
| 🧩 **策略沙盒** | 多腿期权组合构建 + 盈亏图 + Greeks 即时计算 |
| 📈 **K 线图** | 自绘 K 线 + ICT 支撑阻力 + 纽约午夜线等指标 |
| 💼 **账户聚合** | Bybit / Deribit / Hyperliquid / Binance 多账户统一持仓查看 |
| ⚠️ **告警引擎** | 价格/IV/成交量/OI 触发，桌面通知推送 |
| 📓 **交易日志** | 成交追溯 + 已实现盈亏 + 手动笔记 |
| 🔬 **组合风险** | Greeks 汇总 / 快照追踪 / 情景压力测试 |
| 📉 **波动率历史** | Deribit 历史 IV / SKEW / 期限结构 |

## 技术栈

| 层 | 选型 |
|----|------|
| 构建 | Vite 6 + TypeScript 5.8 |
| UI | React 19 + Tailwind v4（@theme 设计令牌） |
| 图表 | ECharts 6 + LightweightCharts 5 |
| 后端 | Hono 4（本地 SQLite 持久化，Node 26 `node:sqlite`） |
| WebSocket | Deribit 公开频道 + Bybit 私有频道 |
| 路由 | react-router-dom 7 |
| 动效 | motion 12 (Framer Motion 继任) |

## 快速开始

### 前置要求

- **Node.js 18+**（推荐 22+，Node 26 免数据库依赖）
- 一个或多个交易所账户（只读权限即可）

### 安装

```bash
# 克隆
git clone https://github.com/yushinae/weiwei-watcher.git
cd weiwei-watcher

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 按需填入交易所 API key（可跳过，不填也能用大部分功能）
```

### 运行

```bash
npm run dev
```

浏览器访问 **http://localhost:3000/**

### 配置（.env）

| 变量 | 必填 | 说明 |
|------|:---:|------|
| `VITE_BYBIT_API_KEY` / `VITE_BYBIT_API_SECRET` | 否 | 头寸可视化用，**只读 key，不要开提现权限** |
| `VITE_HYPERLIQUID_ADDRESS` | 否 | 多账户聚合，逗号分隔多个钱包地址 |
| `VITE_BINANCE_API_KEY` / `VITE_BINANCE_API_SECRET` | 否 | Binance 账户同步，只读 key |
| `VITE_DERIBIT_API_KEY` / `VITE_DERIBIT_API_SECRET` | 否 | Deribit 账户同步 |
| `API_PROXY_TARGET` | 否 | 后端代理地址，默认 `http://localhost:8787` |
| `DISABLE_HMR` | 否 | 设 `true` 可禁用 HMR（agent 编辑时防闪烁） |

> ⚠️ **安全警告**：`.env` 中的密钥仅用于本地个人终端。浏览器端会读到 VITE_ 前缀的变量，**切勿把带密钥的构建产物部署到公网**。

## 命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动前端(3000) + 后端(8787) |
| `npm run dev:fe` | 仅启动前端 |
| `npm run dev:be` | 仅启动后端 |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run lint` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run lint:eslint` | ESLint 检查 |
| `npm test` | 跑测试（vitest） |
| `npm run test:watch` | 监听模式跑测试 |
| `npm run clean` | 清理 `dist/` |

## 目录结构

```
src/
├── pages/              路由页（每页一个功能模块的挂载壳）
├── features/           业务功能
│   ├── optionsChain/   期权链核心（order book + 执行 + 模拟）
│   ├── monitor/        监控页 4 个 tab
│   ├── accounts/       多交易所账户适配器
│   ├── alerts/         告警引擎
│   ├── bybit/          Bybit 持仓分析
│   ├── portfolioRisk/  Greeks 聚合 + 风险分析
│   ├── positionBuilder/多腿组合创建器
│   ├── strategyBuilder/策略参数框架
│   ├── priceChart/     K 线图 + 技术指标
│   ├── volHistory/     波动率历史
│   ├── journal/        交易日志 + 盈亏计算
│   └── settings/       UI 偏好设置
├── registry/           共享数据层 + 组件注册
│   ├── data/           数据源管理（WS/轮询/REST/新鲜度）
│   ├── lib/            共享数学/颜色/图表工具
│   └── components/     Widget 注册原子
├── components/         通用 UI（卡片、图表、弹窗）
└── lib/                通用工具函数

server/                 本地后端
├── index.ts            Hono REST 服务
├── db.ts               SQLite 数据库操作
└── data/               运行时数据（gitignore）
```

## 架构说明

- **纯本地运行**：浏览器直连交易所 WS/REST，不走第三方中继
- **数据新鲜度系统**：页面切走时自动暂停非关键轮询，回到页面恢复
- **模拟/实盘分离**：期权执行有风险闸门（risk gate），模拟和实盘用不同适配器
- **详见**：[PRODUCT.md](./PRODUCT.md)

## 注意

- 期权行情走 Deribit / Bybit **公有** WebSocket，不需要密钥
- 历史 IV 数据走 Deribit REST，20s 超时
- 监控页 widget 切换标签页时自动暂停轮询，回到页面恢复
- 后端 SQLite 数据库自动创建在 `server/data/` 下

## 许可

MIT © [yushinae](./LICENSE)
