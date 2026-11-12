/* In-app notifications, unread counts, and phone notifications through Firebase Cloud Messaging. */

import {
  arrayUnion, collection, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getMessaging, getToken, onMessage, isSupported as isMessagingSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { openPostModal } from "./feed.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import {
  FCM_VAPID_KEY, activeTab, app, closeModal, currentUid, db, escapeHtml, keepOrLoading, markLoaded,
  pad, renderTab, resolveNotifTab, showToast, switchTab, usersCache
} from "./app.js";

const NOTIF_CATEGORY_BY_TAB = { gifts:'gifts', social:'social', recs:'social' };
/*
 * Creates an in-app notification; the server also sends it to the member's phone unless push is false
 * (see sendPushOnNotification).
 */
export async function notifyUser(uid, message, linkTab, postId, { push = true } = {}){
  if(!uid) return;
  const category = NOTIF_CATEGORY_BY_TAB[linkTab];
  if(category){
    const recipient = usersCache[uid];
    const prefs = (recipient && recipient.notifPrefs) || {};
    if(prefs[category] === false) return; // the recipient turned this category off
  }
  try{
    /*
     * Deduplicate without reading the recipient's notifications: the document id is derived from the
     * message and a time bucket, so sending the same message again shortly afterwards overwrites the same
     * document (or is rejected by the rules) instead of adding a duplicate.
     */
    let hash = 0;
    for(let i=0;i<message.length;i++) hash = (hash*31 + message.charCodeAt(i)) & 0xffffffff;
    const bucket = Math.floor(Date.now()/10000);
    const docId = `${bucket}_${Math.abs(hash)}`;
    await setDoc(doc(db,'notifications',uid,'items',docId), { message, linkTab: linkTab||null, postId: postId||null, read:false, createdAt:new Date().toISOString(), ...(push ? {} : { push:false }) });
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
// Called by app.js on sign-out.
export function unsubscribeNotifs(){ if(unsubNotifs){ unsubNotifs(); unsubNotifs=null; } }
/*
 * The unread badge only needs unread notifications, and never more than it can show ("99+"). Listening
 * to the whole collection would download every notification the member ever received on each start.
 */
const UNREAD_BADGE_LIMIT = 100;
const unreadNotifsQuery = (max)=> query(collection(db,'notifications',currentUid,'items'), where('read','==',false), limit(max));
function showUnreadBadge(unread){
  const badge = document.getElementById('hamburgerBadge');
  if(unread>0){ badge.style.display='inline-block'; badge.textContent = unread>99?'99+':String(unread); }
  else { badge.style.display='none'; }
}
let notifsRenderTimer = null;
export function subscribeNotifs(){
  if(unsubNotifs) unsubNotifs();
  unsubNotifs = onSnapshot(unreadNotifsQuery(UNREAD_BADGE_LIMIT), (snap)=>{
    showUnreadBadge(snap.size);
    // Several changes can arrive close together (marking all as read); refresh the open list once.
    clearTimeout(notifsRenderTimer);
    notifsRenderTimer = setTimeout(()=>{
      if(document.getElementById('notifModal').style.display==='flex') renderNotifsTab();
    }, 250);
  });
}
export function openNotifModal(){
  document.getElementById('notifModal').style.display='flex';
  renderNotifsTab();
}

/* Phone (push) notifications via Firebase Cloud Messaging */
async function registerPushToken(){
  const swReg = await navigator.serviceWorker.register('./sw.js');
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: swReg });
  if(token){
    await updateDoc(doc(db,'users',currentUid), { fcmTokens: arrayUnion(token) }).catch(()=>{});
  }
  onMessage(messaging, (payload)=>{
    // Browsers don't display push messages that arrive while the app is open, so show a toast.
    const title = payload.data?.title || 'BookHook';
    const body = payload.data?.body || '';
    showToast(`🔔 ${body || title}`);
    if(activeTab) renderTab(activeTab);
  });
}
/*
 * Runs at sign-in: refreshes the push token if permission was already granted. It never asks for
 * permission, because browsers only allow that from a direct user click (see enablePushNotifications).
 */
export async function setupPushNotifications(){
  try{
    const supported = await isMessagingSupported();
    if(!supported) return;
    if(FCM_VAPID_KEY.includes('BURAYA_')) return;
    if(Notification.permission !== 'granted') return;
    await registerPushToken();
  }catch(e){ /* without push, in-app notifications still work */ }
}
/*
 * Called from the "Enable notifications" button, so the permission prompt happens inside the click
 * handler as browsers require.
 */
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
  /*
   * On a failed query, keep the current (possibly cached) list instead of replacing it with an error that
   * would then be cached.
   */
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
    row.addEventListener('click', ()=>{
      const tab = resolveNotifTab(row.dataset.notifTab);
      const id = row.dataset.notifId;
      const postId = row.dataset.notifPost;
      // Marked as read in the background; opening the target doesn't wait for the server.
      updateDoc(doc(db,'notifications',currentUid,'items',id), {read:true}).catch(()=>{});
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
  let markingAllRead = false;
  document.getElementById('markAllReadBtn').addEventListener('click', async ()=>{
    if(markingAllRead) return;
    markingAllRead = true;
    // Show the result right away; the writes follow in the background.
    document.querySelectorAll('#notifsList .notif-row').forEach(row=>{ row.style.opacity = '0.55'; });
    showUnreadBadge(0);
    try{
      // Only unread notifications are touched, a few hundred per write (a batch holds at most 500).
      const BATCH = 400;
      for(;;){
        const snap = await getDocs(unreadNotifsQuery(BATCH));
        if(snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d=> batch.update(d.ref, {read:true}));
        await batch.commit();
        if(snap.size < BATCH) break;
      }
    }catch(e){ console.error('Bildirimler okundu olarak işaretlenemedi:', e); }
    markingAllRead = false;
    renderNotifsTab();
  });
}

