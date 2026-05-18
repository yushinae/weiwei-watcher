import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Maximize2, Minimize2, X, LayoutGrid } from 'lucide-react';
import { Responsive as ResponsiveGridLayout, useContainerWidth, Layout, LayoutItem } from 'react-grid-layout';
import { cn } from '../lib/utils';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { ElasticLayout } from '../components/ElasticLayout';
import { WIDGET_REGISTRY } from '../registry';
import { WidgetInstance } from '../types/workspace';
import { WidgetCard } from '../components/card/WidgetCard';
import { DUR_CARD, EASE_EMPHASIS } from '../motion/tokens';

function instToLayoutItem(inst: WidgetInstance): LayoutItem {
  return { i: inst.instanceId, ...inst.layout };
}

export const DashboardPage = () => {
  const { width, containerRef } = useContainerWidth();
  const pages = useWorkspaceStore(state => state.pages);
  const activePageId = useWorkspaceStore(state => state.activePageId);
  const removeInstance = useWorkspaceStore(state => state.removeInstance);
  const updatePageLayouts = useWorkspaceStore(state => state.updatePageLayouts);

  const activePage = pages.find(p => p.id === activePageId);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const layout: LayoutItem[] = (activePage?.instances ?? []).map(instToLayoutItem);
  const layoutById = useMemo(() => new Map(layout.map(l => [l.i, l])), [layout]);

  const onLayoutChange = (newLayout: Layout) => {
    if (!activePage) return;
    updatePageLayouts(activePage.id, [...newLayout].map(item => ({
      instanceId: item.i,
      layout: {
        x: item.x, y: item.y, w: item.w, h: item.h,
        minW: activePage.instances.find(inst => inst.instanceId === item.i)?.layout.minW,
        minH: activePage.instances.find(inst => inst.instanceId === item.i)?.layout.minH,
      },
    })));
  };

  const fullscreenInst = fullscreenId
    ? activePage?.instances.find(i => i.instanceId === fullscreenId) ?? null
    : null;
  const fullscreenDefn = fullscreenInst ? WIDGET_REGISTRY[fullscreenInst.widgetId] : null;

  if (!activePage) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 bg-[#0A0A0D]"
    >
      <ElasticLayout>
        <div className="min-h-full flex flex-col">
          {activePage.instances.length === 0 && (
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

          {activePage.instances.length > 0 && (
            <div className="relative p-2 pb-24 flex-1" ref={containerRef}>
              {fullscreenId && (
                <div
                  className="fixed inset-0 bg-[#0A0A0B]/80 z-[90] backdrop-blur-sm"
                  onClick={() => setFullscreenId(null)}
                />
              )}

              <ResponsiveGridLayout
                width={width || 1200}
                className="layout"
                layouts={{ lg: layout }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={50}
                onLayoutChange={onLayoutChange}
                dragConfig={{ handle: ".widget-drag-handle" }}
                margin={[8, 8]}
                containerPadding={[8, 8]}
              >
                {activePage.instances.map(inst => {
                  const defn = WIDGET_REGISTRY[inst.widgetId];
                  if (!defn) return null;
                  const Component = defn.component;
                  const gridItem = layoutById.get(inst.instanceId);
                  return (
                    <div
                      key={inst.instanceId}
                      className={cn(fullscreenId === inst.instanceId ? "opacity-0 pointer-events-none" : "opacity-100")}
                      data-grid={gridItem ?? { x: 0, y: Infinity, w: defn.defaultSize.w, h: defn.defaultSize.h }}
                    >
                      <WidgetCard
                        title={defn.label}
                        icon={defn.icon}
                        dragHandle
                        actions={[
                          {
                            id: 'fullscreen',
                            icon: Maximize2,
                            label: '全屏',
                            onClick: () => setFullscreenId(prev => (prev === inst.instanceId ? null : inst.instanceId)),
                          },
                          {
                            id: 'close',
                            icon: X,
                            label: '关闭',
                            tone: 'danger',
                            onClick: () => removeInstance(activePage.id, inst.instanceId),
                          },
                        ]}
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
                        icon={fullscreenDefn.icon}
                        className="is-fullscreen shadow-2xl"
                        actions={[
                          {
                            id: 'exit-fullscreen',
                            icon: Minimize2,
                            label: '退出全屏',
                            onClick: () => setFullscreenId(null),
                          },
                          {
                            id: 'close',
                            icon: X,
                            label: '关闭',
                            tone: 'danger',
                            onClick: () => removeInstance(activePage.id, fullscreenInst.instanceId),
                          },
                        ]}
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
};
