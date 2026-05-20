import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WorkspacePage, WidgetInstance } from '../types/workspace';

export interface TickerData {
  symbol: string;
  price: string;
  change: string;
  up: boolean;
}

const INITIAL_TICKERS: TickerData[] = [
  { symbol: 'BTCUSDT', price: '64,123.50', change: '+1.2%', up: true },
  { symbol: 'ETHUSDT', price: '3,425.80', change: '+0.8%', up: true },
  { symbol: 'SOLUSDT', price: '152.45', change: '-2.4%', up: false },
  { symbol: 'BNBUSDT', price: '588.20', change: '+0.1%', up: true },
];

const INITIAL_WIDGETS: Record<string, boolean> = { margin: true, time: true };
INITIAL_TICKERS.forEach(t => { INITIAL_WIDGETS[t.symbol] = true; });

const DEFAULT_PAGES: WorkspacePage[] = [
  {
    id: 'page-account',
    label: '账户',
    instances: [
      { instanceId: 'stat-cards-1', widgetId: 'stat-cards', layout: { x: 0, y: 0, w: 12, h: 2, minW: 3, minH: 2 } },
      { instanceId: 'equity-chart-1', widgetId: 'equity-chart', layout: { x: 0, y: 2, w: 8, h: 5, minW: 3, minH: 3 } },
      { instanceId: 'checklist-1', widgetId: 'checklist', layout: { x: 8, y: 2, w: 4, h: 5, minW: 2, minH: 3 } },
      { instanceId: 'heatmap-1', widgetId: 'heatmap', layout: { x: 0, y: 7, w: 12, h: 3, minW: 4, minH: 2 } },
    ],
  },
  { id: 'page-trade-log', label: '交易日志', instances: [], routePath: '/trade-log' },
  { id: 'page-monitor', label: '监控', instances: [], routePath: '/monitor' },
];

export interface OptionsChainTab {
  id: string;
  coinId: string;
  expiry: string;
}

const newOptionsChainTabId = () => {
  try {
    // 更稳健的 key：避免同一毫秒内重复导致 React 复用节点（视觉上像“替换”）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = typeof crypto !== 'undefined' ? crypto : null;
    if (c?.randomUUID) return `otab-${c.randomUUID()}`;
  } catch {
    // ignore
  }
  return `otab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

interface WorkspaceState {
  widgets: Record<string, boolean>;
  liveTickers: TickerData[];
  pages: WorkspacePage[];
  activePageId: string;
  isEditMode: boolean;
  optionsChainTabs: OptionsChainTab[];
  activeOptionsTabId: string | null;

  /** 全局组件库弹窗：用于从不同页面打开并可预选某个组件与配置 */
  isComponentLibraryOpen: boolean;
  componentLibraryPreset: null | {
    category?: 'account' | 'charts' | 'tools' | 'monitor' | 'options';
    widgetId?: string;
    initialConfig?: Record<string, string>;
  };

  toggleWidget: (key: string) => void;
  updateTickers: (updater: (prev: TickerData[]) => TickerData[]) => void;

  addPage: (label: string) => void;
  removePage: (id: string) => void;
  setActivePage: (id: string) => void;
  renamePage: (id: string, label: string) => void;
  clonePage: (id: string) => void;

  addInstance: (pageId: string, widgetId: string, layout: WidgetInstance['layout'], props?: Record<string, string>) => void;
  removeInstance: (pageId: string, instanceId: string) => void;
  updatePageLayouts: (pageId: string, updates: { instanceId: string; layout: WidgetInstance['layout'] }[]) => void;

  toggleEditMode: () => void;

  /** 追加一个期权链 Tab（不切换当前 active） */
  appendOptionsChainTab: (coinId: string, expiry: string) => void;
  /** 打开/激活一个期权链 Tab（用于 URL 直达、用户点击 Tab 切换等） */
  openOptionsChainTab: (coinId: string, expiry: string) => void;
  /** 兼容旧调用：默认等同于 open；activate=false 时等同于 append（不切换） */
  addOptionsChainTab: (coinId: string, expiry: string, activate?: boolean) => void;
  removeOptionsChainTab: (id: string) => void;
  setActiveOptionsTab: (id: string) => void;
  /** 更新某个期权链 Tab 的参数（例如在当前 Tab 内切换到期日） */
  updateOptionsChainTab: (id: string, patch: Partial<Pick<OptionsChainTab, 'coinId' | 'expiry'>>) => void;

  openComponentLibrary: (preset?: WorkspaceState['componentLibraryPreset']) => void;
  closeComponentLibrary: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      widgets: INITIAL_WIDGETS,
      liveTickers: INITIAL_TICKERS,
      pages: DEFAULT_PAGES,
      activePageId: 'page-account',
      isEditMode: false,
      optionsChainTabs: [],
      activeOptionsTabId: null,
      isComponentLibraryOpen: false,
      componentLibraryPreset: null,

      toggleWidget: (key) => set(state => ({
        widgets: { ...state.widgets, [key]: !state.widgets[key] },
      })),

      updateTickers: (updater) => set(state => ({
        liveTickers: updater(state.liveTickers),
      })),

      addPage: (label) => set(state => {
        const id = `page-${Date.now()}`;
        return {
          pages: [...state.pages, { id, label, instances: [] }],
          activePageId: id,
        };
      }),

      removePage: (id) => set(state => {
        const remaining = state.pages.filter(p => p.id !== id);
        const firstWorkspace = remaining.find(p => !p.routePath);
        return {
          pages: remaining,
          activePageId: state.activePageId === id
            ? (firstWorkspace?.id ?? remaining[0]?.id ?? '')
            : state.activePageId,
        };
      }),

      setActivePage: (id) => set({ activePageId: id }),

      renamePage: (id, label) => set(state => ({
        pages: state.pages.map(p => p.id === id ? { ...p, label } : p),
      })),

      clonePage: (id) => set(state => {
        const src = state.pages.find(p => p.id === id);
        if (!src) return state;
        const newId = `page-${Date.now()}`;
        const newPage: WorkspacePage = {
          id: newId,
          label: `${src.label} (复制)`,
          instances: src.instances.map(inst => ({
            ...inst,
            instanceId: `${inst.widgetId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          })),
        };
        const idx = state.pages.findIndex(p => p.id === id);
        const newPages = [...state.pages];
        newPages.splice(idx + 1, 0, newPage);
        return { pages: newPages, activePageId: newId };
      }),

      addInstance: (pageId, widgetId, layout, props) => set(state => {
        const instanceId = `${widgetId}-${Date.now()}`;
        return {
          pages: state.pages.map(p => p.id !== pageId ? p : {
            ...p,
            instances: [...p.instances, { instanceId, widgetId, layout, props }],
          }),
        };
      }),

      removeInstance: (pageId, instanceId) => set(state => ({
        pages: state.pages.map(p => p.id !== pageId ? p : {
          ...p,
          instances: p.instances.filter(inst => inst.instanceId !== instanceId),
        }),
      })),

      updatePageLayouts: (pageId, updates) => set(state => {
        const updMap = new Map(updates.map(u => [u.instanceId, u.layout]));
        return {
          pages: state.pages.map(p => p.id !== pageId ? p : {
            ...p,
            instances: p.instances.map(inst => {
              const newLayout = updMap.get(inst.instanceId);
              return newLayout ? { ...inst, layout: newLayout } : inst;
            }),
          }),
        };
      }),

      toggleEditMode: () => set(state => ({ isEditMode: !state.isEditMode })),

      appendOptionsChainTab: (coinId, expiry) => set(state => {
        const existing = state.optionsChainTabs.find(t => t.coinId === coinId && t.expiry === expiry);
        if (existing) return {};
        const id = newOptionsChainTabId();
        return {
          optionsChainTabs: [...state.optionsChainTabs, { id, coinId, expiry }],
        };
      }),

      openOptionsChainTab: (coinId, expiry) => set(state => {
        const existing = state.optionsChainTabs.find(t => t.coinId === coinId && t.expiry === expiry);
        if (existing) return { activeOptionsTabId: existing.id };
        const id = newOptionsChainTabId();
        return {
          optionsChainTabs: [...state.optionsChainTabs, { id, coinId, expiry }],
          activeOptionsTabId: id,
        };
      }),

      addOptionsChainTab: (coinId, expiry, activate = true) => set(state => {
        // 兼容旧调用：activate=true → open；activate=false → append（绝不激活）
        const existing = state.optionsChainTabs.find(t => t.coinId === coinId && t.expiry === expiry);
        if (existing) return activate ? { activeOptionsTabId: existing.id } : {};
        const id = newOptionsChainTabId();
        if (!activate) {
          return { optionsChainTabs: [...state.optionsChainTabs, { id, coinId, expiry }] };
        }
        return {
          optionsChainTabs: [...state.optionsChainTabs, { id, coinId, expiry }],
          activeOptionsTabId: id,
        };
      }),

      removeOptionsChainTab: (id) => set(state => {
        const idx = state.optionsChainTabs.findIndex(t => t.id === id);
        const remaining = state.optionsChainTabs.filter(t => t.id !== id);

        // 关闭的是当前激活 Tab：按“左邻优先，其次右邻”的规则迁移激活态
        const nextActiveId = state.activeOptionsTabId === id
          ? (
            // 左邻优先
            (idx > 0 ? remaining[idx - 1]?.id : undefined) ??
            // 其次右邻（删除后仍处于 idx 的那个）
            remaining[idx]?.id ??
            remaining[remaining.length - 1]?.id ??
            null
          )
          : state.activeOptionsTabId;
        return {
          optionsChainTabs: remaining,
          activeOptionsTabId: nextActiveId,
        };
      }),

      setActiveOptionsTab: (id) => set({ activeOptionsTabId: id }),

      updateOptionsChainTab: (id, patch) => set(state => ({
        optionsChainTabs: state.optionsChainTabs.map(t => t.id === id ? { ...t, ...patch } : t),
      })),

      openComponentLibrary: (preset) => set({
        isComponentLibraryOpen: true,
        componentLibraryPreset: preset ?? null,
      }),
      closeComponentLibrary: () => set({
        isComponentLibraryOpen: false,
        componentLibraryPreset: null,
      }),
    }),
    {
      name: 'nexus-workspace',
      partialize: (state) => ({
        widgets: state.widgets,
        pages: state.pages,
        activePageId: state.activePageId,
        optionsChainTabs: state.optionsChainTabs,
        activeOptionsTabId: state.activeOptionsTabId,
      }),
    }
  )
);
