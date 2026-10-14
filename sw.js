const CACHE = "kitap-kulubu-v24-folders";
// Only rarely changing files are precached. HTML and code (js/, css/) are not: they are
// revalidated with the server on every load (see the fetch handler).
const ASSETS = ["./manifest.json?v=brand-2", "./icons/logo-mark.png", "./icons/icon-192.png?v=brand-2", "./icons/icon-512.png?v=brand-2", "./icons/favicon.png?v=brand-2", "./icons/apple-touch-icon.png?v=brand-2"];

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
    // HTML and code are revalidated on every load (cache: "no-cache"). If nothing changed
    // the server answers 304 and the browser's copy is used; otherwise the new file is
    // downloaded. HTML and code therefore always stay in sync without version numbers in
    // file names. Offline, the cached copy is used.
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

/* Push notifications. Chrome checks that every push message shows a notification
   within event.waitUntil(); if it doesn't (or is late), Chrome shows its own "This site
   has been updated in the background" notification. Firebase's onBackgroundMessage()
   wrapper doesn't reliably guarantee that, so push events are handled directly here with
   a single showNotification() call inside event.waitUntil(). */
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


