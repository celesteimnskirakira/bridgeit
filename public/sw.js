const CACHE = 'bridgeit-v1';
const ASSETS = ['/login.html', '/register.html', '/home.html', '/chat.html', '/css/mobile.css'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
