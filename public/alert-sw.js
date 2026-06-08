self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = all.find(c => c.url.includes('/alerts')) ?? all[0];
    if (target) {
      await target.focus();
      return;
    }
    await clients.openWindow('/alerts');
  })());
});
