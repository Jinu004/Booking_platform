const CACHE_NAME = 'receptionai-v5';
const urlsToCache = ['/'];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/assets/')) return;
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'ReceptionAI';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'receptionai-notification',
    data: data.url || '/conversations'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/conversations')
  );
});
