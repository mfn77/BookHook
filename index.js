const { onDocumentCreated } = require("firebase-functions/v2/firestore");
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
    if (!data) return;

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) return;
    const tokens = userSnap.data().fcmTokens || [];
    if (!tokens.length) return;

    const message = {
      notification: {
        title: "BookHook",
        body: data.message || "",
      },
      data: {
        linkTab: data.linkTab || "",
      },
      tokens,
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      const invalidTokens = [];
      response.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error && r.error.code;
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
      console.error("Push gönderilemedi:", e);
    }
  }
);
