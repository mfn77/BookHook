/* ============ BİLDİRİM SİSTEMİ (uygulama içi) ============ */

import {
  arrayUnion, collection, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getMessaging, getToken, onMessage, isSupported as isMessagingSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { openPostModal } from "./feed.js";
// app.js ile karşılıklı import: buradaki kod bu adları sadece fonksiyonların içinde (uygulama
// açıldıktan sonra) kullanıyor, dosya yüklenirken değil; bu yüzden güvenli.
import {
  FCM_VAPID_KEY, activeTab, app, closeModal, currentUid, db, escapeHtml, keepOrLoading, markLoaded,
  pad, renderTab, resolveNotifTab, showToast, switchTab, usersCache
} from "./app.js";

const NOTIF_CATEGORY_BY_TAB = { gifts:'gifts', social:'social', recs:'social' };
export async function notifyUser(uid, message, linkTab, postId){
  if(!uid) return;
  const category = NOTIF_CATEGORY_BY_TAB[linkTab];
  if(category){
    const recipient = usersCache[uid];
    const prefs = (recipient && recipient.notifPrefs) || {};
    if(prefs[category] === false) return; // alıcı bu kategoriyi kapatmış
  }
  try{
    // Aynı mesajın kısa süre içinde tekrar yazılmasını, OKUMA izni gerektirmeyen bir yöntemle
    // engelliyoruz: mesaj + zaman dilimine göre sabit bir belge kimliği üretip setDoc ile yazıyoruz.
    // Aynı kimlikle ikinci bir yazma denemesi olursa (kısa sürede tekrar tetiklenmişse), ya aynı
    // belgenin üzerine yazılır (tekrar yok) ya da (başka biri deniyorsa) kurallar zaten reddeder —
    // ikisi de sonuçta çift bildirim oluşmasını engeller. Alıcının kendi bildirimlerini önceden
    // OKUMAMIZ gerekmediği için, gönderen kim olursa olsun (kendisi veya başka biri) çalışır.
    let hash = 0;
    for(let i=0;i<message.length;i++) hash = (hash*31 + message.charCodeAt(i)) & 0xffffffff;
    const bucket = Math.floor(Date.now()/10000);
    const docId = `${bucket}_${Math.abs(hash)}`;
    await setDoc(doc(db,'notifications',uid,'items',docId), { message, linkTab: linkTab||null, postId: postId||null, read:false, createdAt:new Date().toISOString() });
  }catch(e){ console.error('Bildirim gönderilemedi (notifyUser):', uid, e); }
}
export async function notifyAdmins(message, linkTab){
  const adminUids = Object.keys(usersCache).filter(u=>usersCache[u].role==='admin' && !usersCache[u].banned);
  await Promise.all(adminUids.map(uid=>notifyUser(uid,message,linkTab)));
}
export async function notifyAllMembers(message, linkTab, excludeUid){
  const uids = Object.keys(usersCache).filter(u=> u!==excludeUid && !usersCache[u].banned);
  await Promise.all(uids.map(uid=>notifyUser(uid,message,linkTab)));
}
let unsubNotifs = null;
// Çıkış yapılınca app.js bildirim aboneliğini buradan kapatıyor.
export function unsubscribeNotifs(){ if(unsubNotifs){ unsubNotifs(); unsubNotifs=null; } }
export function subscribeNotifs(){
  if(unsubNotifs) unsubNotifs();
  unsubNotifs = onSnapshot(collection(db,'notifications',currentUid,'items'), (snap)=>{
    let unread=0;
    snap.forEach(d=>{ if(!d.data().read) unread++; });
    const badge = document.getElementById('hamburgerBadge');
    if(unread>0){ badge.style.display='inline-block'; badge.textContent = unread>99?'99+':String(unread); }
    else { badge.style.display='none'; }
    if(document.getElementById('notifModal').style.display==='flex') renderNotifsTab();
  });
}
export function openNotifModal(){
  document.getElementById('notifModal').style.display='flex';
  renderNotifsTab();
}

/* ============ GERÇEK TELEFON BİLDİRİMİ (Firebase Cloud Messaging) ============ */
async function registerPushToken(){
  const swReg = await navigator.serviceWorker.register('./sw.js');
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: swReg });
  if(token){
    await updateDoc(doc(db,'users',currentUid), { fcmTokens: arrayUnion(token) }).catch(()=>{});
  }
  onMessage(messaging, (payload)=>{
    // Uygulama açıkken gelen bildirimler (foreground) tarayıcı tarafından otomatik gösterilmez, biz gösteriyoruz.
    const title = payload.data?.title || 'BookHook';
    const body = payload.data?.body || '';
    showToast(`🔔 ${body || title}`);
    if(activeTab) renderTab(activeTab);
  });
}
// Girişte sessizce çalışır: izin ZATEN verilmişse token'ı tazeler. İzin isteme (requestPermission)
// tarayıcı kısıtlaması yüzünden burada YAPILMAZ — o yalnızca "Bildirimleri Aç" butonuyla, doğrudan
// bir tıklama içinde tetiklenmeli, yoksa tarayıcı sessizce reddediyor.
export async function setupPushNotifications(){
  try{
    const supported = await isMessagingSupported();
    if(!supported) return;
    if(FCM_VAPID_KEY.includes('BURAYA_')) return;
    if(Notification.permission !== 'granted') return;
    await registerPushToken();
  }catch(e){ /* push kurulamazsa uygulama içi bildirimler zaten çalışmaya devam eder */ }
}
// Kullanıcının doğrudan tıklamasıyla çalışır — izin isteme burada, tıklamanın hemen içinde yapılır.
export async function enablePushNotifications(){
  try{
    const supported = await isMessagingSupported();
    if(!supported){ alert(window.BH_I18N.pick("Bu tarayıcı telefon bildirimlerini desteklemiyor.","This browser does not support push notifications.")); return; }
    if(FCM_VAPID_KEY.includes('BURAYA_')){ alert('VAPID anahtarı henüz ayarlanmamış.'); return; }
    if(Notification.permission === 'denied'){
      alert(window.BH_I18N.pick("Bu site için bildirimleri daha önce reddetmişsin. Tarayıcının adres çubuğundaki kilit/site bilgisi simgesinden bildirim iznini \"İzin ver\" yapıp tekrar dene.","Notifications were previously blocked. Allow notifications in your browser’s site settings and try again."));
      return;
    }
    if(Notification.permission === 'default'){
      const perm = await Notification.requestPermission();
      if(perm !== 'granted'){ showToast('Bildirim izni verilmedi.'); renderNotifsTab(); return; }
    }
    await registerPushToken();
    showToast(window.BH_I18N.pick("Bildirimler Açık","Notifications enabled"));
    renderNotifsTab();
  }catch(e){ alert(window.BH_I18N.pick("Bildirimler açılamadı: ","Could not enable notifications: ") + (e.message||e)); }
}
async function renderNotifsTab(){
  const statusNote = document.getElementById('pushStatusNote');
  const enableBtn = document.getElementById('enablePushBtn');
  if(!('Notification' in window)){
    statusNote.textContent = window.BH_I18N.pick("Bu tarayıcı telefon bildirimlerini desteklemiyor.","This browser does not support push notifications.");
    enableBtn.style.display = 'none';
  } else if(Notification.permission === 'granted'){
    statusNote.textContent = window.BH_I18N.pick("Bildirimler Açık","Notifications enabled");
    enableBtn.style.display = 'none';
  } else if(Notification.permission === 'denied'){
    statusNote.textContent = window.BH_I18N.pick("Bildirimler bu site için reddedilmiş. Adres çubuğundaki site simgesinden izni değiştirip sayfayı yenile.","Notifications are blocked for this site. Change the permission in your browser’s site settings and reload.");
    enableBtn.style.display = 'none';
  } else {
    statusNote.textContent = window.BH_I18N.pick("Telefon bildirimleri henüz açık değil.","Push notifications are not enabled yet.");
    enableBtn.style.display = 'inline-block';
  }

  const box = keepOrLoading('notifsList');
  let snap;
  // Sorgu başarısız olursa (ör. ağ henüz hazır değil) ekrandaki mevcut/önbellekli görünümü
  // "yüklenemedi" ile ezip bunu kalıcı önbelleğe yazmıyoruz — aksi halde geçici bir hata,
  // bir sonraki başarılı yüklemeye kadar kalıcı olarak yanlış bir durumu gösterirdi.
  try{ snap = await getDocs(query(collection(db,'notifications',currentUid,'items'), orderBy('createdAt','desc'), limit(50))); }
  catch(e){ return; }
  const items = [];
  snap.forEach(d=> items.push({id:d.id, ref:d.ref, ...d.data()}));
  if(items.length===0){ box.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">🔔</span>Henüz bildirim yok.</div>`; markLoaded(box); return; }
  box.innerHTML = items.map(it=>{
    const dt = new Date(it.createdAt);
    const dtLabel = isNaN(dt.getTime()) ? '' : `${pad(dt.getDate())}.${pad(dt.getMonth()+1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    const clickable = it.linkTab ? ' style="cursor:pointer;" data-notif-id="'+it.id+'" data-notif-tab="'+it.linkTab+'"'+(it.postId?' data-notif-post="'+it.postId+'"':'') : '';
    return `<div class="member-row notif-row" style="display:block; ${it.read?'opacity:0.55;':''}"${clickable}>
      <div class="muted mono" style="font-size:10.5px;">${dtLabel}</div>
      <div>${escapeHtml(it.message)}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('.notif-row[data-notif-tab]').forEach(row=>{
    row.addEventListener('click', async ()=>{
      const tab = resolveNotifTab(row.dataset.notifTab);
      const id = row.dataset.notifId;
      const postId = row.dataset.notifPost;
      try{ await updateDoc(doc(db,'notifications',currentUid,'items',id), {read:true}); }catch(e){}
      closeModal('notifModal');
      if(document.getElementById('tab-'+tab)) switchTab(tab);
      if(postId) setTimeout(()=> openPostModal(postId), 250);
    });
  });
  markLoaded(box);
}

export function initNotifications(){
  document.getElementById('notifModalClose').addEventListener('click', ()=>{ closeModal('notifModal'); });
  document.getElementById('notifModal').addEventListener('click', (e)=>{ if(e.target.id==='notifModal') closeModal('notifModal'); });
  document.getElementById('enablePushBtn').addEventListener('click', enablePushNotifications);
  document.getElementById('markAllReadBtn').addEventListener('click', async ()=>{
    let snap;
    try{ snap = await getDocs(collection(db,'notifications',currentUid,'items')); }catch(e){ return; }
    await Promise.all(snap.docs.map(d=> updateDoc(d.ref, {read:true}).catch(()=>{})));
    renderNotifsTab();
  });
}
