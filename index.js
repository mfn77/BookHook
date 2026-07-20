const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// notifications/{uid}/items/{itemId} altına her yeni uygulama-içi bildirim
// eklendiğinde, o kişinin kayıtlı cihazlarına gerçek bir push bildirimi gönderir.
// DEBUG SÜRÜMÜ: her adımda console.log ile ne olduğunu Cloud Logging'e yazar,
// böylece "tetiklendi ama bir şey göndermedi mi" sorusunu loglardan cevaplayabiliriz.
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
      console.log("[push] Hiç token yok (kullanıcı telefon bildirimlerini hiç açmamış olabilir), çıkılıyor.");
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
          const msg = r.error && r.error.message;
          console.error(`[push] Token #${i} BAŞARISIZ. code=${code} message=${msg}`);
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            invalidTokens.push(tokens[i]);
          }
        } else {
          console.log(`[push] Token #${i} başarıyla gönderildi. messageId=${r.messageId}`);
        }
      });

      if (invalidTokens.length) {
        console.log(`[push] ${invalidTokens.length} geçersiz token temizleniyor.`);
        await db.collection("users").doc(uid).update({
          fcmTokens: tokens.filter((t) => !invalidTokens.includes(t)),
        });
      }
    } catch (e) {
      console.error("[push] Push gönderilemedi (genel hata):", e);
    }
  }
);
