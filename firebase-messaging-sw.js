// Bu dosya Firebase Cloud Messaging'in ARKA PLANDA (uygulama kapalıyken/gizliyken)
// gelen bildirimleri işletim sistemi bildirimi olarak gösterebilmesi için gerekli.
// Modül (import) sözdizimi service worker'larda henüz standart olmadığı için
// burada Firebase'in "compat" (uyumluluk) sürümünü kullanıyoruz.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// DİKKAT: Bu config, index.html içindeki firebaseConfig ile AYNI olmalı.
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

// Bildirime tıklanınca siteyi aç (mümkünse zaten açık olan sekmeye odaklan).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
