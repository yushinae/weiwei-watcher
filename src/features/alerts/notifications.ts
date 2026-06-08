import { METRIC_META, type AlertTriggerEvent } from '../../registry/data/store';

export async function ensureAlertNotifications(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  const perm = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (perm === 'granted' && 'serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/alert-sw.js');
    } catch {
      /* plain Notification fallback still works */
    }
  }
  return perm;
}

export async function notifyAlert(e: AlertTriggerEvent): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const meta = METRIC_META[e.metric];
  const title = `${e.coin} 告警触发`;
  const options: NotificationOptions = {
    body: `${meta.label} ${e.op} ${e.threshold}${meta.unit}  (当前: ${e.value.toFixed(2)}${meta.unit})`,
    icon: '/icons/alerts.png',
    tag: e.id,
  };

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return;
    } catch {
      /* fall through */
    }
  }
  new Notification(title, options);
}
