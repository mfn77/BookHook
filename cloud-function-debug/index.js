const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// notifications/{uid}/items/{itemId} altına her yeni uygulama-içi bildirim
// eklendiğinde, o kişinin kayıtlı cihazlarına gerçek bir push bildirimi gönderir.
exports.sendPushOnNotification = onDocumentCreated(
  "notifications/{uid}/items/{itemId}",
  async (event) => {
    const uid = event.params.uid;
    const data = event.data.data();
    console.log(`[push] Tetiklendi. uid=${uid} data=${JSON.stringify(data)}`);

    if (!data) {
      console.log("[push] Belge verisi boş, çıkılıyor.");
      return;
    }

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      console.log(`[push] users/${uid} belgesi bulunamadı, çıkılıyor.`);
      return;
    }

    const tokens = userSnap.data().fcmTokens || [];
    console.log(`[push] uid=${uid} icin kayitli token sayisi: ${tokens.length}`);
    if (!tokens.length) {
      console.log("[push] Hiç token yok, çıkılıyor.");
      return;
    }

    const message = {
      data: {
        title: "BookHook",
        body: data.message || "",
        linkTab: data.linkTab || "",
      },
      tokens,
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      console.log(`[push] Gönderim tamamlandı. successCount=${response.successCount} failureCount=${response.failureCount}`);

      const invalidTokens = [];
      response.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error && r.error.code;
          console.error(`[push] Token #${i} BAŞARISIZ. code=${code}`);
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            invalidTokens.push(tokens[i]);
          }
        }
      });

      if (invalidTokens.length) {
        await db.collection("users").doc(uid).update({
          fcmTokens: tokens.filter((t) => !invalidTokens.includes(t)),
        });
      }
    } catch (e) {
      console.error("[push] Push gönderilemedi (genel hata):", e);
    }
  }
);

// Türkiye'nin yerel (UTC+3, DST yok) tarihini YYYY-MM-DD olarak hesaplar.
function todayInIstanbul() {
  const now = new Date();
  const ist = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Bugün için henüz "okudum/okumadım" işaretlemesi yapmamış herkese hatırlatma push'u gönderir.
async function sendReminderToUnmarked(message) {
  const today = todayInIstanbul();
  console.log(`[reminder] Çalışıyor. today=${today} message="${message}"`);

  const answersSnap = await db.collection("days").doc(today).collection("answers").get();
  const markedUids = new Set();
  answersSnap.forEach((d) => markedUids.add(d.id));
  console.log(`[reminder] Bugün işaretlemiş olan kişi sayısı: ${markedUids.size}`);

  const usersSnap = await db.collection("users").get();
  const tokens = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.banned) return;
    if (markedUids.has(d.id)) return;
    (u.fcmTokens || []).forEach((t) => tokens.push(t));
  });
  console.log(`[reminder] Hatırlatma gidecek token sayısı: ${tokens.length}`);

  if (!tokens.length) {
    console.log("[reminder] Gönderilecek token yok, çıkılıyor.");
    return;
  }

  try {
    const response = await messaging.sendEachForMulticast({
      data: { title: "BookHook", body: message, linkTab: "msurvey" },
      tokens,
    });
    console.log(`[reminder] Gönderim tamamlandı. successCount=${response.successCount} failureCount=${response.failureCount}`);
  } catch (e) {
    console.error("[reminder] Hatırlatma gönderilemedi:", e);
  }
}

// Her gün Türkiye saatiyle 14:00
exports.readingReminderNoon = onSchedule(
  { schedule: "0 14 * * *", timeZone: "Europe/Istanbul" },
  async () => {
    await sendReminderToUnmarked("Bugün okumak için heyecanlı mısın? 🤪🫪");
  }
);

// Her gün Türkiye saatiyle 22:00
exports.readingReminderNight = onSchedule(
  { schedule: "0 22 * * *", timeZone: "Europe/Istanbul" },
  async () => {
    await sendReminderToUnmarked("Zaman geçiyor, oku hadi! 😡🫡");
  }
);
