// ProxView service worker — shows notifications pushed from the server.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: 'ProxView', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ProxView';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: title,
      icon: '/icon/icon-192.png',
      badge: undefined,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
