## Summary
目标：修复“在 `/options-chain` 页面打开组件库并点击「添加组件」后，会替换当前期权链而不是仅在右侧追加新 Tab”的问题，并给出可复现实验与最终验收标准。重点处理 **zustand persist 的时序/脏状态** 与 **activeTab 为空时的 fallback 逻辑** 造成的“看起来像替换”的问题。

---

## Current State Analysis
### 用户侧现象（已确认）
- 环境：本地 dev
- 操作：组件库里点「添加组件」
- 实际：**替换当前 Tab**
- 额外信息：只做过普通刷新，未重启 dev server / 未清 localStorage

### 代码现状（已读文件）
- 组件库弹窗在 `/options-chain` 分支确实调用了 `appendOptionsChainTab(...)`，理论上不应切换：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/App.tsx)
- store 存在 `appendOptionsChainTab/openOptionsChainTab`，但 `appendOptionsChainTab` 仍可能在“tabs 为空”时激活：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/store/useWorkspaceStore.ts)
- 页面层存在 URL ↔ store 同步，并用 `useEffect`，且 activeTab 计算在 `activeOptionsTabId === null` 时 fallback 到 `optionsChainTabs[0]`：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/pages/OptionsChainPage.tsx)
- store 使用 `persist`（key: `nexus-workspace`），dev 下 StrictMode 会放大 effect 时序问题：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/store/useWorkspaceStore.ts)
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/main.tsx)

### 高概率根因（可被验证）
1) **activeOptionsTabId 为空时的 fallback**：
   - 当前 activeTab 计算为：`activeOptionsTabId ? find(...) : optionsChainTabs[0]`
   - 当 activeOptionsTabId 为 null 时，只要 append 新 tab，`optionsChainTabs[0]` 立刻变化/出现，UI 会体感“被替换”
2) **persist rehydrate + useEffect 时序**：
   - URL→store 的 open 在 `useEffect` 中执行（commit 后）
   - 若用户在 store 还未稳定前就点击“添加组件”，append 可能发生在 tabs/active 未建立阶段，造成切换/替换感
3) **本地持久化脏数据**：
   - localStorage 里可能存在 `optionsChainTabs` 与 `activeOptionsTabId` 不一致（尤其是版本演进后）
   - 导致页面落入 fallback 分支，出现不可预测的“替换”

---

## Proposed Changes
### A. 先做可复现验证（不改代码也能验证“持久化/时序”是否为根因）
1) 重启 dev server（避免热更新状态残留）
2) 清掉持久化数据后再测：
   - DevTools → Application → Local Storage → 删除 `nexus-workspace`
   - 或 Console：
     ```js
     localStorage.removeItem('nexus-workspace');
     location.reload();
     ```
3) 复测步骤：
   - 进入 `/options-chain?coin=BTC-USD&expiry=15+MAY+26`
   - 打开组件库，选 ETH，点「添加组件」
   - 观察：是否仍“替换当前 Tab”

> 若清持久化后现象消失，则需要在代码侧加“rehydrate gate + 脏状态自愈”，防止用户真实环境继续遇到。

### B. store：让 “append” 语义绝对不激活（修复核心）
文件：`src/store/useWorkspaceStore.ts`
1) `appendOptionsChainTab`：**永远不修改 `activeOptionsTabId`**（去掉任何 “tabs 为空时自动激活” 的逻辑）
2) `addOptionsChainTab(activate=false)`：当前实现仍存在“空 tabs 自动激活”的隐式行为；改为：
   - `activate=true` → 等价 `openOptionsChainTab`
   - `activate=false` → 等价 `appendOptionsChainTab`（绝不激活）
3)（稳健性）tab id 生成避免同 ms 冲突：用 `crypto.randomUUID()` 或 `Date.now()+Math.random()`（防止 React key 复用导致“像替换”）

### C. OptionsChainPage：建立“稳定 active”与“可控同步”
文件：`src/pages/OptionsChainPage.tsx`
1) URL→store 的 open 从 `useEffect` 换为 `useLayoutEffect`（让 active 建立更早，减少用户在空状态点击的窗口）
2) 引入 `persist hasHydrated` gate（或等价机制）：
   - hydrated 前不做 URL→store open
   - hydrated 后做一次“脏状态自愈”：若 `optionsChainTabs.length>0 && activeOptionsTabId===null`，则设为第一个/最后一个 tab
3) 保留 “URL↔store 双向同步 guard”：
   - URL→store：仅不一致时 open
   - store→URL：仅用户切换 tab 时 replace 更新

### D. App.tsx：追加后让用户“看得到”（避免误判“没新增”）
文件：`src/App.tsx` + `src/pages/OptionsChainPage.tsx`
1) append 成功后，tab bar 自动滚到最右（scrollIntoView 或容器 scrollLeft=scrollWidth）
2) 若存在“两个 tab 文案相同导致像替换”的情况（如币本位/U本位都显示 BTC），tab 标题需展示更区分的信息（例如完整 coinId 或在括号里展示 `USD/USDC`）

### E. Web Interface Guidelines 最小合规修补（仅与本改动相关的按钮/控件）
依据已拉取的 guidelines，重点检查并修补：
- icon-only 按钮补 `aria-label`（如“添加/关闭/+”）
- 若有 `outline-none`，补 `focus-visible` 替代样式

---

## Assumptions & Decisions
- “新增一个期权链页面”= 新增一个 OptionsChain Tab（同一 route 内多 tab），不是新增 route。
- 追加 Tab 后 **不切换**；只有用户点击 tab（或外部跳转）才切换，并同步 URL。
- 页面必须始终至少有 1 个期权链：通过“URL 进入自动 open + 脏状态自愈”保证。

---

## Verification Steps
1) **干净环境验证**
   - 清 localStorage `nexus-workspace`，重启 dev server
   - 进入 `/options-chain?coin=BTC-USD&expiry=15+MAY+26`
2) **追加不切换**
   - 打开组件库 → 选 ETH → 点「添加组件」
   - 期望：右侧新增 Tab；当前展示仍为 BTC；URL 不变
3) **点击 tab 才切换**
   - 点击新 tab
   - 期望：切换到 ETH；URL replace 更新为 ETH 对应参数
4) **刷新恢复**
   - 刷新页面
   - 期望：tabs 与 active 正确恢复；不出现“先显示 A 又跳到 B”
5) **边界：重复添加同一 coinId+expiry**
   - 期望：不重复创建；不切换（append 语义）

