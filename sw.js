const CACHE = "kitap-kulubu-v23-split-js";
// Sadece nadiren değişen dosyalar önceden önbelleğe alınır. Kod (app.js, i18n.js, style.css) ve
// HTML burada yok: onlar her açılışta sunucuya "değişti mi?" diye sorularak alınıyor (aşağıda).
const ASSETS = ["./manifest.json?v=brand-2", "./logo-mark.png", "./icon-192.png?v=brand-2", "./icon-512.png?v=brand-2", "./favicon.png?v=brand-2", "./apple-touch-icon.png?v=brand-2"];

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
    // HTML ve kod: her açılışta sunucuya "değişti mi?" diye sorulur (no-cache = yeniden doğrula).
    // Değişmediyse sunucu çok küçük bir "304" döner ve tarayıcının elindeki kopya kullanılır;
    // değiştiyse yenisi iner. Böylece HTML ile kod hep aynı sürümde kalır ve dosya adına sürüm
    // numarası eklemeyi unutmak eski kodun takılı kalmasına yol açmaz. Ağ yoksa önbelleğe düşer.
    e.respondWith(
      fetch(e.request, { cache: "no-cache" })
        .then((res) => {
          // Sadece başarılı yanıtları sakla; sunucu hatası çevrimdışı yedeğin yerini almasın.
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

  // Diğer statik dosyalar (ikonlar, manifest): önce önbellek, yoksa ağdan çek.
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

/* ============ PUSH BİLDİRİMLERİ ============
   Önceden Firebase'in messaging.onBackgroundMessage() sarmalayıcısı kullanılıyordu.
   Chrome, her push mesajının event.waitUntil() içinde ZAMANINDA bir bildirime
   dönüştüğünü doğrulayabilmek istiyor; bu doğrulama başarısız olursa (veya
   gecikirse) kendi "bu site arka planda güncellendi" yedek bildirimini gösteriyor.
   Firebase'in SDK'sı bu garantiyi her zaman güvenilir şekilde sağlayamadığı için,
   push olayını burada doğrudan ve manuel olarak işliyoruz — hiçbir ekstra kütüphane
   veya gecikme olmadan, doğrudan event.waitUntil() ile sarmalanmış tek bir
   showNotification() çağrısı. */
self.addEventListener('push', (event) => {
  let payload = {};
  try{ payload = event.data ? event.data.json() : {}; }catch(e){}
  const data = (payload && payload.data) || payload || {};
  const title = data.title || 'BookHook';
  const body = data.body || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './notif-icon.png',
      data: { linkTab: data.linkTab || null, postId: data.postId || null, notifId: data.notifId || null }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = self.registration.scope; // manifest'teki scope ile birebir aynı, tam URL
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


