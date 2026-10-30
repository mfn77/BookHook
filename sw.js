const CACHE = "kitap-kulubu-v25-dark-bar";
// Precache only rarely changing assets. Check HTML, JavaScript, and CSS with the server on each load.
const ASSETS = ["./manifest.json?v=dark-bar-1", "./icons/logo-mark.png", "./icons/icon-192.png?v=brand-2", "./icons/icon-512.png?v=brand-2", "./icons/favicon.png?v=brand-2", "./icons/apple-touch-icon.png?v=brand-2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  const isHtml = e.request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  const isCode = url.pathname.endsWith(".js") || url.pathname.endsWith(".css");

  if (isHtml || isCode) {
    /*
     * Revalidate pages and code before use. Reuse unchanged responses and download updated files; fall back
     * to the saved copy when offline.
     */
    e.respondWith(
      fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          // Only cache successful responses, so a server error never replaces the offline copy.
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Other static files (icons, manifest): cache first, then network.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return (
        cached ||
        fetch(e.request)
          .then((res) => {
            const resClone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, resClone));
            return res;
          })
          .catch(() => cached)
      );
    })
  );
});

/*
 * Show push notifications directly inside event.waitUntil. Otherwise Chrome may display its own
 * background-update warning instead.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try{ payload = event.data ? event.data.json() : {}; }catch(e){}
  const data = (payload && payload.data) || payload || {};
  const title = data.title || 'BookHook';
  const body = data.body || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/notif-icon.png',
      data: { linkTab: data.linkTab || null, postId: data.postId || null, notifId: data.notifId || null }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = self.registration.scope; // same as the manifest scope, as a full URL
  const linkTab = (event.notification.data && event.notification.data.linkTab) || null;
  const postId = (event.notification.data && event.notification.data.postId) || null;
  const notifId = (event.notification.data && event.notification.data.notifId) || null;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(targetUrl) && 'focus' in client) {
          if (linkTab) client.postMessage({ type: 'notifClick', linkTab, postId, notifId });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        const openUrl = linkTab ? targetUrl + '?tab=' + encodeURIComponent(linkTab) + (postId ? '&post=' + encodeURIComponent(postId) : '') + (notifId ? '&notif=' + encodeURIComponent(notifId) : '') : targetUrl;
        return clients.openWindow(openUrl);
      }
    })
  );
});



