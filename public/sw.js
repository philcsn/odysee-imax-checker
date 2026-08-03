/* Service worker for push notifications. Served from the root so its scope covers the app. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* malformed payload */ }

  // iOS treats a push that doesn't display a notification as "silent" and revokes the
  // subscription after a few of them. So this always shows something, even on a payload
  // that failed to parse — a wrong notification beats a dead subscription.
  const title = data.title || 'New showings';
  const options = {
    body: data.body || 'Tap to see what changed.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'eventcinemas-watch',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ('focus' in w) return w.focus();
      return self.clients.openWindow(target);
    })
  );
});
