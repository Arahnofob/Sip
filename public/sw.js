// Service worker: offline app shell, push notifications, and the
// "Hit back: +250 ml" quick action right from the notification.

const SHELL = 'sip-shell-v9';
const AUTH = 'sip-auth';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/i18n.js', '/manifest.webmanifest', '/icons/icon-192.png', '/fonts/russo-one-cyrillic.woff2', '/fonts/russo-one-latin.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== AUTH).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for the app shell (so updates arrive right away), cache as fallback offline.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && SHELL_FILES.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html'))),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SIP', body: event.data && event.data.text() };
  }
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || 'sip',
    renotify: true,
    data: { url: data.url || '/', glass: data.glass },
  };
  if (data.action && data.glass) options.actions = [{ action: 'drink', title: data.action }];
  event.waitUntil(self.registration.showNotification(data.title || 'SIP 💧', options));
});

async function token() {
  const cache = await caches.open(AUTH);
  const res = await cache.match('/__token');
  return res ? res.text() : null;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/', glass } = event.notification.data || {};

  if (event.action === 'drink' && glass) {
    event.waitUntil(
      token().then((t) =>
        t
          ? fetch('/api/entries', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
              body: JSON.stringify({ ml: glass }),
            }).catch(() => {})
          : null,
      ),
    );
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
