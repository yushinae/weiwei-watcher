import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const LayoutItemSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
  static: z.boolean().optional(),
});

const WidgetConfigSchema = z.object({
  id: z.string(),
  type: z.string(),
  visible: z.boolean(),
  title: z.string(),
  config: z.record(z.string(), z.string()).optional(),
});

const PageLayoutSchema = z.object({
  pageId: z.string(),
  items: z.array(LayoutItemSchema),
  widgets: z.array(WidgetConfigSchema),
});

export type LayoutItem = z.infer<typeof LayoutItemSchema>;
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;
export type PageLayout = z.infer<typeof PageLayoutSchema>;

// ── Store ────────────────────────────────────────────────────────────────────

interface LayoutState {
  /** Saved (committed) layouts per page */
  savedLayouts: Record<string, PageLayout>;
  /** In-edit draft copy (null when not editing) */
  draftLayouts: Record<string, PageLayout> | null;
  isEditMode: boolean;

  // Actions
  enterEditMode: () => void;
  saveEdit: () => void;
  cancelEdit: () => void;

  /** Update draft layout items for a page (called on drag/resize) */
  updateDraftItems: (pageId: string, items: LayoutItem[]) => void;
  /** Update draft widget config (visible, title, etc.) */
  updateDraftWidget: (pageId: string, widgetId: string, patch: Partial<WidgetConfig>) => void;
  /** Remove a widget from draft */
  removeDraftWidget: (pageId: string, widgetId: string) => void;
  /** Add a widget to draft */
  addDraftWidget: (pageId: string, item: LayoutItem, widget: WidgetConfig) => void;
  /** Initialize a page layout if it doesn't exist yet */
  initPageLayout: (pageId: string, items: LayoutItem[], widgets: WidgetConfig[]) => void;
}

function validatePageLayout(raw: unknown): PageLayout | null {
  const result = PageLayoutSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      savedLayouts: {},
      draftLayouts: null,
      isEditMode: false,

      enterEditMode: () => {
        const { savedLayouts } = get();
        // Deep-clone saved → draft
        const draft: Record<string, PageLayout> = {};
        for (const [k, v] of Object.entries(savedLayouts)) {
          draft[k] = {
            pageId: v.pageId,
            items: v.items.map(i => ({ ...i })),
            widgets: v.widgets.map(w => ({ ...w, config: w.config ? { ...w.config } : undefined })),
          };
        }
        set({ isEditMode: true, draftLayouts: draft });
      },

      saveEdit: () => {
        const { draftLayouts } = get();
        if (!draftLayouts) return;
        set({ isEditMode: false, savedLayouts: draftLayouts, draftLayouts: null });
      },

      cancelEdit: () => {
        set({ isEditMode: false, draftLayouts: null });
      },

      updateDraftItems: (pageId, items) => {
        set(state => {
          if (!state.draftLayouts) return state;
          const page = state.draftLayouts[pageId];
          if (!page) return state;
          return {
            draftLayouts: {
              ...state.draftLayouts,
              [pageId]: { ...page, items },
            },
          };
        });
      },

      updateDraftWidget: (pageId, widgetId, patch) => {
        set(state => {
          if (!state.draftLayouts) return state;
          const page = state.draftLayouts[pageId];
          if (!page) return state;
          return {
            draftLayouts: {
              ...state.draftLayouts,
              [pageId]: {
                ...page,
                widgets: page.widgets.map(w => w.id === widgetId ? { ...w, ...patch } : w),
              },
            },
          };
        });
      },

      removeDraftWidget: (pageId, widgetId) => {
        set(state => {
          if (!state.draftLayouts) return state;
          const page = state.draftLayouts[pageId];
          if (!page) return state;
          return {
            draftLayouts: {
              ...state.draftLayouts,
              [pageId]: {
                ...page,
                items: page.items.filter(i => i.i !== widgetId),
                widgets: page.widgets.filter(w => w.id !== widgetId),
              },
            },
          };
        });
      },

      addDraftWidget: (pageId, item, widget) => {
        set(state => {
          const layouts = state.draftLayouts ?? state.savedLayouts;
          const page = layouts[pageId] ?? { pageId, items: [], widgets: [] };
          return {
            draftLayouts: {
              ...(state.draftLayouts ?? state.savedLayouts),
              [pageId]: {
                ...page,
                items: [...page.items, item],
                widgets: [...page.widgets, widget],
              },
            },
          };
        });
      },

      initPageLayout: (pageId, items, widgets) => {
        set(state => {
          if (state.savedLayouts[pageId]) return state;
          const layout: PageLayout = { pageId, items, widgets };
          return { savedLayouts: { ...state.savedLayouts, [pageId]: layout } };
        });
      },
    }),
    {
      name: 'nexus-layout',
      partialize: (state) => ({ savedLayouts: state.savedLayouts }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Validate all saved layouts on rehydration
        const validated: Record<string, PageLayout> = {};
        for (const [k, v] of Object.entries(state.savedLayouts)) {
          const parsed = validatePageLayout(v);
          if (parsed) validated[k] = parsed;
        }
        state.savedLayouts = validated;
      },
    }
  )
);
