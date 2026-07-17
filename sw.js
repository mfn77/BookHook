const CACHE = "kitap-kulubu-v4";
const ASSETS = ["./manifest.json", "./icon-192.png", "./icon-512.png", "./favicon.png", "./apple-touch-icon.png"];

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

  if (isHtml) {
    // HTML: her zaman önce ağdan taze sürümü çekmeye çalış, sadece ağ yoksa (offline) önbelleğe düş.
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Statik dosyalar (ikonlar, manifest): önce önbellek, yoksa ağdan çek.
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

/* ============ FIREBASE CLOUD MESSAGING (arka plan push bildirimleri) ============
   Önceden ayrı bir firebase-messaging-sw.js dosyasındaydı. Aynı klasörde iki service
   worker (bu dosya + firebase-messaging-sw.js) aynı kapsamda (scope) kayıtlı olduğu
   için, telefon kapalıyken gelen push bazen push dinleyicisi OLMAYAN bu dosyaya
   yönlendirilip sessizce kayboluyordu. Artık push'u da BURADA (tek dosyada) işliyoruz,
   böylece çakışma tamamen ortadan kalkıyor. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDpRov8Qs7rPQ7lILyhs7DuRHdQpTJZWJ4",
  authDomain: "bookhook-77.firebaseapp.com",
  projectId: "bookhook-77",
  storageBucket: "bookhook-77.firebasestorage.app",
  messagingSenderId: "611511209042",
  appId: "1:611511209042:web:3fa319fb5ee6ca5daba38b"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'BookHook';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { linkTab: (payload.data && payload.data.linkTab) || null }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = self.registration.scope; // manifest'teki scope ile birebir aynı, tam URL
  const linkTab = (event.notification.data && event.notification.data.linkTab) || null;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(targetUrl) && 'focus' in client) {
          if (linkTab) client.postMessage({ type: 'notifClick', linkTab });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        const openUrl = linkTab ? targetUrl + '?tab=' + encodeURIComponent(linkTab) : targetUrl;
        return clients.openWindow(openUrl);
      }
    })
  );
});
