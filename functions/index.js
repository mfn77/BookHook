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
        postId: data.postId || "",
        notifId: event.params.itemId || "",
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

// Profili eksik (soyad/telefon/adres) olan üyelere günde 2 kez hatırlatma gönderir.
// Not: Yeni kayıt olan üyeler artık uygulama içinde profillerini doldurmadan geçemiyor,
// bu fonksiyon sadece bu zorunluluktan ÖNCE kayıt olmuş, profili eksik kalmış üyeler için var.
// Profilini tamamlayan bir üyeye bir daha bildirim gitmez.
async function sendProfileCompletionReminders() {
  const usersSnap = await db.collection("users").get();
  const tokens = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.banned) return;
    const complete = (u.surname && u.surname.trim()) && (u.phone && u.phone.trim()) && (u.address && u.address.trim());
    if (complete) return;
    (u.fcmTokens || []).forEach((t) => tokens.push(t));
  });
  console.log(`[profil-hatirlatma] Eksik profilli, bildirim gidecek token sayısı: ${tokens.length}`);

  if (!tokens.length) {
    console.log("[profil-hatirlatma] Gönderilecek token yok, çıkılıyor.");
    return;
  }

  try {
    const response = await messaging.sendEachForMulticast({
      data: { title: "BookHook", body: "Profil bilgilerini (soyad, telefon, adres) doldurman gerekiyor.", linkTab: "profile" },
      tokens,
    });
    console.log(`[profil-hatirlatma] Gönderim tamamlandı. successCount=${response.successCount} failureCount=${response.failureCount}`);
  } catch (e) {
    console.error("[profil-hatirlatma] Hatırlatma gönderilemedi:", e);
  }
}

// Her gün Türkiye saatiyle 10:00
exports.profileCompletionReminderMorning = onSchedule(
  { schedule: "0 10 * * *", timeZone: "Europe/Istanbul" },
  async () => {
    await sendProfileCompletionReminders();
  }
);

// Her gün Türkiye saatiyle 20:00
exports.profileCompletionReminderEvening = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Europe/Istanbul" },
  async () => {
    await sendProfileCompletionReminders();
  }
);

/* ============================================================================
   AŞAĞIDAKİ İKİ FONKSİYON, İSTEMCİ (UYGULAMA) TARAFINDA "biri uygulamayı açtığında"
   çalışan iki mantığı (eksik günleri otomatik "okumadı" doldurma ve haftalık kura
   çekimi) sunucu tarafına, saati geldiğinde KİMSE UYGULAMAYI AÇMASA BİLE otomatik
   çalışacak şekilde taşır. İstemci tarafındaki karşılıklarıyla (autoFillPastDays,
   computeWeekStats, runLottery, finalizeWeek) AYNI iş mantığını, AYNI Firestore
   alan adlarıyla uyguluyor ki istemci kodu bu kayıtları okurken hiçbir fark
   görmesin.
   ============================================================================ */

// Bu tarihten önce hiçbir gün için kayıt tutulmuyor (istemcideki CLUB_START_DATE ile birebir aynı).
const CLUB_START_DATE = "2026-07-06";

// Bugünden n gün öncesinin İstanbul takvim tarihini YYYY-MM-DD olarak verir.
function dateNDaysAgoInIstanbul(n) {
  const now = new Date();
  const ist = new Date(now.getTime() + 3 * 60 * 60 * 1000 - n * 24 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
// Bir tarih dizesine (YYYY-MM-DD) gün ekler/çıkarır.
function addDaysToDateStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function weekDatesFrom(mondayStr) {
  const arr = [];
  for (let i = 0; i < 7; i++) arr.push(addDaysToDateStr(mondayStr, i));
  return arr;
}
// Bir ISO zaman damgasını, istemcideki logicalDateStrOf ile AYNI kuralla (İstanbul saati,
// 06:00'dan önceyse bir önceki güne say) mantıksal gün dizesine çevirir. Üyelik tarihini
// hesaplamak için kullanılıyor (bir üye katılmadan önceki günler asla doldurulmaz).
function logicalDateStrFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  if (ist.getUTCHours() < 6) ist.setUTCDate(ist.getUTCDate() - 1);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Kapanmış bir gün için hiç işaretleme yapılmamış üyelere otomatik "okumadı" yazar.
// İstemcideki autoFillPastDays'in tek bir gün için çalışan sunucu karşılığı.
async function autoMarkMissedDay(dateStr) {
  if (dateStr < CLUB_START_DATE) return 0;
  const usersSnap = await db.collection("users").get();
  const toCreate = [];
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const u = userDoc.data();
    if (u.banned || u.deleted) continue;
    const joinDs = logicalDateStrFromIso(u.createdAt);
    if (joinDs && dateStr < joinDs) continue; // üye olmadan önceki günler asla doldurulmaz
    const ansRef = db.collection("days").doc(dateStr).collection("answers").doc(uid);
    const ansSnap = await ansRef.get();
    if (!ansSnap.exists) {
      toCreate.push({ ref: ansRef, data: { status: "skip", name: u.name || "", updatedAt: new Date().toISOString(), auto: true } });
    }
  }
  for (let i = 0; i < toCreate.length; i += 400) {
    const batch = db.batch();
    toCreate.slice(i, i + 400).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
  console.log(`[auto-mark] ${dateStr} için ${toCreate.length} eksik işaretleme otomatik "okumadı" olarak dolduruldu.`);
  return toCreate.length;
}

// Her gün Türkiye saatiyle 06:00: bir önceki (kapanmış) günü doldurur; olası bir önceki
// çalışmanın kaçırılmış olma ihtimaline karşı bir de önceki 2 günü tekrar kontrol eder
// (zaten işaretli günlere hiçbir şey yazılmaz, sadece boş kalanlar dolar).
exports.autoMarkMissedReading = onSchedule(
  { schedule: "0 6 * * *", timeZone: "Europe/Istanbul" },
  async () => {
    for (let i = 1; i <= 3; i++) {
      await autoMarkMissedDay(dateNDaysAgoInIstanbul(i));
    }
  }
);

const GIFT_WON_MESSAGES = [
  "🎁 Kura ona güldü, hediye kitap kazandı!",
  "🎉 Bu hafta şanslı, kitap hediyesi ona gidiyor!",
  "🎁 Hediye kurası ona çıktı!",
  "🍀 Şansı yaver gitti, kitap hediyesi kazandı!",
];
function pickGiftWonMessage() {
  return GIFT_WON_MESSAGES[Math.floor(Math.random() * GIFT_WON_MESSAGES.length)];
}
function fmtShortBackend(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${d}.${m}`;
}
function shuffleBackend(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// İstemcideki runLottery ile birebir aynı eşleştirme mantığı.
function runLotteryBackend(statsArr) {
  const eligible = statsArr.filter((s) => s.marked > 0);
  const givers = shuffleBackend(eligible.filter((s) => s.miss >= 2));
  const tier1 = shuffleBackend(eligible.filter((s) => s.miss === 0));
  const tier2 = shuffleBackend(eligible.filter((s) => s.miss === 1));
  const receiverQueue = [...tier1, ...tier2];
  const pairs = [];
  givers.forEach((g, i) => {
    if (receiverQueue.length === 0) {
      pairs.push({ giverUid: g.uid || null, giverName: g.name, receiverUid: null, receiverName: null });
      return;
    }
    const r = receiverQueue[i % receiverQueue.length];
    pairs.push({ giverUid: g.uid || null, giverName: g.name, receiverUid: r.uid || null, receiverName: r.name });
  });
  return { giverCount: givers.length, safeCount: tier1.length + tier2.length, pairs };
}
// İstemcideki computeWeekStats'ın sunucu karşılığı.
async function computeWeekStatsBackend(mondayStr) {
  const dates = weekDatesFrom(mondayStr);
  const weekMondayStr = dates[0];
  const weekSundayStr = dates[6];
  const perDate = await Promise.all(
    dates.map(async (ds) => {
      const snap = await db.collection("days").doc(ds).collection("answers").get();
      const map = {};
      snap.forEach((d) => { map[d.id] = d.data(); });
      return map;
    })
  );
  const usersSnap = await db.collection("users").get();
  const stats = [];
  usersSnap.forEach((userDoc) => {
    const uid = userDoc.id;
    const u = userDoc.data();
    if (u.banned || u.deleted) return;
    const joinDs = logicalDateStrFromIso(u.createdAt);
    if (joinDs && joinDs > weekMondayStr && joinDs <= weekSundayStr) {
      stats.push({ uid, name: u.name || "?", miss: 0, read: 0, marked: 0 });
      return;
    }
    let miss = 0, read = 0;
    perDate.forEach((map) => {
      const rec = map[uid];
      if (rec) { if (rec.status === "skip") miss++; else if (rec.status === "read") read++; }
    });
    stats.push({ uid, name: u.name || "?", miss, read, marked: miss + read });
  });
  return stats;
}
async function notifyUserBackend(uid, message, linkTab) {
  if (!uid) return;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    const prefs = (userSnap.exists && userSnap.data().notifPrefs) || {};
    const category = { gifts: "gifts", social: "social", recs: "social" }[linkTab];
    if (category && prefs[category] === false) return; // alıcı bu kategoriyi kapatmış
    let hash = 0;
    for (let i = 0; i < message.length; i++) hash = (hash * 31 + message.charCodeAt(i)) & 0xffffffff;
    const bucket = Math.floor(Date.now() / 10000);
    const docId = `${bucket}_${Math.abs(hash)}`;
    await db.collection("notifications").doc(uid).collection("items").doc(docId).set({
      message, linkTab: linkTab || null, postId: null, read: false, createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[kura] Bildirim yazılamadı:", uid, e);
  }
}
async function createPostBackend(type, data, forUid, forName) {
  try {
    await db.collection("posts").add({
      type, uid: forUid || null, name: forName || "",
      createdAt: new Date().toISOString(), commentCount: 0,
      ...data,
    });
  } catch (e) {
    console.error("[kura] Gönderi oluşturulamadı:", e);
  }
}
// İstemcideki finalizeWeek'in sunucu karşılığı: draws/{weekStart} zaten varsa hiçbir şey
// yapmaz (idempotent), yoksa kurayı çeker, sonucu yazar, kazanana/cezalıya bildirim ve
// akış gönderisi oluşturur.
async function finalizeWeekBackend(mondayStr) {
  const drawRef = db.collection("draws").doc(mondayStr);
  const existing = await drawRef.get();
  if (existing.exists) {
    console.log(`[kura] ${mondayStr} haftası için kura zaten çekilmiş, atlanıyor.`);
    return;
  }
  const stats = await computeWeekStatsBackend(mondayStr);
  const { giverCount, safeCount, pairs } = runLotteryBackend(stats);
  const weekEnd = addDaysToDateStr(mondayStr, 6);
  const data = { weekStart: mondayStr, weekEnd, giverCount, safeCount, pairs, generatedAt: new Date().toISOString() };
  let didWrite = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(drawRef);
    if (snap.exists) return;
    tx.set(drawRef, data);
    didWrite = true;
  });
  if (!didWrite) return;
  const rangeLabel = `${fmtShortBackend(mondayStr)}–${fmtShortBackend(weekEnd)}`;
  if (pairs.length === 0) {
    await createPostBackend("no_lottery", { weekLabel: rangeLabel });
  }
  for (const p of pairs) {
    if (p.giverUid) await notifyUserBackend(p.giverUid, `Kura çekildi (${rangeLabel}): cezalısın, ${p.receiverName || "—"} için kitap hediyesi vereceksin. "Hediye Kitap" sekmesine bak.`, "gifts");
    if (p.receiverUid) await notifyUserBackend(p.receiverUid, `Kura çekildi (${rangeLabel}): tebrikler, ${p.giverName} sana kitap hediye edecek! "Hediye Kitap" sekmesinden isteğini gönderebilirsin.`, "gifts");
    if (p.receiverUid) await createPostBackend("gift_won", { variantText: pickGiftWonMessage() }, p.receiverUid, p.receiverName);
  }
  console.log(`[kura] ${mondayStr} haftası kapatıldı. giverCount=${giverCount} safeCount=${safeCount} pairs=${pairs.length}`);
}

// Her Pazartesi Türkiye saatiyle 06:00: bir önceki haftanın (Pazartesi-Pazar) kurasını çeker.
exports.weeklyLotteryDraw = onSchedule(
  { schedule: "0 6 * * 1", timeZone: "Europe/Istanbul" },
  async () => {
    const thisMonday = dateNDaysAgoInIstanbul(0); // fonksiyon tam Pazartesi 06:00'da çalışıyor
    const prevMonday = addDaysToDateStr(thisMonday, -7);
    await finalizeWeekBackend(prevMonday);
  }
);
