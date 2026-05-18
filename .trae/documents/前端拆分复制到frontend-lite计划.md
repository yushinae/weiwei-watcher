# 前端拆分复制到 frontend-lite 计划

## Summary（目标概要）
把当前仓库**根目录的 Vite + React 前端**复制一份到新目录 **`frontend-lite/`**，使其在该目录内可独立执行 `npm install && npm run dev` 启动。新目录里保留 **顶部导航栏（header）**、**底部导航栏（footer）** 的整体逻辑架构与路由框架；后端/数据库相关（`server/` 等）保持在原目录**不动、不复制**。

> 说明（关于“带走哪些部分”的含义）
> - **路由与页面框架**：`BrowserRouter`、`Routes/Route`、页面容器/布局（让“点导航→切页面”这套机制还在）。
> - **样式与 UI 组件**：`index.css`、Tailwind、`src/components/**` 等（保证导航/页脚能渲染出正确样式）。
> - （可选）**API 请求层**：`src/api/**`（如果导航/页脚/状态指示依赖后端连通状态，就需要一起带走）。

---

## Current State Analysis（现状分析：基于实际文件）
### 仓库结构（关键部分）
- 根目录是一套可运行的前端工程（Vite）：
  - `package.json`（Vite dev/build 脚本、依赖）
  - `vite.config.ts`（含 `/api`、`/ws` 代理）
  - `index.html`
  - `src/`（前端源码）
- 后端/数据库相关在 `server/` 目录（Node/TS，含 db/migrations 等），符合“留在原处不动”的要求。

### 顶部/底部导航逻辑所在位置（关键依赖）
- `src/main.tsx`：使用 `BrowserRouter` 包裹 `App`。
- `src/App.tsx`：
  - 顶部 `header`：包含 Logo、`AppNavigationDropdown`、`DataConnectionStatus` 等组件与状态展示。
  - 路由：`Routes/Route` 定义多个页面路由（`/market`、`/assets`、`/monitor`、`/options`、`/options-chain`、`/` 等）。
  - 底部 `footer`：基于 `useWorkspaceStore` 的 `pages` 渲染 tabs（`FooterTab`），并负责 `navigate`/`setActivePage` 等切换逻辑。

---

## Proposed Changes（拟执行变更：只做复制/搬运，不改原目录后端）
> 本阶段计划的“变更”是：在仓库根目录**新增**一个 `frontend-lite/` 并复制文件进去；不触碰 `server/`，也不在原前端目录做重构。

### 1) 创建目标目录
- 新建目录：`frontend-lite/`（位于当前仓库根目录下）

### 2) 复制到 `frontend-lite/` 的文件/目录清单（含原因）
#### A. 工程启动/构建必需（保证 Vite 能跑）
- `index.html`  
  - Vite 入口 HTML，引用前端入口脚本。
- `vite.config.ts`  
  - Vite 配置与代理（`/api`、`/ws`），以及 Tailwind/React 插件。
- `tsconfig.json`  
  - TS 编译选项与 `@/*` path 映射（与 `vite.config.ts` alias 对齐）。
- `package.json`  
  - scripts 与 dependencies（`npm run dev`/`build` 等）。
- `package-lock.json`（建议复制）  
  - 锁定依赖版本，保证 `frontend-lite/` 安装结果可复现。

#### B. 前端源码（保留 header/footer/路由架构所需）
- `src/`（建议整目录复制）  
  - 顶部 header、底部 footer 与路由框架都在 `src/App.tsx`，且依赖：
    - `src/store/**`（Zustand store，页脚 tabs 逻辑依赖）
    - `src/components/**`（例如 `DataConnectionStatus`、弹层 Popover/Modal 等）
    - `src/pages/**`（路由对应页面组件；为保持“架构完整”，先整体带走）
    - `src/api/**`（例如连通状态 SSE/WS）
    - `src/lib/**`、`src/types/**`、`src/registry/**`、`src/features/**`、`src/motion/**`（被 App 与页面间接依赖）

#### C. 环境变量模板（便于在新目录内配置）
- `.env.example`（建议复制）
  - `vite.config.ts` 使用 `loadEnv(mode, '.', '')` 从“当前运行目录”读取 env；复制后应把 env 模板放在 `frontend-lite/`，避免误以为根目录 env 会自动生效。

### 3) 明确不复制/保持原处不动（含原因）
- `server/`：后端与数据库逻辑，按要求留在原目录。
- `node_modules/`、`server/node_modules/`：依赖安装产物，不应复制；`frontend-lite/` 需自行 `npm install`。
- `dist/`：构建产物，不复制；新目录可自行 `npm run build` 生成。
- `docker-compose.yml`、`docs/`、`.trae/` 等：非前端运行必需；是否复制取决于你是否想把文档也一并带走（默认不复制，保持“lite”）。

### 4) 最小必要调整策略（确保“可独立跑起来”）
> 这里的“调整”指在 `frontend-lite/` 内的配置/说明层面，尽量不改业务代码；如果你只想纯复制不改任何内容，也可以先复制后再按验证结果决定是否需要这些微调。

- **端口**：默认沿用 `package.json` 的 `--port=3000`。  
  - 决策：先不改端口；若你未来想同时跑“原前端 + frontend-lite”，再把其中一个改为 `3001` 并配套调整后端 CORS/env（优先用 env，而不是改后端代码）。
- **代理目标**：沿用 `vite.config.ts` 的 `API_PROXY_TARGET` 机制（默认 `http://localhost:8787`）。  
  - 决策：先不改代理逻辑，只确保 `frontend-lite/` 也带有 `.env.example` 便于配置。

---

## Assumptions & Decisions（前提假设与已做决定）
1. `frontend-lite/` 将创建在**当前仓库根目录**，目录名确定为：`frontend-lite`。
2. 目标是“**能独立跑起来**”，即在 `frontend-lite/` 内可执行 `npm install && npm run dev`。
3. 为避免漏依赖导致启动失败，`src/` 默认**整体复制**，暂不做“只留下导航/页脚相关文件”的删减（删减属于后续重构工作）。
4. 后端 `server/` 及数据库迁移脚本等保持原处不动；`frontend-lite` 通过 Vite proxy 与其联通。

---

## Verification（验收/验证步骤）
> 执行阶段由实现者完成；此处仅定义验收标准与操作顺序。

### A. 基础启动验证（不依赖后端）
1. 在 `frontend-lite/` 内执行 `npm install`
2. 执行 `npm run dev`
3. 打开本地页面，确认：
   - 顶部 `header` 可见
   - 底部 `footer` 可见
   - 页面切换（路由）正常（至少 `/` 与一个其他路由）

### B. 路由完整性验证
逐个访问（或通过导航进入）以下路由，确认不白屏/不报错：
- `/`、`/market`、`/assets`、`/monitor`、`/options`、`/options-chain`

### C. 与后端联通验证（依赖 `server/` 仍在原目录运行）
在后端启动后，确认前端请求/连接能通过代理到后端：
- `vite.config.ts` proxy 的 `/api`、`/ws` 可用（Network / Console 无明显连接错误）

---

## Notes（补充）
你可以给我发图片（例如：你希望保留的顶部/底部导航样式截图，或目录结构截图）。如果你提供截图，我可以在后续“精简到只剩导航/页脚架构”的阶段，帮你更精确地决定哪些页面/组件要保留、哪些可以替换成占位页。

