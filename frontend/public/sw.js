const CACHE_NAME = 'receptionai-v9';
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  // Never intercept API calls — always go straight to network
  if (event.request.url.includes('/api/')) return;
  // Never intercept POST requests — request body would be consumed and lost
  if (event.request.method === 'POST') return;
  // JS/CSS chunks and assets — always network, never cache
  if (event.request.url.includes('/assets/')) return;
  // For navigation requests (HTML) — network-first, no cache fallback
  // This ensures index.html is always fresh after a deploy
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
    return;
  }
  // All other requests — pass through to network
  return;
});
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'ReceptionAI';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'receptionai-notification',
    data: data.data?.conversationId ? `/conversations?id=${data.data.conversationId}` : (data.url || '/conversations')
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/conversations')
  );
});
