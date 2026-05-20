import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Minimize2, LayoutGrid, X, Pencil, Check } from 'lucide-react';
import { Responsive as ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem as RGLLayoutItem } from 'react-grid-layout';
import { cn } from '../lib/utils';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useLayoutStore } from '../store/useLayoutStore';
import type { LayoutItem, WidgetConfig } from '../store/useLayoutStore';
import { ElasticLayout } from '../components/ElasticLayout';
import { WIDGET_REGISTRY } from '../registry';
import { WidgetInstance } from '../types/workspace';
import { WidgetCard } from '../components/card/WidgetCard';
import { DUR_CARD, EASE_EMPHASIS } from '../motion/tokens';

function instToLayoutItem(inst: WidgetInstance): LayoutItem {
  return { i: inst.instanceId, x: inst.layout.x, y: inst.layout.y, w: inst.layout.w, h: inst.layout.h, minW: inst.layout.minW, minH: inst.layout.minH };
}

function instToWidgetConfig(inst: WidgetInstance, label: string): WidgetConfig {
  return { id: inst.instanceId, type: inst.widgetId, visible: true, title: label, config: inst.props };
}

export const DashboardPage = React.memo(() => {
  const { width, containerRef } = useContainerWidth();

  const pages = useWorkspaceStore(state => state.pages);
  const activePageId = useWorkspaceStore(state => state.activePageId);
  const removeInstance = useWorkspaceStore(state => state.removeInstance);
  const updatePageLayouts = useWorkspaceStore(state => state.updatePageLayouts);

  const isEditMode = useLayoutStore(state => state.isEditMode);
  const draftLayouts = useLayoutStore(state => state.draftLayouts);
  const enterEditMode = useLayoutStore(state => state.enterEditMode);
  const saveEdit = useLayoutStore(state => state.saveEdit);
  const cancelEdit = useLayoutStore(state => state.cancelEdit);
  const updateDraftItems = useLayoutStore(state => state.updateDraftItems);
  const removeDraftWidget = useLayoutStore(state => state.removeDraftWidget);

  const activePage = useMemo(() => pages.find(p => p.id === activePageId), [pages, activePageId]);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  // When entering edit mode, seed the draft from current instances
  const handleEnterEdit = () => {
    if (!activePage) return;
    const items = activePage.instances.map(instToLayoutItem);
    const widgets = activePage.instances.map(inst => {
      const defn = WIDGET_REGISTRY[inst.widgetId];
      return instToWidgetConfig(inst, defn?.label ?? inst.widgetId);
    });
    // Seed savedLayouts first so enterEditMode can clone it
    useLayoutStore.getState().initPageLayout(activePageId, items, widgets);
    // Force re-seed even if page already existed (instances may have changed)
    useLayoutStore.setState(state => ({
      savedLayouts: {
        ...state.savedLayouts,
        [activePageId]: { pageId: activePageId, items, widgets },
      },
    }));
    enterEditMode();
  };

  // On save: apply draft layout positions back to workspaceStore
  const handleSave = () => {
    const draft = draftLayouts?.[activePageId];
    if (draft && activePage) {
      updatePageLayouts(activePageId, draft.items.map(item => ({
        instanceId: item.i,
        layout: { x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, minH: item.minH },
      })));
      // Remove instances that were deleted in draft
      const draftIds = new Set(draft.widgets.map(w => w.id));
      activePage.instances.forEach(inst => {
        if (!draftIds.has(inst.instanceId)) removeInstance(activePageId, inst.instanceId);
      });
    }
    saveEdit();
  };

  // ── Layout for RGL ────────────────────────────────────────────────────────

  // In edit mode: use draft; in view mode: use activePage.instances directly
  const draftPage = draftLayouts?.[activePageId];

  const rglLayout: RGLLayoutItem[] = useMemo(() => {
    if (isEditMode && draftPage) {
      return draftPage.items.map(item => ({
        i: item.i, x: item.x, y: item.y, w: item.w, h: item.h,
        minW: item.minW, minH: item.minH, static: false,
      }));
    }
    return (activePage?.instances ?? []).map(inst => ({
      i: inst.instanceId, ...inst.layout, static: true,
    }));
  }, [isEditMode, draftPage, activePage]);

  const visibleInstances = useMemo(() => {
    if (isEditMode && draftPage) {
      const draftIds = new Set(draftPage.widgets.filter(w => w.visible).map(w => w.id));
      return (activePage?.instances ?? []).filter(inst => draftIds.has(inst.instanceId));
    }
    return activePage?.instances ?? [];
  }, [isEditMode, draftPage, activePage]);

  const onLayoutChange = (newLayout: Layout) => {
    if (isEditMode) {
      const items: LayoutItem[] = newLayout.map(item => {
        const existing = draftPage?.items.find(i => i.i === item.i);
        return { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h, minW: existing?.minW, minH: existing?.minH };
      });
      updateDraftItems(activePageId, items);
    } else {
      if (!activePage) return;
      updatePageLayouts(activePage.id, newLayout.map(item => ({
        instanceId: item.i,
        layout: {
          x: item.x, y: item.y, w: item.w, h: item.h,
          minW: activePage.instances.find(i => i.instanceId === item.i)?.layout.minW,
          minH: activePage.instances.find(i => i.instanceId === item.i)?.layout.minH,
        },
      })));
    }
  };

  const handleRemoveCard = (instanceId: string) => {
    if (isEditMode) {
      removeDraftWidget(activePageId, instanceId);
    } else {
      removeInstance(activePageId, instanceId);
    }
  };

  const fullscreenInst = fullscreenId ? activePage?.instances.find(i => i.instanceId === fullscreenId) ?? null : null;
  const fullscreenDefn = fullscreenInst ? WIDGET_REGISTRY[fullscreenInst.widgetId] : null;

  if (!activePage) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0"
    >
      {/* Edit mode toolbar — top right of workspace */}
      <div className="absolute top-0 right-0 z-[80] w-40 h-14 group/toolbar flex items-start justify-end pt-3 pr-4">
        <AnimatePresence mode="wait" initial={false}>
          {isEditMode ? (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-2"
            >
              <div className="px-3 py-1 rounded-full text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 backdrop-blur-sm">
                编辑模式
              </div>
              <button
                onClick={cancelEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-bold text-slate-300 bg-white/[0.06] border border-white/10 hover:bg-white/10 transition-colors backdrop-blur-sm"
              >
                <X size={12} strokeWidth={2.5} />
                取消
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-bold text-white bg-brand-blue hover:bg-[#3a6ae8] transition-colors"
              >
                <Check size={12} strokeWidth={2.5} />
                保存布局
              </button>
            </motion.div>
          ) : (
            <button
              onClick={handleEnterEdit}
              className="opacity-0 group-hover/toolbar:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/toolbar:pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-bold text-slate-400 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:text-slate-200 backdrop-blur-sm"
            >
              <Pencil size={12} strokeWidth={2} />
              编辑布局
            </button>
          )}
        </AnimatePresence>
      </div>

      <ElasticLayout>
        <div className="min-h-full flex flex-col">
          {visibleInstances.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center mt-[14vh]">
              <div className="relative mb-8 w-[200px] h-[100px]">
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-2 opacity-[0.18]">
                  {[0, 1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={cn("rounded-[6px] border",
                      i === 0 ? "border-brand-blue/60 bg-brand-blue/10" : "border-surface-5 bg-surface-2")} />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-11 h-11 rounded-[10px] bg-brand-blue/10 border border-brand-blue/25 flex items-center justify-center shadow-[0_0_24px_rgba(77,124,255,0.18)]">
                    <LayoutGrid size={20} className="text-brand-blue" />
                  </div>
                </div>
              </div>
              <h3 className="text-slate-200 font-bold text-[15px] mb-2">添加你的第一个组件</h3>
              <p className="text-slate-500 text-[13px] text-center leading-relaxed max-w-[240px]">
                点击底部的 <span className="text-slate-300 font-bold">+ 添加组件</span>，<br />选择功能模块放入此页面。
              </p>
            </div>
          )}

          {visibleInstances.length > 0 && (
            <div className="relative px-2 pb-0 flex-1" ref={containerRef}>
              {fullscreenId && (
                <div className="fixed inset-0 bg-[#0A0A0B]/60 z-[90] backdrop-blur-md" onClick={() => setFullscreenId(null)} />
              )}

              <ResponsiveGridLayout
                width={width || 1200}
                className="layout"
                layouts={{ lg: rglLayout }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={50}
                onLayoutChange={onLayoutChange}
                resizeConfig={{ handles: ['se'] }}
                dragConfig={{ handle: '.widget-drag-handle' }}
                margin={[8, 8]}
                containerPadding={[8, 0]}
              >
                {visibleInstances.map(inst => {
                  const defn = WIDGET_REGISTRY[inst.widgetId];
                  if (!defn) return null;
                  const Component = defn.component;
                  const gridItem = rglLayout.find(l => l.i === inst.instanceId);
                  return (
                    <div
                      key={inst.instanceId}
                      className={cn(fullscreenId === inst.instanceId ? 'opacity-0 pointer-events-none' : 'opacity-100', 'transition-opacity duration-150')}
                      data-grid={gridItem ?? { x: 0, y: Infinity, w: defn.defaultSize.w, h: defn.defaultSize.h }}
                    >
                      <WidgetCard
                        title={defn.label}
                        dragHandle={isEditMode}
                        actions={isEditMode ? [{
                          id: 'remove', icon: X, label: '关闭', tone: 'danger',
                          onClick: () => handleRemoveCard(inst.instanceId),
                        }] : undefined}
                      >
                        <Component {...(inst.props ?? {})} />
                      </WidgetCard>
                    </div>
                  );
                })}
              </ResponsiveGridLayout>

              <AnimatePresence>
                {fullscreenInst && fullscreenDefn && (() => {
                  const Component = fullscreenDefn.component;
                  return (
                    <motion.div
                      key={fullscreenId}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: DUR_CARD, ease: EASE_EMPHASIS }}
                      className="fixed inset-6 z-[100] flex"
                    >
                      <WidgetCard
                        title={fullscreenDefn.label}
                        className="is-fullscreen shadow-2xl"
                        actions={[{ id: 'exit-fullscreen', icon: Minimize2, label: '退出全屏', onClick: () => setFullscreenId(null) }]}
                      >
                        <Component {...(fullscreenInst.props ?? {})} />
                      </WidgetCard>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </div>
          )}
        </div>
      </ElasticLayout>
    </motion.div>
  );
});

DashboardPage.displayName = 'DashboardPage';
