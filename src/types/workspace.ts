export interface WidgetInstance {
  instanceId: string
  widgetId: string
  layout: { x: number; y: number; w: number; h: number; minW?: number; minH?: number }
  props?: Record<string, string>
}

export interface WorkspacePage {
  id: string
  label: string
  instances: WidgetInstance[]
  routePath?: string
}
