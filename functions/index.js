const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const authAdmin = getAuth();

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
    await settleDailyBadges();
  }
);

const BADGE_DEFS_BACKEND = [
  { key: "b3", days: 3, icon: "🔥", label: "3 gün aralıksız seri" },
  { key: "b5", days: 5, icon: "⭐", label: "5 gün aralıksız seri" },
  { key: "b7", days: 7, icon: "🎯", label: "1 hafta aralıksız seri" },
  { key: "b14", days: 14, icon: "💎", label: "2 hafta aralıksız seri" },
  { key: "b21", days: 21, icon: "🏆", label: "3 hafta aralıksız seri" },
  { key: "b30", days: 30, icon: "🐺", label: "Kitap Kurdu (1 ay aralıksız seri)" },
];
function currentTierForStreakBackend(streak) {
  let tier = null;
  BADGE_DEFS_BACKEND.forEach((def) => { if (streak >= def.days) tier = def.key; });
  return tier;
}
// Bir kullanıcının DÜN akşamı itibariyle (artık kesinleşmiş, değişemeyecek) kaç gündür
// aralıksız okuduğunu hesaplar — istemcideki computeStreak'in "dünden geriye" sunucu karşılığı.
async function computeStreakBackend(uid, maxDays) {
  maxDays = maxDays || 60;
  const yesterday = dateNDaysAgoInIstanbul(1);
  const dates = [];
  for (let i = 0; i <= maxDays; i++) dates.push(addDaysToDateStr(yesterday, -i));
  const snaps = await Promise.all(dates.map((ds) => db.collection("days").doc(ds).collection("answers").doc(uid).get().catch(() => null)));
  let streak = 0;
  for (const snap of snaps) {
    if (snap && snap.exists && snap.data().status === "read") streak++;
    else break;
  }
  return streak;
}
async function backendCheckAndPostDethrone(usersMap, uid, newCount, getOthersCount, label, icon) {
  let maxUid = null, maxCount = 0;
  for (const ouid of Object.keys(usersMap)) {
    if (ouid === uid || usersMap[ouid].banned) continue;
    const c = getOthersCount(ouid) || 0;
    if (c > maxCount) { maxCount = c; maxUid = ouid; }
  }
  if (maxUid && newCount > maxCount) {
    const u = usersMap[uid];
    await createPostBackend("record_dethrone", { recordLabel: label, recordIcon: icon || "🏆", recordCount: newCount, dethronedName: usersMap[maxUid]?.name || "" }, uid, u.name);
  }
}
// Bir günün kapanmasıyla (06:00) o güne kadarki serinin GERÇEKTEN bozulup bozulmadığı burada
// kesinleşiyor. İstemci tarafı artık sadece YUKARI (yeni bir eşiğe ulaşma) anlık bildirimi
// gönderiyor; seri düşüşünü (rozet geçmişine kalıcı ekleme + "seri bozuldu" gönderisi) BİLEREK
// burada, güne ait tüm işaretlemeler kesinleştikten sonra yapıyoruz — böylece biri aynı gün
// içinde bir yanlışlığı (örn. yanlışlıkla "okumadım" işaretleyip hemen düzeltmesi) düzeltirse,
// bu hiçbir zaman kalıcı bir rozet/gönderiye dönüşmez.
async function settleDailyBadges() {
  const usersSnap = await db.collection("users").get();
  const usersMap = {};
  usersSnap.forEach((d) => { usersMap[d.id] = d.data(); });
  for (const uid of Object.keys(usersMap)) {
    const u = usersMap[uid];
    if (u.banned || u.deleted) continue;
    const streak = await computeStreakBackend(uid);
    const lastStreak = typeof u.lastStreak === "number" ? u.lastStreak : 0;
    const prevTier = u.currentTier || null;
    const newTier = currentTierForStreakBackend(streak);
    if (streak === lastStreak && prevTier === newTier) continue;

    if (streak < lastStreak) {
      const badgeCounts = { ...(u.badgeCounts || {}) };
      let historyIncremented = false;
      if (prevTier) {
        badgeCounts[prevTier] = (badgeCounts[prevTier] || 0) + 1;
        historyIncremented = true;
      }
      await db.collection("users").doc(uid).update({ lastStreak: streak, badgeCounts, currentTier: newTier, currentStreak: streak });
      usersMap[uid] = { ...u, lastStreak: streak, badgeCounts, currentTier: newTier, currentStreak: streak };
      if (historyIncremented && prevTier) {
        const lostDef = BADGE_DEFS_BACKEND.find((d) => d.key === prevTier);
        if (lostDef) {
          await createPostBackend("badge_lost", { badgeKey: lostDef.key, badgeLabel: lostDef.label, badgeIcon: lostDef.icon }, uid, u.name);
          await backendCheckAndPostDethrone(usersMap, uid, badgeCounts[lostDef.key] || 1, (ouid) => (usersMap[ouid].badgeCounts || {})[lostDef.key], `${lostDef.label} rozeti`, lostDef.icon);
        }
      }
    } else if (newTier && newTier !== prevTier) {
      // İstemci genelde bunu anlık yakalar; burası sadece kullanıcı hiç uygulamayı açmadan
      // eşiği aştıysa devreye giren bir güvenlik ağı.
      await db.collection("users").doc(uid).update({ lastStreak: streak, currentTier: newTier, currentStreak: streak });
      usersMap[uid] = { ...u, lastStreak: streak, currentTier: newTier, currentStreak: streak };
      const notifyDef = BADGE_DEFS_BACKEND.find((d) => d.key === newTier);
      if (notifyDef) {
        await notifyUserBackend(uid, `🎉 Tebrikler! "${notifyDef.label}" rozetini kazandın!`, u.role === "admin" ? "worms" : "mworms");
        await createPostBackend("badge_gained", { badgeKey: notifyDef.key, badgeLabel: notifyDef.label, badgeIcon: notifyDef.icon }, uid, u.name);
      }
    }
  }
}

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
// Ağırlıklı havuzdan (birisinin şansını tamamen elemeden azaltarak) rastgele birini seçip
// havuzdan çıkarır. İstemcideki weightedPickWithoutReplacement ile birebir aynı.
function weightedPickWithoutReplacementBackend(pool) {
  const totalWeight = pool.reduce((sum, r) => sum + r.weight, 0);
  let rnd = Math.random() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    rnd -= pool[i].weight;
    if (rnd <= 1e-9) return pool.splice(i, 1)[0];
  }
  return pool.splice(pool.length - 1, 1)[0];
}
function buildWeightedPoolBackend(list, previousWinners) {
  return list.map((s) => ({ ...s, weight: previousWinners && previousWinners.has(s.uid) ? 0.8 : 1 }));
}
// İstemcideki runLottery ile birebir aynı eşleştirme mantığı: tier1 (kusursuz) tamamen
// tükenmeden tier2'ye (1 pas) geçilmez; bir önceki haftanın kazananlarının bu haftaki alıcı
// olma şansı %20 azaltılır (elenmez, sadece ağırlığı düşer).
function runLotteryBackend(statsArr, previousWinners) {
  const eligible = statsArr.filter((s) => s.marked > 0);
  const givers = shuffleBackend(eligible.filter((s) => s.miss >= 2));
  const tier1Base = shuffleBackend(eligible.filter((s) => s.miss === 0));
  const tier2Base = shuffleBackend(eligible.filter((s) => s.miss === 1));
  const safeCount = tier1Base.length + tier2Base.length;
  let tier1Pool = buildWeightedPoolBackend(tier1Base, previousWinners);
  let tier2Pool = buildWeightedPoolBackend(tier2Base, previousWinners);
  const pairs = [];
  givers.forEach((g) => {
    if (safeCount === 0) {
      pairs.push({ giverUid: g.uid || null, giverName: g.name, receiverUid: null, receiverName: null });
      return;
    }
    if (tier1Pool.length === 0 && tier2Pool.length === 0) {
      tier1Pool = buildWeightedPoolBackend(tier1Base, previousWinners);
      tier2Pool = buildWeightedPoolBackend(tier2Base, previousWinners);
    }
    const r = tier1Pool.length > 0 ? weightedPickWithoutReplacementBackend(tier1Pool) : weightedPickWithoutReplacementBackend(tier2Pool);
    pairs.push({ giverUid: g.uid || null, giverName: g.name, receiverUid: r.uid || null, receiverName: r.name });
  });
  return { giverCount: givers.length, safeCount, pairs };
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
  // Bir önceki haftanın kazananlarını (alıcılarını) çek — bu haftaki alıcı seçiminde onların
  // şansını %20 azaltmak için.
  const prevMondayStr = addDaysToDateStr(mondayStr, -7);
  const prevDrawSnap = await db.collection("draws").doc(prevMondayStr).get();
  const previousWinners = new Set();
  if (prevDrawSnap.exists) {
    (prevDrawSnap.data().pairs || []).forEach((p) => { if (p.receiverUid) previousWinners.add(p.receiverUid); });
  }
  const stats = await computeWeekStatsBackend(mondayStr);
  const { giverCount, safeCount, pairs } = runLotteryBackend(stats, previousWinners);
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

// Bir üyeyi TAMAMEN siler: Firebase Auth hesabı, users/{uid} belgesi ve kişiye özel alt
// koleksiyonları (Okuduklarım, Okumak İstediklerim, Kitap Geçmişim, bildirimler). Bu, istemci
// tarafından yapılamıyor çünkü Firebase bir kullanıcının BAŞKA birinin Auth hesabını silmesine
// izin vermiyor — bunu yalnızca Admin SDK (yani bir Cloud Function) yapabilir. Geri alınamaz;
// istemci tarafında ekstra bir "geri yükle" mekanizması yok.
// NOT: paylaşılan geçmiş kayıtlar (days/{tarih}/answers/{uid}, eski gönderiler) BİLEREK
// silinmiyor — onlar haftalık istatistik/rozet/kura geçmişinin bir parçası, silinirse geçmiş
// haftaların hesapları bozulur. Sadece kişinin KENDİ profili ve kişisel verileri siliniyor.
exports.adminDeleteMember = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Giriş yapmış olmalısın.");

  const callerSnap = await db.collection("users").doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Bu işlem için yönetici olman gerekiyor.");
  }

  const targetUid = request.data && request.data.targetUid;
  if (!targetUid || typeof targetUid !== "string") {
    throw new HttpsError("invalid-argument", "targetUid gerekli.");
  }
  if (targetUid === callerUid) {
    throw new HttpsError("invalid-argument", "Kendi hesabını buradan silemezsin.");
  }

  const targetRef = db.collection("users").doc(targetUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "Kullanıcı bulunamadı (zaten silinmiş olabilir).");
  }
  const targetData = targetSnap.data();
  if (targetData.isOwner) {
    throw new HttpsError("permission-denied", "Kulübün sahibini silemezsin.");
  }

  // Kişisel alt koleksiyonları sil.
  for (const sub of ["readBooks", "wantToRead", "bookHistory"]) {
    const subSnap = await targetRef.collection(sub).get();
    if (!subSnap.empty) {
      const batch = db.batch();
      subSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  // Bildirimlerini sil.
  const notifSnap = await db.collection("notifications").doc(targetUid).collection("items").get();
  if (!notifSnap.empty) {
    const batch = db.batch();
    notifSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  // Asıl profil belgesini sil.
  await targetRef.delete();
  // Firebase Auth hesabını sil (giriş yapamaz hale gelir).
  try {
    await authAdmin.deleteUser(targetUid);
  } catch (e) {
    console.error(`[adminDeleteMember] ${targetUid} için Auth hesabı silinemedi:`, e);
    // Firestore verisi zaten silindi; Auth silinemese de devam ediyoruz — biri bu hesapla
    // tekrar giriş yaparsa mevcut giriş akışı zaten "profil yoksa yeniden oluştur" mantığına
    // sahip, yani sıfırdan yeni bir üye gibi başlar.
  }

  console.log(`[adminDeleteMember] ${targetUid} (${targetData.name || ""}) tamamen silindi. İşlemi yapan: ${callerUid}.`);
  return { success: true };
});

/* ============================================================================
   3 AYLIK ORTAK KİTAP SEÇİMİ (turnuva usulü oylama)
   Tüm faz geçişleri (öneri → itiraz → oylama turları → okuma → yeniden başlama) burada,
   15 dakikada bir çalışan tek bir "tick" fonksiyonuyla yönetiliyor — kimse uygulamayı
   açmasa bile zamanı gelince otomatik ilerliyor. Öneri gönderme, itiraz etme ve oy verme
   istemci tarafında (Firestore transaction ile) yapılıyor; burada sadece SÜREYE bağlı
   geçişler var.
   ============================================================================ */

const QP_NOMINATION_DAYS = 2;
const QP_OBJECTION_DAYS = 1;
const QP_VOTING_ROUND_DAYS = 1;
const QP_NEAR_END_HOURS = 2;
const QP_READING_MONTHS = 3;

function addHoursIso(iso, hours) {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}
function addDaysIso(iso, days) {
  return addHoursIso(iso, days * 24);
}
function addMonthsIso(iso, months) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}
// 4-7 öneri → 4'lük parantez, 8-15 → 8'lik, 16-31 → 16'lık ... (kullanıcının tarif ettiği kural,
// 2-3 öneri için de aynı mantıkla 2'lik parantezle genişletilmiş).
function bracketSizeForCount(n) {
  if (n < 2) return n;
  let size = 2;
  while (size * 2 <= n) size *= 2;
  return size;
}
async function notifyAllBackend(message, linkTab) {
  const usersSnap = await db.collection("users").get();
  await Promise.all(usersSnap.docs.map((d) => {
    const u = d.data();
    if (u.banned) return null;
    return notifyUserBackend(d.id, message, linkTab);
  }));
}
// Sistem tarafından (kimse tetiklemeden, otomatik) oluşturulan tüm ortak-kitap-seçimi
// gönderileri, anonim/isimsiz görünmesin diye kulüp sahibinin hesabı üzerinden gönderiliyor.
const QP_OWNER_UID = "ZqooOlqf0fafVe8HSzmbg2fyCJJ3";
let qpOwnerNameCache = null;
async function qpOwnerName() {
  if (qpOwnerNameCache) return qpOwnerNameCache;
  try {
    const snap = await db.collection("users").doc(QP_OWNER_UID).get();
    qpOwnerNameCache = (snap.exists && snap.data().name) || "Furkan";
  } catch (e) {
    qpOwnerNameCache = "Furkan";
  }
  return qpOwnerNameCache;
}
async function postQuarterly(subtype, data) {
  await createPostBackend("quarterly_pick", { subtype, ...data }, QP_OWNER_UID, await qpOwnerName());
}
const QP_REF = () => db.collection("quarterlyPick").doc("current");

async function qpStartNominationPhase(prevData) {
  const now = new Date().toISOString();
  const cycleNumber = prevData ? (prevData.cycleNumber || 0) + 1 : 1;
  await QP_REF().set({
    phase: "nominating",
    cycleNumber,
    phaseStartedAt: now,
    phaseEndsAt: addDaysIso(now, QP_NOMINATION_DAYS),
    nearEndPosted: false,
  });
  await postQuarterly("nominations_open", { days: QP_NOMINATION_DAYS });
  await notifyAllBackend(`📚 Yeni ortak kitap önerileri başladı! ${QP_NOMINATION_DAYS} gün içinde en fazla 3 kitap önerebilirsin.`, "recs");
}

async function qpArchiveAndRestart(data) {
  await db.collection("quarterlyPickHistory").doc(String(data.cycleNumber)).set({
    cycleNumber: data.cycleNumber,
    winnerTitle: data.winnerTitle || null,
    winnerAuthor: data.winnerAuthor || null,
    winnerCover: data.winnerCover || null,
    winnerNominatedByName: data.winnerNominatedByName || null,
    readingStartedAt: data.readingStartedAt || null,
    readingEndsAt: data.readingEndsAt || null,
    finishedAt: new Date().toISOString(),
  });
  const nomSnap = await QP_REF().collection("nominations").get();
  if (!nomSnap.empty) {
    const batch = db.batch();
    nomSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const roundDocs = await QP_REF().collection("rounds").listDocuments();
  for (const roundDoc of roundDocs) {
    const matchesSnap = await roundDoc.collection("matches").get();
    if (!matchesSnap.empty) {
      const batch = db.batch();
      matchesSnap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await qpStartNominationPhase(data);
}

async function qpFinalizeNominating() {
  const now = new Date().toISOString();
  await QP_REF().update({
    phase: "objecting",
    phaseStartedAt: now,
    phaseEndsAt: addDaysIso(now, QP_OBJECTION_DAYS),
    nearEndPosted: false,
  });
  await postQuarterly("objecting_open", { days: QP_OBJECTION_DAYS });
  await notifyAllBackend(`🔎 1 günlük itiraz süresi başladı! Yakın zamanda okuduğun bir öneri varsa "Öneriler" sekmesinden itiraz edebilirsin.`, "recs");
}

async function qpFinalizeObjecting(data) {
  const nomSnap = await QP_REF().collection("nominations").where("status", "==", "active").get();
  const activeNoms = nomSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const bracketSize = bracketSizeForCount(activeNoms.length);

  if (bracketSize < 2) {
    if (activeNoms.length === 1) {
      const only = activeNoms[0];
      const now = new Date().toISOString();
      await QP_REF().update({
        phase: "reading",
        winnerTitle: only.bookTitle, winnerAuthor: only.bookAuthor || "", winnerCover: only.bookCover || "",
        winnerNominatedBy: only.uid, winnerNominatedByName: only.name || "",
        readingStartedAt: now, readingEndsAt: addMonthsIso(now, QP_READING_MONTHS),
      });
      await postQuarterly("final_winner", { bookTitle: only.bookTitle, bookAuthor: only.bookAuthor || "", bookCover: only.bookCover || "" });
      await notifyAllBackend(`🏆 Yeni ortak kitap seçildi: "${only.bookTitle}"! 3 ay boyunca bunu okuyacağız.`, "recs");
    } else {
      await qpStartNominationPhase(data);
    }
    return;
  }

  const chosen = shuffleBackend(activeNoms).slice(0, bracketSize);
  const bracketOrder = shuffleBackend(chosen);
  const totalRounds = Math.log2(bracketSize);
  const now = new Date().toISOString();

  const batch = db.batch();
  for (let i = 0; i < bracketOrder.length; i += 2) {
    const a = bracketOrder[i], b = bracketOrder[i + 1];
    const matchRef = QP_REF().collection("rounds").doc("1").collection("matches").doc(`m${i / 2}`);
    batch.set(matchRef, {
      slotA: { uid: a.uid, name: a.name, bookTitle: a.bookTitle, bookAuthor: a.bookAuthor || "", bookCover: a.bookCover || "" },
      slotB: { uid: b.uid, name: b.name, bookTitle: b.bookTitle, bookAuthor: b.bookAuthor || "", bookCover: b.bookCover || "" },
      votesA: [], votesB: [], winnerSlot: null,
    });
  }
  await batch.commit();

  await QP_REF().update({
    phase: "voting", round: 1, totalRounds, bracketSize,
    phaseStartedAt: now, phaseEndsAt: addDaysIso(now, QP_VOTING_ROUND_DAYS), nearEndPosted: false,
  });
  await postQuarterly("round_start", { round: 1, totalRounds, bracketSize, matchCount: bracketOrder.length / 2 });
  await notifyAllBackend(`🗳️ Ortak kitap turnuvası başladı! ${bracketSize} kitap arasından oylamalar açıldı.`, "recs");
}

async function qpFinalizeRound(data) {
  const roundRef = QP_REF().collection("rounds").doc(String(data.round));
  const matchesSnap = await roundRef.collection("matches").get();
  const results = matchesSnap.docs.map((d) => {
    const m = d.data();
    const aVotes = (m.votesA || []).length, bVotes = (m.votesB || []).length;
    let winner;
    if (aVotes > bVotes) winner = m.slotA;
    else if (bVotes > aVotes) winner = m.slotB;
    else winner = Math.random() < 0.5 ? m.slotA : m.slotB;
    return { winner, aVotes, bVotes, slotATitle: m.slotA.bookTitle, slotBTitle: m.slotB.bookTitle };
  });

  if (data.round >= data.totalRounds) {
    const winner = results[0].winner;
    const now = new Date().toISOString();
    await QP_REF().update({
      phase: "reading",
      winnerTitle: winner.bookTitle, winnerAuthor: winner.bookAuthor || "", winnerCover: winner.bookCover || "",
      winnerNominatedBy: winner.uid, winnerNominatedByName: winner.name || "",
      readingStartedAt: now, readingEndsAt: addMonthsIso(now, QP_READING_MONTHS),
    });
    await postQuarterly("final_winner", { bookTitle: winner.bookTitle, bookAuthor: winner.bookAuthor || "", bookCover: winner.bookCover || "" });
    await notifyAllBackend(`🏆 Yeni ortak kitap seçildi: "${winner.bookTitle}"! 3 ay boyunca bunu okuyacağız.`, "recs");
    return;
  }

  const nextRound = data.round + 1;
  const winners = results.map((r) => r.winner);
  const nextRoundRef = QP_REF().collection("rounds").doc(String(nextRound));
  const batch = db.batch();
  for (let i = 0; i < winners.length; i += 2) {
    const matchRef = nextRoundRef.collection("matches").doc(`m${i / 2}`);
    batch.set(matchRef, { slotA: winners[i], slotB: winners[i + 1], votesA: [], votesB: [], winnerSlot: null });
  }
  await batch.commit();

  const now = new Date().toISOString();
  await QP_REF().update({
    round: nextRound, phaseStartedAt: now, phaseEndsAt: addDaysIso(now, QP_VOTING_ROUND_DAYS), nearEndPosted: false,
  });
  await postQuarterly("round_result", { round: data.round, results: results.map((r) => ({ title: r.winner.bookTitle, aTitle: r.slotATitle, bTitle: r.slotBTitle, aVotes: r.aVotes, bVotes: r.bVotes })) });
  await postQuarterly("round_start", { round: nextRound, totalRounds: data.totalRounds, matchCount: winners.length / 2 });
  await notifyAllBackend("🗳️ Yeni tur başladı! Oy vermeyi unutma.", "recs");
}

exports.quarterlyPickTick = onSchedule(
  { schedule: "*/15 * * * *", timeZone: "Europe/Istanbul" },
  async () => {
    const snap = await QP_REF().get();
    if (!snap.exists) {
      await qpStartNominationPhase(null);
      return;
    }
    const data = snap.data();
    const now = new Date();

    if (data.phase === "reading") {
      if (data.readingEndsAt && now >= new Date(data.readingEndsAt)) {
        await qpArchiveAndRestart(data);
      }
      return;
    }

    if (!data.phaseEndsAt) return;
    const endsAt = new Date(data.phaseEndsAt);

    if (!data.nearEndPosted && now >= new Date(endsAt.getTime() - QP_NEAR_END_HOURS * 60 * 60 * 1000)) {
      await QP_REF().update({ nearEndPosted: true });
      if (data.phase === "nominating") await postQuarterly("nominations_near_end", {});
      else if (data.phase === "objecting") await postQuarterly("objecting_near_end", {});
      else if (data.phase === "voting") await postQuarterly("round_near_end", { round: data.round });
    }

    if (now >= endsAt) {
      if (data.phase === "nominating") await qpFinalizeNominating();
      else if (data.phase === "objecting") await qpFinalizeObjecting(data);
      else if (data.phase === "voting") await qpFinalizeRound(data);
    }
  }
);
