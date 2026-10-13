/* ================= FIREBASE AYARLARI — BURAYI DOLDUR ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  GoogleAuthProvider, signInWithPopup, deleteUser, reauthenticateWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, addDoc,
  collection, onSnapshot, query, orderBy, limit, startAfter, where, runTransaction, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getMessaging, getToken, onMessage, isSupported as isMessagingSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
// Haftalık kura kuralları sunucuyla ortak tek dosyada (pazartesi otomatik kurası da bunu kullanıyor).
import {
  LOTTERY_ALGO, runLottery, drawHistory, checkDrawRules
} from "../functions/shared/lottery.js";
// Seri ve rozet kuralları da sunucuyla ortak (gece 06:00 rozet kesinleştirmesi de bunu kullanıyor).
import {
  BADGE_DEFS as SHARED_BADGE_DEFS, currentTierForStreak, countStreak, badgeTransition, replayBadgeHistory
} from "../functions/shared/streak.js";
// Keşfet sekmesi ve seçilmiş kitap kataloğu ayrı dosyalarda.
import { CURATED_CATALOG, bookKeyFor } from "./catalog.js";
import {
  initDiscover, renderDiscoverTab, renderDiscoverFilters, renderDiscoverContent,
  discoverCoversCache, ensureDiscoverCoversLoaded, seedDiscoverCovers,
  discoverPageSize, ensureDiscoverPageSizeLoaded, setDiscoverPageSize
} from "./discover.js";

const firebaseConfig = {
  apiKey: "AIzaSyDpRov8Qs7rPQ7lILyhs7DuRHdQpTJZWJ4",
  authDomain: "bookhook-77.firebaseapp.com",
  projectId: "bookhook-77",
  storageBucket: "bookhook-77.firebasestorage.app",
  messagingSenderId: "611511209042",
  appId: "1:611511209042:web:3fa319fb5ee6ca5daba38b"
};
const FCM_VAPID_KEY = "BE2rTmP33eegqZfz2p3wP-skKGpR0NuEWkal5-VaNbsX1ikgMa_mvIUg4uXATWXHzy1boy0yuBqeCb2Q-Wn3aXw";
const GOOGLE_BOOKS_API_KEY = "AIzaSyBpIIf2aPenDO9E1ZgX96oNAznFmAadRxs"; // Kitap arama kotasını yükseltmek için buraya kendi Google Books API anahtarını yapıştır (boş bırakılırsa düşük anonim kota kullanılır, 429 hatası alınabilir)

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getFirestore(app);
const storage = getStorage(app);
const cloudFunctions = getFunctions(app);
/* ======================================================================= */

/* ============ TARİH YARDIMCILARI (gün 06:00'a kadar sürer) ============ */
const DOW = [window.BH_I18N.pick("Pzt","Mon"),window.BH_I18N.pick("Sal","Tue"),window.BH_I18N.pick("Çar","Wed"),window.BH_I18N.pick("Per","Thu"),window.BH_I18N.pick("Cum","Fri"),window.BH_I18N.pick("Cmt","Sat"),window.BH_I18N.pick("Paz","Sun")];
/* ============ KARANLIK / AYDINLIK TEMA ============ */
function getStoredTheme(){ try{ return localStorage.getItem('bookhook_theme'); }catch(e){ return null; } }
function setTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem('bookhook_theme', theme); }catch(e){}
}
function getAutoThemeEnabled(){ try{ return localStorage.getItem('bookhook_theme_auto')==='true'; }catch(e){ return false; } }
function setAutoThemeEnabled(v){ try{ localStorage.setItem('bookhook_theme_auto', v?'true':'false'); }catch(e){} }
function computeAutoTheme(){
  const h = new Date().getHours();
  return (h>=8 && h<20) ? 'light' : 'dark';
}
function applyAutoThemeIfEnabled(){
  if(getAutoThemeEnabled()){
    document.documentElement.setAttribute('data-theme', computeAutoTheme());
    materialThemeSync();
  }
}
function initTheme(){
  if(getAutoThemeEnabled()){
    document.documentElement.setAttribute('data-theme', computeAutoTheme());
    return;
  }
  const stored = getStoredTheme();
  const theme = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}
initTheme();
setInterval(applyAutoThemeIfEnabled, 5*60*1000);

function pad(n){return n<10?"0"+n:""+n;}
function toStr(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
function fromStr(s){const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d);}
function addDays(d,n){const r=new Date(d); r.setDate(r.getDate()+n); return r;}
function getMonday(d){ const day=d.getDay(); const diff = day===0?-6:1-day; const m=addDays(d,diff); m.setHours(0,0,0,0); return m; }
function weekDates(monday){ const arr=[]; for(let i=0;i<7;i++) arr.push(toStr(addDays(monday,i))); return arr; }
const MONTHS_TR = [window.BH_I18N.pick("Ocak","January"),window.BH_I18N.pick("Şubat","February"),window.BH_I18N.pick("Mart","March"),window.BH_I18N.pick("Nisan","April"),window.BH_I18N.pick("Mayıs","May"),window.BH_I18N.pick("Haziran","June"),window.BH_I18N.pick("Temmuz","July"),window.BH_I18N.pick("Ağustos","August"),window.BH_I18N.pick("Eylül","September"),window.BH_I18N.pick("Ekim","October"),window.BH_I18N.pick("Kasım","November"),window.BH_I18N.pick("Aralık","December")];
function isWideScreen(){ return window.matchMedia && window.matchMedia('(min-width:700px)').matches; }
// Firestore'a kaydedilen (herkesin gördüğü) metinler için dilden ve ekran genişliğinden bağımsız
// tarih; sunucudaki fmtShortBackend ile aynı "gg.aa" biçimi.
function fmtStoredDate(dstr){ const d = fromStr(dstr); return pad(d.getDate())+"."+pad(d.getMonth()+1); }
function fmtShort(dstr){
  const d = fromStr(dstr);
  if(isWideScreen()) return `${d.getDate()} ${MONTHS_TR[d.getMonth()]}`;
  return pad(d.getDate())+"."+pad(d.getMonth()+1);
}
let _lastWideState = null;
window.addEventListener('resize', ()=>{
  const nowWide = isWideScreen();
  if(_lastWideState!==null && nowWide!==_lastWideState && activeTab){ renderTab(activeTab); }
  _lastWideState = nowWide;
});
// "Mantıksal gün": saat 06:00'dan önceyse hâlâ önceki günün okuma günü sayılır (gece okumaları için).
function nowLogical(){ const d=new Date(); if(d.getHours()<6){ d.setDate(d.getDate()-1); } d.setHours(0,0,0,0); return d; }
function todayStr(){ return toStr(nowLogical()); }
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
export function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function turkishLastVowelInfo(name){
  const n = (name||'').trim();
  const vowelsBack = 'aıou', vowelsFront = 'eiöü';
  const allVowels = vowelsBack + vowelsFront;
  const lastChar = n ? n[n.length-1].toLocaleLowerCase('tr-TR') : '';
  const endsInVowel = allVowels.includes(lastChar);
  let lastVowel = null;
  for(let i=n.length-1;i>=0;i--){
    const c = n[i].toLocaleLowerCase('tr-TR');
    if(allVowels.includes(c)){ lastVowel = c; break; }
  }
  const isBack = lastVowel ? vowelsBack.includes(lastVowel) : true;
  const isRounded = lastVowel ? 'ouöü'.includes(lastVowel) : false;
  return { endsInVowel, isBack, isRounded };
}
function turkishDativeName(name){
  const { endsInVowel, isBack } = turkishLastVowelInfo(name);
  const v = isBack ? 'a' : 'e';
  return `${name}'${endsInVowel ? 'y'+v : v}`;
}
function turkishAccusativeName(name){
  const { endsInVowel, isBack, isRounded } = turkishLastVowelInfo(name);
  const v = isBack ? (isRounded?'u':'ı') : (isRounded?'ü':'i');
  return `${name}'${endsInVowel ? 'y'+v : v}`;
}

/* ============ KURA ============
   Kuralın kendisi functions/shared/lottery.js'te (sunucuyla ortak). Burada sadece uygulamaya
   özel yardımcılar var. */
// Üyenin tam kayıt anı: aynı gün katılan hiç kazanmamışlar arasındaki sırayı belirler.
function joinedAtOf(uid){ const c=usersCache[uid]?.createdAt; const t=c?new Date(c):null; return t&&!isNaN(t)?t.toISOString():''; }

/* ============ DURUM ============ */
export let currentUid = null;
export let myProfile = null;
let usersCache = {};
let todayAnswers = {};
let drawsCache = [];
let activeTab = null;
let unsubUsers = null, unsubToday = null, unsubNotifs = null;
let subscribedTodayKey = null;
let manualGrid = {}; // uid -> ['', 'read', 'skip', ...] length 7
let manualHistoryCache = [];

function activeUids(){ return Object.keys(usersCache).filter(uid=>!usersCache[uid].banned && !usersCache[uid].deleted); }
function profilePhotoHtml(profile, fontSize){
 const initial=((profile?.name||'?').trim().charAt(0)||'?').toLocaleUpperCase('tr');
 const url=typeof profile?.photoURL==='string'?profile.photoURL.trim():'';
 // Keep a visible fallback beneath the photo, including during loading/network errors.
 return `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:inherit;overflow:hidden;background:var(--gold);color:var(--on-primary);font-size:${fontSize}px;font-weight:700;line-height:1;">${escapeHtml(initial)}${url?`<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" decoding="async" style="position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;object-fit:cover;object-position:center;border-radius:inherit;" onerror="this.remove()" />`:''}</span>`;
}
function avatarHtmlFromProfile(profile, size, proportionHint){
  size = size || 22;
  // size normalde piksel sayısıdır; bir CSS ölçüsü/yüzdesi ("100%" gibi) de verilebilir — bu durumda
  // halka/rozet oranları için proportionHint (verilmediyse 34px) varsayılan bir taban kullanılır
  // (kendi kapsayıcısına göre orantı hesaplayamayacağımız için), asıl daire boyutu yine verilen CSS
  // değerine göre esner. Avatarın gerçekte çok küçük render edileceği yerlerde (ör. rozet crest'i)
  // köşe simgesinin fotoğrafı kapatmaması için proportionHint ile gerçekçi bir taban verilmeli.
  const isNumeric = typeof size === 'number';
  const sizeCss = isNumeric ? `${size}px` : size;
  const proportionBase = isNumeric ? size : (proportionHint || 34);
  const name = (profile && profile.name) || '?';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const tierKey = profile && profile.currentTier;
  const tierDef = tierKey ? BADGE_DEFS.find(d=>d.key===tierKey) : null;
  const ringStyle = tierDef ? `box-shadow:0 0 0 2.5px ${tierDef.color};` : '';
  const inner = profilePhotoHtml(profile, Math.round(proportionBase*0.5));
  const iconSize = Math.max(10, Math.round(proportionBase*0.44));
  const badgeOverlay = tierDef
    ? `<span class="tier-badge-icon" title="${escapeHtml(tierDef.label)}" style="position:absolute; right:-2px; bottom:-2px; width:${iconSize}px; height:${iconSize}px; border-radius:50%; background:${tierDef.color}; display:flex; align-items:center; justify-content:center; font-size:${Math.round(iconSize*0.62)}px; box-shadow:0 0 0 1.5px var(--card);">${badgeIllustration(tierDef.key)}</span>`
    : '';
  // Dıştaki katman sabit boyutlu (size×size) ve rozet halkasını (box-shadow) taşıyor; overflow burada
  // KESİNLİKLE hidden değil, aksi halde halka kırpılırdı. Yuvarlak kırpma tamamen içteki, kendi
  // overflow:hidden'ına sahip ayrı katmanda yapılıyor; bu yüzden halka asla köşeli görünmez.
  return `<span style="position:relative; display:inline-flex; width:${sizeCss}; height:${sizeCss}; margin-right:${isNumeric?'6px':'0'}; vertical-align:middle; line-height:0; flex:0 0 auto; border-radius:50%; ${ringStyle}">
    <span style="display:block; width:100%; height:100%; border-radius:50%; overflow:hidden;">${inner}</span>
    ${badgeOverlay}
  </span>`;
}
export function userChipHtml(uid, size){
  const u = usersCache[uid];
  const name = (u && u.name) || '?';
  return `<span class="user-chip" data-uid="${uid}">${avatarHtmlFromProfile(u,size)}<span class="uc-name">${escapeHtml(name)}</span></span>`;
}
let currentProfileModalUid = null;
async function openProfileModal(uid){
  const u = usersCache[uid];
  if(!u) return;
  currentProfileModalUid = uid;
  document.getElementById('profileModalPhotoWrap').innerHTML = avatarHtmlFromProfile(u, 88);
  document.getElementById('profileModalPhotoWrap').style.cursor = u.photoURL ? 'pointer' : 'default';
  document.getElementById('profileModalPhotoWrap').onclick = ()=>{ if(u.photoURL) openPhotoLightbox(u.photoURL); };
  document.getElementById('profileModalName').textContent = u.surname ? `${u.name} ${u.surname}` : (u.name || '?');
  document.getElementById('profileModalBio').textContent = u.bio ? u.bio : window.BH_I18N.pick("Henüz bir bilgi eklenmemiş.","No information added yet.");
  renderBookHistoryGrid(uid, 'profileModalReadBooksGrid', false, 'readBooks');
  const statsEl = document.getElementById('profileModalStats');
  const statsKey = 'profileStats_'+uid;
  const cachedStats = getPersistedHTML(statsKey);
  statsEl.innerHTML = cachedStats || window.BH_I18N.template`<span>… hediye kitap</span><span>… sayfa</span>`;
  document.getElementById('profileModal').style.display='flex';
  const [totalReadDays] = await Promise.all([computeTotalReadDays(uid), loadDraws()]);
  const giftsWon = drawsCache.reduce((acc,d)=> acc + (d.pairs||[]).filter(p=>p.receiverUid===uid).length, 0);
  const freshStatsHtml = window.BH_I18N.template`<span><b>${giftsWon}</b> hediye kitap kazandı</span><span><b>${(totalReadDays*15).toLocaleString(window.BH_I18N.locale)}</b> sayfa okudu</span>`;
  statsEl.innerHTML = freshStatsHtml;
  setPersistedHTML(statsKey, freshStatsHtml);
  if(activeTab === 'social'){
    renderProfileModalPosts(uid);
  } else {
    document.getElementById('profileModalPosts').style.display = 'none';
  }
}
function showSocialView(view){
  document.querySelector('#socialPillBar > .social-pill[data-view="feed"]').classList.toggle('active', view==='feed');
  document.getElementById('socialProfilePillGroup').classList.toggle('active', view==='profile');
  document.getElementById('socialFeedView').style.display = view==='feed' ? 'block' : 'none';
  document.getElementById('socialProfileView').style.display = view==='profile' ? 'block' : 'none';
}
document.querySelectorAll('#socialPillBar [data-view]').forEach(btn=>{
  btn.addEventListener('click', ()=> showSocialView(btn.dataset.view));
});
document.getElementById('socialPillCloseBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  document.getElementById('socialPillBar').style.display = 'none';
  showSocialView('feed');
});
document.getElementById('socialProfileCloseBtn').addEventListener('click', ()=>{
  document.getElementById('socialPillBar').style.display = 'none';
  showSocialView('feed');
});
let socialProfilePostsCache = [];
let socialProfilePostsPage = 0;
async function openSocialProfileView(uid){
  document.getElementById('socialPillBar').style.display = 'flex';
  repositionSocialPillBar();
  showSocialView('profile');
  const u = usersCache[uid];
  if(!u) return;
  document.getElementById('socialProfilePhotoWrap').innerHTML = avatarHtmlFromProfile(u, 88);
  document.getElementById('socialProfileName').textContent = u.name || '';
  document.getElementById('socialProfileBio').textContent = u.bio || '';
  renderBookHistoryGrid(uid, 'socialProfileReadBooksGrid', false, 'readBooks');
  document.getElementById('socialProfileStats').innerHTML = '';
  await renderSocialProfilePosts(uid);
}
async function renderSocialProfilePosts(uid){
  const box = document.getElementById('socialProfilePosts');
  box.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  let fetchError = null;
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('uid','==',uid), limit(300)));
    socialProfilePostsCache = [];
    snap.forEach(d=> socialProfilePostsCache.push({id:d.id, ...d.data()}));
    socialProfilePostsCache.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  }catch(e){ socialProfilePostsCache = []; fetchError = e; }
  socialProfilePostsPage = 0;
  if(fetchError){
    box.innerHTML = window.BH_I18N.template`<div class="rec-comments-label">📰 Gönderiler</div><div class="empty-state" style="padding:16px 0;"><span class="big">⚠️</span>Gönderiler yüklenemedi.<br/><span style="font-size:11px;">${escapeHtml(fetchError.message||String(fetchError))}</span></div>`;
    return;
  }
  renderSocialProfilePostsPage();
}
function renderSocialProfilePostsPage(){
  const box = document.getElementById('socialProfilePosts');
  const PAGE_SIZE = 20;
  if(!socialProfilePostsCache.length){
    box.innerHTML = window.BH_I18N.template`<div class="rec-comments-label">📰 Gönderiler</div><div class="empty-state" style="padding:16px 0;"><span class="big">📰</span>Henüz gönderisi yok.</div>`;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(socialProfilePostsCache.length/PAGE_SIZE));
  if(socialProfilePostsPage>=totalPages) socialProfilePostsPage = totalPages-1;
  if(socialProfilePostsPage<0) socialProfilePostsPage = 0;
  const pageItems = socialProfilePostsCache.slice(socialProfilePostsPage*PAGE_SIZE, socialProfilePostsPage*PAGE_SIZE+PAGE_SIZE);
  let html = window.BH_I18N.template`<div class="rec-comments-label">📰 Gönderiler</div>`;
  html += pageItems.map(p=> renderPostCard(p)).join('');
  if(totalPages>1){
    html += `<div class="discover-pager">
      ${socialProfilePostsPage>0?window.BH_I18N.template`<button id="socialProfilePostsPrevBtn">◀ Önceki</button>`:''}
      <span class="muted mono">${socialProfilePostsPage+1} / ${totalPages}</span>
      ${socialProfilePostsPage<totalPages-1?window.BH_I18N.template`<button id="socialProfilePostsNextBtn">Sonraki Sayfa ▶</button>`:''}
    </div>`;
  }
  box.innerHTML = html;
  wirePostCards(box, renderSocialProfilePostsPage);
  const prevBtn = document.getElementById('socialProfilePostsPrevBtn');
  if(prevBtn) prevBtn.addEventListener('click', ()=>{ socialProfilePostsPage--; renderSocialProfilePostsPage(); });
  const nextBtn = document.getElementById('socialProfilePostsNextBtn');
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ socialProfilePostsPage++; renderSocialProfilePostsPage(); });
}
let profileModalPostsCache = [];
let profileModalPostsPage = 0;
async function renderProfileModalPosts(uid){
  const box = document.getElementById('profileModalPosts');
  box.style.display = 'block';
  box.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  let fetchError = null;
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('uid','==',uid), limit(300)));
    profileModalPostsCache = [];
    snap.forEach(d=> profileModalPostsCache.push({id:d.id, ...d.data()}));
    profileModalPostsCache.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  }catch(e){ profileModalPostsCache = []; fetchError = e; }
  profileModalPostsPage = 0;
  if(fetchError){
    box.innerHTML = window.BH_I18N.template`<div class="rec-comments-label">📰 Gönderiler</div><div class="empty-state" style="padding:16px 0;"><span class="big">⚠️</span>Gönderiler yüklenemedi.<br/><span style="font-size:11px;">${escapeHtml(fetchError.message||String(fetchError))}</span></div>`;
    return;
  }
  renderProfileModalPostsPage();
}
function renderProfileModalPostsPage(){
  const box = document.getElementById('profileModalPosts');
  const PAGE_SIZE = 20;
  if(!profileModalPostsCache.length){
    box.innerHTML = window.BH_I18N.template`<div class="rec-comments-label">📰 Gönderiler</div><div class="empty-state" style="padding:16px 0;"><span class="big">📰</span>Henüz gönderisi yok.</div>`;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(profileModalPostsCache.length/PAGE_SIZE));
  if(profileModalPostsPage>=totalPages) profileModalPostsPage = totalPages-1;
  if(profileModalPostsPage<0) profileModalPostsPage = 0;
  const pageItems = profileModalPostsCache.slice(profileModalPostsPage*PAGE_SIZE, profileModalPostsPage*PAGE_SIZE+PAGE_SIZE);
  let html = window.BH_I18N.template`<div class="rec-comments-label">📰 Gönderiler</div>`;
  html += pageItems.map(p=> renderPostCard(p)).join('');
  if(totalPages>1){
    html += `<div class="discover-pager">
      ${profileModalPostsPage>0?window.BH_I18N.template`<button id="profileModalPostsPrevBtn">◀ Önceki</button>`:''}
      <span class="muted mono">${profileModalPostsPage+1} / ${totalPages}</span>
      ${profileModalPostsPage<totalPages-1?window.BH_I18N.template`<button id="profileModalPostsNextBtn">Sonraki Sayfa ▶</button>`:''}
    </div>`;
  }
  box.innerHTML = html;
  wirePostCards(box, renderProfileModalPostsPage);
  const prevBtn = document.getElementById('profileModalPostsPrevBtn');
  if(prevBtn) prevBtn.addEventListener('click', ()=>{ profileModalPostsPage--; renderProfileModalPostsPage(); });
  const nextBtn = document.getElementById('profileModalPostsNextBtn');
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ profileModalPostsPage++; renderProfileModalPostsPage(); });
}
function openPhotoLightbox(url){
  if(!url) return;
  document.getElementById('photoLightboxImg').src = url;
  document.getElementById('photoLightbox').style.display='flex';
}
document.getElementById('sidebarLogoBtn').addEventListener('click', ()=>{
  const homeTab = myProfile && myProfile.role==='admin' ? 'today' : 'msurvey';
  if(document.getElementById('tab-'+homeTab)) switchTab(homeTab);
});
function repositionSocialPillBar(){
  const contentCol = document.getElementById('contentCol');
  const pillBar = document.getElementById('socialPillBar');
  if(!contentCol || !pillBar) return;
  const rect = contentCol.getBoundingClientRect();
  pillBar.style.left = (rect.left + rect.width/2) + 'px';
}
window.addEventListener('resize', repositionSocialPillBar);
document.getElementById('sidebarCollapseBtn').addEventListener('click', ()=>{
  document.getElementById('sidebarNav').classList.add('collapsed');
  document.getElementById('contentCol').classList.add('expanded');
  document.getElementById('sidebarExpandFab').classList.add('visible');
  setTimeout(repositionSocialPillBar, 340);
  setTimeout(positionPinnedPostBar, 340);
});
document.getElementById('sidebarExpandFab').addEventListener('click', ()=>{
  document.getElementById('sidebarNav').classList.remove('collapsed');
  document.getElementById('contentCol').classList.remove('expanded');
  document.getElementById('sidebarExpandFab').classList.remove('visible');
  setTimeout(repositionSocialPillBar, 340);
  setTimeout(positionPinnedPostBar, 340);
});
document.getElementById('photoLightbox').addEventListener('click', ()=>{ closeModal('photoLightbox'); });
document.getElementById('profileModalBookHistoryBtn').addEventListener('click', async ()=>{
  if(!currentProfileModalUid) return;
  const u = usersCache[currentProfileModalUid];
  document.getElementById('bookHistoryViewModalName').textContent = window.BH_I18N.template`📚 ${u.surname ? `${u.name} ${u.surname}` : (u.name||'?')} — Kitap Geçmişi`;
  document.getElementById('bookHistoryViewModal').style.display='flex';
  const viewGrid = document.getElementById('bookHistoryViewGrid');
  viewGrid.innerHTML=''; delete viewGrid.dataset.loaded; delete bhPageState['bookHistoryViewGrid'];
  await renderBookHistoryGrid(currentProfileModalUid, 'bookHistoryViewGrid', false);
});
document.getElementById('bookHistoryViewModalClose').addEventListener('click', ()=>{ closeModal('bookHistoryViewModal'); });
document.getElementById('bookHistoryViewModal').addEventListener('click', (e)=>{ if(e.target.id==='bookHistoryViewModal') closeModal('bookHistoryViewModal'); });

/* ============ ORTAK: KİTAP BİLGİSİ (kapağa tıklayınca) ============ */
document.getElementById('bookInfoModalClose').addEventListener('click', ()=>{ closeModal('bookInfoModal'); });
document.getElementById('bookInfoModal').addEventListener('click', (e)=>{ if(e.target.id==='bookInfoModal') closeModal('bookInfoModal'); });
async function addBookToMyLibrary(title, author, cover, listType){
  const collectionName = listType==='want' ? 'wantToRead' : 'bookHistory';
  try{
    await addDoc(collection(db,'users',currentUid,collectionName), { author: author||'', title, cover: cover||'', addedAt: new Date().toISOString() });
    if(listType!=='want'){
      createOrBatchPost('book_added', { bookTitle: title, bookAuthor: author||'', bookCover: cover||'' });
    }
    showToast(listType==='want' ? 'Okumak istediklerine eklendi!' : window.BH_I18N.pick("Kitaplığına eklendi!","Added to your books!"));
  }catch(err){ alert(window.BH_I18N.pick("Eklenemedi: ","Could not add: ")+(err.message||err)); }
}
async function checkBookListStatus(title){
  let inHistory = false, inWant = false, historyId = null, wantId = null;
  const [snap1, snap2] = await Promise.all([
    getDocs(query(collection(db,'users',currentUid,'bookHistory'), where('title','==',title))).catch(()=>null),
    getDocs(query(collection(db,'users',currentUid,'wantToRead'), where('title','==',title))).catch(()=>null)
  ]);
  if(snap1) snap1.forEach(d=>{ inHistory = true; historyId = d.id; });
  if(snap2) snap2.forEach(d=>{ inWant = true; wantId = d.id; });
  return { inHistory, inWant, historyId, wantId };
}
async function removeFromMyLibraryById(docId, listType){
  const collectionName = listType==='want' ? 'wantToRead' : 'bookHistory';
  try{
    await deleteDoc(doc(db,'users',currentUid,collectionName,docId));
    showToast(listType==='want' ? window.BH_I18N.pick("Okumak istediklerinden kaldırıldı.","Removed from your reading list.") : window.BH_I18N.pick("Kitaplığından kaldırıldı.","Removed from your books."));
  }catch(err){ alert(window.BH_I18N.pick("Kaldırılamadı: ","Could not remove: ")+(err.message||err)); }
}
function libraryButtonsHtml(status, widthStyle, idSuffix){
  idSuffix = idSuffix || '';
  if(status.inHistory){
    return window.BH_I18N.template`<button type="button" class="secondary tiny" id="removeFromLibBtn${idSuffix}" data-id="${status.historyId}" data-list="history" style="${widthStyle}">Listeden Kaldır</button>`;
  }
  if(status.inWant){
    return window.BH_I18N.template`<div style="display:flex; gap:8px; margin-top:10px;">
      <button type="button" class="secondary tiny" id="addToMyLibraryBtn${idSuffix}" style="flex:1;">Okudum</button>
      <button type="button" class="secondary tiny" id="removeFromLibBtn${idSuffix}" data-id="${status.wantId}" data-list="want" style="flex:1;">Listeden Kaldır</button>
    </div>`;
  }
  return window.BH_I18N.template`<div style="display:flex; gap:8px; margin-top:10px;">
    <button type="button" class="secondary tiny" id="addToMyLibraryBtn${idSuffix}" style="flex:1;">Okudum</button>
    <button type="button" class="secondary tiny" id="addToWantToReadBtn${idSuffix}" style="flex:1;">Okumak İstiyorum</button>
  </div>`;
}
export async function refreshLibraryButtons(wrapId, title, author, cover, idSuffix, firstRender){
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  wrap.style.transition = 'opacity .16s ease, transform .16s ease';
  if(!firstRender){
    wrap.style.opacity = '0';
    wrap.style.transform = 'scale(0.97)';
    await new Promise(r=> setTimeout(r, 160));
  }
  const status = await checkBookListStatus(title);
  wrap.innerHTML = libraryButtonsHtml(status, 'width:100%;', idSuffix);
  wrap.style.opacity = '0';
  wrap.style.transform = 'scale(0.97)';
  requestAnimationFrame(()=>{
    wrap.style.opacity = '1';
    wrap.style.transform = 'scale(1)';
  });
  wireLibraryButtons(wrapId, title, author, cover, idSuffix);
}
function wireLibraryButtons(wrapId, title, author, cover, idSuffix){
  idSuffix = idSuffix || '';
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  const refresh = ()=> refreshLibraryButtons(wrapId, title, author, cover, idSuffix);
  const pulseAndRun = async (btn, action)=>{
    if(btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('lib-btn-pulse');
    await action();
    refresh();
  };
  const myLibBtn = wrap.querySelector('#addToMyLibraryBtn'+idSuffix);
  if(myLibBtn) myLibBtn.addEventListener('click', ()=> pulseAndRun(myLibBtn, ()=> addBookToMyLibrary(title, author, cover)));
  const wantBtn = wrap.querySelector('#addToWantToReadBtn'+idSuffix);
  if(wantBtn) wantBtn.addEventListener('click', ()=> pulseAndRun(wantBtn, ()=> addBookToMyLibrary(title, author, cover, 'want')));
  const removeBtn = wrap.querySelector('#removeFromLibBtn'+idSuffix);
  if(removeBtn) removeBtn.addEventListener('click', ()=> pulseAndRun(removeBtn, ()=> removeFromMyLibraryById(removeBtn.dataset.id, removeBtn.dataset.list)));
}
async function showBookInfo(rawTitle, cover, prependHtml, sourceContext){
  if(!rawTitle) return;
  const body = document.getElementById('bookInfoModalBody');
  document.getElementById('bookInfoModal').style.display='flex';
  // "Yazar - Kitap Adı" formatındaysa ikiye ayır (sadece başlık kısmını arama sorgusunda kullanmak için)
  let author = '', title = rawTitle;
  const dashIdx = rawTitle.indexOf(' - ');
  if(dashIdx>0){ author = rawTitle.slice(0,dashIdx).trim(); title = rawTitle.slice(dashIdx+3).trim(); }

  // Kapak, başlık, yazar VE "Okudum/Okumak İstiyorum" tuşları elimizdeki bilgiyle HEMEN
  // çiziliyor — dış kitap veritabanı aramasını beklemiyorlar. Açıklama/puan gibi sadece dış
  // kaynaktan gelebilecek bilgiler ayrı bir bölümde, arka planda yüklenip sonradan ekleniyor.
  body.innerHTML = window.BH_I18N.template`
    ${prependHtml||''}
    ${cover ? `<img src="${cover}" alt="" style="width:100px; height:150px; object-fit:cover; border-radius:8px; box-shadow:var(--shadow); margin-bottom:12px;" onerror="this.style.display='none';" />` : ''}
    <h2 style="margin:4px 0 2px;">${escapeHtml(title)}</h2>
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(author)}</div>
    <div id="bookInfoExtra"><span class="muted" style="font-size:12px;">Detaylar getiriliyor…</span></div>
    ${sourceContext==='history' ? '' : `<div id="libraryBtnsWrap" style="margin-top:10px;"><span class="muted" style="font-size:12px;">…</span></div>`}
  `;
  if(sourceContext!=='history') refreshLibraryButtons('libraryBtnsWrap', title, author, cover, '', true);

  const searchQuery = author ? `${title} ${author}` : title;
  let info = null;
  let lastError = null;
  try{
    const items = await searchOpenLibrary(searchQuery);
    if(items[0]){
      info = items[0];
      info = await enrichFromOpenLibraryWork(info);
    }
    else lastError = window.BH_I18N.pick("Open Library: sonuç yok","Open Library: no results");
  }catch(e){ lastError = 'Open Library hata: '+(e.message||e); }
  if(!info){
    try{
      const items = await searchGoogleBooks(searchQuery);
      if(items[0]) info = items[0];
      else lastError = (lastError?lastError+' | ':'')+window.BH_I18N.pick("Google Books: sonuç yok","Google Books: no results");
    }catch(e){ lastError = (lastError?lastError+' | ':'')+'Google Books hata: '+(e.message||e); }
  }
  const extraEl = document.getElementById('bookInfoExtra');
  if(!extraEl) return; // pencere bu sırada kapatılmış olabilir
  if(info){
    info.author = info.author || author || 'Bilinmeyen Yazar';
    info.title = info.title || title;
    info.cover = cover || info.cover;
  }
  if(!info){
    extraEl.innerHTML = `<span class="muted" style="font-size:12px;">Bu kitap hakkında ek bilgi bulunamadı.${lastError?`<br/><span style="font-size:11px;">(${escapeHtml(lastError)})</span>`:''}</span>`;
    return;
  }
  const descShort = info.description ? escapeHtml(info.description).slice(0,320) + (info.description.length>320?'…':'') : '';
  const LANG_LABELS = {eng:window.BH_I18N.pick("İngilizce","English"), tur:'Türkçe', fre:window.BH_I18N.pick("Fransızca","French"), ger:window.BH_I18N.pick("Almanca","German"), spa:window.BH_I18N.pick("İspanyolca","Spanish"), ita:window.BH_I18N.pick("İtalyanca","Italian"), rus:window.BH_I18N.pick("Rusça","Russian")};
  const metaLine1 = [
    info.year ? escapeHtml(String(info.year)) : '',
    info.pageCount ? window.BH_I18N.template`${info.pageCount} sayfa` : ''
  ].filter(Boolean).join(' &middot; ');
  const metaLine2 = [
    info.publisher ? escapeHtml(info.publisher) : '',
    info.categories ? escapeHtml(info.categories) : '',
    info.rating ? `⭐ ${info.rating}${info.ratingsCount?` (${info.ratingsCount} oy)`:''}` : '',
    info.language ? (LANG_LABELS[info.language]||escapeHtml(info.language)) : ''
  ].filter(Boolean).join(' &middot; ');
  extraEl.innerHTML = `
    ${metaLine1?`<div class="muted" style="margin-bottom:4px; font-size:12.5px;">${metaLine1}</div>`:''}
    ${metaLine2?`<div class="muted" style="margin-bottom:10px; font-size:12.5px;">${metaLine2}</div>`:''}
    ${descShort?`<p style="text-align:left; font-size:13.5px; line-height:1.5;">${descShort}</p>`:''}
    ${info.isbn?`<div class="muted" style="font-size:11px; margin-top:8px;">ISBN: ${escapeHtml(info.isbn)}</div>`:''}
    ${info.link?window.BH_I18N.template`<a href="${info.link}" target="_blank" rel="noopener" style="display:inline-block; margin-top:10px; font-size:13px; color:var(--gold);">Daha fazla bilgi →</a>`:''}
  `;
  // Orijinal bir kapak verilmemişse ve dış kaynaktan bir kapak geldiyse, onu da ekle.
  if(!cover && info.cover && !body.querySelector('img')){
    const h2 = body.querySelector('h2');
    if(h2) h2.insertAdjacentHTML('beforebegin', `<img src="${info.cover}" alt="" style="width:100px; height:150px; object-fit:cover; border-radius:8px; box-shadow:var(--shadow); margin-bottom:12px;" onerror="this.style.display='none';" />`);
  }
}
document.body.addEventListener('click', (e)=>{
  const cover = e.target.closest('.book-cover-clickable');
  if(cover && cover.dataset.bookTitle){
    let sourceContext;
    if(cover.closest('#bookHistoryGrid')) sourceContext = 'history';
    showBookInfo(cover.dataset.bookTitle, cover.dataset.bookCover||cover.src||'', undefined, sourceContext);
  }
});
document.getElementById('profileModalClose').addEventListener('click', ()=>{ closeModal('profileModal'); });
document.getElementById('profileModal').addEventListener('click', (e)=>{ if(e.target.id==='profileModal') closeModal('profileModal'); });
export function showSimpleInfoModal(html){
  document.getElementById('bookInfoModalBody').innerHTML = html;
  document.getElementById('bookInfoModal').style.display='flex';
}
export function closeModal(id){
  const el = document.getElementById(id);
  if(!el || el.style.display==='none') return;
  const card = el.querySelector('.modal-card-anim') || el.querySelector('.lightbox-img-anim');
  el.classList.add('closing');
  if(card) card.classList.add('closing');
  setTimeout(()=>{
    el.style.display='none';
    el.classList.remove('closing');
    if(card) card.classList.remove('closing');
  }, 120);
}
export function showAnchoredPopover(anchorEl, html){
  const pop = document.getElementById('anchoredPopover');
  pop.innerHTML = html;
  pop.style.display = 'block';
  const r = anchorEl.getBoundingClientRect();
  const popW = pop.offsetWidth, popH = pop.offsetHeight;
  let left = r.left + r.width/2 - popW/2;
  left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
  let top = r.bottom + 8;
  if(top + popH > window.innerHeight - 8) top = r.top - popH - 8;
  pop.style.left = (left + window.scrollX) + 'px';
  pop.style.top = (top + window.scrollY) + 'px';
}
export function hideAnchoredPopover(){
  const pop = document.getElementById('anchoredPopover');
  if(pop.style.display==='none') return;
  pop.classList.add('closing');
  setTimeout(()=>{ pop.style.display='none'; pop.classList.remove('closing'); }, 120);
}
// Seçenekler penceresi (ve diğer bağlı popover'lar) açıkken dışarıya tıklanınca önce SADECE o
// pencere kapanmalı — o tıklamanın altındaki başka bir öğenin (örn. başka bir gönderi kartının)
// kendi tıklama işlevi TETİKLENMEMELİ. Bunu "capture" evresinde (olay hedefine erişmeden önce)
// yakalayıp durdurarak sağlıyoruz — böylece kart kendi tıklama dinleyicisine hiç ulaşmıyor.
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('anchoredPopover');
  if(pop.style.display==='block' && !pop.contains(e.target) && !e.target.closest('.badge-info-icon') && !e.target.closest('.total-pages-clickable') && !e.target.closest('#coverFixTarget')){
    hideAnchoredPopover();
    e.stopPropagation();
  }
}, true);
document.addEventListener('click', (e)=>{
  const pop = document.getElementById('anchoredPopover');
  if(pop.style.display==='block' && !pop.contains(e.target) && !e.target.closest('.badge-info-icon') && !e.target.closest('.total-pages-clickable') && !e.target.closest('#coverFixTarget')){
    hideAnchoredPopover();
  }
});
let pendingReactionRefresh = null;
document.body.addEventListener('click', (e)=>{
  const chip = e.target.closest('.user-chip');
  if(chip && chip.dataset.uid){
    if(activeTab === 'social') openSocialProfileView(chip.dataset.uid);
    else openProfileModal(chip.dataset.uid);
  }
  const badge = e.target.closest('.badge-info-icon');
  if(badge && badge.dataset.badgeLabel && !badge.closest('#profileModalPhotoWrap')){
    e.stopPropagation();
    showAnchoredPopover(badge, `🏅 ${escapeHtml(badge.dataset.badgeLabel)}`);
  }
  const pickBtn = e.target.closest('.emoji-pick-btn');
  if(pickBtn){
    const target = pickBtn.dataset.target, emoji = pickBtn.dataset.emoji;
    setReaction(target, emoji).then(async ()=>{
      closeReactionDrawer();
      if(pendingReactionRefresh) await pendingReactionRefresh();
      burstMyReactionBadge(target);
    });
  }
  const pagesEl = e.target.closest('.total-pages-clickable');
  if(pagesEl && pagesEl.dataset.days!==undefined){
    e.stopPropagation();
    showAnchoredPopover(pagesEl, window.BH_I18N.template`📖 ${pagesEl.dataset.days} gün okudun`);
  }
  const dayCell = e.target.closest('.day-info-cell');
  if(dayCell && dayCell.dataset.info){
    e.stopPropagation();
    showAnchoredPopover(dayCell, escapeHtml(dayCell.dataset.info));
  }
});

// Bir konteynerin daha önce içerik gösterip göstermediğini işaretler. İlk seferinde
// "Yükleniyor…" gösterilir; sonraki ziyaretlerde önceki içerik ekranda kalmaya devam
// eder, veri arka planda tazelenip sessizce günceller. Ayrıca içeriği cihazın kendi
// hafızasına (localStorage) kaydediyoruz — böylece uygulama tamamen kapatılıp yeniden
// açıldığında da "yükleniyor" boşluğu görülmez, son bilinen hal anında gösterilir ve
// arka planda gerçek veriyle sessizce güncellenir.
// Her kayıtla birlikte bir zaman damgası da tutuluyor: bir kayıt CACHE_TTL_MS'ten (1 hafta)
// daha eskiyse artık hiç gösterilmiyor (sanki önbellek boşmuş gibi davranılıyor, yerine
// "Yükleniyor…" çıkıyor) — böylece normal günlük kullanımda önbellek her zaman anında
// gösterilmeye devam ediyor, ama bir konteynerin taze render'ı haftalarca hiç
// tamamlanamazsa o eski içerik sonsuza kadar takılı kalmıyor, kendiliğinden düşüyor.
const APP_CACHE_VERSION = 'material-i18n-v1-'+window.BH_I18N.language;
const CACHE_PREFIX = 'bh_cache_'+APP_CACHE_VERSION+'_';
const CACHE_TTL_MS = 7*24*60*60*1000; // 1 hafta
function getPersistedHTML(key){
  try{
    const raw = localStorage.getItem(CACHE_PREFIX+currentUid+'_'+key);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed.html!=='string' || typeof parsed.ts!=='number') return null;
    if(Date.now() - parsed.ts > CACHE_TTL_MS) return null; // 1 haftadan eski — geçersiz say
    return parsed.html;
  }catch(e){ return null; }
}
function setPersistedHTML(key, html){
  const payload = JSON.stringify({html, ts: Date.now()});
  try{ localStorage.setItem(CACHE_PREFIX+currentUid+'_'+key, payload); }
  catch(e){
    // Depolama dolu olabilir: bu uygulamaya ait birkaç eski önbellek kaydını silip tekrar dene
    // (yeni gösterilecek içerik, eski/kullanılmayan bir önbellekten daha değerli).
    try{
      const ownKeys = [];
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(k && k.startsWith(CACHE_PREFIX)) ownKeys.push(k);
      }
      ownKeys.slice(0, 8).forEach(k=>{ try{ localStorage.removeItem(k); }catch(e2){} });
      localStorage.setItem(CACHE_PREFIX+currentUid+'_'+key, payload);
    }catch(e3){ /* hâlâ olmuyorsa sessizce geç */ }
  }
}
export function showCachedOrPlaceholder(el, placeholderHtml){
  if(!el) return;
  if(el.dataset.loaded === '1') return;
  const cached = getPersistedHTML(el.id);
  if(cached){ el.innerHTML = cached; el.dataset.loaded = '1'; }
  else { el.innerHTML = placeholderHtml; }
}
function keepOrLoading(containerId, loadingText){
  const el = document.getElementById(containerId);
  showCachedOrPlaceholder(el, `<div class="empty-state">${loadingText || window.BH_I18N.pick("Yükleniyor…","Loading…")}</div>`);
  return el;
}
export function markLoaded(el){
  if(!el) return;
  el.dataset.loaded = '1';
  if(el.id) setPersistedHTML(el.id, el.innerHTML);
}

export function showToast(msg){
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className='toast';
  el.innerHTML = window.BH_I18N.template`<span>${msg}</span><button aria-label="Kapat">KAPAT</button>`;
  el.querySelector('button').onclick = ()=> el.remove();
  host.appendChild(el);
  setTimeout(()=>{ if(el.parentNode) el.remove(); }, 9000);
}

/* ============ BİLDİRİM SİSTEMİ (uygulama içi) ============ */
const NOTIF_CATEGORY_BY_TAB = { gifts:'gifts', social:'social', recs:'social' };
async function notifyUser(uid, message, linkTab, postId){
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
async function notifyAdmins(message, linkTab){
  const adminUids = Object.keys(usersCache).filter(u=>usersCache[u].role==='admin' && !usersCache[u].banned);
  await Promise.all(adminUids.map(uid=>notifyUser(uid,message,linkTab)));
}
async function notifyAllMembers(message, linkTab, excludeUid){
  const uids = Object.keys(usersCache).filter(u=> u!==excludeUid && !usersCache[u].banned);
  await Promise.all(uids.map(uid=>notifyUser(uid,message,linkTab)));
}
function subscribeNotifs(){
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
function openNotifModal(){
  document.getElementById('notifModal').style.display='flex';
  renderNotifsTab();
}
document.getElementById('notifModalClose').addEventListener('click', ()=>{ closeModal('notifModal'); });
document.getElementById('guideModalClose').addEventListener('click', ()=>{ closeModal('guideModal'); });
document.getElementById('guideModal').addEventListener('click', (e)=>{ if(e.target.id==='guideModal') closeModal('guideModal'); });
document.getElementById('notifModal').addEventListener('click', (e)=>{ if(e.target.id==='notifModal') closeModal('notifModal'); });

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
async function setupPushNotifications(){
  try{
    const supported = await isMessagingSupported();
    if(!supported) return;
    if(FCM_VAPID_KEY.includes('BURAYA_')) return;
    if(Notification.permission !== 'granted') return;
    await registerPushToken();
  }catch(e){ /* push kurulamazsa uygulama içi bildirimler zaten çalışmaya devam eder */ }
}
// Kullanıcının doğrudan tıklamasıyla çalışır — izin isteme burada, tıklamanın hemen içinde yapılır.
async function enablePushNotifications(){
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

document.getElementById('enablePushBtn').addEventListener('click', enablePushNotifications);
document.getElementById('markAllReadBtn').addEventListener('click', async ()=>{
  let snap;
  try{ snap = await getDocs(collection(db,'notifications',currentUid,'items')); }catch(e){ return; }
  await Promise.all(snap.docs.map(d=> updateDoc(d.ref, {read:true}).catch(()=>{})));
  renderNotifsTab();
});

/* ============ AUTH EKRANI ============ */
const authScreen = document.getElementById('authScreen');
const appRoot = document.getElementById('appRoot');
const loadingScreen = document.getElementById('loadingScreen');

document.getElementById('showLoginBtn').onclick = ()=>{
  document.getElementById('showLoginBtn').classList.add('active');
  document.getElementById('showSignupBtn').classList.remove('active');
  document.getElementById('loginForm').style.display='block';
  document.getElementById('signupForm').style.display='none';
};
document.getElementById('showSignupBtn').onclick = ()=>{
  document.getElementById('showSignupBtn').classList.add('active');
  document.getElementById('showLoginBtn').classList.remove('active');
  document.getElementById('signupForm').style.display='block';
  document.getElementById('loginForm').style.display='none';
};

function friendlyAuthError(err){
  const c = err.code || '';
  if(c.includes('email-already-in-use')) return window.BH_I18N.pick("Bu e-posta zaten kayıtlı. Giriş yapmayı dene.","This email is already registered. Try signing in.");
  if(c.includes('invalid-email')) return window.BH_I18N.pick("E-posta adresi geçersiz görünüyor.","The email address appears to be invalid.");
  if(c.includes('weak-password')) return window.BH_I18N.pick("Şifre en az 6 karakter olmalı.","The password must have at least 6 characters.");
  if(c.includes('user-not-found') || c.includes('wrong-password') || c.includes('invalid-credential')) return window.BH_I18N.pick("E-posta veya şifre yanlış.","Incorrect email or password.");
  return window.BH_I18N.pick("Bir hata oluştu: ","An error occurred: ") + (err.message || c);
}

document.getElementById('signupBtn').onclick = async ()=>{
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errBox = document.getElementById('signupError');
  errBox.textContent = '';
  if(!name || !email || !password){ errBox.textContent = window.BH_I18N.pick("Tüm alanları doldur.","Fill in all fields."); return; }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db,'users',cred.user.uid), { name, email, role:'member', banned:false, phone:'', address:'', photoURL:'', createdAt: new Date().toISOString() });
    try{ await addDoc(collection(db,'posts'), { type:'new_member', uid:cred.user.uid, name, createdAt:new Date().toISOString(), commentCount:0 }); }catch(e){}
  }catch(err){ errBox.textContent = friendlyAuthError(err); }
};

document.getElementById('loginBtn').onclick = async ()=>{
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';
  if(!email || !password){ errBox.textContent = window.BH_I18N.pick("E-posta ve şifreni gir.","Enter your email and password."); return; }
  try{ await signInWithEmailAndPassword(auth, email, password); }
  catch(err){ errBox.textContent = friendlyAuthError(err); }
};

document.getElementById('logoutBtn').onclick = ()=> signOut(auth);

document.getElementById('forgotPasswordLink').addEventListener('click', async (e)=>{
  e.preventDefault();
  const emailField = document.getElementById('loginEmail');
  let email = emailField.value.trim();
  if(!email){ email = prompt(window.BH_I18N.pick("Şifre sıfırlama linki gönderilecek e-posta adresini yaz:","Enter the email address for your password reset link:")) || ''; email = email.trim(); }
  if(!email) return;
  try{
    await sendPasswordResetEmail(auth, email);
    alert(window.BH_I18N.template`${email} adresine şifre sıfırlama linki gönderildi. Gelen kutunu (ve spam klasörünü) kontrol et.`);
  }catch(err){ alert(friendlyAuthError(err)); }
});

document.getElementById('googleAuthBtn').addEventListener('click', async ()=>{
  const provider = new GoogleAuthProvider();
  try{
    await signInWithPopup(auth, provider);
  }catch(err){
    if(err.code && err.code.includes('unauthorized-domain')){
      alert(window.BH_I18N.pick("Bu site adresi Firebase'de yetkili domainler listesinde değil. Firebase konsolu → Authentication → Settings → Authorized domains kısmına bu sitenin adresini eklemen gerekiyor.","This site is not an authorized Firebase domain. Add its address in Firebase Console → Authentication → Settings → Authorized domains."));
    } else if(err.code && err.code.includes('popup-closed-by-user')){
      // kullanıcı pencereyi kapattı, sessizce geç
    } else {
      alert(friendlyAuthError(err));
    }
  }
});

/* ============ TAB TANIMLARI ============ */
const ADMIN_TABS = [
  {id:'social', label:window.BH_I18N.pick("Akış","Feed"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>'},
  {id:'today', label:window.BH_I18N.pick("Bugün","Today"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'},
  {id:'bookhistory', label:window.BH_I18N.pick("Keşfet","Discover"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'},
  {id:'week', label:window.BH_I18N.pick("Kayıtlar","Records"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>'},
  {id:'worms', label:window.BH_I18N.pick("Rozet","Badge"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>'},
  {id:'gifts', label:window.BH_I18N.pick("Hediye","Gift"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"></path></svg>'},
  {id:'mybooks', label:window.BH_I18N.pick("Kitaplığım","My books"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>'},
  {id:'recs', label:window.BH_I18N.pick("Öneriler","Recommendations"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>'}
];
const MEMBER_TABS = [
  {id:'social', label:window.BH_I18N.pick("Akış","Feed"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>'},
  {id:'msurvey', label:window.BH_I18N.pick("Bugün","Today"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'},
  {id:'bookhistory', label:window.BH_I18N.pick("Keşfet","Discover"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'},
  {id:'mtoday', label:window.BH_I18N.pick("Kayıtlar","Records"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>'},
  {id:'mworms', label:window.BH_I18N.pick("Rozet","Badge"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>'},
  {id:'gifts', label:window.BH_I18N.pick("Hediye","Gift"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"></path></svg>'},
  {id:'mybooks', label:window.BH_I18N.pick("Kitaplığım","My books"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>'},
  {id:'recs', label:window.BH_I18N.pick("Öneriler","Recommendations"), icon:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>'}
];
const HAMBURGER_ADMIN_EXTRA = [
  {id:'whoreadtoday', label:window.BH_I18N.pick("Bugün Kim Okudu","Who read today"), icon:'👁'},
  {id:'editpast', label:window.BH_I18N.pick("Geçmiş Düzenle","Edit history"), icon:'✎'},
  {id:'manual', label:window.BH_I18N.pick("Manuel Kura","Manual draw"), icon:'⚙'},
  {id:'qptest', label:window.BH_I18N.pick("Deneme: Ortak Kitap Seçimi","Test: Shared book selection"), icon:'🧪'},
  {id:'goodreadsimport', label:window.BH_I18N.pick("Kütüphaneyi İçe Aktar","Import library"), icon:'📥'},
  {id:'members', label:window.BH_I18N.pick("Üyeler","Members"), icon:'⚈'},
  {id:'rules', label:window.BH_I18N.pick("Grup Kuralları","Club rules"), icon:'§'},
  {id:'settings', label:window.BH_I18N.pick("Ayarlar","Settings"), icon:'⚒'},
  {id:'profile', label:window.BH_I18N.pick("Profilim","My profile"), icon:'◍'}
];
const HAMBURGER_MEMBER_EXTRA = [
  {id:'rules', label:window.BH_I18N.pick("Grup Kuralları","Club rules"), icon:'§'},
  {id:'settings', label:window.BH_I18N.pick("Ayarlar","Settings"), icon:'⚒'},
  {id:'profile', label:window.BH_I18N.pick("Profilim","My profile"), icon:'◍'}
];
// Hamburger menüsü kaldırıldı, herşey Ayarlar sekmesine taşındı (bkz. tab-appsettings). Yukarıdaki
// iki dizi (HAMBURGER_ADMIN_EXTRA/HAMBURGER_MEMBER_EXTRA) hâlâ switchTab()'daki başlık aramasında
// kullanıldığı için duruyor.

let prevTabBeforeProfile = null;
document.getElementById('whoamiClickable').addEventListener('click', ()=>{
  if(activeTab === 'profile'){
    const back = prevTabBeforeProfile;
    prevTabBeforeProfile = null;
    switchTab(back && document.getElementById('tab-'+back) ? back : getTabOrder()[0]);
  } else if(document.getElementById('tab-profile')){
    prevTabBeforeProfile = activeTab;
    switchTab('profile');
  }
});
document.getElementById('notifBellBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  if(profileGateActive){ flashRequiredFields(); showToast(window.BH_I18N.pick("Devam etmek için önce soyad, telefon ve adres bilgilerini doldurup kaydetmen gerekiyor.","Save your surname, phone and address before continuing.")); return; }
  openNotifModal();
});
document.getElementById('hamburgerBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  if(profileGateActive){ flashRequiredFields(); showToast(window.BH_I18N.pick("Devam etmek için önce soyad, telefon ve adres bilgilerini doldurup kaydetmen gerekiyor.","Save your surname, phone and address before continuing.")); return; }
  switchTab('appsettings');
});

function buildNav(){
  const tabs = materialPrimaryTabs();
  renderMaterialNav();
  materialInit();
  let languageReturn=false;try{languageReturn=sessionStorage.getItem('bookhook_language_return')==='settings';sessionStorage.removeItem('bookhook_language_return');}catch(e){}
  switchTab(profileGateActive ? 'profile' : languageReturn ? 'settings' : tabs[0].id);
}

function getTabOrder(){ return materialPrimaryTabs().map(t=>t.id); }
let profileGateActive = false;
const PROFILE_GATE_FIELDS = ['profileSurname','profilePhone','profileAddress'];
function flashRequiredFields(){
  let anyEmpty = false;
  PROFILE_GATE_FIELDS.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    if(!el.value.trim()){
      anyEmpty = true;
      el.classList.remove('field-flash-error');
      void el.offsetWidth;
      el.classList.add('field-flash-error');
    }
  });
  return anyEmpty;
}
let lastTabSwitchTime = 0;
// Bazı bildirimler (ör. hatırlatma push'u, "X bugün okudum işaretledi") tek bir sekme id'siyle hem
// üyelere hem yöneticilere gönderiliyor. Üye ve yönetici arayüzlerinde aynı işi gören ama farklı
// id'li sekmeler olduğu için (Bugün: msurvey/today, Kayıtlar: mtoday/week, Rozet: mworms/worms),
// bildirime tıklanınca kullanıcının KENDİ rolündeki karşılığa gitmesi lazım — yoksa örneğin bir
// yönetici üyelerin "Bugün" sekmesine düşer ve orada sağa/sola kaydırarak diğer sekmelerine
// geçemez (çünkü o sekme kendi sekme setinin bir parçası değildir).
const TAB_ROLE_EQUIVALENTS = { msurvey:'today', today:'msurvey', mtoday:'week', week:'mtoday', mworms:'worms', worms:'mworms' };
const MEMBER_SIDE_TAB_IDS = ['msurvey','mtoday','mworms'];
function resolveNotifTab(tabId){
  if(!tabId) return tabId;
  const equiv = TAB_ROLE_EQUIVALENTS[tabId];
  if(!equiv) return tabId; // ortak sekme (ör. gifts, mybooks, settings) — dönüşüm gerekmez
  const isAdmin = myProfile && myProfile.role==='admin';
  const tabIsMemberSide = MEMBER_SIDE_TAB_IDS.includes(tabId);
  if(isAdmin && tabIsMemberSide) return equiv;
  if(!isAdmin && !tabIsMemberSide) return equiv;
  return tabId;
}
// Üstteki sekme başlığı değişirken eskisi silinip yerine yenisi giren küçük bir animasyonla
// değişsin diye — switchTab() (buton/tıklama ile) ve materialSyncNavigation() (kaydırma anında,
// parmak kalkar kalkmaz) her ikisi de aynı yardımcı fonksiyonu çağırıyor.
function setTabTitleAnimated(newText){
  const el = document.getElementById('currentTabTitle');
  if(!el) return;
  // Kaydırma anında hem parmak kalkar kalkmaz (materialSyncNavigation) hem de içerik gerçekten
  // değişince (switchTab, ~240ms sonra) bu fonksiyon aynı hedef metinle iki kez çağrılıyor.
  // Animasyon sürerken el.textContent, iki <span>'in birleşimi (ör. "BugünAkış") olduğu için
  // güvenilir değil — bunun yerine son hedeflenen metni ayrıca saklayıp ona göre kısa devre
  // yapıyoruz, yoksa ikinci çağrı yarım kalan animasyonu yeniden başlatıp metni birbirine katardı.
  const currentTarget = el._titleTarget!==undefined ? el._titleTarget : el.textContent;
  if(currentTarget===newText) return;
  if(el._titleAnimTimeout){ clearTimeout(el._titleAnimTimeout); el._titleAnimTimeout=null; }
  const oldText = currentTarget;
  el._titleTarget = newText;
  el.classList.add('title-animating');
  el.innerHTML = `<span class="tab-title-piece tab-title-out">${escapeHtml(oldText)}</span><span class="tab-title-piece tab-title-in">${escapeHtml(newText)}</span>`;
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ el.classList.add('title-animate-run'); }); });
  el._titleAnimTimeout = setTimeout(()=>{
    el.classList.remove('title-animating','title-animate-run');
    el.textContent = newText;
    el._titleAnimTimeout = null;
  }, 260);
}
// switchTab() ve kaydırma jestinin parmak-kalkar-kalkmaz senkronizasyonu aynı etiket kaynağını
// kullansın diye — materialSyncNavigation()'daki names haritası yalnızca hub-kökü olan
// sekmeleri kapsıyor (ör. "Akış" orada yok), o yüzden birincil sekmelerin tümü için başlık bunu
// kullanmalı.
function getTabLabel(id){
  // ADMIN_TABS/MEMBER_TABS eski (hub'lar öncesi) sekme listeleri — 'club'/'library' gibi hub-kökü
  // id'leri hiç içermiyor. materialPrimaryTabs() eklenmezse getTabLabel('club') boş dönüyor;
  // switchTab() bunu "etiket yok" sanıp başlığı '' ile SİLİYOR (bkz. titleEl.textContent=''), ve
  // eğer o an setTabTitleAnimated'ın kendi _titleTarget'ı zaten aynı metne eşitse (ör. swipe'ın
  // touchend'te hemen çağırdığı materialSyncNavigation bunu önceden ayarlamışsa), sonraki
  // düzeltme çağrısı "hedef zaten aynı" diye kısa devre yapıp görünen metni hiç geri doldurmuyor
  // — başlık kalıcı olarak boş kalıyor. Kök neden burada.
  const allTabDefs = [...ADMIN_TABS, ...MEMBER_TABS, ...HAMBURGER_ADMIN_EXTRA, ...HAMBURGER_MEMBER_EXTRA, ...materialPrimaryTabs()];
  const def = allTabDefs.find(t=>t.id===id);
  return def ? def.label : '';
}
function switchTab(id, { animate = true } = {}){
  if(['club','library'].includes(id)&&hubLayoutMode(id)==='primary')id=hubSubtabEntries(id)[0][0];
  lastTabSwitchTime = Date.now();
  if(typeof closeReactionDrawer==='function') closeReactionDrawer();
  if(profileGateActive && id!=='profile'){
    flashRequiredFields();
    showToast(window.BH_I18N.pick("Devam etmek için önce soyad, telefon ve adres bilgilerini doldurup kaydetmen gerekiyor.","Save your surname, phone and address before continuing."));
    return;
  }
  if(typeof HUB_PARENT!=='undefined' && HUB_PARENT[id] && hubLayoutMode(HUB_PARENT[id])!=='primary' && !(typeof HUB_NO_ACCORDION!=='undefined' && HUB_NO_ACCORDION.has(id))){
    const hubId = HUB_PARENT[id];
    switchTab(hubId);
    requestAnimationFrame(()=>{
      const item = document.querySelector(`.hub-item[data-hub-target="${id}"]`);
      if(item){ materialExpandHubItem(item, id); item.scrollIntoView({behavior:'smooth', block:'start'}); }
    });
    return;
  }
  const order = getTabOrder();
  const oldIdx = order.indexOf(activeTab);
  const newIdx = order.indexOf(id);
  let direction = 'fade';
  if(oldIdx!==-1 && newIdx!==-1 && oldIdx!==newIdx){
    direction = newIdx > oldIdx ? 'right' : 'left';
  }
  activeTab = id;
  document.querySelectorAll('nav.tabs button').forEach(b=> b.classList.toggle('active', b.dataset.tab===id));
  document.querySelectorAll('section.tab').forEach(s=> s.classList.remove('active','anim-from-right','anim-from-left','anim-fade'));
  const sec = document.getElementById('tab-'+id);
  if(sec){
    // Swipe zaten tamamlandıysa giriş animasyonuyla sayfayı yeniden soldurma.
    // Normal sekme tıklamalarında CSS animasyonunu geri etkinleştir.
    sec.style.animation = animate ? '' : 'none';
    sec.classList.add('active');
    sec.classList.add(direction==='right' ? 'anim-from-right' : direction==='left' ? 'anim-from-left' : 'anim-fade');
  }
  const label = getTabLabel(id);
  const titleEl = document.getElementById('currentTabTitle');
  if(titleEl){ if(label) setTabTitleAnimated(label); else titleEl.textContent = ''; }
  const socialFab = document.getElementById('socialFloatingAction');
  if(socialFab) socialFab.classList.toggle('hidden', id!=='social');
  if(typeof updateDiscoverFabVisibility==='function') updateDiscoverFabVisibility();
  materialSyncNavigation(id);
  renderTab(id);
}

/* Alt panel: normal tarayıcıda görünür viewport farkını telafi et.
   iOS ana ekran uygulamasında fixed + safe-area konumuna ayrıca bu farkı ekleme;
   geçici viewport farkı paneli gereksiz yere yukarı taşıyabilir. */
(function stabilizeBottomNav(){
  const nav = document.getElementById('sidebarNav');
  if(!nav || !window.visualViewport) return;
  const mq = window.matchMedia('(max-width:700px)');
  const standalone = window.matchMedia('(display-mode: standalone)');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  function update(){
    const iosHomeScreen = navigator.standalone===true || (isIOS && standalone.matches);
    if(!mq.matches || iosHomeScreen){ nav.style.transform = ''; return; }
    const vv = window.visualViewport;
    const gap = window.innerHeight - (vv.offsetTop + vv.height);
    nav.style.transform = gap > 0.5 ? `translateY(${-gap}px)` : '';
  }
  window.addEventListener('pageshow', update);
  if(standalone.addEventListener) standalone.addEventListener('change', update);
  window.visualViewport.addEventListener('resize', update);
  window.visualViewport.addEventListener('scroll', update);
  if(mq.addEventListener) mq.addEventListener('change', update); else mq.addListener(update);
  update();
})();

/* ============ SEKMELER ARASI KAYDIRMA (SWIPE) — parmakla birlikte anlık kayar, hedef sekme
   kenardan GERÇEK içeriğiyle (kart içi sekme karuseli gibi) girer. Komşu sekmenin DOM'da zaten
   var olan (önceden ziyaret edildiyse dolu, edilmediyse henüz boş) bölümü gösterilir —
   renderTab() jest sırasında ASLA ikinci kez çağrılmaz, bu yüzden çift Firestore dinleyicisi ya
   da ekstra sorgu maliyeti oluşmaz; gerçek veri tazeleme her zaman olduğu gibi jest tamamlanıp
   switchTab() çalıştığında olur. Animasyon sürerken dikey kaydırmayı kilitler, iOS/Android'deki
   gibi mesafe + hız kombinasyonuyla karar verir ============ */
(function setupSwipeNav(){
  let touchStartX=null, touchStartY=0, dragging=false, containerWidth=0, pendingSettleTimeout=null, pendingFinish=null;
  let motionSamples=[];
  let previewCurrentSection=null, previewTargetSection=null, previewGoingNext=false, previewTargetIdx=-1, previewGap=0, previewWidth=0;
  let moveFrame=null, queuedDx=0, previewRect=null, transitionListener=null;
  let pointerId=null, recoveryTimer=null;
  const contentCol = document.querySelector('.content-col > main');
  const DISTANCE_THRESHOLD_RATIO = 0.5; // klasik iOS/Android varsayılanı: genişliğin yarısı
  const VELOCITY_THRESHOLD = 0.35; // piksel/ms — bunun üzerindeki hızlı "fiske"ler mesafe şartını atlar

  // Son iki olay yerine kısa bir hareket penceresi: parmak kalkmadan önce gelen
  // aynı konumlu son olay hızlı fiskenin hızını sıfırlamasın.
  function recordMotion(x, time){
    const last=motionSamples[motionSamples.length-1];
    if(last && time===last.time) last.x=x;
    else motionSamples.push({x,time});
    while(motionSamples.length>2 && motionSamples[1].time < time-120) motionSamples.shift();
  }
  function releaseVelocity(x, time){
    recordMotion(x,time);
    const cutoff=time-100;
    let start=motionSamples[0];
    for(let i=1;i<motionSamples.length;i++){
      const next=motionSamples[i];
      if(next.time>=cutoff){
        if(start.time<cutoff && next.time>start.time){
          const fraction=(cutoff-start.time)/(next.time-start.time);
          start={x:start.x+(next.x-start.x)*fraction,time:cutoff};
        }
        break;
      }
      start=next;
    }
    const dt=time-start.time;
    return dt>0 ? (x-start.x)/dt : 0;
  }

  function resetSection(section, hide){
    if(!section) return;
    section.style.position = '';
    section.style.top = '';
    section.style.left = '';
    section.style.width = '';
    section.style.transform = '';
    section.style.transition = '';
    section.style.zIndex = '';
    section.style.pointerEvents = '';
    section.style.willChange = '';
    if(hide) section.style.display = '';
  }
  function cleanupPreview(){
    if(moveFrame!==null){ cancelAnimationFrame(moveFrame); moveFrame=null; }
    if(transitionListener && previewCurrentSection) previewCurrentSection.removeEventListener('transitionend', transitionListener);
    transitionListener=null;
    if(pendingSettleTimeout){ clearTimeout(pendingSettleTimeout); pendingSettleTimeout=null; }
    previewRect=null;
    resetSection(previewTargetSection, true);
    resetSection(previewCurrentSection, false);
    previewCurrentSection = null;
    previewTargetSection = null;
    previewTargetIdx = -1;
  }
  // Hedef sekmeyi (DOM'da zaten var olan ama aktif olmayan <section>) mevcut sekmenin tam
  // yanına, onun GERÇEK render edilmiş dikdörtgenine göre konumlandırır (position:fixed ile —
  // main'in padding'iyle ilgili yüzde hesaplarıyla uğraşmaya hiç gerek kalmıyor).
  function beginPreview(currentSection, targetSection, targetIdx, goingNext){
    const rect = previewRect || (previewRect = currentSection.getBoundingClientRect());
    // İki sekme birbirine dip dibe kaymasın — mevcut sekmenin sağ/sol kenarındaki inset ile
    // hedef sekmenin kendi kenarındaki inset TOPLANARAK (main'in yatay padding'inin iki katı)
    // aradaki boşluk belirlenir. Bu boşluk sadece sürükleme SIRASINDA görünür; jest tamamlanınca
    // hedef tam olarak mevcut sekmenin durduğu yere oturur, boşluk kaybolur.
    const gap = (parseFloat(getComputedStyle(contentCol).paddingLeft) || 0) * 2;
    previewCurrentSection = currentSection;
    previewTargetSection = targetSection;
    previewTargetIdx = targetIdx;
    previewGoingNext = goingNext;
    previewGap = gap;
    previewWidth = rect.width;
    targetSection.style.transition = 'none';
    targetSection.style.display = 'block';
    targetSection.style.position = 'fixed';
    // Hedef, geçiş sonunda scroll=0 iken duracağı yükseklikten girsin.
    targetSection.style.top = (rect.top + window.scrollY) + 'px';
    targetSection.style.left = (rect.left + (goingNext ? rect.width+gap : -(rect.width+gap))) + 'px';
    targetSection.style.width = rect.width + 'px';
    targetSection.style.zIndex = '1';
    targetSection.style.pointerEvents = 'none';
    targetSection.style.willChange = 'transform';
    currentSection.style.transition = 'none';
    currentSection.style.willChange = 'transform';
  }
  function updatePreview(dx){
    if(!previewCurrentSection || !previewTargetSection) return;
    previewCurrentSection.style.transform = `translateX(${dx}px)`;
    previewTargetSection.style.transform = `translateX(${dx}px)`;
  }
  // Çok sayıdaki touchmove olayını ekran başına tek görsel güncellemeye indir.
  function queuePreview(dx){
    queuedDx=dx;
    if(moveFrame===null) moveFrame=requestAnimationFrame(()=>{
      moveFrame=null;
      updatePreview(queuedDx);
    });
  }
  function settlePreview(dx, animate){
    if(moveFrame!==null){
      cancelAnimationFrame(moveFrame); moveFrame=null;
      updatePreview(queuedDx);
      // Son parmak konumu transition başlangıcı olarak işlensin (yalnızca bırakırken).
      if(previewCurrentSection) getComputedStyle(previewCurrentSection).transform;
    }
    if(!previewCurrentSection || !previewTargetSection) return;
    const transition = animate ? 'transform 0.24s cubic-bezier(0.25,0.8,0.25,1)' : 'none';
    previewCurrentSection.style.transition = transition;
    previewTargetSection.style.transition = transition;
    previewCurrentSection.style.transform = `translateX(${dx}px)`;
    previewTargetSection.style.transform = `translateX(${dx}px)`;
  }
  // Sürüklerken yön tersine dönerse (kullanıcı vazgeçip tam tersine gitmeye başlarsa) önizlemeyi
  // yeni yön için baştan kurar; yeni yön sınır dışındaysa (ör. ilk sekmede geri gitmeye çalışmak)
  // false döner — çağıran yer bu durumda dx'i 0'da kelepçeler, önizleme olduğu yerde durur.
  function maybeFlipDirection(goingNextNow){
    if(goingNextNow===previewGoingNext || !previewCurrentSection) return true;
    const order = getTabOrder();
    const idx = order.indexOf(activeTab);
    const targetIdx = goingNextNow ? idx+1 : idx-1;
    if(targetIdx<0 || targetIdx>=order.length) return false;
    const targetSection = document.getElementById('tab-'+order[targetIdx]);
    if(!targetSection) return false;
    resetSection(previewTargetSection, true);
    beginPreview(previewCurrentSection, targetSection, targetIdx, goingNextNow);
    return true;
  }
  function releaseGesture(){
    clearTimeout(recoveryTimer); recoveryTimer=null;
    const id=pointerId; pointerId=null;
    if(id!==null && contentCol.hasPointerCapture(id)) contentCol.releasePointerCapture(id);
  }
  function cancelGesture(){
    touchStartX=null;
    const wasDragging=dragging;
    dragging=false;
    releaseGesture();
    if(!wasDragging) return;
    settlePreview(0, true);
    pendingFinish=()=>{ cleanupPreview(); pendingFinish=null; };
    waitForSettle();
  }
  function armRecovery(){
    clearTimeout(recoveryTimer);
    // Sonlandırma olayı gerçekten kaybolursa ekran yarıda kalmasın.
    recoveryTimer=setTimeout(cancelGesture, 1200);
  }
  function waitForSettle(){
    const section=previewCurrentSection;
    const finish=()=>{
      const callback=pendingFinish;
      pendingFinish=null;
      if(callback) callback();
    };
    transitionListener=e=>{
      if(e.target===section && e.propertyName==='transform') finish();
    };
    if(section) section.addEventListener('transitionend', transitionListener);
    // Gizli sekme / iptal edilen transition için güvenlik ağı; normal bitiş olayla gelir.
    pendingSettleTimeout=setTimeout(finish, 400);
  }
  function interruptGesture(){
    touchStartX=null; dragging=false;
    if(pendingFinish){ const finish=pendingFinish; pendingFinish=null; finish(); }
    cleanupPreview(); releaseGesture();
  }
  window.addEventListener('blur', interruptGesture);
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden) interruptGesture();
  });

  document.addEventListener('pointerdown', (e)=>{
    if(e.pointerType!=='touch' && e.pointerType!=='pen') return;
    if(!e.isPrimary){ cancelGesture(); return; }
    if(pointerId!==null) cancelGesture();
    // Önceki jestin 240ms'lik yerleşme süresi bitmeden yeni bir jest başlamış olabilir (hızlı art
    // arda kaydırma). O süre boyunca alt sekme çubuğu ve başlık ZATEN yeni sekmeyi gösteriyor
    // (touchend'te hemen güncelleniyorlar) ama gerçek switchTab() — activeTab'ı ve .active
    // sınıfını güncelleyen — hâlâ bekliyor. Bu bekleyen işlemi burada sessizce iptal edip
    // atlarsak, nav/başlık YENİ sekmeyi gösterirken DOM'daki gerçek aktif section hâlâ ESKİ
    // sekmede kalır — ekran, yeni jest başlar başlamaz eski içeriğe sıçrayarak "jerk" eder ve bir
    // sonraki jest de artık yanlış (eski) sekmeden hesaplama yapar. Onun yerine bekleyen işlemi
    // burada HEMEN (senkron) çalıştırıp DOM'u nav/başlıkla senkronize tutuyoruz.
    if(pendingSettleTimeout){ clearTimeout(pendingSettleTimeout); pendingSettleTimeout=null; }
    if(pendingFinish){ pendingFinish(); }
    cleanupPreview(); // her ihtimale karşı savunma amaçlı ikinci bir temizlik
    releaseGesture();
    const t = e.target;
    // Kart içi sekmesi olan bir alanda (ör. genişlemiş "Kayıtlar"/"Kitaplığım" kartındaki
    // Kulüp/Ben, Okuyorum/İstek listem/Geçmişim gibi iç sekmeler) dokunuş başlıyorsa, sayfa
    // seviyesindeki bu sekmeler-arası kaydırmayı hiç başlatma — o alan kendi kart-içi kaydırmasını
    // ayrıca yönetiyor (bkz. setupInnerPaneCarousels).
    if(!contentCol.contains(t) || t.closest('input,textarea,select,[contenteditable=true]') || t.closest('header.top') || t.closest('nav.tabs') || t.closest('#profileModal') || t.closest('#notifModal') || (t.closest('.inner-pane-viewport')&&!t.closest('.hub-flat')) || (t.closest('#discoverFeed')&&hubLayoutMode('library')!=='primary')){
      touchStartX=null; return;
    }
    pointerId=e.pointerId;
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    dragging = false;
    motionSamples=[];
    recordMotion(e.clientX,e.timeStamp);
    containerWidth = contentCol.offsetWidth || window.innerWidth;
  }, {passive:true, capture:true});

  document.addEventListener('pointermove', (e)=>{
    if(e.pointerId!==pointerId) return;
    if(touchStartX===null || !myProfile) return;
    const touch = e;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if(!dragging){
      // Dikey kaydırmayı gereksiz yere kilitlememek için yön belirsizken bekliyoruz. Eşik önceden
      // gevşekti — bu, hafifçe dikey başlayıp sonra yataya dönen jestlerde tarayıcının önce
      // scroll'a karar verip sonra bizimle çakışmasına (jitter/takılmaya) sebep oluyordu. Şimdi
      // çok daha net bir yatay üstünlük istiyoruz.
      if(Math.abs(dx) < 5 || Math.abs(dx) <= Math.abs(dy)*2.2) return;
      const order = getTabOrder();
      const idx = order.indexOf(activeTab);
      if(idx===-1 || profileGateActive || (dx<0 && idx>=order.length-1) || (dx>0 && idx<=0)){ touchStartX=null; return; }
      const goingNext = dx < 0;
      const targetIdx = goingNext ? idx+1 : idx-1;
      const currentSection = contentCol.querySelector(':scope > section.tab.active');
      const targetSection = document.getElementById('tab-'+order[targetIdx]);
      if(!currentSection || !targetSection){ touchStartX=null; return; }
      dragging = true;
      beginPreview(currentSection, targetSection, targetIdx, goingNext);
      // Hareket eden / yeniden çizilen kart yerine kalıcı main öğesi dokunuşu tutsun.
      try { contentCol.setPointerCapture(e.pointerId); } catch(_) { cancelGesture(); return; }
    }
    if(dragging && e.cancelable) e.preventDefault();
    recordMotion(e.clientX,e.timeStamp);
    if(dragging){
      const goingNextNow = dx < 0;
      const canFollow = maybeFlipDirection(goingNextNow);
      queuePreview(canFollow ? dx : 0);
      armRecovery();
    }
  }, {passive:false, capture:true});

  document.addEventListener('pointerup', (e)=>{
    if(e.pointerId!==pointerId) return;
    if(touchStartX===null) return;
    const touch = e;
    const dx = touch.clientX - touchStartX;
    touchStartX = null;
    if(!dragging){ releaseGesture(); return; }
    dragging = false;
    releaseGesture();
    const order = getTabOrder();
    const idx = order.indexOf(activeTab);
    const goingNext = dx < 0;
    // Yön, jest sırasında tersine dönmüş olabilir — önizlemenin şu an GERÇEKTEN hangi sekmeye
    // kurulu olduğunu (previewGoingNext/previewTargetIdx) esas alıyoruz, dx'in çiğ işaretini değil.
    const canComplete = previewCurrentSection && goingNext===previewGoingNext && previewTargetIdx>=0;
    const distanceOk = Math.abs(dx) > containerWidth * DISTANCE_THRESHOLD_RATIO;
    const velocity = releaseVelocity(e.clientX,e.timeStamp);
    const flickOk = Math.abs(dx)>=20 && Math.abs(velocity)>VELOCITY_THRESHOLD && Math.sign(velocity)===Math.sign(dx);
    const shouldComplete = canComplete && idx!==-1 && (distanceOk || flickOk);
    if(shouldComplete){
      const targetIdx = previewTargetIdx;
      // NOT: burada containerWidth (main'in KENDİ, padding'i de içeren offsetWidth'i) değil,
      // previewWidth (kayan section'ın GERÇEK render genişliği, yani main'in İÇERİK genişliği)
      // kullanılıyor — bu ikisi main'in kendi yatay padding'i kadar farklı, containerWidth
      // kullanmak hedefi olması gerekenden fazla kaydırıp (jest bittiğinde inline stiller
      // temizlenip section normal akışa dönünce) bir "düzeltme sıçraması" oluşturuyordu.
      const flyDist = goingNext ? -(previewWidth+previewGap) : (previewWidth+previewGap);
      settlePreview(flyDist, true);
      // Alt sekme çubuğunun hangi sekmenin aktif olduğu, parmağın kalktığı an belli olur — bunu
      // içerik kayma animasyonunun bitmesini (240ms) beklemeden hemen burada güncelliyoruz.
      // Yoksa eski sekme, kaybolan içerikle birlikte hâlâ "highlighted" görünmeye devam ediyor ve
      // .tab-icon'daki arka plan geçişiyle (0.2s) çakışıp bir an iki sekme de vurgulanmış gibi
      // görünebiliyordu. switchTab() içeride aynı senkronizasyonu tekrar yapacak ama bu, zararsız
      // bir tekrardır (idempotent).
      if(typeof materialSyncNavigation==='function') materialSyncNavigation(order[targetIdx], { resetScroll: false });
      // materialSyncNavigation() başlığı yalnızca hub-kökü sekmeler için değiştiriyor (ör. "Akış"
      // orada yok) — birincil sekmelerin tümünde başlık aynı anda değişsin diye ayrıca burada da
      // kesin kaynaktan (getTabLabel) çağırıyoruz; switchTab() 240ms sonra aynı metinle tekrar
      // çağıracak ama setTabTitleAnimated zaten hedef aynıysa no-op.
      if(typeof getTabLabel==='function' && typeof setTabTitleAnimated==='function'){
        const nextLabel = getTabLabel(order[targetIdx]);
        if(nextLabel) setTabTitleAnimated(nextLabel);
      }
      pendingFinish = ()=>{
        cleanupPreview();
        switchTab(order[targetIdx], { animate: false });
        pendingFinish = null;
      };
      waitForSettle();
    } else {
      settlePreview(0, true);
      pendingFinish = ()=>{ cleanupPreview(); pendingFinish=null; };
      waitForSettle();
    }
  }, {passive:true, capture:true});

  document.addEventListener('pointercancel', e=>{
    if(e.pointerId===pointerId) cancelGesture();
  }, {capture:true});
  contentCol.addEventListener('lostpointercapture', e=>{
    if(e.target===contentCol && e.pointerId===pointerId) cancelGesture();
  });
})();

function renderTab(id){
  if(id==='recs'&&hubLayoutMode('library')==='primary'){renderAiRecCard();syncAiHubLayout();}
  if(id===materialRoute('records')&&hubLayoutMode('club')==='primary')materialRenderClub();
  if(id==='club'||id==='library'){applyHubLayout(id,{render:true});if(!hubLayoutEnabled(id))hubPreviews.sync(id);}
  if(id==='club') { materialRenderClub(); return; }
  if(id==='library') { renderAiRecCard(); return; }
  if(id==='appsettings') { return; }
  if(id==='quarterly') { renderQuarterlyPickCard(); return; }
  if(id==='admin') { renderSettingsTab(); renderAdminDraws(); return; }
  if(id==='today') renderAdminSelfToday();
  else if(id==='whoreadtoday') renderAdminToday();
  else if(id==='editpast'){ renderEditPastTab(); editPastWeekOffset=0; renderEditPastWeekReport(); }
  else if(id==='week'){ renderAdminWeek(); adminWeekOffset=0; renderAdminOwnWeek(); }
  else if(id==='gifts'){
    renderGiftsTab();
    renderGiftBooksGrid();
    if(myProfile.role==='admin'){ drawHistIndex.a=0; renderDrawHistoryCard('a'); }
    else { renderMemberLastWeek(); drawHistIndex.m=0; renderDrawHistoryCard('m'); }
  }
  else if(id==='manual') renderManualTab();
  else if(id==='qptest') renderQpTestTab();
  else if(id==='goodreadsimport') renderGoodreadsImportTab();
  else if(id==='members') renderAdminMembers();
  else if(id==='worms') renderAdminWorms();
  else if(id==='msurvey') renderMemberSurvey();
  else if(id==='mtoday'){ renderWeekReportTable(getMonday(nowLogical()), 'mWeekGridAll'); memberWeekOffset=0; renderMemberOwnWeek(); }
  else if(id==='settings'){ renderSettingsTab(); if(myProfile.role==='admin') renderAdminDraws(); }
  else if(id==='mworms') renderMemberWorms();
  else if(id==='rules') renderRulesTab();
  else if(id==='profile') renderProfileTab();
  else if(id==='recs') renderRecsTab();
  else if(id==='bookhistory'){
    renderBookHistoryTab();
    positionDiscoverFabs();
  }
  else if(id==='mybooks') renderMyBooksTab();
  else if(id==='social'){
    document.getElementById('socialFloatingAction').classList.remove('hidden');
    document.getElementById('socialPillBar').style.display = 'none';
    document.getElementById('socialFeedView').style.display = 'block';
    document.getElementById('socialProfileView').style.display = 'none';
    lastSocialScrollY = window.scrollY;
    renderTimelineTab();
  }
}

function renderHeader(){
  document.getElementById('whoamiAvatar').innerHTML = avatarHtmlFromProfile(myProfile,18);
  document.getElementById('whoamiName').textContent = myProfile.name;
  document.querySelectorAll('[data-material-name]').forEach(el=>el.textContent=myProfile.name||'');
}

/* ============ FIRESTORE YARDIMCILARI ============ */
function dayAnswersCol(dateStr){ return collection(db,'days',dateStr,'answers'); }
async function fetchDayAnswers(dateStr){
  const snap = await getDocs(dayAnswersCol(dateStr));
  const map = {};
  snap.forEach(d=> map[d.id] = { status: d.data().status, auto: !!d.data().auto });
  return map;
}
async function markStatus(uid, status, pages=null){
  const t = todayStr();
  const ref = doc(db,'days',t,'answers',uid);
  const current = todayAnswers[uid];
  if(current === status){
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { status, name: usersCache[uid]?.name || '', updatedAt: new Date().toISOString(), ...(status==='read'&&Number.isSafeInteger(pages)&&pages>=15?{pages}:{}) });
  }
}
async function computeWeekStats(monday){
  const dates = weekDates(monday);
  const weekMondayStr = dates[0];
  const weekSundayStr = dates[6];
  const perDate = await Promise.all(dates.map(fetchDayAnswers));
  return activeUids().map(uid=>{
    const joinDs = joinDateStrOf(uid);
    // Bir üye bu hafta içinde, Pazartesi DIŞINDA bir günde katıldıysa, sadece bu haftanın
    // kurasına dahil edilmez (marked:0 vererek eleniyor); sonraki haftalarda normal katılır.
    if(joinDs && joinDs > weekMondayStr && joinDs <= weekSundayStr){
      return {uid, name: usersCache[uid]?.name || '?', miss:0, read:0, marked:0, joinDate: joinDs||'', joinedAt: joinedAtOf(uid)};
    }
    // Kapanmış (bugünden önceki) bir günde hiç kayıt yoksa o gün "okumadı" sayılır — 06:00'daki
    // otomatik doldurmanın yazacağıyla aynı kural. Eskiden kayıtsız gün hiç sayılmıyordu; kura
    // otomatik doldurmadan önce çekilirse (ör. Pazar) biri cezalı yerine paslı görünebiliyordu.
    const today = todayStr();
    let miss=0, read=0, autoMiss=0;
    perDate.forEach((map,i)=>{
      const rec=map[uid], ds=dates[i];
      if(rec){ if(rec.status==='skip') miss++; else if(rec.status==='read') read++; }
      else if(ds<today && ds>=CLUB_START_DATE && !(joinDs && ds<joinDs)){ miss++; autoMiss++; }
    });
    return {uid, name: usersCache[uid]?.name || '?', miss, read, marked: miss+read, joinDate: joinDs||'', joinedAt: joinedAtOf(uid), autoMiss};
  });
}
// Kapanmış (geçmiş) günlerde hiç işaretleme yapılmamışsa otomatik "okumadı" yazar.
// Sadece yönetici girişinde çalışır (yazma izni ve merkezi tetikleme için).
const CLUB_START_DATE = '2026-07-06'; // Bu tarihten önce hiçbir gün için kayıt yok/tutulmuyor
function logicalDateStrOf(d){
  const copy = new Date(d);
  if(isNaN(copy.getTime())) return null;
  if(copy.getHours()<6) copy.setDate(copy.getDate()-1);
  copy.setHours(0,0,0,0);
  return toStr(copy);
}
function joinDateStrOf(uid){
  const u = usersCache[uid];
  if(!u || !u.createdAt) return null;
  return logicalDateStrOf(new Date(u.createdAt));
}
async function autoFillPastDays(daysBack){
  daysBack = daysBack || 30;
  const uids = activeUids();
  if(uids.length===0) return 0;
  // Önceden 30 gün birbirini bekleyerek (her gün kendi içinde üyeler arası paralel olsa da,
  // günler arası SIRALI) işleniyordu — bu, yönetici uygulamayı her açtığında saniyelerce
  // sürebiliyordu. Artık gün×üye kombinasyonlarının HEPSİ tek seferde, aynı anda çekiliyor.
  const tasks = [];
  for(let i=1;i<=daysBack;i++){
    const ds = toStr(addDays(nowLogical(), -i));
    if(ds < CLUB_START_DATE) continue; // kulüp başlamadan önceki günler asla doldurulmaz
    uids.forEach(uid=>{
      const joinDs = joinDateStrOf(uid);
      if(joinDs && ds < joinDs) return; // üye olmadan önceki günler doldurulmaz, boş kalır
      tasks.push({ds, uid});
    });
  }
  const results = await Promise.all(tasks.map(async ({ds,uid})=>{
    const ref = doc(db,'days',ds,'answers',uid);
    const snap = await getDoc(ref);
    if(!snap.exists()){
      await setDoc(ref, { status:'skip', name: usersCache[uid]?.name || '', updatedAt: new Date().toISOString(), auto:true });
      return 1;
    }
    return 0;
  }));
  return results.reduce((a,b)=>a+b,0);
}
// Daha önce (bu düzeltmeden önce) yanlışlıkla, kulüp başlamadan veya kişi üye olmadan önceki
// günler için otomatik "okumadı" yazılmış olabilir. Bu, o hatalı otomatik kayıtları temizler.
// Sadece auto:true (otomatik oluşturulmuş) kayıtları siler, elle girilmiş hiçbir veriye dokunmaz.
async function cleanupBadAutoFills(daysBack){
  daysBack = daysBack || 60;
  const uids = Object.keys(usersCache);
  let deleted = 0;
  for(let i=0;i<=daysBack;i++){
    const ds = toStr(addDays(nowLogical(), -i));
    const beforeClub = ds < CLUB_START_DATE;
    for(const uid of uids){
      const joinDs = joinDateStrOf(uid);
      const beforeJoin = joinDs && ds < joinDs;
      if(!beforeClub && !beforeJoin) continue;
      try{
        const ref = doc(db,'days',ds,'answers',uid);
        const snap = await getDoc(ref);
        if(snap.exists() && snap.data().auto){
          await deleteDoc(ref);
          deleted++;
        }
      }catch(e){}
    }
  }
  return deleted;
}
// Bir üyenin TÜM geçmişini (kulüp başlangıcından ya da katılım tarihinden dünе kadar)
// gün gün yeniden oynatarak rozet geçmişini (badgeCounts) sıfırdan, doğru mantıkla hesaplar.
// Sadece tamamlanmış (bozulmuş) serileri sayar; bugünü bu fonksiyon işlemez, bugünün
// katkısı ayrıca computeStreak + checkAndAwardBadges ile eklenir.
async function recomputeUserBadgeHistory(uid){
  const u = usersCache[uid];
  if(!u) return;
  const joinDs = joinDateStrOf(uid);
  const startDs = (joinDs && joinDs > CLUB_START_DATE) ? joinDs : CLUB_START_DATE;
  const yesterday = addDays(nowLogical(), -1);
  const dateStrs = [];
  let cursor = fromStr(startDs);
  while(toStr(cursor) <= toStr(yesterday)){ dateStrs.push(toStr(cursor)); cursor = addDays(cursor,1); }
  // Günleri tek tek sırayla değil, hepsini aynı anda (paralel) çekiyoruz; sıralı olan artık
  // sadece hesaplama (seri/rozet sayımı) — o hâlâ sırayla ama ağ beklemeden, hafızada yapılıyor.
  // Okunamayan bir gün "okumadı" sayılırsa rozet geçmişi yanlış yeniden yazılırdı; hata fırlatıp
  // bu üyeyi hiç güncellemeden bırakıyoruz.
  const snaps = await Promise.all(dateStrs.map(ds=> getDoc(doc(db,'days',ds,'answers',uid))));
  const {badgeCounts, streak, tier} = replayBadgeHistory(snaps.map(snap=> snap.exists() ? snap.data().status : null));
  const updates = { badgeCounts, lastStreak: streak, currentTier: tier, currentStreak: streak };
  try{
    await updateDoc(doc(db,'users',uid), updates);
    Object.assign(u, updates);
  }catch(e){}
}
async function resetAndRecomputeAllBadges(){
  const uids = activeUids();
  let done = 0, failed = 0;
  for(const uid of uids){
    try{ await recomputeUserBadgeHistory(uid); }catch(_){ failed++; continue; }
    try{ const liveStreak = await computeStreak(uid); await checkAndAwardBadges(uid, liveStreak); }catch(_){}
    done++;
  }
  return {done, failed};
}
async function finalizeWeek(monday, force){
  const wk = toStr(monday);
  const ref = doc(db,'draws',wk);
  if(!force){
    const existing = await getDoc(ref);
    if(existing.exists()) return {already:true, data:existing.data()};
  }
  // Kazanma geçmişi: tüm kuralar; bu haftanın kendi eski sonucu ("yeniden çek") hariç.
  const allDrawsSnap = await getDocs(collection(db,'draws'));
  const {winCounts, totalGiftsGivenSoFar, previousWinners} = drawHistory(
    allDrawsSnap.docs.map(d=>({id:d.id, pairs:d.data().pairs})), wk, toStr(addDays(monday,-7)));
  const stats = await computeWeekStats(monday);
  const {giverCount, safeCount, pairs} = runLottery(stats, previousWinners, winCounts, totalGiftsGivenSoFar);
  const data = { weekStart:wk, weekEnd: toStr(addDays(monday,6)), giverCount, safeCount, pairs, generatedAt: new Date().toISOString(), algo: LOTTERY_ALGO };
  let didWrite = false;
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(ref);
    if(snap.exists() && !force) return;
    tx.set(ref, data);
    didWrite = true;
  });
  if(didWrite){
    // Bildirimlere ve gönderiye kaydedilen etiket: dil ayarından ve ekran genişliğinden bağımsız.
    const rangeLabel = `${fmtStoredDate(data.weekStart)}–${fmtStoredDate(data.weekEnd)}`;
    if(pairs.length===0){
      createPost('no_lottery', { weekLabel: rangeLabel });
    }
    await Promise.all(pairs.map(async p=>{
      if(p.giverUid) await notifyUser(p.giverUid, `Kura çekildi (${rangeLabel}): cezalısın, ${p.receiverName||'—'} için kitap hediyesi vereceksin. "Hediye Kitap" sekmesine bak.`, 'gifts');
      if(p.receiverUid) await notifyUser(p.receiverUid, `Kura çekildi (${rangeLabel}): tebrikler, ${p.giverName} sana kitap hediye edecek! "Hediye Kitap" sekmesinden isteğini gönderebilirsin.`, 'gifts');
      if(p.receiverUid){
        createPost('gift_won', { variantText: pickGiftMessage('won') }, p.receiverUid, p.receiverName);
      }
    }));
  }
  return {already:!didWrite, data};
}
async function loadDraws(){
  const snap = await getDocs(query(collection(db,'draws'), orderBy('weekStart','desc')));
  drawsCache = [];
  snap.forEach(d=> drawsCache.push({id:d.id, ...d.data()}));
}
// Seri sayımı ortak dosyada (countStreak): bugünden (henüz işaretlenmediyse dünden) geriye, okunmamış
// ilk güne kadar, üst sınırsız. Okunamayan gün hata fırlatır, "okumadı" sayılmaz.
function computeStreak(uid){
  return countStreak(todayStr(), ds=> getDoc(doc(db,'days',ds,'answers',uid)).then(snap=> snap.exists() ? snap.data().status : null), {startMayBeUnmarked:true});
}

/* ============ ROZET SİSTEMİ ============ */
// Rozetler artık KALICI değil, o anki aktif seriye bağlı: seri bozulunca profil resmindeki
// çerçeve/rozet de kayboluyor. Kaç kere kazanıldığı ayrıca badgeCounts içinde sayılıyor
// (Kitap Kurtları sekmesindeki geçmiş tablosu için).
// Rozet tanımları ortak dosyada; ekranda üyenin diline göre ad gösteriliyor. Kayıtlara (gönderi,
// bildirim) her zaman ortak tanımdaki Türkçe ad yazılır (bkz. checkAndAwardBadges).
const BADGE_DEFS = SHARED_BADGE_DEFS.map(def=>({...def, label: window.BH_I18N.pick(def.label, def.labelEn)}));
// Rozet kavramları ve eşikleri aynı; ikonlar uygulamaya ait vektör çizimler.
function badgeIllustration(key){
 const art={
 b3:'<path d="M34 10c3 12-10 15-7 26 3-2 6-6 7-10 9 8 16 15 13 24-3 10-25 12-30 0-5-12 6-18 5-28 5 3 6 7 7 10 4-8 1-14 5-22Z" fill="currentColor"/><path d="M32 36c0 7-8 10-6 16 2 5 11 6 13 0 2-5-3-10-7-16Z" fill="var(--badge-light)"/>',
 b5:'<path d="m32 9 7 15 17 3-12 12 3 17-15-8-15 8 3-17L8 27l17-3Z" fill="currentColor"/><path d="m32 9 1 26-16 21 3-17L8 27l17-3Z" fill="var(--badge-light)" opacity=".65"/><path d="m32 21 3 8 9 2-7 6 2 9-7-4-8 4 2-9-6-6 9-2Z" fill="none" stroke="var(--badge-light)" stroke-width="2"/>',
 b7:'<circle cx="30" cy="35" r="22" fill="currentColor"/><circle cx="30" cy="35" r="15" fill="var(--badge-light)"/><circle cx="30" cy="35" r="9" fill="currentColor"/><circle cx="30" cy="35" r="3" fill="var(--badge-light)"/><path d="m31 34 20-20m-8 0h9v9" fill="none" stroke="var(--badge-dark)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
 b14:'<path d="m18 12-12 16 26 30 26-30-12-16Z" fill="currentColor"/><path d="m18 12 4 16H6Zm14 0L22 28h20Zm14 0-4 16h16Z" fill="var(--badge-light)"/><path d="M6 28h16l10 30Zm36 0h16L32 58Z" fill="var(--badge-dark)" opacity=".45"/><path d="m22 28 10 30 10-30" fill="var(--badge-light)" opacity=".6"/>',
 b21:'<path d="M19 13H9v9c0 10 7 16 16 16m20-25h10v9c0 10-7 16-16 16" fill="none" stroke="currentColor" stroke-width="5"/><path d="M18 10h28v18c0 10-6 15-14 15s-14-5-14-15Z" fill="currentColor"/><path d="M23 14v14c0 6 3 9 7 10" fill="none" stroke="var(--badge-light)" stroke-width="4" stroke-linecap="round"/><path d="M29 42h6v10h10v6H19v-6h10Z" fill="var(--badge-dark)"/><path d="m32 18 3 5 6 1-5 4 1 6-5-3-5 3 1-6-5-4 6-1Z" fill="var(--badge-light)"/>',
 b30:'<path d="m11 9 16 13h10L53 9l-2 30-19 20-19-20Z" fill="currentColor"/><path d="m15 17 10 10-10 5Zm34 0L39 27l10 5Z" fill="var(--badge-dark)"/><path d="m14 37 12 3 6 15 6-15 12-3-8 14-10 8-10-8Z" fill="var(--badge-light)"/><path d="m21 32 7 3m15-3-7 3" stroke="var(--badge-dark)" stroke-width="3" stroke-linecap="round"/><path d="m27 43 5-3 5 3-5 6Z" fill="var(--badge-dark)"/>'
 };
 if(!art[key])return '';
 return `<svg class="badge-art badge-art-${key}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="31" fill="currentColor" opacity=".1"/>${art[key]}</svg>`;
}


const badgeCheckInFlight = new Set();
const stampBtnInFlight = new Set();
const BADGE_GAINED_MESSAGES = {
  b3: ["🔥 Ateşi yaktı, 3 gün aralıksız okudu!", "🔥 3 günlük seri başladı, devam!", "🔥 İlk ısınma turu: 3 gün üst üste!"],
  b5: ["⭐ 5 gün aralıksız, yıldızını kazandı!", "⭐ Beşi devirdi, seri büyüyor!", "⭐ 5 günlük istikrar rozeti geldi!"],
  b7: ["🎯 Tam bir hafta aralıksız okudu!", "🎯 7/7! Haftayı temiz geçirdi.", "🎯 Bir haftalık hedefi vurdu!"],
  b14: ["💎 2 hafta aralıksız, elmas gibi parlıyor!", "💎 14 gün kesintisiz — bu bir alışkanlık artık!", "💎 İki haftalık seri tamamlandı!"],
  b21: ["🏆 3 hafta aralıksız okudu, kupayı kaptı!", "🏆 21 gün! Artık gerçek bir okur.", "🏆 Üç haftalık maraton bitti, tebrikler!"],
  b30: ["🐺 Tam bir ay aralıksız — Kitap Kurdu unvanı hak edildi!", "🐺 30 gün! Bu artık disiplin.", "🐺 Bir aylık seri: Kitap Kurdu doğdu!"]
};
const BADGE_LOST_MESSAGES = {
  b3: ["💔 3 günlük seri sona erdi.", "😮‍💨 Ateş söndü, seri bozuldu."],
  b5: ["💔 5 günlük seri bitti.", "😮‍💨 Yıldız serisi sona erdi."],
  b7: ["💔 Haftalık seri bozuldu.", "😮‍💨 7 günlük hedef kaçtı."],
  b14: ["💔 2 haftalık seri sona erdi.", "😮‍💨 14 günlük emek bir günde gitti."],
  b21: ["💔 3 haftalık seri bitti.", "😮‍💨 21 günlük maraton durdu."],
  b30: ["💔 Bir aylık seri sona erdi.", "😮‍💨 Kitap Kurdu serisi bozuldu."]
};
function pickBadgeGainedMessage(tierKey){
  const pool = BADGE_GAINED_MESSAGES[tierKey] || ["🏅 Yeni bir rozet kazandı!"];
  return pool[Math.floor(Math.random()*pool.length)];
}
function pickBadgeLostMessage(tierKey, count){
  const pool = BADGE_LOST_MESSAGES[tierKey] || ["💔 Bir rozet serisi sona erdi."];
  let msg = pool[Math.floor(Math.random()*pool.length)];
  if(count>1) msg += ` (${count}. kez)`;
  return msg;
}
const GIFT_WON_MESSAGES = ["🎁 Kura ona güldü, hediye kitap kazandı!", "🎉 Bu hafta şanslı, kitap hediyesi ona gidiyor!", "🎁 Hediye kurası ona çıktı!", "🍀 Şansı yaver gitti, kitap hediyesi kazandı!"];
const GIFT_COMPLETED_MESSAGES = ["📦 Hediye kitabına kavuştu!", "🎉 Uzun bekleyiş bitti, kitap elinde!", "📬 Kitap teslim edildi, mutlu son!", "🥳 Hediyesi eline geçti!"];
function pickGiftMessage(kind){
  const pool = kind==='won' ? GIFT_WON_MESSAGES : GIFT_COMPLETED_MESSAGES;
  return pool[Math.floor(Math.random()*pool.length)];
}
async function checkAndPostDethrone(uid, newCount, getOthersCount, label, icon){
  let maxUid=null, maxCount=0;
  Object.keys(usersCache).forEach(ouid=>{
    if(ouid===uid || usersCache[ouid].banned) return;
    const c = getOthersCount(ouid) || 0;
    if(c>maxCount){ maxCount=c; maxUid=ouid; }
  });
  if(maxUid && newCount>maxCount){
    const u = usersCache[uid];
    createPost('record_dethrone', { recordLabel:label, recordIcon:icon||'🏆', recordCount:newCount, dethronedName:usersCache[maxUid]?.name||'' }, uid, u.name);
  }
}
// ÖNEMLİ: seri DÜŞTÜĞÜNDE (streak < lastStreak) burada ARTIK hiçbir şey kalıcı olarak
// kaydedilmiyor — ne rozet geçmişine (badgeCounts) ekleme, ne "seri bozuldu" gönderisi. Bunun
// sebebi: bugünün işaretlemesi gün bitene (06:00) kadar değişebilir; biri yanlışlıkla
// "okumadım" işaretleyip hemen "okudum" olarak düzeltirse, o anlık düşüş burada kalıcı bir
// rozet/gönderiye dönüşmemeli. Bir serinin GERÇEKTEN bitip bitmediği artık sadece gece 06:00'da
// sunucu tarafında (bkz. functions/index.js: autoMarkMissedReading içindeki günlük rozet
// kesinleştirmesi) kesinleşiyor — o ana kadar aynı gün içinde düzeltilen bir hata hiç sayılmaz.
// Sadece YUKARI (yeni bir eşiğe ulaşma) anlık bildirim/gönderi olarak kalıyor, çünkü o zaten
// geri alınamaz bir zarar oluşturmuyor.
async function checkAndAwardBadges(uid, streak){
  if(badgeCheckInFlight.has(uid)) return; // aynı kişi için eşzamanlı ikinci bir kontrolü atla (çift sayımı önler)
  badgeCheckInFlight.add(uid);
  try{
    const u = usersCache[uid];
    if(!u) return;
    const lastStreak = typeof u.lastStreak==='number' ? u.lastStreak : 0;
    const {kind, newTier} = badgeTransition(streak, lastStreak, u.currentTier || null);
    // Düşüş: kesinleşme geceye (sunucuya) bırakılıyor. Sadece yeni bir rozete ulaşınca bildir;
    // geçmişe (badgeCounts) henüz sayma, seri bitince (gece) sayılacak.
    if(kind!=='rise') return;
    // Gönderi ve bildirim herkesin gördüğü kayıt: üyenin dil ayarından bağımsız Türkçe ad.
    const notifyDef = SHARED_BADGE_DEFS.find(d=>d.key===newTier);

    const updates = { lastStreak: streak, currentTier: newTier, currentStreak: streak };
    await updateDoc(doc(db,'users',uid), updates);
    Object.assign(u, updates);
    if(notifyDef){
      const uTab = u.role==='admin' ? 'worms' : 'mworms';
      await notifyUser(uid, `🎉 Tebrikler! "${notifyDef.label}" rozetini kazandın!`, uTab);
      createPost('badge_gained', { badgeKey:notifyDef.key, badgeLabel:notifyDef.label, badgeIcon:notifyDef.icon, variantText: pickBadgeGainedMessage(notifyDef.key) }, uid, u.name);
    }
  }catch(e){ /* rozet kaydedilemezse sessizce geç */ }
  finally{ badgeCheckInFlight.delete(uid); }
}

/* ============ GÜN GEÇİŞİNİ (06:00) TAKİP ET ============ */
// "Okudum"a basınca ekran sunucuyu beklemeden anında güncelleniyor; kayıt arka planda giderken
// başka bir üyenin işaretlemesi dinleyiciyi tetiklerse bu iyimser durum silinmesin diye tutuluyor.
let selfReadPending = null;
function resubscribeToday(){
  if(unsubToday) unsubToday();
  subscribedTodayKey = todayStr();
  unsubToday = onSnapshot(collection(db,'days',subscribedTodayKey,'answers'), (snap)=>{
    todayAnswers = {};
    snap.forEach(d=> todayAnswers[d.id] = d.data().status);
    if(selfReadPending && selfReadPending.day===subscribedTodayKey) todayAnswers[selfReadPending.uid]='read';
    if(activeTab) renderTab(activeTab);
  });
}
setInterval(async ()=>{
  if(!currentUid) return;
  if(todayStr() !== subscribedTodayKey){
    resubscribeToday();
    renderHeader();
    if(activeTab) renderTab(activeTab);
    if(myProfile && myProfile.role==='admin'){
      const n = await autoFillPastDays(3);
      if(n>0) showToast(`${n} eksik işaretleme otomatik "okumadı" olarak dolduruldu.`);
    }
  }
}, 5*60*1000);

/* ============ ADMIN: BUGÜN ============ */
let adminWeekOffset = 0; // 0 = bu hafta, -1 = önceki hafta, ...
function renderAdminToday(){
  const list = document.getElementById('todayList');
  const uids = activeUids();
  if(uids.length===0){ list.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">📚</span>Henüz üye yok.</div>`; return; }
  list.innerHTML = uids.map(uid=>{
    const u = usersCache[uid];
    const st = todayAnswers[uid];
    const isProtectedOwner = u.isOwner && uid!==currentUid;
    return `
    <div class="member-row">
      <div>
        <div class="member-name">${userChipHtml(uid)}</div>
      </div>
      <div class="stamp-btns">
        <button class="stamp-btn read ${st==='read'?'selected':''}" data-uid="${uid}" data-status="read" ${isProtectedOwner?'disabled title="Sahibin işaretlemesini değiştiremezsin"':''}>✓</button>
        <button class="stamp-btn skip ${st==='skip'?'selected':''}" data-uid="${uid}" data-status="skip" ${isProtectedOwner?'disabled title="Sahibin işaretlemesini değiştiremezsin"':''}>✕</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.stamp-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const key = btn.dataset.uid+'|'+btn.dataset.status;
      if(stampBtnInFlight.has(key)) return;
      stampBtnInFlight.add(key);
      try{
        const isSelf = btn.dataset.uid===currentUid;
        const isSettingMark = todayAnswers[btn.dataset.uid] !== btn.dataset.status;
        const wasNew = isSelf && isSettingMark;
        playMarkFx(btn, btn.dataset.status);
        await markStatus(btn.dataset.uid, btn.dataset.status);
        if(isSelf) hubPreviews.invalidate('club');
        if(wasNew && btn.dataset.status==='skip') createPost('skip', {variantText: await pickVariantMessage('skip')});
        if(isSettingMark){
          const markedName = (usersCache[btn.dataset.uid] && usersCache[btn.dataset.uid].name) || '';
          // Bildirim tüm üyelere gidip kayıtlı kalıyor; gönderenin dil ayarından bağımsız Türkçe kalmalı.
          notifyAllMembers(`${markedName} bugün "${btn.dataset.status==='read'?'Okudum':'Okumadım'}" işaretledi.`, 'week', currentUid);
        }
      } finally {
        setTimeout(()=> stampBtnInFlight.delete(key), 1200);
      }
    });
  });

  const ld = nowLogical();
  const dowLabel = DOW[ld.getDay()===0?6:ld.getDay()-1];
  const dateLabel = `${dowLabel} ${pad(ld.getDate())}.${pad(ld.getMonth()+1)}.${ld.getFullYear()}`;
  const noteEl = document.getElementById('aDateNote');
  if(noteEl){
    const myStatus = todayAnswers[currentUid];
    const myStatusText = myStatus==='read' ? window.BH_I18N.pick("Bugün için \"Okudum\" işaretlendin.","Today was marked as read.") : myStatus==='skip' ? window.BH_I18N.pick("Bugün için \"Okumadım\" işaretlendin.","Today was marked as not read.") : window.BH_I18N.pick("Bugün için henüz işaretleme yapılmadı.","No check-in recorded today.");
    noteEl.textContent = window.BH_I18N.template`Bugünün okuma tarihi: ${dateLabel}. İşaretlemeler yarın sabah 06:00'a kadar geçerli; 06:00'dan sonraki işaretleme bir sonraki güne yazılır. 06:00'a kadar hiç işaretleme yapılmazsa o gün otomatik "okumadı" sayılır. ${myStatusText}`;
  }
  renderTotalPagesCard('totalPagesNumber');
}
// Bir haftanın kendi geçmişini GNOME Hava Durumu tarzı şerit olarak üretir. Haftalık pas hakkı
// kuralına göre: haftanın ilk "okumadı"sı ücretsiz pastır (sarı), ikinci ve sonrakiler cezadır (kırmızı).
// uid verilmezse currentUid kullanılır; extraColClass küçük (satır içi) varyant için 'small' gibi bir sınıf eklemeye yarar.
// Basit hex renk açma/koyulaştırma yardımcıları: rozet crest'inin gradyanlarını kişinin rozet
// çerçevesi rengine göre yeniden boyamak için kullanılıyor.
function shadeHexColor(hex, percent){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  let r = (num>>16)&255, g=(num>>8)&255, b=num&255;
  if(percent>=0){ r=r+(255-r)*percent; g=g+(255-g)*percent; b=b+(255-b)*percent; }
  else { const p=-percent; r=r*(1-p); g=g*(1-p); b=b*(1-p); }
  const clamp = v=>Math.max(0,Math.min(255,Math.round(v)));
  return '#'+[r,g,b].map(v=>clamp(v).toString(16).padStart(2,'0')).join('');
}
// GNOME "EarTag" (app.drey.EarTag) uygulama simgesinin küpe/etiket şekli — rozet arka planı olarak
// kullanılıyor. Orijinal simgedeki nota şekli çıkarıldı (yerine seri gün sayısı yazılıyor); üstteki
// boş halkanın içi ise profil fotoğrafıyla dolduruluyor. Kaynak: GNOME uygulama kataloğu.
// Gradyan renkleri, kişinin o anki rozet çerçevesi rengine göre (baseColor) yeniden hesaplanıyor;
// her rozet kendi benzersiz gradient id'lerini kullanır (aynı sayfada aynı id iki kez olamaz).
function earTagCrestSvg(uid, baseColor){
  const gid = 'et' + String(uid).replace(/[^a-zA-Z0-9]/g,'');
  const base = baseColor, light = shadeHexColor(baseColor,0.5), lighter = shadeHexColor(baseColor,0.72),
        dark = shadeHexColor(baseColor,-0.35), darker = shadeHexColor(baseColor,-0.5);
  return `<svg class="streak-badge-svg" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gid}A" gradientUnits="userSpaceOnUse" x1="13.456008" x2="118.326286" y1="110.070801" y2="110.070801">
      <stop offset="0" stop-color="${base}"/><stop offset="0.0355267" stop-color="${lighter}"/><stop offset="0.0834366" stop-color="${dark}"/>
      <stop offset="0.857903" stop-color="${base}"/><stop offset="0.941897" stop-color="${lighter}"/><stop offset="1" stop-color="${base}"/>
    </linearGradient>
    <linearGradient id="${gid}B" gradientUnits="userSpaceOnUse" x1="56.910191" x2="71.174553" y1="35" y2="35">
      <stop offset="0" stop-color="${darker}"/><stop offset="0.262276" stop-color="${light}"/><stop offset="0.628525" stop-color="${dark}"/>
      <stop offset="0.857903" stop-color="${base}"/><stop offset="0.941897" stop-color="${lighter}"/><stop offset="1" stop-color="${base}"/>
    </linearGradient>
    <linearGradient id="${gid}C" gradientUnits="userSpaceOnUse" x1="91.27047" x2="91.27047" y1="49.755768" y2="64.784882">
      <stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${lighter}"/>
    </linearGradient>
  </defs>
  <g fill-rule="evenodd">
    <path d="m 62.992188 11.980469 c -13.808594 0 -25.003907 11.195312 -25.007813 25.007812 c 0.011719 2.386719 0.367187 4.757813 1.046875 7.03125 c 0.734375 2.464844 0.417969 5.945313 -1.414062 7.753907 c -8.082032 7.972656 -25.46875 22.113281 -25.617188 30.207031 v 30.039062 c 0 4.433594 3.566406 8 8 8 h 88 c 4.433594 0 8 -3.566406 8 -8 v -30.039062 c -2.140625 -9.0625 -17.289062 -23.355469 -26.773438 -31.433594 c -1.960937 -1.671875 -2.652343 -4.878906 -2.011718 -7.371094 c 0.515625 -2.015625 0.78125 -4.09375 0.785156 -6.1875 c 0 -13.8125 -11.195312 -25.007812 -25.007812 -25.007812 z m 0 16.980469 c 4.433593 0 8.023437 3.59375 8.023437 8.027343 c 0.003906 4.429688 -3.589844 8.023438 -8.023437 8.023438 c -4.433594 0 -8.023438 -3.59375 -8.023438 -8.023438 c 0 -4.433593 3.59375 -8.023437 8.023438 -8.027343 z m 0 0" fill="url(#${gid}A)"/>
    <path d="m 62.992188 11.980469 c -13.808594 0 -25.003907 11.195312 -25.007813 25.007812 c 0.011719 2.386719 0.367187 4.757813 1.046875 7.03125 c 0.734375 2.464844 0.417969 5.945313 -1.414062 7.753907 c -2.011719 1.988281 -4.605469 4.355468 -7.363282 6.917968 h 67.992188 c -3.179688 -3.03125 -6.328125 -5.851562 -9.019532 -8.144531 c -1.960937 -1.671875 -2.652343 -4.878906 -2.011718 -7.371094 c 0.515625 -2.015625 0.78125 -4.09375 0.785156 -6.1875 c 0 -13.8125 -11.195312 -25.007812 -25.007812 -25.007812 z m 0 16.980469 c 4.433593 0 8.023437 3.59375 8.023437 8.027343 c 0.003906 4.429688 -3.589844 8.023438 -8.023437 8.023438 c -4.433594 0 -8.023438 -3.59375 -8.023438 -8.023438 c 0 -4.433593 3.59375 -8.023437 8.023438 -8.027343 z m 0 0" fill="url(#${gid}B)"/>
    <path d="m 62.992188 8 c -13.808594 0 -25.003907 11.195312 -25.007813 25.007812 c 0.007813 0.90625 0.058594 1.8125 0.164063 2.710938 c 0.5625 4.957031 0.011718 11.765625 -3.542969 15.300781 c -4.625 4.597657 -10.660157 10.179688 -15.328125 14.429688 c -4 3.640625 -7.277344 10.933593 -7.277344 16.339843 v 26.25 c 0 4.433594 3.566406 8 8 8 h 88 c 4.433594 0 8 -3.566406 8 -8 v -26.25 c 0 -5.40625 -3.125 -12.863281 -7.011719 -16.625 c -4.769531 -4.617187 -11.167969 -10.734374 -16.511719 -15.605468 c -3.707031 -3.378906 -4.917968 -9.738282 -4.546874 -14.714844 c 0.046874 -0.609375 0.070312 -1.222656 0.070312 -1.835938 c 0 -13.8125 -11.195312 -25.007812 -25.007812 -25.007812 z m 0 16.980469 c 4.433593 0 8.023437 3.59375 8.023437 8.027343 c 0.003906 4.429688 -3.589844 8.023438 -8.023437 8.023438 c -4.433594 0 -8.023438 -3.59375 -8.023438 -8.023438 c 0 -4.433593 3.59375 -8.023437 8.023438 -8.027343 z m 0 0" fill="url(#${gid}C)"/>
  </g>
  <path d="m 63 12 c -11.597656 0 -21 9.402344 -21 21 c 0 13.679688 9.410156 23.160156 21.007812 23.160156 c 11.597657 0 20.992188 -8.738281 20.992188 -23.160156 c 0 -11.597656 -9.402344 -21 -21 -21 z m 0 7.738281 c 7.324219 0 13.261719 5.9375 13.261719 13.261719 s -5.9375 13.261719 -13.261719 13.261719 s -13.261719 -5.9375 -13.261719 -13.261719 s 5.9375 -13.261719 13.261719 -13.261719 z m 0 0" fill="${dark}"/>
  <path d="m 63 10 c -11.597656 0 -21 9.402344 -21 21 s 9.402344 21 21 21 s 21 -9.402344 21 -21 s -9.402344 -21 -21 -21 z m 0 7.738281 c 7.324219 0 13.261719 5.9375 13.261719 13.261719 s -5.9375 13.261719 -13.261719 13.261719 s -13.261719 -5.9375 -13.261719 -13.261719 s 5.9375 -13.261719 13.261719 -13.261719 z m 0 0" fill="${light}"/>
</svg>`;
}
function buildWeekHistoryHTML(dates, perDate, joinDs, uid, extraColClass){
  uid = uid || currentUid;
  extraColClass = extraColClass ? ' '+extraColClass : '';
  let passUsed = false;
  return dates.map((d,i)=>{
    const dow = DOW[i];
    const dateLbl = fmtShort(d);
    let cls='wh-empty', icon='', title='';
    if(joinDs && d < joinDs){
      title = window.BH_I18N.pick("Henüz üye değildi","Not a member yet");
    } else {
      const rec = perDate[i][uid];
      if(rec && rec.status==='read'){ cls='wh-read'; icon='✓'; title='Okudu'; }
      else if(rec && rec.status==='skip'){
        if(!passUsed){ passUsed = true; cls='wh-pas'; icon='–'; title = rec.auto?window.BH_I18N.pick("Otomatik okumadı (haftalık pas hakkı)","Automatically marked unread (weekly pass)"):window.BH_I18N.pick("Okumadı (haftalık pas hakkı)","Didn’t read (weekly pass)"); }
        else { cls='wh-penalty'; icon='✕'; title = rec.auto?window.BH_I18N.pick("Otomatik okumadı (ceza)","Automatically marked unread (penalty)"):window.BH_I18N.pick("Okumadı (ceza)","Didn’t read (penalty)"); }
      }
    }
    return `
      <div class="weekhist-col${extraColClass} ${cls}" title="${title}">
        <div class="weekhist-daylabel">${dow}<span class="weekhist-date">${dateLbl}</span></div>
        <div class="weekhist-fillwrap">
          <div class="weekhist-bar"><span class="weekhist-icon">${icon}</span></div>
        </div>
      </div>`;
  }).join('');
}
async function renderAdminOwnWeek(){
  const baseMonday = getMonday(nowLogical());
  const monday = addDays(baseMonday, adminWeekOffset*7);
  const dates = weekDates(monday);
  document.getElementById('aWeekNextBtn').disabled = adminWeekOffset>=0;
  const table = document.getElementById('aOwnWeekGrid');
  showCachedOrPlaceholder(table, window.BH_I18N.template`<div class="empty-state">Yükleniyor…</div>`);
  const perDate = await Promise.all(dates.map(fetchDayAnswers));
  const joinDs = joinDateStrOf(currentUid);
  table.innerHTML = buildWeekHistoryHTML(dates, perDate, joinDs);
  markLoaded(table);
}
document.getElementById('aWeekPrevBtn').addEventListener('click', ()=>{ adminWeekOffset -= 1; renderAdminOwnWeek(); });
document.getElementById('aWeekNextBtn').addEventListener('click', ()=>{ if(adminWeekOffset<0){ adminWeekOffset += 1; renderAdminOwnWeek(); } });

/* ============ ADMIN: GEÇMİŞ CEVAPLARI DÜZENLE ============ */
async function markStatusForDate(uid, dateStr, status){
  const ref = doc(db,'days',dateStr,'answers',uid);
  const snap = await getDoc(ref);
  const current = snap.exists() ? snap.data().status : undefined;
  if(current === status){
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { status, name: usersCache[uid]?.name || '', updatedAt: new Date().toISOString() });
  }
}
const editPastDateInput = document.getElementById('editPastDate');
editPastDateInput.max = todayStr();
if(!editPastDateInput.value) editPastDateInput.value = toStr(addDays(nowLogical(),-1));
editPastDateInput.addEventListener('change', renderEditPastTab);
async function renderEditPastTab(){
  const dateStr = editPastDateInput.value || toStr(addDays(nowLogical(),-1));
  const list = keepOrLoading('editPastList');
  const map = await fetchDayAnswers(dateStr);
  const uids = activeUids();
  if(uids.length===0){ list.innerHTML = window.BH_I18N.template`<div class="empty-state">Henüz üye yok.</div>`; markLoaded(list); return; }
  list.innerHTML = uids.map(uid=>{
    const rec = map[uid];
    const st = rec ? rec.status : undefined;
    const isProtectedOwner = usersCache[uid] && usersCache[uid].isOwner && uid!==currentUid;
    const autoTag = rec && rec.auto ? window.BH_I18N.pick("<span class=\"chip pending\" title=\"Otomatik işaretlenmiş, henüz kendisi cevap vermemiş\">otomatik</span>","<span class=\"chip pending\" title=\"Otomatik işaretlenmiş, henüz kendisi cevap vermemiş\">automatic</span>") : (!rec ? window.BH_I18N.pick("<span class=\"chip pending\">cevap yok</span>","<span class=\"chip pending\">no reply</span>") : '');
    return `<div class="member-row">
      <div><div class="member-name">${userChipHtml(uid)}</div><div class="member-meta">${autoTag}</div></div>
      <div class="stamp-btns">
        <button class="stamp-btn read ${st==='read'?'selected':''}" data-uid="${uid}" data-status="read" ${isProtectedOwner?'disabled title="Sahibin geçmişini değiştiremezsin"':''}>✓</button>
        <button class="stamp-btn skip ${st==='skip'?'selected':''}" data-uid="${uid}" data-status="skip" ${isProtectedOwner?'disabled title="Sahibin geçmişini değiştiremezsin"':''}>✕</button>
      </div>
    </div>`;
  }).join('');
  markLoaded(list);
  list.querySelectorAll('.stamp-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      await markStatusForDate(btn.dataset.uid, dateStr, btn.dataset.status);
      renderEditPastTab();
    });
  });
}

/* ============ ADMIN: BU HAFTA (ve genel olarak: seçilen herhangi bir hafta) ============ */
async function renderWeekReportTable(monday, tableId){
  const table = document.getElementById(tableId);
  showCachedOrPlaceholder(table, window.BH_I18N.template`<div class="empty-state">Yükleniyor…</div>`);
  const dates = weekDates(monday);
  const perDate = await Promise.all(dates.map(fetchDayAnswers));
  const uids = activeUids();
  if(uids.length===0){ table.innerHTML = window.BH_I18N.template`<div class="empty-state">Henüz üye yok.</div>`; markLoaded(table); return; }
  let rows = uids.map(uid=>{
    const joinDs = joinDateStrOf(uid);
    let miss=0, read=0;
    dates.forEach((d,i)=>{
      if(joinDs && d < joinDs) return;
      const rec = perDate[i][uid];
      if(rec && rec.status==='read') read++;
      else if(rec && rec.status==='skip') miss++;
    });
    let nameCls = '';
    if(miss+read>0){
      if(miss>=2) nameCls = 'wh-name-danger';
      else if(miss===1) nameCls = 'wh-name-pas';
      else nameCls = 'wh-name-ok';
    }
    const strip = buildWeekHistoryHTML(dates, perDate, joinDs, uid, 'small');
    return `<div class="weekrep-row">
        <div class="weekrep-name ${nameCls}">${userChipHtml(uid,22)}</div>
        <div class="weekrep-strip">${strip}</div>
      </div>`;
  }).join('');
  table.innerHTML = `<div class="weekrep-list">${rows}</div>`;
  markLoaded(table);
}
async function renderAdminWeek(){
  await renderWeekReportTable(getMonday(nowLogical()), 'weekGrid');
}
document.getElementById('refreshWeekBtn').addEventListener('click', renderAdminWeek);


let editPastWeekOffset = 0;
async function renderEditPastWeekReport(){
  const monday = addDays(getMonday(nowLogical()), editPastWeekOffset*7);
  const dates = weekDates(monday);
  document.getElementById('editPastWeekRangeLabel').textContent = `${fmtShort(dates[0])} — ${fmtShort(dates[6])}`;
  document.getElementById('editPastWeekNextBtn').disabled = editPastWeekOffset>=0;
  await renderWeekReportTable(monday, 'editPastWeekGrid');
}
document.getElementById('editPastWeekPrevBtn').addEventListener('click', ()=>{ editPastWeekOffset--; renderEditPastWeekReport(); });
document.getElementById('editPastWeekNextBtn').addEventListener('click', ()=>{ if(editPastWeekOffset<0){ editPastWeekOffset++; renderEditPastWeekReport(); } });

/* ============ ADMIN: KURA (gerçek, esnek hafta seçimi) ============ */
document.getElementById('drawWeekPicker').value = toStr(addDays(getMonday(nowLogical()),-7));
async function renderAdminDraws(){
  await loadDraws();
  const note = document.getElementById('drawStatusNote');
  note.textContent = "Tarih seçip 'Kapat / Yeniden Çek' ile o haftanın kurasını çekebilir veya zaten çekilmişse üzerine yazıp yeniden çekebilirsin. Girilmemiş bir hafta seçersen kura boş çıkar.";
  const list = document.getElementById('drawsList');
  if(drawsCache.length===0){ list.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">🎁</span>Henüz tamamlanmış bir hafta yok.</div>`; return; }
  list.innerHTML = drawsCache.slice(0,1).map(d=>{
    const rangeLabel = `${fmtShort(d.weekStart)} — ${fmtShort(d.weekEnd)}`;
    let body;
    if(!d.pairs || d.pairs.length===0){
      body = window.BH_I18N.template`<div class="empty-note">Bu hafta cezalı çıkmadığı için kura çekilmedi.</div>`;
    } else {
      body = d.pairs.map(p=>{
        const giverHtml = `<span class="giver">${p.giverUid ? userChipHtml(p.giverUid) : escapeHtml(p.giverName)}</span>`;
        const receiverHtml = `<span class="receiver">${p.receiverUid ? userChipHtml(p.receiverUid) : escapeHtml(p.receiverName)}</span>`;
        if(!p.receiverUid) return window.BH_I18N.template`<div class="pair-line">${giverHtml}<span class="arrow">—</span><span class="empty-note" style="text-align:right;">uygun alıcı bulunamadı</span></div>`;
        return `<div class="pair-line">${giverHtml}<span class="arrow"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>${receiverHtml}</div>`;
      }).join('');
    }
    return window.BH_I18N.template`<div class="receipt">
      <div class="rweek"><span>Hafta: ${rangeLabel} &middot; Cezalı: ${d.giverCount} &middot; Temiz/Pas: ${d.safeCount}</span>
      <span class="row" style="gap:6px;width:auto;"><button class="secondary tiny" data-explain="${d.weekStart}">Neden?</button><button class="secondary tiny" data-redraw="${d.weekStart}">Yeniden çek</button></span></div>
      ${body}
      <div class="draw-explain" data-explain-panel="${d.weekStart}" hidden></div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-explain]').forEach(btn=>{
    btn.addEventListener('click', ()=> toggleDrawExplanation(btn.dataset.explain, list));
  });
  list.querySelectorAll('[data-redraw]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Bu haftanın kurası yeniden çekilecek ve önceki sonucun üzerine yazılacak. Emin misin?","This week’s draw will be rerun and replace the previous result. Are you sure?"))) return;
      const monday = getMonday(fromStr(btn.dataset.redraw));
      await finalizeWeek(monday, true);
      await renderAdminDraws();
      showToast(window.BH_I18N.pick("Kura yeniden çekildi.","Draw completed again."));
    });
  });
}
document.getElementById('forceCloseBtn').addEventListener('click', async ()=>{
  const picked = document.getElementById('drawWeekPicker').value;
  if(!picked){ alert(window.BH_I18N.pick("Bir tarih seç.","Select a date.")); return; }
  const monday = getMonday(fromStr(picked));
  const wk = toStr(monday);
  const existing = drawsCache.find(d=>d.id===wk);
  const msg = existing
    ? `${fmtShort(wk)} haftası için zaten bir kura var, üzerine yazılıp yeniden çekilecek. Onaylıyor musun?`
    : `${fmtShort(wk)} haftasını kapatıp kura çekmek istediğine emin misin?`;
  if(confirm(msg)){
    await finalizeWeek(monday, true);
    await renderAdminDraws();
    showToast(window.BH_I18N.pick("Kura çekildi.","Draw completed."));
  }
});

/* ============ ADMIN: KURA AÇIKLAMASI ("Neden?") ============
   Bir haftanın kura sonucunu, o haftanın kayıtları ve o haftadan ÖNCEKİ kazanma geçmişiyle
   yeniden değerlendirip kimin hangi grupta olduğunu, hiç kazanmamışların neden seçilmediğini ve
   sonucun öncelik kurallarına uyup uymadığını gösterir. */
// Kural kontrolü ortak dosyada (checkDrawRules); burada sadece sebep kodları ekrana çevriliyor.
function explainDrawResult(draw, stats, winCounts){
  const result = checkDrawRules(draw, stats, winCounts);
  const text = {
    'no-records': ()=> window.BH_I18N.pick("Bu hafta hiç kaydı yok ya da hafta ortasında katıldı; kuraya girmedi.","No records this week, or joined during the week; not entered in the draw."),
    'cezali': x=> window.BH_I18N.template`Cezalıydı (${x.miss} gün okumadı); hediye veren taraftaydı.`,
    'should-have': ()=> window.BH_I18N.pick("Kurallara göre seçilmesi gerekirdi.","Should have been selected under the rules."),
    'pasli': ()=> window.BH_I18N.pick("Paslıydı (1 gün okumadı). Önce tam okuyanlar sırayla alır; hediye sayısı paslılara sıra gelmesine yetmedi.","Used a pass (1 missed reading day). Full readers take priority, and there were not enough gifts for pass users."),
    'not-enough': ()=> window.BH_I18N.pick("Tam okuyandı ama hediye sayısı yetmedi; ondan önce üye olan, hiç kazanmamış tam okuyanlar önce aldı.","Read every day, but there were not enough gifts. Earlier-joining full readers who had never won took priority."),
  };
  result.skippedNeverWon = result.skippedNeverWon.map(x=>({uid:x.uid, reason:text[x.reason](x)}));
  return result;
}
async function toggleDrawExplanation(weekStart, scope){
  const panel = scope.querySelector(`[data-explain-panel="${weekStart}"]`);
  if(!panel) return;
  if(!panel.hidden){ panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = window.BH_I18N.pick("<span class=\"muted\">Hesaplanıyor…</span>","<span class=\"muted\">Calculating…</span>");
  try{
    const draw = drawsCache.find(d=>d.id===weekStart);
    const stats = await computeWeekStats(getMonday(fromStr(weekStart)));
    const winCounts = {}, winWeeks = {};
    drawsCache.forEach(d=>{ if(d.weekStart>=weekStart) return; (d.pairs||[]).forEach(p=>{ if(p.receiverUid){ winCounts[p.receiverUid]=(winCounts[p.receiverUid]||0)+1; (winWeeks[p.receiverUid]=winWeeks[p.receiverUid]||[]).push(d.weekStart); } }); });
    const {receiverInfo, skippedNeverWon, violations} = explainDrawResult(draw, stats, winCounts);
    const name = uid=> escapeHtml(usersCache[uid]?.name || window.BH_I18N.pick("Eski üye","Former member"));
    const group = s=> !s ? window.BH_I18N.pick("artık üye değil","no longer a member") : !(s.marked>0) ? 'kuraya girmedi' : s.miss===0 ? 'tam okuyan' : s.miss===1 ? window.BH_I18N.pick("paslı","pass") : window.BH_I18N.pick("cezalı","penalty");
    const winsText = n=> n ? window.BH_I18N.template`daha önce ${n} kez kazanmıştı` : 'ilk hediyesi';
    let html = window.BH_I18N.template`<p class="muted" style="font-size:12px;">Sıra kuralı: önce tam okuyup hiç kazanmamışlar (en eski üye önce), sonra diğer tam okuyanlar (ağırlıklı kura), sonra hiç kazanmamış paslılar, en son diğer paslılar. Bu açıklama şu anki kayıtlara göre hesaplanır.</p>`;
    html += draw.algo===LOTTERY_ALGO
      ? window.BH_I18N.template`<p style="font-size:13px;">✓ Bu kura güncel öncelik kurallarıyla çekildi.</p>`
      : window.BH_I18N.template`<p style="font-size:13px;">Bu kurada hangi kod sürümüyle çekildiği kaydı yok (bu kayıt yeni eklendi).</p>`;
    if(violations.length){
      const pairsText = [...new Map(violations.map(v=>[v.shouldHave+'|'+v.gotInstead,v])).values()].map(v=>`${name(v.shouldHave)} yerine ${name(v.gotInstead)}`).join(', ');
      html += window.BH_I18N.template`<p class="danger" style="font-size:13px;"><b>⚠ Bu sonuç öncelik kurallarına uymuyor:</b> ${pairsText}. Kura büyük ihtimalle eski kodla çekildi; sunucu fonksiyonları deploy edilmemiş olabilir. "Yeniden çek" ile güncel kurallara göre tekrar çekebilirsin (önceki sonuç silinir).</p>`;
    }
    html += window.BH_I18N.template`<div style="font-size:13px;margin-top:8px;"><b>Kazananlar</b>${receiverInfo.map(r=>`<div>${name(r.uid)} — ${group(r.stat)} · ${winsText(r.wins)}</div>`).join('') || '<div class="muted">—</div>'}</div>`;
    if(skippedNeverWon.length) html += window.BH_I18N.template`<div style="font-size:13px;margin-top:8px;"><b>Hiç kazanmamış ama bu hafta çıkmayanlar</b>${skippedNeverWon.map(x=>`<div>${name(x.uid)} — ${escapeHtml(x.reason)}</div>`).join('')}</div>`;
    // Herkesin bu haftaki sayımı ve kazandığı haftalar: biri "hiç almadı" diye bilinip sistemde bir
    // kazancı kayıtlıysa ya da beklenmedik bir grupta görünüyorsa burada açıkça görülsün.
    const order = st=> st.marked>0 ? (st.miss>=2?2:st.miss) : 3;
    const everyone = [...stats].sort((a,b)=> order(a)-order(b) || (usersCache[a.uid]?.name||'').localeCompare(usersCache[b.uid]?.name||'','tr'));
    html += window.BH_I18N.template`<details style="font-size:13px;margin-top:10px;"><summary><b>Tüm üyelerin bu haftası</b></summary>${everyone.map(st=>{
      const weeks = (winWeeks[st.uid]||[]).map(w=>fmtShort(w)).join(', ');
      const counts = st.marked>0 ? window.BH_I18N.template`${st.read} okudu · ${st.miss} okumadı${st.autoMiss?` (${st.autoMiss} günü kayıtsızdı, okumadı sayıldı)`:''}` : window.BH_I18N.pick("kaydı yok / hafta ortasında katıldı","no records / joined during the week");
      const joined = st.joinedAt ? new Date(st.joinedAt).toLocaleString(window.BH_I18N.locale,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}) : (st.joinDate?fmtShort(st.joinDate):'bilinmiyor');
      return `<div>${name(st.uid)} — ${group(st)} · ${counts} · ${weeks?window.BH_I18N.template`kazandığı haftalar: ${weeks}`:window.BH_I18N.pick("hiç kazanmamış","never won")} · üyelik: ${escapeHtml(joined)}</div>`;
    }).join('')}</details>`;
    panel.innerHTML = html;
  }catch(err){
    panel.innerHTML = window.BH_I18N.pick("<span class=\"muted\">Açıklama şu an hesaplanamadı. Tekrar dene.</span>","<span class=\"muted\">The explanation could not be calculated. Try again.</span>");
  }
}

/* ============ ADMIN: MANUEL KURA (sandbox, tamamen izole) ============ */
function ensureManualGrid(){
  activeUids().forEach(uid=>{
    if(!manualGrid[uid]) manualGrid[uid] = ['','','','','','',''];
  });
}
function renderManualTab(){
  ensureManualGrid();
  const table = document.getElementById('manualGridTable');
  const uids = activeUids();
  if(uids.length===0){ table.innerHTML = window.BH_I18N.template`<tr><td class="empty-state">Henüz üye yok.</td></tr>`; markLoaded(table); return; }
  let head = window.BH_I18N.template`<tr><th style="text-align:left;">Üye</th>` + [1,2,3,4,5,6,7].map(n=>`<th>G${n}</th>`).join('') + window.BH_I18N.template`<th>Durum</th></tr>`;
  let rows = uids.map(uid=>{
    const arr = manualGrid[uid];
    let miss=0, read=0;
    const cells = arr.map((st,i)=>{
      if(st==='read') read++; else if(st==='skip') miss++;
      const cls = st==='read'?'read':st==='skip'?'skip':'empty';
      const label = st==='read'?'✓':st==='skip'?'✕':'·';
      return `<td><span class="stamp-mini ${cls} clickable" data-uid="${uid}" data-day="${i}">${label}</span></td>`;
    }).join('');
    let statusChip = `<span class="chip">—</span>`;
    if(miss+read>0){
      if(miss>=2) statusChip = `<span class="chip danger">Cezalı (${miss})</span>`;
      else if(miss===1) statusChip = window.BH_I18N.template`<span class="chip warn">Pas (1)</span>`;
      else statusChip = window.BH_I18N.template`<span class="chip ok">Kusursuz</span>`;
    }
    return `<tr><td class="name-cell">${userChipHtml(uid,18)}</td>${cells}<td>${statusChip}</td></tr>`;
  }).join('');
  table.innerHTML = head + rows;
  table.querySelectorAll('.stamp-mini.clickable').forEach(cell=>{
    cell.addEventListener('click', ()=>{
      const uid = cell.dataset.uid, day = +cell.dataset.day;
      const cur = manualGrid[uid][day];
      manualGrid[uid][day] = cur==='' ? 'read' : cur==='read' ? 'skip' : '';
      renderManualTab();
    });
  });
  renderManualHistory();
}
document.getElementById('manualResetBtn').addEventListener('click', ()=>{
  if(!confirm(window.BH_I18N.pick("Tüm deneme tablosu sıfırlansın mı?","Reset the entire test table?"))) return;
  manualGrid = {};
  document.getElementById('manualLabel').value='';
  document.getElementById('manualResult').innerHTML='';
  renderManualTab();
});
document.getElementById('manualDrawBtn').addEventListener('click', async ()=>{
  ensureManualGrid();
  const uids = activeUids();
  const stats = uids.map(uid=>{
    const arr = manualGrid[uid];
    const miss = arr.filter(s=>s==='skip').length;
    const read = arr.filter(s=>s==='read').length;
    return {uid, name: usersCache[uid].name, miss, read, marked: miss+read, joinDate: joinDateStrOf(uid)||'', joinedAt: joinedAtOf(uid)};
  });
  // Deneme kurası da gerçek kurayla aynı geçmişi kullansın (kim kaç kez kazandı, geçen hafta kim
  // kazandı, üyelik sırası); yoksa herkes "hiç kazanmamış" sayılıp sonuç gerçeği yansıtmıyordu.
  await loadDraws();
  const {winCounts, totalGiftsGivenSoFar, previousWinners} = drawHistory(drawsCache, null, drawsCache[0]?.id);
  const {giverCount, safeCount, pairs} = runLottery(stats, previousWinners, winCounts, totalGiftsGivenSoFar);
  const label = document.getElementById('manualLabel').value.trim() || window.BH_I18N.pick("İsimsiz deneme","Untitled test");
  const resultBox = document.getElementById('manualResult');
  let body;
  if(pairs.length===0){
    body = window.BH_I18N.template`<div class="empty-note">Bu tabloya göre cezalı çıkan yok.</div>`;
  } else {
    body = pairs.map(p=>{
      if(!p.receiverUid && !p.receiverName) return window.BH_I18N.template`<div class="pair-line"><span class="giver">${escapeHtml(p.giverName)}</span><span class="arrow">—</span><span class="empty-note" style="text-align:right;">uygun alıcı bulunamadı</span></div>`;
      return `<div class="pair-line"><span class="giver">${escapeHtml(p.giverName)}</span><span class="arrow"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span><span class="receiver">${escapeHtml(p.receiverName)}</span>'e kitap hediye edecek</div>`;
    }).join('');
  }
  resultBox.innerHTML = `<div class="receipt"><div class="rweek">${escapeHtml(label)} &middot; Cezalı: ${giverCount} &middot; Temiz/Pas: ${safeCount}</div>${body}</div>`;

  try{
    await addDoc(collection(db,'manualDraws'), { label, giverCount, safeCount, pairs, createdAt: new Date().toISOString() });
    showToast(window.BH_I18N.pick("Deneme sonucu kaydedildi (sadece sana görünür).","Test result saved (only visible to you)."));
    renderManualHistory();
  }catch(e){ /* kayıt başarısız olsa da sonucu ekranda göstermeye devam */ }
});
async function renderManualHistory(){
  const box = document.getElementById('manualHistory');
  try{
    const snap = await getDocs(query(collection(db,'manualDraws'), orderBy('createdAt','desc')));
    manualHistoryCache = [];
    snap.forEach(d=> manualHistoryCache.push({id:d.id, ...d.data()}));
  }catch(e){ box.innerHTML = window.BH_I18N.template`<p class="muted">Geçmiş yüklenemedi.</p>`; return; }
  if(manualHistoryCache.length===0){ box.innerHTML = window.BH_I18N.template`<p class="muted">Henüz kayıtlı deneme yok.</p>`; return; }
  box.innerHTML = manualHistoryCache.slice(0,10).map(d=>{
    let body = (!d.pairs || d.pairs.length===0)
      ? window.BH_I18N.template`<div class="empty-note">Cezalı çıkan olmadı.</div>`
      : d.pairs.map(p=> !p.receiverName
          ? window.BH_I18N.template`<div class="pair-line"><span class="giver">${escapeHtml(p.giverName)}</span> — <span class="empty-note">alıcı yok</span></div>`
          : `<div class="pair-line"><span class="giver">${escapeHtml(p.giverName)}</span><span class="arrow"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span><span class="receiver">${escapeHtml(p.receiverName)}</span></div>`
        ).join('');
    return `<div class="receipt"><div class="rweek">${escapeHtml(d.label)}</div>${body}</div>`;
  }).join('');
}

/* ============ ADMIN: ÜYELER (rol + ban) ============ */
document.getElementById('cleanupBtn').addEventListener('click', async ()=>{
  if(!confirm(window.BH_I18N.pick("Kulüp başlamadan veya kişi üye olmadan önceki otomatik \"okumadı\" kayıtları silinsin mi? Elle girilmiş hiçbir veri silinmez.","Delete automatic missed-reading records from before the club started or the member joined? Manually entered records will be kept."))) return;
  document.getElementById('cleanupResult').textContent = window.BH_I18N.pick("Taranıyor, biraz sürebilir…","Scanning, this may take a while…");
  const n = await cleanupBadAutoFills(60);
  document.getElementById('cleanupResult').textContent = `${n} hatalı otomatik kayıt silindi.`;
  showToast(window.BH_I18N.pick("Temizlik tamamlandı.","Cleanup completed."));
});
document.getElementById('recomputeBadgesBtn').addEventListener('click', async ()=>{
  if(!confirm(window.BH_I18N.pick("Herkesin rozet geçmişi sıfırlanıp tüm okuma günleri yeniden taranarak baştan hesaplanacak. Bu biraz sürebilir. Devam edilsin mi?","Everyone’s badge history will be reset and recalculated from all reading days. This may take a while. Continue?"))) return;
  document.getElementById('recomputeBadgesResult').textContent = window.BH_I18N.pick("Hesaplanıyor, biraz sürebilir…","Calculating, this may take a moment…");
  const {done, failed} = await resetAndRecomputeAllBadges();
  document.getElementById('recomputeBadgesResult').textContent = `${done} üyenin rozet geçmişi yeniden hesaplandı.` + (failed ? ` ${failed} üyenin verisi okunamadığı için atlandı (onlara dokunulmadı); tekrar deneyebilirsin.` : '');
  showToast(window.BH_I18N.pick("Rozetler yeniden hesaplandı.","Badges recalculated."));
  if(activeTab) renderTab(activeTab);
});
async function renderAdminMembers(){
  const list = document.getElementById('membersList');
  // "deleted" artık bir bayrak değil — silinen bir üyenin belgesi tamamen kalkıyor, o yüzden
  // usersCache'te hiç yer almıyor ve buradaki listeye zaten kendiliğinden hiç girmiyor. Geri
  // yükleme diye bir şey yok, silme kalıcı.
  const uids = Object.keys(usersCache);
  if(uids.length===0){ list.innerHTML = window.BH_I18N.template`<p class="muted">Henüz üye yok.</p>`; return; }
  const adminCount = uids.filter(u=>usersCache[u].role==='admin' && !usersCache[u].banned).length;
  list.innerHTML = uids.map(uid=>{
    const u = usersCache[uid];
    const isSelf = uid===currentUid;
    const isProtectedOwner = u.isOwner && !isSelf; // sahip, sahibin kendisi dışındaki herkese karşı korumalı
    const joinDs = joinDateStrOf(uid) || '—';
    return window.BH_I18N.template`<div class="member-row">
      <div>
        <div class="member-name">${userChipHtml(uid)} ${u.role==='admin'?window.BH_I18N.template`<span class="chip ${u.isOwner?'owner':'ok'}">YÖNETİCİ</span>`:''} ${u.banned?window.BH_I18N.pick("<span class=\"chip banned\">BANLI</span>","<span class=\"chip banned\">SUSPENDED</span>"):''}</div>
        <div class="member-meta">${escapeHtml(u.email||'')} &middot; Katılım: ${joinDs} <button data-edit-join="${uid}" style="border:none;background:none;color:var(--gold);cursor:pointer;font-size:10.5px;text-decoration:underline;">düzenle</button></div>
      </div>
      <div class="row" style="flex:0 0 auto; width:auto; flex-wrap:wrap;">
        <button class="secondary tiny" data-toggle-role="${uid}" ${isSelf||isProtectedOwner?'disabled':''} ${isSelf?'title="Kendi rolünü buradan değiştiremezsin"':(isProtectedOwner?'title="Sahibin rolünü değiştiremezsin"':'')}>${u.role==='admin' ? window.BH_I18N.pick("Üye Yap","Make member") : window.BH_I18N.pick("Yönetici Yap","Make administrator")}</button>
        <button class="secondary tiny" data-toggle-ban="${uid}" ${isSelf||isProtectedOwner?'disabled':''} ${isSelf?'title="Kendini banlayamazsın"':(isProtectedOwner?'title="Sahibi banlayamazsın"':'')}>${u.banned ? window.BH_I18N.pick("Banı Kaldır","Lift suspension") : window.BH_I18N.pick("Banla","Suspend")}</button>
        <button class="secondary tiny" data-toggle-delete="${uid}" ${isSelf||isProtectedOwner?'disabled':''} ${isSelf?'title="Kendi hesabını Profilim sekmesinden silebilirsin"':(isProtectedOwner?'title="Sahibi silemezsin"':'')} style="border-color:var(--cloth-dark); color:var(--cloth-dark);">Sil</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-edit-join]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const uid = btn.dataset.editJoin;
      const u = usersCache[uid];
      const current = joinDateStrOf(uid) || CLUB_START_DATE;
      const input = prompt(window.BH_I18N.template`${u.name} için gerçek katılım tarihini gir (YYYY-AA-GG):`, current);
      if(!input) return;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(input)){ alert(window.BH_I18N.pick("Tarih formatı YYYY-AA-GG olmalı, örn: 2026-07-06","Use YYYY-MM-DD format, e.g. 2026-07-06")); return; }
      const newCreatedAt = new Date(input+'T12:00:00').toISOString();
      try{
        await updateDoc(doc(db,'users',uid), {createdAt:newCreatedAt});
        u.createdAt = newCreatedAt;
        showToast(window.BH_I18N.template`${u.name} için katılım tarihi güncellendi: ${input}`);
        renderAdminMembers();
      }catch(err){ alert(window.BH_I18N.pick("Güncellenemedi: ","Could not update: ")+(err.message||err)); }
    });
  });
  list.querySelectorAll('[data-toggle-role]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const uid = btn.dataset.toggleRole;
      const u = usersCache[uid];
      if(u.role==='admin' && adminCount<=1){ alert(window.BH_I18N.pick("Tek aktif yönetici sensin, önce başka birini yönetici yapmalısın.","You are the only active administrator. Assign another administrator first.")); return; }
      const newRole = u.role==='admin' ? 'member' : 'admin';
      if(!confirm(window.BH_I18N.template`${u.name} artık "${newRole==='admin'?window.BH_I18N.pick("yönetici","administrator"):window.BH_I18N.pick("üye","member")}" olsun mu?`)) return;
      try{
        await updateDoc(doc(db,'users',uid), {role:newRole});
        showToast(window.BH_I18N.template`${u.name} artık ${newRole==='admin'?window.BH_I18N.pick("yönetici","administrator"):window.BH_I18N.pick("üye","member")}.`);
      }catch(err){
        alert(window.BH_I18N.pick("Rol değiştirilemedi: ","Could not change role: ")+(err.message||err));
      }
    });
  });
  list.querySelectorAll('[data-toggle-ban]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const uid = btn.dataset.toggleBan;
      const u = usersCache[uid];
      const willBan = !u.banned;
      if(willBan && u.role==='admin' && adminCount<=1){ alert(window.BH_I18N.pick("Tek aktif yönetici sensin, önce başka birini yönetici yapmalısın.","You are the only active administrator. Assign another administrator first.")); return; }
      if(!confirm(willBan ? window.BH_I18N.template`${u.name} banlansın mı? Giriş yapamayacak.` : window.BH_I18N.template`${u.name}'in banı kaldırılsın mı?`)) return;
      try{
        await updateDoc(doc(db,'users',uid), {banned: willBan});
        showToast(willBan ? window.BH_I18N.template`${u.name} banlandı.` : window.BH_I18N.template`${u.name}'in banı kaldırıldı.`);
      }catch(err){ alert(window.BH_I18N.pick("İşlem başarısız: ","Operation failed: ")+(err.message||err)); }
    });
  });
  list.querySelectorAll('[data-toggle-delete]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const uid = btn.dataset.toggleDelete;
      const u = usersCache[uid];
      if(u.role==='admin' && adminCount<=1){ alert(window.BH_I18N.pick("Tek aktif yönetici sensin, önce başka birini yönetici yapmalısın.","You are the only active administrator. Assign another administrator first.")); return; }
      if(!confirm(`${u.name} hesabı KALICI olarak silinsin mi?\n\nBu işlem geri alınamaz: hesabı, profilini ve kişisel verilerini (Okuduklarım, Okumak İstediklerim, Kitap Geçmişim, bildirimler) tamamen siler. Giriş bilgisi de kapanır, tekrar giriş yapamaz.`)) return;
      btn.disabled = true;
      btn.textContent = 'Siliniyor…';
      try{
        const deleteMemberFn = httpsCallable(cloudFunctions, 'adminDeleteMember');
        await deleteMemberFn({ targetUid: uid });
        showToast(window.BH_I18N.template`${u.name} kalıcı olarak silindi.`);
      }catch(err){
        alert('Silinemedi: '+(err.message||err));
        btn.disabled = false;
        btn.textContent = window.BH_I18N.pick("Sil","Delete");
      }
    });
  });
}

/* ============ ADMIN: KİTAP KURTLARI ============ */
document.getElementById('calcStreaksBtn').addEventListener('click', renderAdminWorms);
// Rozet Geçmişi: her üye tek satır, 6 rozet de her zaman yan yana madalyon şeklinde duruyor.
// Kazanılmamışlar kesikli çizgili soluk "hayalet" madalyon. Sayı, madalyonun köşesindeki metalik
// (gümüş gradyan + kabartma efektli) yuvarlak rozette duruyor.
// Sıralama SADECE bu listeye özgü: her rozet, o rozeti kazanmak için gereken gün sayısı (def.days)
// kadar puan eder; kişinin puanı = Σ (o rozetten kazandığı adet × o rozetin gün değeri). Bu, "Kitap
// Kurtları" listesindeki güncel seri sıralamasından tamamen bağımsız — orijinal diziyi bozmamak
// için önce bir kopyası alınıp öyle sıralanıyor.
// Rozet süre etiketini kısa/okunur biçime çevirir: 3→"3 gün", 7→"1 hafta", 14→"2 hafta", 30→"1 ay".
function formatStreakDuration(days){
  if(days % 7 === 0) return (days/7) + window.BH_I18N.pick(" hafta"," weeks");
  if(days % 30 === 0) return (days/30) + ' ay';
  return days + window.BH_I18N.pick(" gün"," days");
}
function renderBadgeHistoryShelf(rows){
  const sorted = rows.slice().map(r=>{
    const u = usersCache[r.uid] || {};
    const bc = u.badgeCounts || {};
    const liveTier = u.currentTier;
    const score = BADGE_DEFS.reduce((sum,def)=>{
      const count = (bc[def.key]||0) + (liveTier===def.key ? 1 : 0);
      return sum + count*def.days;
    }, 0);
    return {...r, score};
  }).sort((a,b)=> b.score-a.score);
  return `<div class="badge-shelf-list">${sorted.map(r=>{
    const u = usersCache[r.uid] || {};
    const bc = u.badgeCounts || {};
    const liveTier = u.currentTier;
    const items = BADGE_DEFS.map(def=>{
      const count = (bc[def.key]||0) + (liveTier===def.key ? 1 : 0);
      const earned = count>0;
      const countBadge = count>1
        ? `<span class="badge-shelf-count" style="background:linear-gradient(145deg, ${shadeHexColor(def.color,-0.28)} 0%, ${shadeHexColor(def.color,-0.62)} 100%);"><span class="badge-shelf-count-num">${count}</span></span>`
        : '';
      // Tıklanınca (sadece kazanılmış rozetlerde) hafif bir sallanma animasyonu ve sağ üstte,
      // köşedeki sayaçla aynı metalik gradyan/font'ta ama hap (pill) şeklinde bir bilgi kutusu
      // açılıyor; içinde o rozet için gereken seri gün sayısı yazıyor.
      const infoPop = earned
        ? `<div class="badge-shelf-info" style="background:linear-gradient(145deg, ${shadeHexColor(def.color,-0.28)} 0%, ${shadeHexColor(def.color,-0.62)} 100%);"><span class="badge-shelf-info-text">${escapeHtml(formatStreakDuration(def.days))}</span></div>`
        : '';
      const coinHtml = earned
        ? `<div class="badge-shelf-coin" title="${escapeHtml(def.label)} — ${count} kere" style="background:${def.color};"><span>${badgeIllustration(def.key)}</span>${countBadge}${infoPop}</div>`
        : `<div class="badge-shelf-coin ghost" title="${escapeHtml(def.label)} — henüz kazanılmadı"><span>${badgeIllustration(def.key)}</span></div>`;
      return `<div class="badge-shelf-item">${coinHtml}</div>`;
    }).join('');
    return `<div class="badge-shelf-row">
      <div class="badge-shelf-name">${userChipHtml(r.uid,26)}</div>
      <div class="badge-shelf-icons">${items}</div>
    </div>`;
  }).join('')}</div>`;
}
// Rozet madalyonuna tıklayınca sallanma animasyonu oynatır ve o madalyonun bilgi kutusunu açar/
// kapatır; başka bir madalyon açılınca öncekini kapatır. Konteynere bir kez bağlanır (yeniden
// render'da tekrar tekrar dinleyici eklenmesin diye).
function bindBadgeShelfClicks(container){
  if(!container || container.dataset.shelfClicksBound) return;
  container.dataset.shelfClicksBound = '1';
  container.addEventListener('click', (e)=>{
    const coin = e.target.closest('.badge-shelf-coin');
    if(!coin || coin.classList.contains('ghost') || !container.contains(coin)) return;
    const info = coin.querySelector('.badge-shelf-info');
    if(!info) return;
    const wasOpen = info.classList.contains('show');
    container.querySelectorAll('.badge-shelf-info.show').forEach(p=> p.classList.remove('show'));
    if(!wasOpen){
      info.classList.add('show');
      coin.classList.remove('wobble');
      void coin.offsetWidth;
      coin.classList.add('wobble');
      setTimeout(()=> coin.classList.remove('wobble'), 420);
    }
  });
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.badge-shelf-coin')) return;
  document.querySelectorAll('.badge-shelf-info.show').forEach(p=> p.classList.remove('show'));
});
async function renderWormsShared(myStreakContainerId, clubStreaksContainerId, historyContainerId){
  // Eskiden "Kitap Kurtları" tek bir kartın içinde hem senin güncel serini hem kulübün tüm
  // serilerini üst üste gösteriyordu — artık kart-içi sekmelerde ayrı ayrı gösterildiği için
  // (bkz. tab-worms/tab-mworms) bu iki parça ayrı konteynerlere yazılıyor.
  const myBox = keepOrLoading(myStreakContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…"));
  const clubBox = keepOrLoading(clubStreaksContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…"));
  const historyBox = historyContainerId ? keepOrLoading(historyContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…")) : null;
  // Sekme açıldığında önce önbellekteki (eski) HTML anında gösteriliyor, gerçek veri henüz
  // gelmeden — tıklama dinleyicisi de bu yüzden en başta bağlanıyor, yoksa sayfa ilk açıldığında
  // önbellek gösterilirken tıklamalar hiçbir şey yapmıyordu (asıl render bitene kadar).
  if(historyBox) bindBadgeShelfClicks(historyBox);
  const uids = activeUids();
  let failed = false;
  const results = await Promise.all(uids.map(async uid=>{
    try{
      const streak = await computeStreak(uid);
      await checkAndAwardBadges(uid, streak);
      return {uid, streak};
    }catch(e){ failed = true; return {uid, streak:0}; }
  }));
  // Bir üyenin serisi hesaplanamazsa onu 0 gündür sanıp herkesi bu şekilde çizip önbelleğe
  // yazarsak, geçici bir hata gerçek serileri bir süreliğine kalıcı olarak silerdi — bu durumda
  // ekranı olduğu gibi bırakıyoruz.
  if(failed) return;
  results.sort((a,b)=>b.streak-a.streak);

  if(results.length===0){
    myBox.innerHTML = window.BH_I18N.template`<div class="empty-state">Henüz üye yok.</div>`;
    clubBox.innerHTML = window.BH_I18N.template`<div class="empty-state">Henüz üye yok.</div>`;
  } else {
    const own = results.find(r=>r.uid===currentUid);
    const streak = own ? own.streak : 0;
    myBox.innerHTML = window.BH_I18N.template`<div class="material-streak-hero"><div class="material-medal">${streak}</div><h2>${streak} gündür aralıksız</h2><p class="muted">Her gün birkaç sayfa, yeni bir alışkanlık.</p><div class="milestones">${BADGE_DEFS.map(d=>window.BH_I18N.template`<div class="milestone ${streak>=d.days?'earned':''}"><span>${badgeIllustration(d.key)}</span><small>${d.days} gün</small></div>`).join('')}</div></div>`;
    clubBox.innerHTML = `<div class="streak-grid">${results.map(r=>{
      const u = usersCache[r.uid] || {};
      return window.BH_I18N.template`<div class="streak-card ${r.uid===currentUid?'mine':''}">${avatarHtmlFromProfile(u,52)}<b>${escapeHtml(u.name||'?')}</b><span class="streak-card-days">${r.streak} gün</span></div>`;
    }).join('')}</div>`;
  }
  markLoaded(myBox);
  markLoaded(clubBox);

  if(historyBox){
    const rows = results;
    if(rows.length===0){
      historyBox.innerHTML = window.BH_I18N.template`<p class="muted">Henüz üye yok.</p>`;
    } else {
      historyBox.innerHTML = renderBadgeHistoryShelf(rows);
    }
    markLoaded(historyBox);
  }

}
async function renderTotalPagesCard(elId){
  const pagesEl = document.getElementById(elId);
  if(!pagesEl) return;
  renderCompletedBooksCount(elId==='totalPagesNumber'?'completedBooksNumber':'mCompletedBooksNumber');
  showCachedOrPlaceholder(pagesEl, '…');
  const daysEl=document.getElementById(elId==='totalPagesNumber'?'totalDaysNumber':'mTotalDaysNumber');
  if(daysEl) showCachedOrPlaceholder(daysEl,'…');
  const uid=currentUid;let totals;
  try{totals=await computeReadingTotals(uid);}catch(_){return;}
  if(uid!==currentUid)return;
  const totalReadDays=totals.days;
  renderPersonalGoals(pagesEl.closest("section.tab"),totals,uid);
  pagesEl.textContent = totals.pages.toLocaleString(window.BH_I18N.locale);
  if(daysEl){daysEl.textContent=totalReadDays.toLocaleString(window.BH_I18N.locale);markLoaded(daysEl);}
  markLoaded(pagesEl);
}
async function renderCompletedBooksCount(elId){
  const el=document.getElementById(elId);if(!el||!currentUid)return;
  const uid=currentUid;showCachedOrPlaceholder(el,'…');
  try{
    // bookHistory = bitirilen kitaplar; readBooks = halen okunanlar.
    const snap=await getDocs(collection(db,'users',uid,'bookHistory'));
    if(currentUid!==uid)return;
    el.textContent=snap.size.toLocaleString(window.BH_I18N.locale);markLoaded(el);
  }catch(_){}
}
async function computeTotalReadDays(uid){return (await computeReadingTotals(uid)).days;}
async function computeReadingTotals(uid){
  const joinDs = joinDateStrOf(uid);
  const startDs = (joinDs && joinDs > CLUB_START_DATE) ? joinDs : CLUB_START_DATE;
  const today = nowLogical();
  const dateStrs = [];
  let cursor = fromStr(startDs);
  while(toStr(cursor) <= toStr(today)){ dateStrs.push(toStr(cursor)); cursor = addDays(cursor,1); }
  // Günleri tek tek sırayla değil, hepsini aynı anda (paralel) çekiyoruz — bu, uzun
  // süredir üye olan biri için bile sonucu saniyelerden yüzlerce milisaniyeye indirir.
  const snaps = await Promise.all(dateStrs.map(ds => getDoc(doc(db,'days',ds,'answers',uid))));
  const totals={days:0,pages:0,records:{}};
  snaps.forEach((snap,i)=>{if(!snap.exists())return;const rec=snap.data();totals.records[dateStrs[i]]=rec;if(rec.status==='read'){totals.days++;totals.pages+=Number.isSafeInteger(rec.pages)&&rec.pages>=15?rec.pages:15;}});
  return totals;
}
async function renderAdminWorms(){ await renderWormsShared('wormsMyStreak','wormsClubStreaks','wormsHistory'); }

/* İsteğe bağlı kişisel hedefler. Günler mevcut 06.00 sınırını kullanır. */
function personalGoals(data){return {daily:data?.daily||[],monthly:data?.monthly||[]};}
function dailyGoalAt(goals,day=todayStr()){
 return [...goals.daily].reverse().find(g=>g.start<=day&&(!g.end||day<g.end));
}
function activeMonthlyGoal(goals,now=Date.now()){
 return goals.monthly.find(g=>!g.cancelledAt&&Date.parse(g.start)<=now&&now<Date.parse(g.end));
}
function goalMonthEnd(start){
 const end=new Date(start),day=end.getDate();end.setDate(1);end.setMonth(end.getMonth()+1);
 const last=new Date(end.getFullYear(),end.getMonth()+1,0).getDate();end.setDate(Math.min(day,last));return end.toISOString();
}
async function loadPersonalGoals(uid=currentUid){
 const snapshot=await getDoc(doc(db,'users',uid));return personalGoals(snapshot.data()?.readingGoals);
}
async function savePersonalGoal(kind,target){
 if(!Number.isSafeInteger(target)||target<(kind==='daily'?15:1))throw Error(kind==='daily'?window.BH_I18N.pick("En az 15 sayfa yazmalısın.","Enter at least 15 pages."):window.BH_I18N.pick("En az 1 kitap yazmalısın.","Enter at least 1 book."));
 const uid=currentUid,ref=doc(db,'users',uid),day=todayStr(),now=new Date().toISOString();
 await runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref),goals=personalGoals(snapshot.data()?.readingGoals);
  if(kind==='daily'){
   if(dailyGoalAt(goals,day))throw Error(window.BH_I18N.pick("Günlük hedefin zaten var.","You already have a daily goal."));
   goals.daily.push({start:day,target});
  }else{
   if(activeMonthlyGoal(goals))throw Error(window.BH_I18N.pick("Aylık hedefin henüz bitmedi.","Your monthly goal is still active."));
   goals.monthly.push({start:now,end:goalMonthEnd(now),target,completed:[]});
  }
  tx.update(ref,{readingGoals:goals});
 });
}
async function stopDailyGoal(){
 const ref=doc(db,'users',currentUid),day=todayStr();
 await runTransaction(db,async tx=>{
  const snap=await tx.get(ref),goals=personalGoals(snap.data()?.readingGoals),goal=dailyGoalAt(goals,day);
  // Bugünün hedefi geçmişte korunsun; bırakma yarın 06.00'da yürürlüğe girer.
  if(goal&&!goal.end){goal.end=toStr(addDays(fromStr(day),1));tx.update(ref,{readingGoals:goals});}
 });
}
function goalHistoryCounts(goals,records,day=todayStr(),now=Date.now()){
 const count={dailyWin:0,dailyLoss:0,monthlyWin:0,monthlyLoss:0};
 for(const goal of goals.daily){
  for(let ds=goal.start;ds<=day&&(!goal.end||ds<goal.end);ds=toStr(addDays(fromStr(ds),1))){
   const rec=records[ds],pages=rec?.status==='read'?(Number.isSafeInteger(rec.pages)&&rec.pages>=15?rec.pages:15):0;
   if(pages>=goal.target)count.dailyWin++;else if(ds<day)count.dailyLoss++;
  }
 }
 for(const goal of goals.monthly){if(!goal.cancelledAt&&Date.parse(goal.end)<=now)count[(goal.completed||[]).length>=goal.target?'monthlyWin':'monthlyLoss']++;}
 return count;
}
function goalEditButton(kind){
 const label=kind==='daily'?window.BH_I18N.pick("Günlük sayfa hedefini düzenle","Edit daily page goal"):window.BH_I18N.pick("Aylık kitap hedefini düzenle","Edit monthly book goal");
 return `<button type="button" class="goal-edit-button icon-button" data-edit-goal="${kind}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19.5 10M4.5 14A8 8 0 0 0 17.9 17.9"/></svg></button>`;
}
async function updatePersonalGoal(kind,target,expected,uid,day,remove=false){
 if(!remove&&(!Number.isSafeInteger(target)||target<(kind==='daily'?15:1)))throw Error(kind==='daily'?window.BH_I18N.pick("En az 15 sayfa yazmalısın.","Enter at least 15 pages."):window.BH_I18N.pick("En az 1 kitap yazmalısın.","Enter at least 1 book."));
 const ref=doc(db,'users',uid);
 await runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref),goals=personalGoals(snapshot.data()?.readingGoals);
  if(uid!==currentUid||day!==todayStr())throw Error(window.BH_I18N.pick("Gün veya oturum değişti. Hedefi yeniden aç.","The day or session has changed. Reopen the goal."));
  const goal=kind==='daily'?dailyGoalAt(goals,day):activeMonthlyGoal(goals);
  if(!goal||goal.start!==expected.start||goal.target!==expected.target||goal.end!==expected.end)throw Error(window.BH_I18N.pick("Hedef değişmiş veya süresi dolmuş. Kartı yeniden aç.","The goal has changed or expired. Reopen the card."));
  if(remove){
   if(kind==='daily')goal.end=day;
   else goal.cancelledAt=new Date().toISOString();
   tx.update(ref,{readingGoals:goals});return;
  }
  if(goal.target===target)return;
  if(kind==='daily'&&goal.start<day){
   // Dünkü ve daha eski hedef sonuçları yeni hedefle yeniden hesaplanmasın.
   const next={start:day,target,...(goal.end?{end:goal.end}:{})};
   goal.end=day;goals.daily.push(next);
  }else goal.target=target;
  // Aylık hedefte başlangıç, bitiş ve bitirilen kitaplar aynen korunur.
  tx.update(ref,{readingGoals:goals});
 });
}
function openGoalEditor(kind,goal,section){
 if(document.querySelector('.goal-edit-dialog'))return;
 const uid=currentUid,day=todayStr(),expected={...goal};
 const dialog=document.createElement('dialog');dialog.className='reading-pages-dialog goal-edit-dialog';
 dialog.innerHTML=window.BH_I18N.template`<form novalidate><h2>${kind==='daily'?window.BH_I18N.pick("Günlük sayfa hedefi","Daily page goal"):window.BH_I18N.pick("Aylık kitap hedefi","Monthly book goal")}</h2><label>${kind==='daily'?window.BH_I18N.pick("Günde kaç sayfa?","How many pages per day?"):window.BH_I18N.pick("Bu dönemde kaç kitap?","How many books this period?")}<input name="target" type="number" inputmode="numeric" min="${kind==='daily'?15:1}" step="1" required value="${goal.target}" autofocus></label><p class="muted">${kind==='daily'?window.BH_I18N.pick("Yeni hedef bugünden itibaren geçerli. Önceki günlerin sonuçları korunur.","The new goal applies from today. Previous results are kept."):window.BH_I18N.pick("Dönem tarihleri ve bitirdiğin kitaplar korunur.","Your period dates and completed books will be kept.")}</p><p class="goal-error" role="alert"></p><div class="row"><button type="button" data-cancel>Vazgeç</button><button type="submit" class="primary">Kaydet</button></div><button type="submit" name="remove" class="goal-remove-button">Hedefi kaldır</button></form>`;
 let busy=false;
 const close=()=>{if(busy)return;dialog.close();dialog.remove();};
 dialog.querySelector('[data-cancel]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
   await updatePersonalGoal(kind,Number(e.target.elements.target.value),expected,uid,day,e.submitter?.name==='remove');
   busy=false;close();
   if(currentUid===uid)renderTotalPagesCard(section.id==='tab-today'?'totalPagesNumber':'mTotalPagesNumber');
  }catch(err){dialog.querySelector('.goal-error').textContent=err.message||'Hedef kaydedilemedi.';}
  finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 document.body.append(dialog);dialog.showModal();dialog.querySelector('input').select();
}

function goalForm(kind){return window.BH_I18N.template`<form class="goal-form" data-goal-form="${kind}"><label>${kind==='daily'?window.BH_I18N.pick("Günde kaç sayfa?","How many pages per day?"):window.BH_I18N.pick("Bir ayda kaç kitap?","How many books per month?")}<input type="number" name="target" inputmode="numeric" min="${kind==='daily'?15:1}" step="1" required placeholder="${kind==='daily'?window.BH_I18N.pick("Örn. 30","e.g. 30"):window.BH_I18N.pick("Örn. 2","e.g. 2")}"></label><button class="primary" type="submit">Belirle</button><p class="goal-error" role="alert"></p></form>`;}
function goalProgress(value,target){return `<progress value="${Math.min(value,target)}" max="${target}" aria-label="Hedef ilerlemesi"></progress>`;}
async function renderPersonalGoals(section,totals,uid=currentUid){
 const grid=section.querySelector('.personal-goals'),history=section.querySelector('.goal-history');if(!grid)return;
 const revision=String(Number(grid.dataset.revision||0)+1);grid.dataset.revision=revision;
 try{
  const goals=await loadPersonalGoals(uid);if(uid!==currentUid||grid.dataset.revision!==revision)return;
  const day=todayStr(),daily=dailyGoalAt(goals,day),monthly=activeMonthlyGoal(goals),last=goals.monthly.filter(g=>!g.cancelledAt).at(-1);
  const nextDay=fromStr(toStr(addDays(nowLogical(),1)));nextDay.setHours(6,0,0,0);
  section.dataset.goalRefreshAt=String(Math.min(nextDay.getTime(),monthly?Date.parse(monthly.end):Infinity));
  const rec=totals.records[day],pages=rec?.status==='read'?(Number.isSafeInteger(rec.pages)&&rec.pages>=15?rec.pages:15):0;
  // Toplamlar sunucudan iyimser işaretlemeden önce okunmuş olabilir; düğmeyi geri çevirmesin.
  updateSelfReadButton(section,todayAnswers[uid]==='read'&&rec?.status!=='read'?{...rec,status:'read'}:rec,daily);
  const dailyText=pages>=daily?.target?window.BH_I18N.template`Bugünkü hedefini ${pages} sayfayla tamamladın.`:pages?window.BH_I18N.template`Bugün ${pages} sayfa okudun. Hedefine ${Math.max(0,(daily?.target||0)-pages)} sayfa kaldı.`:window.BH_I18N.pick("Bugün henüz okuma kaydın yok.","You haven’t recorded any reading today.");
  grid.innerHTML=window.BH_I18N.template`<div class="card personal-goal"><span class="goal-symbol" aria-hidden="true">▤</span><h2>Günlük sayfa hedefi</h2>${daily?goalEditButton("daily"):""}${daily?window.BH_I18N.template`<strong class="goal-value">${daily.target} <small>sayfa / gün</small></strong>${goalProgress(pages,daily.target)}<p role="status">${dailyText}</p>${daily.end?window.BH_I18N.pick("<p class=\"muted\">Hedefin yarın 06.00’da sona erecek.</p>","<p class=\"muted\">Your goal will end tomorrow at 06:00.</p>"):window.BH_I18N.pick("<button type=\"button\" class=\"ai-text-action\" data-stop-goal>Hedefi yarından itibaren bırak</button>","<button type=\"button\" class=\"ai-text-action\" data-stop-goal>End goal from tomorrow</button>")}`:goalForm('daily')}<p class="muted">İsteğe bağlı</p></div>
  <div class="card personal-goal"><span class="goal-symbol" aria-hidden="true">▥</span><h2>Aylık kitap hedefi</h2>${monthly?goalEditButton("monthly"):""}${monthly?window.BH_I18N.template`<strong class="goal-value">${monthly.target} <small>kitap</small></strong>${goalProgress((monthly.completed||[]).length,monthly.target)}<p role="status">Bu ay ${(monthly.completed||[]).length} kitap bitirdin.</p><p class="muted">${new Date(monthly.end).toLocaleString(window.BH_I18N.locale,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})} tarihinde sona erer.</p>`:`${last?`<p class="goal-result" role="status">${(last.completed||[]).length>=last.target?window.BH_I18N.pick("Son hedefinde başarılı oldun.","You completed your last goal."):window.BH_I18N.pick("Son hedefini tamamlayamadın.","You did not complete your last goal.")} ${(last.completed||[]).length} / ${last.target} kitap.</p>`:''}${goalForm('monthly')}` }<p class="muted">İsteğe bağlı</p></div>`;
  const counts=goalHistoryCounts(goals,totals.records);
  history.innerHTML=window.BH_I18N.template`<h2>Hedef geçmişin</h2><div class="goal-history-grid"><div><b>Günlük sayfa hedefleri</b><p><span class="goal-success"><strong class="goal-history-number">${counts.dailyWin}</strong> tamamladın</span><br><strong class="goal-history-number">${counts.dailyLoss}</strong> tamamlayamadın</p></div><div><b>Aylık kitap hedefleri</b><p><span class="goal-success"><strong class="goal-history-number">${counts.monthlyWin}</strong> tamamladın</span><br><strong class="goal-history-number">${counts.monthlyLoss}</strong> tamamlayamadın</p></div></div><span class="muted">Süresi devam eden hedefler başarısız sayılmaz.</span>`;
  grid.querySelectorAll('[data-goal-form]').forEach(form=>form.onsubmit=async e=>{
   e.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
   try{await savePersonalGoal(form.dataset.goalForm,Number(form.elements.target.value));await renderPersonalGoals(section,totals,uid);}
   catch(err){form.querySelector('.goal-error').textContent=err.message||'Hedef kaydedilemedi.';button.disabled=false;}
  });
  grid.querySelectorAll('[data-edit-goal]').forEach(button=>button.onclick=()=>openGoalEditor(button.dataset.editGoal,button.dataset.editGoal==='daily'?daily:monthly,section));
  const stop=grid.querySelector('[data-stop-goal]');if(stop)stop.onclick=async()=>{
   stop.disabled=true;try{await stopDailyGoal();await renderPersonalGoals(section,totals,uid);}catch(err){showToast(window.BH_I18N.pick("Hedef değiştirilemedi. Tekrar dene.","Could not change the goal. Try again."));stop.disabled=false;}
  };
 }catch(err){grid.innerHTML=window.BH_I18N.pick("<div class=\"card\">Hedefler yüklenemedi. <button type=\"button\" data-retry-goals>Tekrar dene</button></div>","<div class=\"card\">Could not load goals. <button type=\"button\" data-retry-goals>Try again</button></div>");grid.querySelector('button').onclick=()=>renderPersonalGoals(section,totals,uid);}
}
function validReadPages(rec){return Number.isSafeInteger(rec?.pages)&&rec.pages>=15?rec.pages:15;}
function updateSelfReadButton(section,rec,daily){
 const button=section.querySelector('.daily-actions .read');if(!button)return;
 const read=rec?.status==='read',pages=read?validReadPages(rec):0;
 const editable=read&&daily&&pages<daily.target;
 button.disabled=read&&!editable;button.classList.toggle('selected',read);
 button.classList.toggle('pages-editable',Boolean(editable));
 button.setAttribute('aria-pressed',String(read));
 // İçerik sadece durum gerçekten değişince yeniden yazılıyor; aynı duruma tekrar render
 // edilince (dinleyici, hedef kartı vb.) süren işaretleme animasyonu kesilmesin.
 const state=editable?'edit:'+pages:read?'read':'idle';
 if(button.dataset.markState!==state){
  button.dataset.markState=state;
  button.innerHTML=editable?window.BH_I18N.template`<span>Sayfa sayısını güncelle<small class="previous-page-count">${pages} sayfa</small></span>`:`${READ_CHECK_SVG}<span class="mark-label">${read?window.BH_I18N.pick("Bugün okudun","You read today"):window.BH_I18N.pick("Okudum","Read")}</span>`;
 }
 button.title=editable?window.BH_I18N.pick("Bugün okuduğun toplam sayfa sayısını güncelle","Update your total pages read today"):read?window.BH_I18N.pick("Bugün okudun","You read today"):window.BH_I18N.pick("Okudum","Read");
}
const READ_CHECK_SVG='<svg class="mark-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
// Ağ beklemeden, dokunulan noktadan yayılan dolgu + kendini çizen tik + küçük kıvılcım patlaması.
function playReadMarkFx(btn,point){
 try{navigator.vibrate?.(12);}catch(_){}
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const r=btn.getBoundingClientRect();
 const x=point&&point.x?point.x-r.left:r.width/2,y=point&&point.y?point.y-r.top:r.height/2;
 btn.style.setProperty('--fx-x',x+'px');btn.style.setProperty('--fx-y',y+'px');
 btn.style.setProperty('--fx-r',Math.hypot(Math.max(x,r.width-x),Math.max(y,r.height-y))+'px');
 btn.classList.remove('just-marked');void btn.offsetWidth;btn.classList.add('just-marked');
 clearTimeout(btn._markFxTimer);btn._markFxTimer=setTimeout(()=>btn.classList.remove('just-marked'),1200);
 const layer=document.createElement('span');layer.className='mark-burst';
 layer.style.left=(r.left+x)+'px';layer.style.top=(r.top+y)+'px';
 // Hem koyu yeşil dolgunun hem de açık kartın üzerinde seçilebilen kutlama renkleri.
 const colors=['#F2B84B','#EF8A62','#9FD8A8','#B9A8E8'];
 for(let i=0;i<14;i++){
  const dot=document.createElement('i'),angle=(i/14)*Math.PI*2+Math.random()*.45,dist=42+Math.random()*36;
  dot.style.background=colors[i%colors.length];if(i%3===0)dot.classList.add('streak');
  layer.appendChild(dot);
  dot.animate([{transform:`rotate(${angle}rad) translateX(0) scale(1)`,opacity:1},{transform:`rotate(${angle}rad) translateX(${dist}px) scale(.2)`,opacity:0}],{duration:680+Math.random()*200,delay:60,easing:'cubic-bezier(.15,.8,.3,1)',fill:'both'});
 }
 document.body.appendChild(layer);setTimeout(()=>layer.remove(),1000);
}
async function saveSelfReadTotal(uid,day,pages){
 const ref=doc(db,'days',day,'answers',uid),userRef=doc(db,'users',uid);
 return runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref),user=await tx.get(userRef);
  if(uid!==currentUid||day!==todayStr())throw Error(window.BH_I18N.pick("Gün veya oturum değişti. Lütfen yeniden işaretle.","The day or session has changed. Please mark your reading again."));
  const rec=snapshot.data(),wasRead=rec?.status==='read';
  const daily=dailyGoalAt(personalGoals(user.data()?.readingGoals),day);
  if(wasRead&&(!daily||validReadPages(rec)>=daily.target))return false;
  if(daily&&(!Number.isSafeInteger(pages)||pages<15))throw Error('En az 15 tam sayfa girmelisin.');
  if(wasRead&&pages<validReadPages(rec))throw Error(window.BH_I18N.pick("Yeni toplam önceki sayfa sayısından az olamaz.","The new total cannot be less than the previous page count."));
  // Bir güne ait toplamı değiştir; önceki sayının üzerine tekrar ekleme.
  tx.set(ref,{status:'read',name:usersCache[uid]?.name||'',updatedAt:new Date().toISOString(),...(daily?{pages}:{})},{merge:true});
  return !wasRead;
 });
}
function askReadPages(previousPages=0){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='reading-pages-dialog';
  dialog.innerHTML=window.BH_I18N.pick("<form novalidate><h2>Bugün kaç sayfa okudun?</h2><label>Okuduğun sayfa sayısı<input name=\"pages\" type=\"number\" inputmode=\"numeric\" min=\"15\" step=\"1\" required autofocus></label><p class=\"muted\">En az 15 sayfa girmelisin.</p><div class=\"row\"><button type=\"button\" data-cancel>Vazgeç</button><button type=\"submit\" class=\"primary\">Kaydet</button></div></form>","<form novalidate><h2>How many pages did you read today?</h2><label>Pages you read<input name=\"pages\" type=\"number\" inputmode=\"numeric\" min=\"15\" step=\"1\" required autofocus></label><p class=\"muted\">Enter at least 15 pages.</p><div class=\"row\"><button type=\"button\" data-cancel>Cancel</button><button type=\"submit\" class=\"primary\">Save</button></div></form>");
  if(previousPages){dialog.querySelector('input').placeholder=String(previousPages);dialog.querySelector('h2').textContent=window.BH_I18N.pick("Bugün toplam kaç sayfa okudun?","How many pages have you read in total today?");dialog.querySelector('.muted').textContent=window.BH_I18N.pick("Önceki toplam: ","Previous total: ")+previousPages+window.BH_I18N.pick(" sayfa. Yeni günlük toplamını yaz."," pages. Enter your new daily total.");}
  const finish=value=>{dialog.close();dialog.remove();resolve(value);};
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const value=Number(e.target.elements.pages.value);if(!Number.isSafeInteger(value)||value<15){showToast('En az 15 tam sayfa girmelisin. Okuma kaydedilmedi.');finish(null);}else finish(value);};
  dialog.querySelector('[data-cancel]').onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};
  document.body.appendChild(dialog);dialog.showModal();
 });
}
async function moveBookWithGoal(b,collectionName,destCollection){
 const uid=currentUid;
 if(collectionName!=='readBooks'){
  await addDoc(collection(db,'users',uid,destCollection),{title:b.title||'',author:b.author||'',cover:b.cover||'',addedAt:new Date().toISOString()});
  await deleteDoc(doc(db,'users',uid,collectionName,b.id));
  hubPreviews.invalidate('library');
  return;
 }
 const userRef=doc(db,'users',uid),sourceRef=doc(db,'users',uid,'readBooks',b.id),destRef=doc(db,'users',uid,'bookHistory','finished_'+b.id);
 const completedAt=new Date().toISOString();
 await runTransaction(db,async tx=>{
  const user=await tx.get(userRef),source=await tx.get(sourceRef);if(!source.exists())return;
  const goals=personalGoals(user.data()?.readingGoals),monthly=activeMonthlyGoal(goals,Date.parse(completedAt));
  const data=source.data();
  tx.set(destRef,{title:data.title||'',author:data.author||'',cover:data.cover||'',addedAt:completedAt,completedAt,completedFromReading:true});
  tx.delete(sourceRef);
  if(monthly){monthly.completed=[...new Set([...(monthly.completed||[]),b.id])];tx.update(userRef,{readingGoals:goals});}
 });
 hubPreviews.invalidate('library');
}
// Uygulama açık kalırsa 06.00 / aylık dönem bitişi de görünümde güncellensin.
setInterval(()=>{
 if(document.hidden||!currentUid)return;
 const section=document.querySelector('#tab-today.active, #tab-msurvey.active');
 if(section&&Date.now()>=Number(section.dataset.goalRefreshAt||Infinity))renderTotalPagesCard(section.id==='tab-today'?'totalPagesNumber':'mTotalPagesNumber');
},60000);

/* ============ ORTAK: "BUGÜN OKUDUN MU?" KENDİNİ İŞARETLEME KARTI ============ */
// Hem üye hem yönetici "Bugün" sekmesinde aynı kendini işaretleme kartını görüyor; ikisi de aynı
// mantığı kullanıyor, sadece farklı DOM id'lerine bağlanıyor (aynı sayfada aynı id iki kez olamaz).
// Günün saatine ve o günkü işaretleme durumuna göre "Bugün" başlığı için sıcak ama abartısız
// bir karşılama cümlesi seçer. Hem admin (tab-today) hem üye (tab-msurvey) ekranı aynı fonksiyonu
// paylaştığı için burada tek yerden yönetiliyor.
function dailyGreetingText(status){
  const h = new Date().getHours();
  const part = h<6 ? 'gece' : h<11 ? 'sabah' : h<17 ? 'oglen' : h<21 ? 'aksam' : 'gece';
  const lines = {
    sabah: {
      read: window.BH_I18N.pick("Günaydın! Bugünün kitabını okudun, güne hazırsın.","Good morning! You’ve read today. You’re ready for the day."),
      skip: window.BH_I18N.pick("Günaydın! Bugün ara verdin, canın istediğinde devam edersin.","Good morning! You took a break today. Read whenever you feel ready."),
      none: window.BH_I18N.pick("Günaydın! Okumaya hazır mısın?","Good morning! Ready to read?")
    },
    oglen: {
      read: window.BH_I18N.pick("İyi günler! Bugün için okudun bile, harikasın.","Good afternoon! You’ve already read today. Well done!"),
      skip: window.BH_I18N.pick("İyi günler! Bugün ara verdin, yarın devam edebilirsin.","Good afternoon! You took a break today. You can continue tomorrow."),
      none: window.BH_I18N.pick("İyi günler! Güne birkaç sayfa sığdırmaya ne dersin?","Good afternoon! How about a few pages today?")
    },
    aksam: {
      read: window.BH_I18N.pick("İyi akşamlar! Günü okuyarak kapattın.","Good evening! You’ve rounded off the day with a book."),
      skip: window.BH_I18N.pick("İyi akşamlar! Bugün ara verdin, yarın kaldığın yerden devam.","Good evening! You took a break today. Pick up where you left off tomorrow."),
      none: window.BH_I18N.pick("İyi akşamlar! Günü bitirmeden birkaç sayfa okur musun?","Good evening! A few pages before the day ends?")
    },
    gece: {
      read: window.BH_I18N.pick("İyi geceler! Bugün okudun, tatlı rüyalar.","Good night! You read today. Sweet dreams."),
      skip: window.BH_I18N.pick("İyi geceler! Bugün ara verdin, yarın devam edersin.","Good night! You took a break today. Continue tomorrow."),
      none: window.BH_I18N.pick("İyi geceler! Yatmadan birkaç sayfa okumaya ne dersin?","Good night! How about a few pages before bed?")
    }
  };
  return lines[part][status] || lines[part].none;
}
function wireSelfMarkCard(ids){
  function render(){
    const st = todayAnswers[currentUid];
    updateSelfReadButton(document.getElementById(ids.readBtn).closest('section.tab'),{status:st},null);
    if(ids.heading){
      document.getElementById(ids.heading).textContent = dailyGreetingText(st==='read'?'read':st==='skip'?'skip':'none');
    }
    const ld = nowLogical();
    const dowLabel = DOW[ld.getDay()===0?6:ld.getDay()-1];
    const dateLabel = `${dowLabel} ${pad(ld.getDate())}.${pad(ld.getMonth()+1)}.${ld.getFullYear()}`;
    document.getElementById(ids.dateNote).textContent =
      (window.BH_I18N.language==='en'
       ? `Today’s reading date: ${dateLabel}. This check-in is valid until 06:00 tomorrow morning. Check-ins after 06:00 count toward the next day. If you do not check in by 06:00, today will automatically be marked as “didn’t read”.`
       : `Bugünün okuma tarihi: ${dateLabel}. Bu işaretleme yarın sabah 06:00'a kadar geçerli; 06:00'dan sonra yaptığın işaretleme bir sonraki güne yazılır. 06:00'a kadar hiç işaretleme yapmazsan bu gün otomatik "okumadım" sayılır.`);
    document.getElementById(ids.statusNote).textContent =
      st==='read' ? window.BH_I18N.pick("Bugün için \"Okudum\" işaretledin. Harika!","You marked today as read. Great!") :
      st==='skip' ? window.BH_I18N.pick("Bugün için okuma kaydın yok.","You haven’t recorded any reading today.") :
      window.BH_I18N.pick("Bugün için henüz işaretleme yapmadın.","You haven’t checked in today.");
    computeStreak(currentUid).then(s=>{
      document.getElementById(ids.streakNote).textContent = window.BH_I18N.template`${s} gün`;
    }).catch(()=>{});
    renderTotalPagesCard(ids.pagesNumber);
    if(ids.qpBook) renderQpBookInBugun(ids.qpBook);
  }
  document.getElementById(ids.readBtn).addEventListener('click', async (ev)=>{
    const key = ids.readBtn+'|read';
    if(stampBtnInFlight.has(key)) return;
    stampBtnInFlight.add(key);
    const btn=ev.currentTarget,point={x:ev.clientX,y:ev.clientY};
    const uid=currentUid,day=todayStr(),prevStatus=todayAnswers[uid];
    let optimistic=false;
    try{
      // Hedefler ve bugünkü durum zaten canlı dinleyicilerle elimizde; sunucuya gidip beklemiyoruz.
      const goals=personalGoals((usersCache[uid]||myProfile)?.readingGoals);
      const daily=dailyGoalAt(goals,day),wasRead=prevStatus==='read';
      let previousPages=0;
      if(wasRead){
        if(!daily){render();return;}
        previousPages=validReadPages((await getDoc(doc(db,'days',day,'answers',uid))).data());
        if(previousPages>=daily.target){render();return;}
      }
      let pages=null;
      if(daily){
        pages=await askReadPages(previousPages);
        if(pages===null){render();return;}
        if(wasRead&&pages<previousPages){showToast(window.BH_I18N.pick("Yeni toplam önceki ","The new total cannot be below the previous ")+previousPages+' sayfadan az olamaz.');render();return;}
      }
      if(uid!==currentUid||day!==todayStr()){showToast(window.BH_I18N.pick("Gün veya oturum değişti. Lütfen yeniden işaretle.","The day or session has changed. Please mark your reading again."));render();return;}
      if(!wasRead){
        optimistic=true;selfReadPending={uid,day};
        todayAnswers[uid]='read';render();playReadMarkFx(btn,point);
      }
      const created=await saveSelfReadTotal(uid,day,pages);
      selfReadPending=null;
      todayAnswers[uid]='read';
      hubPreviews.invalidate('club');
      render();
      if(created){
        notifyAllMembers(`${myProfile.name} bugün "Okudum" işaretledi.`, 'week', uid);
        // Kayıt zaten başarılı; seri okunamazsa işaretlemeyi geri alma, rozet kontrolü sonra yapılır.
        try{const streak=await computeStreak(uid);await checkAndAwardBadges(uid,streak);}catch(_){}
      }
    }catch(err){
      selfReadPending=null;
      if(optimistic){
        if(prevStatus===undefined) delete todayAnswers[uid]; else todayAnswers[uid]=prevStatus;
        btn.classList.remove('just-marked');
      }
      showToast(err.message||window.BH_I18N.pick("Okuma kaydedilemedi. Lütfen yeniden dene.","Could not save your reading. Please try again."));render();
    }
    finally{setTimeout(()=>stampBtnInFlight.delete(key),1200);}
  });
  return render;
}
function playMarkFx(btn, type){
  const cls = type==='read' ? 'pop-read' : 'pop-skip';
  const r = btn.getBoundingClientRect();
  const ghost = btn.cloneNode(true);
  ghost.classList.remove('selected');
  ghost.removeAttribute('id');
  ghost.style.position = 'fixed';
  ghost.style.left = r.left + 'px';
  ghost.style.top = r.top + 'px';
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.margin = '0';
  ghost.style.zIndex = '500';
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);
  void ghost.offsetWidth; // reflow — animasyonu tetiklemek için
  ghost.classList.add(cls);
  setTimeout(()=> ghost.remove(), 700);
}
const renderMemberSurvey = wireSelfMarkCard({readBtn:'mReadBtn', dateNote:'mDateNote', statusNote:'mMyStatusNote', streakNote:'mMyStreakNote', pagesNumber:'mTotalPagesNumber', qpBook:'mMyQpBook', heading:'mTodayHeading'});
let memberWeekOffset = 0; // 0 = bu hafta, -1 = önceki hafta, ...
const renderAdminSelfToday = wireSelfMarkCard({readBtn:'aSelfReadBtn', dateNote:'aSelfDateNote', statusNote:'aSelfStatusNote', streakNote:'aSelfStreakNote', pagesNumber:'totalPagesNumber', qpBook:'aSelfQpBook', heading:'aTodayHeading'});

async function renderMemberOwnWeek(){
  const baseMonday = getMonday(nowLogical());
  const monday = addDays(baseMonday, memberWeekOffset*7);
  const dates = weekDates(monday);
  document.getElementById('mWeekNextBtn').disabled = memberWeekOffset>=0;
  const table = document.getElementById('mOwnWeekGrid');
  showCachedOrPlaceholder(table, window.BH_I18N.template`<div class="empty-state">Yükleniyor…</div>`);
  const perDate = await Promise.all(dates.map(fetchDayAnswers));
  const joinDs = joinDateStrOf(currentUid);
  table.innerHTML = buildWeekHistoryHTML(dates, perDate, joinDs);
  markLoaded(table);
}
document.getElementById('mWeekPrevBtn').addEventListener('click', ()=>{ memberWeekOffset -= 1; renderMemberOwnWeek(); });
document.getElementById('mWeekNextBtn').addEventListener('click', ()=>{ if(memberWeekOffset<0){ memberWeekOffset += 1; renderMemberOwnWeek(); } });

/* ============ ÜYE: BU HAFTA (HERKES) ============ */


/* ============ ÜYE: GEÇEN HAFTA ============ */
async function renderMemberLastWeek(){
  const box = keepOrLoading('mLastWeekBox');
  await loadDraws();
  if(drawsCache.length===0){ box.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">🎁</span>Henüz tamamlanmış bir hafta yok.</div>`; markLoaded(box); return; }
  const d = drawsCache[0];
  const rangeLabel = `${fmtShort(d.weekStart)} — ${fmtShort(d.weekEnd)}`;
  let body;
  if(!d.pairs || d.pairs.length===0){
    body = window.BH_I18N.template`<div class="empty-note">Bu hafta cezalı çıkmadığı için kura çekilmedi.</div>`;
  } else {
    body = d.pairs.map(p=>{
      const giverHtml = `<span class="giver">${p.giverUid ? userChipHtml(p.giverUid) : escapeHtml(p.giverName)}</span>`;
      const receiverHtml = `<span class="receiver">${p.receiverUid ? userChipHtml(p.receiverUid) : escapeHtml(p.receiverName)}</span>`;
      if(!p.receiverUid) return window.BH_I18N.template`<div class="pair-line">${giverHtml}<span class="arrow">—</span><span class="empty-note" style="text-align:right;">uygun alıcı bulunamadı</span></div>`;
      return `<div class="pair-line">${giverHtml}<span class="arrow"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>${receiverHtml}</div>`;
    }).join('');
  }
  box.innerHTML = `<div class="receipt"><div class="rweek">Hafta: ${rangeLabel}</div>${body}</div>`;
  markLoaded(box);
}

/* ============ ORTAK: KURA GEÇMİŞİ (gezinilebilir, tek tek hafta) ============ */
let drawHistIndex = { m:0, a:0 };
async function renderDrawHistoryCard(prefix){
  const box = keepOrLoading(prefix+'DrawHistBox');
  await loadDraws();
  const rangeEl = document.getElementById(prefix+'DrawHistRangeLabel');
  const prevBtn = document.getElementById(prefix+'DrawHistPrevBtn');
  const nextBtn = document.getElementById(prefix+'DrawHistNextBtn');
  if(drawsCache.length===0){
    rangeEl.textContent = '';
    prevBtn.disabled = true; nextBtn.disabled = true;
    box.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">🎁</span>Henüz tamamlanmış bir hafta yok.</div>`;
    markLoaded(box);
    return;
  }
  if(drawHistIndex[prefix] >= drawsCache.length) drawHistIndex[prefix] = drawsCache.length-1;
  if(drawHistIndex[prefix] < 0) drawHistIndex[prefix] = 0;
  const d = drawsCache[drawHistIndex[prefix]];
  const rangeLabel = `${fmtShort(d.weekStart)} — ${fmtShort(d.weekEnd)}`;
  rangeEl.textContent = rangeLabel;
  prevBtn.disabled = drawHistIndex[prefix] >= drawsCache.length-1;
  nextBtn.disabled = drawHistIndex[prefix] <= 0;
  let body;
  if(!d.pairs || d.pairs.length===0){
    body = window.BH_I18N.template`<div class="empty-note">Bu hafta cezalı çıkmadığı için kura çekilmedi.</div>`;
  } else {
    body = d.pairs.map(p=>{
      const giverHtml = `<span class="giver">${p.giverUid ? userChipHtml(p.giverUid) : escapeHtml(p.giverName)}</span>`;
      const receiverHtml = `<span class="receiver">${p.receiverUid ? userChipHtml(p.receiverUid) : escapeHtml(p.receiverName)}</span>`;
      if(!p.receiverUid) return window.BH_I18N.template`<div class="pair-line">${giverHtml}<span class="arrow">—</span><span class="empty-note" style="text-align:right;">uygun alıcı bulunamadı</span></div>`;
      return `<div class="pair-line">${giverHtml}<span class="arrow"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>${receiverHtml}</div>`;
    }).join('');
  }
  box.innerHTML = `<div class="receipt"><div class="rweek">Hafta: ${rangeLabel} &middot; Cezalı: ${d.giverCount} &middot; Temiz/Pas: ${d.safeCount}</div>${body}</div>`;
  markLoaded(box);
}
document.getElementById('mDrawHistPrevBtn').addEventListener('click', ()=>{ drawHistIndex.m += 1; renderDrawHistoryCard('m'); });
document.getElementById('mDrawHistNextBtn').addEventListener('click', ()=>{ if(drawHistIndex.m>0){ drawHistIndex.m -= 1; renderDrawHistoryCard('m'); } });
document.getElementById('aDrawHistPrevBtn').addEventListener('click', ()=>{ drawHistIndex.a += 1; renderDrawHistoryCard('a'); });
document.getElementById('aDrawHistNextBtn').addEventListener('click', ()=>{ if(drawHistIndex.a>0){ drawHistIndex.a -= 1; renderDrawHistoryCard('a'); } });

/* ============ ORTAK: PROFİLİM ============ */
function isGoogleUser(){
  return !!(auth.currentUser && auth.currentUser.providerData.some(p=>p.providerId==='google.com'));
}
function renderProfileTab(){
  document.getElementById('profileMyRole').textContent = myProfile.role==='admin' ? window.BH_I18N.pick("YÖNETİCİ","ADMINISTRATOR") : window.BH_I18N.pick("ÜYE","MEMBER");
  document.getElementById('profileName').value = myProfile.name || '';
  document.getElementById('profileSurname').value = myProfile.surname || '';
  document.getElementById('profilePhone').value = myProfile.phone || '';
  document.getElementById('profileAddress').value = myProfile.address || '';
  document.getElementById('profileBio').value = myProfile.bio || '';
  document.getElementById('profilePhotoWrap').innerHTML = avatarHtmlFromProfile(myProfile, 88);
  document.getElementById('profileError').textContent = '';
}
function resizeImageFile(file, maxSize){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let w=img.width, h=img.height;
        if(w>h){ if(w>maxSize){ h=Math.round(h*maxSize/w); w=maxSize; } }
        else { if(h>maxSize){ w=Math.round(w*maxSize/h); h=maxSize; } }
        const canvas = document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        canvas.toBlob(blob=> blob?resolve(blob):reject(new Error(window.BH_I18N.pick("Dönüştürme başarısız","Conversion failed"))), 'image/jpeg', 0.85);
      };
      img.onerror = ()=>reject(new Error(window.BH_I18N.pick("Görsel okunamadı","Could not read the image")));
      img.src = reader.result;
    };
    reader.onerror = ()=>reject(new Error(window.BH_I18N.pick("Dosya okunamadı","Could not read the file")));
    reader.readAsDataURL(file);
  });
}
document.getElementById('profilePhotoInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try{
    const blob = await resizeImageFile(file, 300);
    const ref = storageRef(storage, `avatars/${currentUid}.jpg`);
    await uploadBytes(ref, blob);
    const url = await getDownloadURL(ref);
    await updateDoc(doc(db,'users',currentUid), {photoURL:url});
    myProfile.photoURL = url;
    document.getElementById('profilePhotoWrap').innerHTML = avatarHtmlFromProfile(myProfile, 88);
    showToast(window.BH_I18N.pick("Profil fotoğrafı güncellendi.","Profile photo updated."));
  }catch(err){ alert(window.BH_I18N.pick("Fotoğraf yüklenemedi: ","Could not upload photo: ") + (err.message||err) + '\n\nFirebase Storage etkin mi kontrol et.'); }
});
document.getElementById('profileSaveBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('profileName').value.trim();
  const surname = document.getElementById('profileSurname').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  const address = document.getElementById('profileAddress').value.trim();
  const bio = document.getElementById('profileBio').value.trim();
  const errBox = document.getElementById('profileError');
  errBox.textContent = '';
  if(!name){ errBox.textContent = window.BH_I18N.pick("İsim boş olamaz.","Name cannot be empty."); return; }
  if(!surname || !phone || !address){
    flashRequiredFields();
    errBox.textContent = window.BH_I18N.pick("Soyad, telefon ve adres alanları zorunludur.","Surname, phone and address are required.");
    return;
  }
  try{
    await updateDoc(doc(db,'users',currentUid), {name, surname, phone, address, bio});
    myProfile.name = name; myProfile.surname = surname; myProfile.phone = phone; myProfile.address = address;
    myProfile.bio = bio;
    document.getElementById('whoamiAvatar').innerHTML = avatarHtmlFromProfile(myProfile,18);
  document.getElementById('whoamiName').textContent = myProfile.name;
  document.querySelectorAll('[data-material-name]').forEach(el=>el.textContent=myProfile.name||'');
    if(profileGateActive){
      profileGateActive = false;
      showToast(window.BH_I18N.pick("Profilin tamamlandı, artık uygulamayı kullanabilirsin!","Your profile is complete. You can now use the app!"));
      buildNav();
    } else {
      showToast(window.BH_I18N.pick("Profilin güncellendi.","Profile updated."));
    }
  }catch(err){ errBox.textContent = 'Kaydedilemedi: ' + (err.message||err); }
});
document.getElementById('settingsChangePasswordBtn').addEventListener('click', async ()=>{
  const curPass = document.getElementById('settingsCurPassword').value;
  const newPass = document.getElementById('settingsNewPassword').value;
  const errBox = document.getElementById('settingsPasswordError');
  errBox.textContent = '';
  if(!curPass || !newPass){ errBox.textContent = window.BH_I18N.pick("Her iki alanı da doldur.","Fill in both fields."); return; }
  if(newPass.length<6){ errBox.textContent = window.BH_I18N.pick("Yeni şifre en az 6 karakter olmalı.","The new password must have at least 6 characters."); return; }
  try{
    const cred = EmailAuthProvider.credential(auth.currentUser.email, curPass);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, newPass);
    document.getElementById('settingsCurPassword').value='';
    document.getElementById('settingsNewPassword').value='';
    showToast(window.BH_I18N.pick("Şifren değiştirildi.","Password changed."));
  }catch(err){ errBox.textContent = friendlyAuthError(err); }
});

async function performSelfDelete(){
  await deleteDoc(doc(db,'users',currentUid));
  await deleteUser(auth.currentUser);
}
document.getElementById('deleteMyAccountBtn').addEventListener('click', async ()=>{
  if(myProfile.role==='admin'){
    const remainingAdmins = Object.keys(usersCache).filter(u=>usersCache[u].role==='admin' && !usersCache[u].banned && !usersCache[u].deleted && u!==currentUid).length;
    if(remainingAdmins===0){ alert(window.BH_I18N.pick("Tek aktif yöneticisin. Hesabını silmeden önce başka birini yönetici yapmalısın.","You are the only active administrator. Assign another before deleting your account.")); return; }
  }
  if(!confirm(window.BH_I18N.pick("Hesabını tamamen ve kalıcı olarak silmek istediğine EMİN misin? Bu işlem geri alınamaz.","Are you SURE you want to permanently delete your account? This cannot be undone."))) return;
  const typed = prompt(window.BH_I18N.pick("Onaylamak için büyük harflerle \"SİL\" yaz:","Type \"SİL\" in capital letters to confirm:"));
  if(typed !== 'SİL'){ if(typed!==null) alert(window.BH_I18N.pick("Onay metni eşleşmedi, işlem iptal edildi.","The confirmation text did not match. Deletion cancelled.")); return; }
  try{
    await performSelfDelete();
  }catch(err){
    if(err.code === 'auth/requires-recent-login'){
      try{
        if(isGoogleUser()){
          await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
        } else {
          const pass = prompt(window.BH_I18N.pick("Güvenlik için şifreni tekrar gir:","Re-enter your password for security:"));
          if(!pass) return;
          const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
          await reauthenticateWithCredential(auth.currentUser, cred);
        }
        await performSelfDelete();
      }catch(err2){ alert('Hesap silinemedi: ' + (err2.message||err2)); }
    } else {
      alert('Hesap silinemedi: ' + (err.message||err));
    }
  }
});

/* ============ ORTAK: GRUP KURALLARI ============ */
async function renderRulesTab(){
  const displayBox = document.getElementById('rulesDisplay');
  showCachedOrPlaceholder(displayBox, window.BH_I18N.pick("Yükleniyor…","Loading…"));
  let rulesText = '';
  try{
    const snap = await getDoc(doc(db,'settings','groupRules'));
    rulesText = snap.exists() ? (snap.data().text || '') : '';
  }catch(e){ return; }
  displayBox.textContent = rulesText || window.BH_I18N.pick("Henüz kural eklenmemiş.","No rules have been added yet.");
  markLoaded(displayBox);
  const editBox = document.getElementById('rulesAdminEdit');
  if(myProfile.role==='admin'){
    editBox.style.display='block';
    document.getElementById('rulesTextarea').value = rulesText;
  } else {
    editBox.style.display='none';
  }
  document.getElementById('ruleRequestsTitle').textContent = myProfile.role==='admin' ? window.BH_I18N.pick("Gelen Kural Önerileri","Received rule suggestions") : window.BH_I18N.pick("Gönderdiğim Öneriler","My suggestions");
  await renderRuleRequestsList();
}
document.getElementById('rulesSaveBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('rulesTextarea').value;
  try{
    await setDoc(doc(db,'settings','groupRules'), {text, updatedAt:new Date().toISOString(), updatedBy: myProfile.name});
    showToast(window.BH_I18N.pick("Kurallar güncellendi.","Rules updated."));
    renderRulesTab();
  }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
});
document.getElementById('ruleRequestBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('ruleRequestText').value.trim();
  if(!text) return;
  try{
    await addDoc(collection(db,'ruleRequests'), { uid:currentUid, name: myProfile.name, text, status:'pending', createdAt:new Date().toISOString() });
    document.getElementById('ruleRequestText').value='';
    showToast(window.BH_I18N.pick("Öneri gönderildi.","Recommendation sent."));
    if(myProfile.role!=='admin') await notifyAdmins(`${myProfile.name} yeni bir kural önerisi gönderdi: "${text}"`, 'rules');
    renderRulesTab();
  }catch(err){ alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err)); }
});
async function renderRuleRequestsList(){
  const box = keepOrLoading('ruleRequestsList');
  let snap;
  try{
    if(myProfile.role==='admin'){
      snap = await getDocs(query(collection(db,'ruleRequests'), orderBy('createdAt','desc')));
    } else {
      snap = await getDocs(query(collection(db,'ruleRequests'), where('uid','==',currentUid), orderBy('createdAt','desc')));
    }
  }catch(e){ return; }
  const items = [];
  snap.forEach(d=> items.push({id:d.id, ...d.data()}));
  if(items.length===0){ box.innerHTML = window.BH_I18N.template`<p class="muted">Henüz öneri yok.</p>`; markLoaded(box); return; }
  box.innerHTML = items.map(it=>{
    const statusChip = it.status==='approved' ? window.BH_I18N.pick("<span class=\"chip ok\">Onaylandı</span>","<span class=\"chip ok\">Approved</span>") : it.status==='rejected' ? window.BH_I18N.pick("<span class=\"chip danger\">Reddedildi</span>","<span class=\"chip danger\">Rejected</span>") : window.BH_I18N.pick("<span class=\"chip pending\">Bekliyor</span>","<span class=\"chip pending\">Waiting</span>");
    const adminBtns = myProfile.role==='admin' && it.status==='pending' ? window.BH_I18N.template`
      <div class="row" style="margin-top:6px;">
        <button class="secondary tiny" data-approve="${it.id}">Onayla</button>
        <button class="secondary tiny" data-reject="${it.id}">Reddet</button>
      </div>` : '';
    return `<div class="member-row" style="display:block;">
      <div class="member-name">${userChipHtml(it.uid)} ${statusChip}</div>
      <div class="muted" style="margin-top:4px;">${escapeHtml(it.text)}</div>
      ${adminBtns}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-approve]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const it = items.find(x=>x.id===btn.dataset.approve);
      await updateDoc(doc(db,'ruleRequests',btn.dataset.approve), {status:'approved'});
      if(it) await notifyUser(it.uid, `Kural önerin onaylandı: "${it.text}"`, 'rules');
      renderRuleRequestsList();
    });
  });
  box.querySelectorAll('[data-reject]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const it = items.find(x=>x.id===btn.dataset.reject);
      await updateDoc(doc(db,'ruleRequests',btn.dataset.reject), {status:'rejected'});
      if(it) await notifyUser(it.uid, `Kural önerin reddedildi: "${it.text}"`, 'rules');
      renderRuleRequestsList();
    });
  });
  markLoaded(box);
}

/* ============ ORTAK: HEDİYE KİTAP ============ */
// Tüm çekilişlerdeki (draws) her çift için tek bir "giftRequests/{id}" belgesi var. Eskiden bu
// belgeler TEK TEK, birbirini bekleyerek (sequential await) çekiliyordu — hafta sayısı arttıkça
// (kulüp ne kadar eskiyse o kadar çok hafta) bu, onlarca ardışık ağ gidiş-dönüşü demekti ve
// "Hediye Kitap" sekmesi saniyelerce (bazı durumlarda 15-20 sn) donmuş gibi kalıyordu. Artık
// hepsi TEK SEFERDE, aynı anda (Promise.all) çekiliyor — süre, en yavaş tek istek kadar oluyor,
// hepsinin toplamı kadar değil.
async function fetchAllGiftRequests(){
  const reqIds = [];
  drawsCache.forEach(d=>{
    (d.pairs||[]).forEach(p=>{
      if(p.receiverUid) reqIds.push(`${d.weekStart}_${p.giverUid}_${p.receiverUid}`);
    });
  });
  // Sorgu gerçekten başarısız olursa (ağ/izin hatası — belge yok dönmesi zaten hata fırlatmaz)
  // bunu "istek yok/alınmadı" sanıp zaten tamamlanmış bir hediyeyi yeniden "bekliyor" göstermeyelim
  // ve bunu kalıcı önbelleğe yazmayalım — hata yukarı (renderGiftsTab'a) yayılsın, ekran olduğu
  // gibi kalsın.
  const snaps = await Promise.all(reqIds.map(id=> getDoc(doc(db,'giftRequests',id))));
  const map = {};
  reqIds.forEach((id,i)=>{
    const s = snaps[i];
    map[id] = (s && s.exists()) ? s.data() : null;
  });
  return map;
}
// 3 aylık ortak kitap hediyesi: haftalık hediye kurasından tamamen ayrı, kendi koleksiyonunda
// (quarterlyGiftPending / quarterlyGiftRequests) tutuluyor. Sadece kullanıcının KENDİ ilgili
// olduğu eşleşme(ler) varsa kart gösteriliyor, yoksa (ilgisi yoksa) kart tamamen gizli kalıyor.
async function renderQpGiftCard(){
  const wrap = document.getElementById('qpGiftCardWrap');
  const content = document.getElementById('qpGiftContent');
  if(!wrap || !content) return;
  let pending = null;
  try{ const snap = await getDoc(doc(db,'quarterlyGiftPending','current')); pending = snap.exists() ? snap.data() : null; }catch(e){ return; }
  if(!pending){ wrap.style.display = 'none'; return; }
  const myPairs = (pending.pairs||[]).filter(p=> p.giverUid===currentUid || p.receiverUid===currentUid);
  if(myPairs.length===0){ wrap.style.display = 'none'; return; }

  if(!pending.applied){
    wrap.style.display = 'block';
    content.innerHTML = myPairs.map(p=>{
      if(p.giverUid===currentUid){
        return window.BH_I18N.template`<div class="receipt"><div class="rweek">Ortak kitabı zamanında bitirmediğin için <span class="giver">${userChipHtml(p.receiverUid)}</span>'e bir kitap hediye edeceksin.</div><div class="empty-note">Hangi kitap olacağı, bir sonraki ortak kitap seçimi tamamlanınca belli olacak.</div></div>`;
      }
      return window.BH_I18N.template`<div class="receipt"><div class="rweek"><span class="giver">${userChipHtml(p.giverUid)}</span> sana bir kitap hediye edecek.</div><div class="empty-note">Hangi kitap olacağı, bir sonraki ortak kitap seçimi tamamlanınca belli olacak.</div></div>`;
    }).join('');
    return;
  }

  let html = '';
  for(const p of myPairs){
    const reqId = `${pending.sourceCycleNumber}_${p.giverUid}_${p.receiverUid}`;
    let req = null;
    try{ const s = await getDoc(doc(db,'quarterlyGiftRequests',reqId)); req = s.exists() ? s.data() : null; }catch(e){ return; }
    if(!req || req.received) continue;
    if(p.receiverUid===currentUid){
      if(req.shipped){
        html += window.BH_I18N.template`<div class="receipt">
          <div class="rweek"><span class="giver">${userChipHtml(p.giverUid)}</span> kitabını gönderdi 📮</div>
          <div class="muted" style="display:flex; align-items:center; gap:8px;"><span class="book-cover-clickable" data-book-title="${escapeHtml(req.bookTitle||'')}" data-book-cover="${escapeHtml(req.bookCover||'')}" style="display:block;flex:0 0 auto;width:32px;height:48px;cursor:pointer;">${materialBookCover(req.bookTitle,req.bookCover)}</span><span>Kitap: <b>${escapeHtml(req.bookTitle||'-')}</b></span></div>
          <button class="primary qp-gift-received" data-reqid="${reqId}" data-giver="${p.giverUid}" style="margin-top:8px;">📬 Kitabı Aldım</button>
        </div>`;
      } else {
        html += window.BH_I18N.template`<div class="receipt">
          <div class="rweek"><span class="giver">${userChipHtml(p.giverUid)}</span> sana kitap hediye edecek: <b>${escapeHtml(req.bookTitle||'')}</b></div>
          <p class="muted" style="font-size:12px;">Adres bilgilerin profilinden otomatik iletildi.</p>
        </div>`;
      }
    } else {
      if(req.shipped){
        html += window.BH_I18N.template`<div class="receipt"><div class="rweek">${userChipHtml(p.receiverUid)}'e gönderdiğini işaretledin</div><div class="empty-note">📬 Alıcı onayı bekleniyor.</div></div>`;
      } else {
        html += window.BH_I18N.template`<div class="receipt"><div class="rweek">${userChipHtml(p.receiverUid)}'e kitap hediye edeceksin</div>
          <div class="muted" style="display:flex; gap:10px;"><span class="book-cover-clickable" data-book-title="${escapeHtml(req.bookTitle||'')}" data-book-cover="${escapeHtml(req.bookCover||'')}" style="display:block;flex:0 0 auto;width:40px;height:60px;cursor:pointer;">${materialBookCover(req.bookTitle,req.bookCover)}</span><span>Alıcı: <b>${escapeHtml(req.recipientName||p.receiverName)}</b><br/>Kitap: <b>${escapeHtml(req.bookTitle||'-')}</b><br/>Adres: ${escapeHtml(req.address||'-')}<br/>Telefon: ${escapeHtml(req.phone||'-')}</span></div>
          <button class="secondary qp-gift-shipped" data-reqid="${reqId}" data-receiver="${p.receiverUid}" style="margin-top:8px;">📮 Kitabı Gönderdim</button>
        </div>`;
      }
    }
  }
  if(!html){ wrap.style.display='none'; return; }
  wrap.style.display = 'block';
  content.innerHTML = html;
  content.querySelectorAll('.qp-gift-shipped').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Kitabı gönderdiğini onaylıyor musun? Alıcı, aldığını onayladığında bu hediye geçmişe taşınacak.","Confirm you sent the book? It will move to history when the recipient confirms receipt."))) return;
      btn.disabled = true;
      try{
        await updateDoc(doc(db,'quarterlyGiftRequests',btn.dataset.reqid), {shipped:true, shippedAt:new Date().toISOString()});
        notifyUser(btn.dataset.receiver, `${myProfile.name} ortak kitap hediyesini gönderdi! Aldığında "Hediye Kitap" sekmesinden onaylamayı unutma.`, 'gifts');
        showToast(window.BH_I18N.pick("Kitap gönderildi olarak işaretlendi.","Book marked as sent."));
        renderQpGiftCard();
      }catch(err){ alert(window.BH_I18N.pick("İşaretlenemedi: ","Could not mark: ")+(err.message||err)); btn.disabled = false; }
    });
  });
  content.querySelectorAll('.qp-gift-received').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Kitabı aldığını onaylıyor musun? Onayladıktan sonra bu hediye geçmişe taşınacak.","Confirm you received the book? This gift will then move to your history."))) return;
      btn.disabled = true;
      try{
        await updateDoc(doc(db,'quarterlyGiftRequests',btn.dataset.reqid), {received:true, receivedAt:new Date().toISOString()});
        notifyUser(btn.dataset.giver, `${myProfile.name} ortak kitap hediyesini aldığını onayladı. 🎉`, 'gifts');
        showToast(window.BH_I18N.pick("Alındı olarak işaretlendi, teşekkürler!","Marked as received, thank you!"));
        renderQpGiftCard();
      }catch(err){ alert(window.BH_I18N.pick("İşaretlenemedi: ","Could not mark: ")+(err.message||err)); btn.disabled = false; }
    });
  });
}
// "Bugüne Kadar" kartı: kulüp kurulduğundan beri kim kaç hediye almış/vermiş — Rozet
// Geçmişi'ndeki madalyon görünümüyle aynı stil, sadece 2 "rozet" (aldı/verdi) var.
function renderGiftStatsList(){
  const box = keepOrLoading('giftStatsList');
  const stats = {};
  drawsCache.forEach(d=>{
    (d.pairs||[]).forEach(p=>{
      if(p.giverUid){ stats[p.giverUid] = stats[p.giverUid] || {given:0, received:0}; stats[p.giverUid].given++; }
      if(p.receiverUid){ stats[p.receiverUid] = stats[p.receiverUid] || {given:0, received:0}; stats[p.receiverUid].received++; }
    });
  });
  const uids = Object.keys(stats).filter(uid=>usersCache[uid]);
  uids.sort((a,b)=> stats[b].received - stats[a].received);
  if(uids.length===0){ box.innerHTML = window.BH_I18N.template`<p class="muted">Henüz hiç hediye verilmemiş.</p>`; markLoaded(box); return; }
  const coin = (icon, kind, count, title)=>{
    if(count>0){
      return `<div class="gift-stats-num ${kind}" title="${title}: ${count}"><span class="gift-stats-num-text">${count}</span></div>`;
    }
    return `<div class="gift-stats-icon-only" title="${title}: 0"><span>${icon}</span></div>`;
  };
  box.innerHTML = `<div class="gift-stats-grid">${uids.map(uid=>{
    const s = stats[uid];
    return `<div class="gift-stats-cell">
      <div class="gift-stats-avatar">${avatarHtmlFromProfile(usersCache[uid], 44)}</div>
      <div class="gift-stats-name">${escapeHtml(usersCache[uid].name||'')}</div>
      <div class="gift-stats-coins">
        ${coin('📥', 'received', s.received, window.BH_I18N.pick("Aldığı hediye","Gifts received"))}
        ${coin('📤', 'given', s.given, window.BH_I18N.pick("Verdiği hediye","Gifts given"))}
      </div>
    </div>`;
  }).join('')}</div>`;
  markLoaded(box);
}
async function renderGiftsTab(){
  document.getElementById('giftsMemberLastWeekWrap').style.display = myProfile.role==='admin' ? 'none' : 'block';
  document.getElementById('giftsDrawHistAdminWrap').style.display = myProfile.role==='admin' ? 'block' : 'none';
  document.getElementById('giftsDrawHistMemberWrap').style.display = myProfile.role==='admin' ? 'none' : 'block';
  renderQpGiftCard();
  const intro = document.getElementById('giftsIntro');
  const content = keepOrLoading('giftsContent');
  await loadDraws();
  renderGiftStatsList();
  const reqMap = await fetchAllGiftRequests();

  let personalHtml = '';
  // Sadece EN SON haftaya değil, geçmişteki TÜM haftalara bakılıyor: bir önceki haftadan kalan
  // henüz tamamlanmamış (teslim onaylanmamış) bir hediye, yeni bir kura çekilse bile buradan
  // kaybolmasın — kişi işini bitirene kadar (alıcı "Kitabı Aldım" deyip onaylayana kadar) o
  // haftanın kartı gösterilmeye devam ediyor.
  for(const d of drawsCache){
    if(!d.pairs) continue;
    for(const p of d.pairs){
      const isReceiver = p.receiverUid===currentUid;
      const isGiver = p.giverUid===currentUid && p.receiverUid;
      if(!isReceiver && !isGiver) continue;
      const reqId = `${d.weekStart}_${p.giverUid}_${p.receiverUid}`;
      const req = reqMap[reqId];
      if(req && req.received) continue; // tamamlanmış, geçmişte görünür, burada tekrar gösterilmez
      personalHtml += buildPersonalGiftHtml(d, isReceiver?p:null, isGiver?p:null, req);
    }
  }

  let adminHtml = '';
  if(myProfile.role==='admin'){
    adminHtml = buildAdminPendingHtml(reqMap);
  }

  intro.textContent = myProfile.role==='admin'
    ? window.BH_I18N.pick("Önce kendi durumun (varsa), altında tüm kulübün bekleyen istekleri.","Your status appears first, followed by pending requests from the club.")
    : window.BH_I18N.pick("Bu haftanın hediye kitap durumu.","This week’s book gift status.");

  if(!personalHtml && !adminHtml){
    content.innerHTML = drawsCache.length===0
      ? window.BH_I18N.template`<div class="empty-state"><span class="big">🎁</span>Henüz kura çekilmedi.</div>`
      : window.BH_I18N.template`<div class="empty-state"><span class="big">🎁</span>Bu hafta hediye kitap kazanamadınız.</div>`;
  } else {
    let combined = personalHtml || '';
    if(adminHtml){
      combined += window.BH_I18N.template`<h3 style="font-family:'Roboto',sans-serif; font-weight:500; margin:18px 0 8px;">Tüm Kulüp — Bekleyen İstekler</h3>${adminHtml}`;
    }
    content.innerHTML = combined;
  }

  markLoaded(content);
  wireGiftFormHandlers(content);
}

function buildPersonalGiftHtml(draw, myPairAsReceiver, myPairAsGiver, reqForReceiver, reqForGiver){
  const latest = draw;
  let html = '';
  if(myPairAsReceiver){
    const p = myPairAsReceiver;
    const reqId = `${latest.weekStart}_${p.giverUid}_${p.receiverUid}`;
    const req = reqForReceiver!==undefined ? reqForReceiver : null;
    if(req && req.received){
      // tamamlandı, geçmişte görünür
    } else if(req && req.shipped){
      html += window.BH_I18N.template`<div class="receipt">
        <div class="rweek">${fmtShort(latest.weekStart)}–${fmtShort(latest.weekEnd)}: <span class="giver">${userChipHtml(p.giverUid)}</span> kitabını gönderdi 📮</div>
        <div class="muted" style="display:flex; align-items:center; gap:8px;"><span class="book-cover-clickable" data-book-title="${escapeHtml(req.bookTitle||'')}" data-book-cover="${escapeHtml(req.bookCover||'')}" style="display:block;flex:0 0 auto;width:32px;height:48px;cursor:pointer;">${materialBookCover(req.bookTitle,req.bookCover)}</span><span>Kitap: <b>${escapeHtml(req.bookTitle||'-')}</b></span></div>
        <button class="primary gf-received" data-reqid="${reqId}" data-giver="${p.giverUid}" style="margin-top:8px;">📬 Kitabı Aldım</button>
      </div>`;
    } else if(req){
      html += window.BH_I18N.template`<div class="receipt">
        <div class="rweek">${fmtShort(latest.weekStart)}–${fmtShort(latest.weekEnd)}: <span class="giver">${userChipHtml(p.giverUid)}</span> sana kitap hediye edecek</div>
        <div class="muted" style="display:flex; align-items:center; gap:8px;"><span class="book-cover-clickable" data-book-title="${escapeHtml(req.bookTitle||'')}" data-book-cover="${escapeHtml(req.bookCover||'')}" style="display:block;flex:0 0 auto;width:32px;height:48px;cursor:pointer;">${materialBookCover(req.bookTitle,req.bookCover)}</span><span>İstediğin kitap: <b>${escapeHtml(req.bookTitle||'-')}</b></span></div>
        <button type="button" class="secondary gf-edit-toggle" style="margin-top:8px;">Güncelle</button>
        <div class="gift-form" data-week="${latest.weekStart}" data-giver="${p.giverUid}" data-receiver="${p.receiverUid}" style="display:none; margin-top:12px;">
          <div class="field"><label>Ad Soyad</label><input type="text" class="gf-name" value="${escapeHtml(req.recipientName||'')}" /></div>
          <div class="field"><label>İstediğin kitap</label><input type="text" class="gf-book" autocomplete="off" placeholder="kitap adını yazmaya başla, listeden seç" value="${escapeHtml(req.bookTitle||'')}" /><div class="gf-book-suggest book-suggest-box"></div></div>
          <div class="field"><label>Kapak Görseli Linki (seçince otomatik dolar, istersen değiştir)</label><input type="text" class="gf-cover" value="${escapeHtml(req.bookCover||'')}" placeholder="internetten bulduğun kapak görselinin linki" /></div>
          <div class="field"><label>Site (opsiyonel)</label><input type="text" class="gf-site" value="${escapeHtml(req.site||'')}" placeholder="örn. trendyol, d&r..." /></div>
          <div class="field"><label>Adres</label><input type="text" class="gf-address" value="${escapeHtml(req.address||'')}" /></div>
          <div class="field"><label>Telefon</label><input type="text" class="gf-phone" value="${escapeHtml(req.phone||'')}" /></div>
          <button class="primary gf-submit">Güncelle</button>
        </div>
      </div>`;
    } else {
      const myFullName = myProfile.surname ? `${myProfile.name} ${myProfile.surname}` : (myProfile.name || '');
      const prefillName = myFullName;
      const prefillAddress = myProfile.address || '';
      const prefillPhone = myProfile.phone || '';
      html += window.BH_I18N.template`<div class="receipt">
        <div class="rweek">${fmtShort(latest.weekStart)}–${fmtShort(latest.weekEnd)}: <span class="giver">${userChipHtml(p.giverUid)}</span> sana kitap hediye edecek</div>
        <div class="gift-form" data-week="${latest.weekStart}" data-giver="${p.giverUid}" data-receiver="${p.receiverUid}">
          <div class="field"><label>Ad Soyad</label><input type="text" class="gf-name" value="${escapeHtml(prefillName)}" /></div>
          <div class="field"><label>İstediğin kitap</label><input type="text" class="gf-book" autocomplete="off" placeholder="kitap adını yazmaya başla, listeden seç" value="" /><div class="gf-book-suggest book-suggest-box"></div></div>
          <div class="field"><label>Kapak Görseli Linki (seçince otomatik dolar, istersen değiştir)</label><input type="text" class="gf-cover" value="" placeholder="internetten bulduğun kapak görselinin linki" /></div>
          <div class="field"><label>Site (opsiyonel)</label><input type="text" class="gf-site" value="" placeholder="örn. trendyol, d&r..." /></div>
          <div class="field"><label>Adres</label><input type="text" class="gf-address" value="${escapeHtml(prefillAddress)}" /></div>
          <div class="field"><label>Telefon</label><input type="text" class="gf-phone" value="${escapeHtml(prefillPhone)}" /></div>
          <p class="muted" style="font-size:12px;">Bilgiler Profilim sekmendeki kayıtlı bilgilerden otomatik dolduruldu, istersen değiştirip yine de gönderebilirsin.</p>
          <button class="primary gf-submit">Gönder</button>
        </div>
      </div>`;
    }
  }
  if(myPairAsGiver && myPairAsGiver.receiverUid){
    const p = myPairAsGiver;
    const reqId = `${latest.weekStart}_${p.giverUid}_${p.receiverUid}`;
    const req = reqForGiver!==undefined ? reqForGiver : reqForReceiver;
    if(req && req.received){
      // tamamlandı, geçmişte görünür
    } else if(req && req.shipped){
      html += window.BH_I18N.template`<div class="receipt"><div class="rweek">${fmtShort(latest.weekStart)}–${fmtShort(latest.weekEnd)}: ${userChipHtml(p.receiverUid)}'e gönderdiğini işaretledin</div><div class="empty-note">📬 Alıcı onayı bekleniyor.</div></div>`;
    } else if(req){
      html += window.BH_I18N.template`<div class="receipt"><div class="rweek">${fmtShort(latest.weekStart)}–${fmtShort(latest.weekEnd)}: ${userChipHtml(p.receiverUid)}'e kitap hediye edeceksin</div>
        <div class="muted" style="display:flex; gap:10px;"><span class="book-cover-clickable" data-book-title="${escapeHtml(req.bookTitle||'')}" data-book-cover="${escapeHtml(req.bookCover||'')}" style="display:block;flex:0 0 auto;width:40px;height:60px;cursor:pointer;">${materialBookCover(req.bookTitle,req.bookCover)}</span><span>Alıcı: <b>${escapeHtml(req.recipientName||p.receiverName)}</b><br/>İstediği kitap: <b>${escapeHtml(req.bookTitle||'-')}</b>${req.site?` &middot; Site: ${escapeHtml(req.site)}`:''}<br/>Adres: ${escapeHtml(req.address||'-')}<br/>Telefon: ${escapeHtml(req.phone||'-')}</span></div>
        <button class="secondary gf-shipped" data-reqid="${reqId}" data-receiver="${p.receiverUid}" style="margin-top:8px;">📮 Kitabı Gönderdim</button>
      </div>`;
    } else {
      html += `<div class="receipt"><div class="rweek">${fmtShort(latest.weekStart)}–${fmtShort(latest.weekEnd)}: ${userChipHtml(p.receiverUid)}'e kitap hediye edeceksin</div><div class="empty-note">${escapeHtml(p.receiverName)} henüz istek formunu doldurmadı.</div></div>`;
    }
  }
  return html;
}

function buildAdminPendingHtml(reqMap){
  if(drawsCache.length===0) return '';
  let html = '';
  for(const d of drawsCache){
    if(!d.pairs) continue;
    for(const p of d.pairs){
      if(!p.receiverUid) continue;
      const reqId = `${d.weekStart}_${p.giverUid}_${p.receiverUid}`;
      const req = reqMap[reqId];
      if(req && req.received) continue; // tamamlanan geçmişte gösterilir
      html += `<div class="receipt"><div class="rweek"><span>${fmtShort(d.weekStart)}–${fmtShort(d.weekEnd)}: <span class="giver">${userChipHtml(p.giverUid)}</span> → <span class="receiver">${userChipHtml(p.receiverUid)}</span></span></div>`;
      if(req && req.shipped){
        html += window.BH_I18N.template`<div class="empty-note">📮 Gönderildi, alıcı onayı bekleniyor.</div>`;
      } else if(req){
        html += window.BH_I18N.template`<div class="muted" style="display:flex; gap:10px;"><span class="book-cover-clickable" data-book-title="${escapeHtml(req.bookTitle||'')}" data-book-cover="${escapeHtml(req.bookCover||'')}" style="display:block;flex:0 0 auto;width:40px;height:60px;cursor:pointer;">${materialBookCover(req.bookTitle,req.bookCover)}</span><span>Alıcı: <b>${escapeHtml(req.recipientName||p.receiverName)}</b><br/>Kitap: <b>${escapeHtml(req.bookTitle||'-')}</b>${req.site?` &middot; Site: ${escapeHtml(req.site)}`:''}<br/>Adres: ${escapeHtml(req.address||'-')}<br/>Telefon: ${escapeHtml(req.phone||'-')}</span></div>`;
      } else {
        html += window.BH_I18N.template`<div class="empty-note">Alıcı henüz istek formunu doldurmadı.</div>`;
      }
      html += `</div>`;
    }
  }
  return html || window.BH_I18N.template`<div class="empty-state">Bekleyen hediye yok.</div>`;
}

function wireGiftFormHandlers(content){
  content.querySelectorAll('.gf-edit-toggle').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const formEl = btn.nextElementSibling;
      if(formEl && formEl.classList.contains('gift-form')){
        if(formEl.style.display==='none'){
          formEl.style.display = 'block';
          formEl.classList.remove('slide-down-anim');
          void formEl.offsetWidth;
          formEl.classList.add('slide-down-anim');
        } else {
          formEl.style.display = 'none';
        }
      }
    });
  });
  content.querySelectorAll('.gift-form').forEach(formEl=>{
    attachBookAutocompleteEl(
      formEl.querySelector('.gf-book'),
      formEl.querySelector('.gf-cover'),
      formEl.querySelector('.gf-book-suggest')
    );
    formEl.querySelector('.gf-submit').addEventListener('click', async (e)=>{
      const weekStart = formEl.dataset.week, giverUid = formEl.dataset.giver, receiverUid = formEl.dataset.receiver;
      const reqId = `${weekStart}_${giverUid}_${receiverUid}`;
      const recipientName = formEl.querySelector('.gf-name').value.trim();
      const bookTitle = formEl.querySelector('.gf-book').value.trim();
      const bookCover = formEl.querySelector('.gf-cover').value.trim();
      const site = formEl.querySelector('.gf-site').value.trim();
      const address = formEl.querySelector('.gf-address').value.trim();
      const phone = formEl.querySelector('.gf-phone').value.trim();
      if(!recipientName || !bookTitle || !address || !phone){ alert(window.BH_I18N.pick("Ad soyad, kitap adı, adres ve telefon alanları zorunlu.","Full name, book title, address and phone are required.")); return; }
      const submitBtn = e.currentTarget;
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = window.BH_I18N.pick("Gönderiliyor…","Sending…");
      try{
        await setDoc(doc(db,'giftRequests',reqId), {
          weekStart, giverUid, receiverUid,
          giverName: usersCache[giverUid]?.name||'', receiverName: usersCache[receiverUid]?.name||'',
          recipientName, bookTitle, bookCover, site, address, phone, shipped:false, received:false, updatedAt: new Date().toISOString()
        });
        // Bildirim ve akış gönderisi, ana işlemin sonucunu ETKİLEMEDİĞİ için (ikisi de "yan
        // etki") bekletmiyoruz — kullanıcı arka planda tamamlanırken hemen sonucu görüyor.
        notifyUser(giverUid, `${myProfile.name} hediye kitap isteğini gönderdi: "${bookTitle}". "Hediye Kitap" sekmesinden bak.`, 'gifts');
        createPost('gift_requested', { giverUid, giverName: usersCache[giverUid]?.name||'', bookTitle, bookCover });
        showToast(window.BH_I18N.pick("İstek gönderildi.","Request sent."));
        renderGiftsTab();
      }catch(err){
        alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err));
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });
  });
  content.querySelectorAll('.gf-shipped').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Kitabı gönderdiğini onaylıyor musun? Alıcı, aldığını onayladığında bu hediye geçmişe taşınacak.","Confirm you sent the book? It will move to history when the recipient confirms receipt."))) return;
      btn.disabled = true;
      try{
        await updateDoc(doc(db,'giftRequests',btn.dataset.reqid), {shipped:true, shippedAt:new Date().toISOString()});
        // Bildirim, sayaç güncellemesi ve rekor kontrolü asıl işlemin sonucunu etkilemiyor —
        // arka planda tamamlanırken kullanıcı hemen sonucu görüyor.
        notifyUser(btn.dataset.receiver, `${myProfile.name} hediye kitabını gönderdi! Aldığında "Hediye Kitap" sekmesinden onaylamayı unutma.`, 'gifts');
        const myGivenCount = (myProfile.giftsGivenCount||0) + 1;
        updateDoc(doc(db,'users',currentUid), { giftsGivenCount: myGivenCount }).then(()=>{ usersCache[currentUid].giftsGivenCount = myGivenCount; }).catch(()=>{});
        checkAndPostDethrone(currentUid, myGivenCount, (ouid)=>usersCache[ouid].giftsGivenCount, window.BH_I18N.pick("En Çok Hediye Gönderen","Most gifts sent"), '📦');
        showToast(window.BH_I18N.pick("Kitap gönderildi olarak işaretlendi.","Book marked as sent."));
        renderGiftsTab();
      }catch(err){ alert(window.BH_I18N.pick("İşaretlenemedi: ","Could not mark: ")+(err.message||err)); btn.disabled = false; }
    });
  });
  content.querySelectorAll('.gf-received').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Kitabı aldığını onaylıyor musun? Onayladıktan sonra bu hediye geçmişe taşınacak.","Confirm you received the book? This gift will then move to your history."))) return;
      btn.disabled = true;
      try{
        await updateDoc(doc(db,'giftRequests',btn.dataset.reqid), {received:true, receivedAt:new Date().toISOString()});
        notifyUser(btn.dataset.giver, `${myProfile.name} hediye kitabını aldığını onayladı. 🎉`, 'gifts');
        createPost('gift_completed', { variantText: pickGiftMessage('completed') });
        const myReceivedCount = (myProfile.giftsReceivedCount||0) + 1;
        updateDoc(doc(db,'users',currentUid), { giftsReceivedCount: myReceivedCount }).then(()=>{ usersCache[currentUid].giftsReceivedCount = myReceivedCount; }).catch(()=>{});
        checkAndPostDethrone(currentUid, myReceivedCount, (ouid)=>usersCache[ouid].giftsReceivedCount, window.BH_I18N.pick("En Çok Hediye Alan","Most gifts received"), '🎁');
        showToast(window.BH_I18N.pick("Alındı olarak işaretlendi, teşekkürler!","Marked as received, thank you!"));
        renderGiftsTab();
      }catch(err){ alert(window.BH_I18N.pick("İşaretlenemedi: ","Could not mark: ")+(err.message||err)); btn.disabled = false; }
    });
  });
}

let giftBooksGridCache = [];
async function renderGiftBooksGrid(){
  const host = keepOrLoading('giftBooksGrid');
  let items = [];
  try{
    const snap = await getDocs(query(collection(db,'giftRequests'), where('received','==',true)));
    snap.forEach(d=> items.push(d.data()));
  }catch(e){ return; }
  items = items.filter(it=>it.bookTitle).sort((a,b)=> new Date(b.receivedAt||b.updatedAt||0) - new Date(a.receivedAt||a.updatedAt||0));
  if(!items.length){ host.innerHTML = window.BH_I18N.template`<p class="muted">Henüz tamamlanmış hediye yok.</p>`; markLoaded(host); return; }
  giftBooksGridCache = items;
  host.innerHTML = `<div class="discover-grid">${items.map((it,idx)=>{
    const coverHtml = materialBookCover(it.bookTitle,it.bookCover);
    return `<div class="discover-book-card" data-gift-book-idx="${idx}">
      <div class="discover-book-cover-wrap">${coverHtml}</div>
      <div class="discover-book-title">${escapeHtml(it.bookTitle)}</div>
    </div>`;
  }).join('')}</div>`;
  host.querySelectorAll('[data-gift-book-idx]').forEach(card=>{
    card.addEventListener('click', ()=>{
      const it = giftBooksGridCache[parseInt(card.dataset.giftBookIdx,10)];
      if(!it) return;
      const monday = new Date(it.weekStart);
      const sunday = new Date(monday); sunday.setDate(sunday.getDate()+6);
      const weekLabel = `${fmtShort(it.weekStart)}–${fmtShort(sunday.toISOString().slice(0,10))}`;
      const prependHtml = `<div class="rec-comments-label" style="margin-top:0;">🎁 Hediye Bilgisi</div>
        <div class="muted" style="margin-bottom:12px; font-size:13px;">👤 ${escapeHtml(it.receiverName||'')} aldı &middot; 📅 ${weekLabel} haftası</div>`;
      showBookInfo(it.bookTitle, it.bookCover, prependHtml);
    });
  });
  markLoaded(host);
}
/* ============ ORTAK: KİTAP ÖNERİLERİ ============ */
async function renderRecsTab(){
  const select = document.getElementById('recPersonalTarget');
  const others = activeUids().filter(uid=>uid!==currentUid);
  select.innerHTML = others.length
    ? others.map(uid=>`<option value="${uid}">${escapeHtml(usersCache[uid].name)}</option>`).join('')
    : window.BH_I18N.pick("<option value=\"\">(başka üye yok)</option>","<option value=\"\">(no other members)</option>");

  await renderQuarterlyPickCard();
  await renderPersonalRecs();
  await renderGroupRecs();
}

/* ============ ORTAK KİTAP SEÇİMİ (3 aylık turnuva usulü oylama) ============
   Faz geçişleri (öneri → itiraz → oylama turları → okuma) sunucu tarafında otomatik
   ilerliyor (bkz. functions/index.js: quarterlyPickTick). Burada sadece o anki fazı
   gösterip, öneri/itiraz/oy verme gibi kullanıcı eylemlerini Firestore transaction'larıyla
   güvenli şekilde kaydediyoruz. */
const QP_MAX_NOMINATIONS = 3;
let qpCache = null;
function qpDocRef(){ return doc(db,'quarterlyPick','current'); }
function qpNomsCol(){ return collection(db,'quarterlyPick','current','nominations'); }
function qpMatchesCol(round){ return collection(db,'quarterlyPick','current','rounds',String(round),'matches'); }
function qpFinishAnswersCol(){ return collection(db,'quarterlyPick','current','finishAnswers'); }
function qpDiscussionMessagesCol(){ return collection(db,'quarterlyPick','current','discussionMessages'); }
const QP_DEFAULT_Q1 = window.BH_I18N.pick("Kitaptaki bir karakter, hayatında tanıdığın birine benziyor muydu? Nasıl?","Did a character remind you of someone you know? How?");
const QP_DEFAULT_Q2 = window.BH_I18N.pick("Kitaptaki önemli bir olayı sen de yaşadın mı ya da benzer bir şey hissettin mi?","Have you experienced something like an important event in the book, or felt similarly?");
const QP_MOODS = [
  {key:'keyifli', icon:'😊', label:'Keyifli'},
  {key:'huzunlu', icon:'😢', label:window.BH_I18N.pick("Hüzünlü","Sad")},
  {key:'vasat', icon:'😐', label:'Vasat'},
  {key:'etkileyici', icon:'🤯', label:'Etkileyici'},
  {key:'sikici', icon:'😴', label:window.BH_I18N.pick("Sıkıcı","Boring")},
  {key:'muhtesem', icon:'🔥', label:window.BH_I18N.pick("Muhteşem","Wonderful")},
];
function qpFmtRemaining(endsAtIso){
  if(!endsAtIso) return '';
  const ms = new Date(endsAtIso).getTime() - Date.now();
  if(ms<=0) return window.BH_I18N.pick("süre doldu, güncelleniyor…","time expired, updating…");
  const totalMin = Math.floor(ms/60000);
  const days = Math.floor(totalMin/1440);
  const hours = Math.floor((totalMin%1440)/60);
  const mins = totalMin%60;
  if(days>0) return window.BH_I18N.template`${days} gün ${hours} saat kaldı`;
  if(hours>0) return window.BH_I18N.template`${hours} saat ${mins} dakika kaldı`;
  return window.BH_I18N.template`${mins} dakika kaldı`;
}
async function renderQuarterlyPickCard(){
  const body = document.getElementById('quarterlyPickBody');
  if(!body) return;
  let qp = null;
  // Sorgu başarısız olursa "henüz başlamamış" sanıp ekranı yanlışlıkla ezmeyelim — olduğu gibi
  // bırakıp çıkıyoruz, "belge yok" (gerçekten başlamamış) durumu zaten hata fırlatmaz.
  try{ const snap = await getDoc(qpDocRef()); qp = snap.exists() ? snap.data() : null; }catch(e){ return; }
  qpCache = qp;
  materialRenderPhase(qp);
  if(!qp){ body.innerHTML = window.BH_I18N.template`<p class="muted">Henüz başlamamış, yakında başlayacak.</p>`; return; }
  if(qp.phase==='nominating') return renderQpNominating(body, qp);
  if(qp.phase==='objecting') return renderQpObjecting(body, qp);
  if(qp.phase==='voting') return renderQpVoting(body, qp);
  if(qp.phase==='reading') return renderQpReadingSummary(body, qp);
  body.innerHTML = window.BH_I18N.template`<p class="muted">Durum bilinmiyor.</p>`;
}
let qpNomCache = {};
function qpNomRowHtml(n, extraHtml){
  qpNomCache[n.id] = n;
  return `<div class="qp-nom-row" data-qp-nom-id="${n.id}">
    <div class="qp-nom-cover-ph">${materialBookCover(n.bookTitle,n.bookCover)}</div>
    <div class="qp-nom-info">
      <div class="qp-nom-title">${escapeHtml(n.bookTitle)}</div>
      <div class="qp-nom-meta">${escapeHtml(n.bookAuthor||'')} &middot; öneren: ${escapeHtml(n.name||'')}</div>
    </div>
    ${extraHtml||''}
  </div>`;
}
function showQpNominationInfo(nom){
  if(!nom) return;
  const body = document.getElementById('bookInfoModalBody');
  document.getElementById('bookInfoModal').style.display='flex';
  const coverHtml = materialBookCover(nom.bookTitle,nom.bookCover,'book-cover-detail');
  body.innerHTML = `
    ${coverHtml}
    <h2 style="margin:4px 0 2px;">${escapeHtml(nom.bookTitle)}</h2>
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(nom.bookAuthor||'')}</div>
    ${nom.note ? window.BH_I18N.template`<p style="text-align:left; font-size:13.5px; line-height:1.5;"><b>Kitap hakkında:</b> ${escapeHtml(nom.note)}</p>` : window.BH_I18N.template`<p class="muted" style="font-size:12.5px;">Öneren bir açıklama eklememiş.</p>`}
    <div class="muted" style="font-size:11px; margin-top:10px;">Öneren: ${escapeHtml(nom.name||'')}</div>
  `;
}
function qpWireNomRowClicks(body){
  body.querySelectorAll('[data-qp-nom-id]').forEach(row=>{
    row.addEventListener('click', (e)=>{
      if(e.target.closest('button, input, textarea, .book-suggest-box, .field')) return;
      showQpNominationInfo(qpNomCache[row.dataset.qpNomId]);
    });
  });
}
// Bir öneri satırını (kapak+isim yan yana duran, dar flex bir satır) düzenleme formuna
// çevirir. Satırın kendi flex düzenini (display:block ile) geçersiz kılıyoruz, yoksa form
// alanları (kitap adı, yazar adı vs.) o dar satırın içinde yan yana sıkışıp kalıyordu — dar
// ekranlarda okunamaz hâle geliyordu. Ayrıca diğer önerileri aşağı itme, yumuşak bir
// yükseklik animasyonuyla oluyor.
function qpExpandRowToForm(row, formHtml){
  row.classList.add('qp-editing');
  row.style.overflow = 'hidden';
  row.style.maxHeight = row.offsetHeight + 'px';
  row.style.transition = 'max-height .35s ease';
  row.innerHTML = formHtml;
  requestAnimationFrame(()=>{
    row.style.maxHeight = row.scrollHeight + 'px';
  });
  row.addEventListener('transitionend', function handler(e){
    if(e.propertyName!=='max-height') return;
    row.style.maxHeight = 'none';
    row.style.overflow = 'visible';
    row.removeEventListener('transitionend', handler);
  });
}
function qpNominationFormHtml(idPrefix, submitLabel){
  return window.BH_I18N.template`
    <div class="field"><label>Kitap Adı</label><input type="text" id="${idPrefix}Book" autocomplete="off" placeholder="yazmaya başla, aransın — bulamazsan yazmaya devam et" /><div id="${idPrefix}BookSuggest" class="book-suggest-box"></div></div>
    <div class="field"><label>Yazar Adı</label><input type="text" id="${idPrefix}Author" autocomplete="off" placeholder="yazmaya başla, aransın — bulamazsan yazmaya devam et" /><div id="${idPrefix}AuthorSuggest" class="book-suggest-box"></div></div>
    <div class="field"><label>Kapak Görseli Linki (seçince otomatik dolar, istersen değiştir)</label><input type="text" id="${idPrefix}Cover" placeholder="internetten bulduğun kapak görselinin linki" /></div>
    <div class="field"><label>Kitap Hakkında</label><textarea id="${idPrefix}Note" placeholder="bu kitabı neden okumak istediğini kısaca anlat" style="width:100%; min-height:70px; padding:10px; border:1.5px solid var(--line); border-radius:12px; font-family:'Inter',sans-serif; font-size:14px; background:var(--card); color:var(--ink); resize:vertical; box-sizing:border-box;"></textarea></div>
    <button class="primary" id="${idPrefix}SendBtn">${submitLabel}</button>
  `;
}
// Hem "kitap adı" hem "yazar adı" alanı aynı genel aramayı tetikliyor (OpenLibrary'nin genel
// arama uç noktası zaten yazar adına göre de eşleşiyor); ikisi de seçim yapılmadan elle yazmaya
// devam edebiliyor. Gönderirken yazar adı boşsa (database'den seçilmemiş VE elle de
// yazılmamışsa) engelliyoruz.
function qpWireNominationForm(idPrefix, onSubmit){
  const bookInput = document.getElementById(idPrefix+'Book');
  const authorInput = document.getElementById(idPrefix+'Author');
  const coverInput = document.getElementById(idPrefix+'Cover');
  const applySelection = (b)=>{
    bookInput.value = b.title;
    authorInput.value = b.author||'';
    coverInput.value = b.cover||'';
  };
  attachBookAutocompleteEl(bookInput, coverInput, document.getElementById(idPrefix+'BookSuggest'), applySelection);
  attachBookAutocompleteEl(authorInput, coverInput, document.getElementById(idPrefix+'AuthorSuggest'), applySelection);
  document.getElementById(idPrefix+'SendBtn').addEventListener('click', async (e)=>{
    const title = bookInput.value.trim();
    const author = authorInput.value.trim();
    const cover = coverInput.value.trim();
    const note = document.getElementById(idPrefix+'Note').value.trim();
    if(!title){ alert(window.BH_I18N.pick("Kitap adı gerekli.","A book title is required.")); return; }
    if(!author){ alert(window.BH_I18N.pick("Yazar adı gerekli.","An author name is required.")); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    try{
      await onSubmit({title, author, cover, note});
    }catch(err){ alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err)); btn.disabled = false; }
  });
}
async function renderQpNominating(body, qp){
  let noms = [];
  try{ const snap = await getDocs(qpNomsCol()); snap.forEach(d=> noms.push({id:d.id, ...d.data()})); }catch(e){ return; }
  noms.sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
  const myCount = noms.filter(n=>n.uid===currentUid).length;
  const rows = noms.map(n=>{
    const canManage = n.uid===currentUid || myProfile.role==='admin';
    const extra = canManage ? window.BH_I18N.template`<div class="row" style="flex:0 0 auto; width:auto; gap:6px;">
      <button type="button" class="secondary tiny" data-qp-edit="${n.id}">Düzenle</button>
      <button type="button" class="secondary tiny" data-qp-delete="${n.id}" style="border-color:var(--cloth-dark); color:var(--cloth-dark);">Sil</button>
    </div>` : '';
    return qpNomRowHtml(n, extra);
  }).join('');
  body.innerHTML = window.BH_I18N.template`
    <div class="qp-phase-label">Öneri Toplama</div>
    <div class="qp-deadline">⏳ ${qpFmtRemaining(qp.phaseEndsAt)}</div>
    <div class="qp-nom-list">${rows || window.BH_I18N.pick("<p class=\"muted\">Henüz öneri yok, ilk öneriyi sen yap!</p>","<p class=\"muted\">No recommendations yet. Be the first!</p>")}</div>
    <p class="muted" style="font-size:12px; margin-bottom:8px;">Hakkın: ${myCount}/${QP_MAX_NOMINATIONS} kullanıldı.</p>
    ${myCount<QP_MAX_NOMINATIONS ? window.BH_I18N.template`
    <button type="button" class="secondary tiny" id="qpNomAddBtn">+ Kitap Öner</button>
    <div id="qpNomFormWrap" style="display:none; margin-top:12px;">${qpNominationFormHtml('qpNom',window.BH_I18N.pick("Öner","Recommend"))}</div>` : window.BH_I18N.template`<p class="muted" style="font-size:12px;">3 öneri hakkını kullandın.</p>`}
  `;
  qpWireNomRowClicks(body);
  body.querySelectorAll('[data-qp-delete]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!confirm(window.BH_I18N.pick("Bu öneriyi silmek istediğine emin misin?","Are you sure you want to delete this recommendation?"))) return;
      try{
        await deleteDoc(doc(db,'quarterlyPick','current','nominations',btn.dataset.qpDelete));
        showToast(window.BH_I18N.pick("Öneri silindi.","Recommendation deleted."));
        renderQuarterlyPickCard();
      }catch(err){ alert('Silinemedi: '+(err.message||err)); }
    });
  });
  body.querySelectorAll('[data-qp-edit]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const nomId = btn.dataset.qpEdit;
      const nom = qpNomCache[nomId];
      const row = btn.closest('.qp-nom-row');
      qpExpandRowToForm(row, qpNominationFormHtml('qpEdit_'+nomId, window.BH_I18N.pick("Güncelle","Update")));
      document.getElementById('qpEdit_'+nomId+'Book').value = nom.bookTitle||'';
      document.getElementById('qpEdit_'+nomId+'Author').value = nom.bookAuthor||'';
      document.getElementById('qpEdit_'+nomId+'Cover').value = nom.bookCover||'';
      document.getElementById('qpEdit_'+nomId+'Note').value = nom.note||'';
      qpWireNominationForm('qpEdit_'+nomId, async ({title,author,cover,note})=>{
        await updateDoc(doc(db,'quarterlyPick','current','nominations',nomId), { bookTitle:title, bookAuthor:author, bookCover:cover, note });
        showToast(window.BH_I18N.pick("Öneri güncellendi!","Recommendation updated!"));
        renderQuarterlyPickCard();
      });
    });
  });
  const addBtn = document.getElementById('qpNomAddBtn');
  if(addBtn){
    addBtn.addEventListener('click', ()=>{
      const wrap = document.getElementById('qpNomFormWrap');
      wrap.style.display = wrap.style.display==='none' ? 'block' : 'none';
    });
    qpWireNominationForm('qpNom', async ({title,author,cover,note})=>{
      await submitQuarterlyNomination(title, author, cover, note, null);
      showToast(window.BH_I18N.pick("Öneri gönderildi!","Recommendation sent!"));
      renderQuarterlyPickCard();
    });
  }
}
async function renderQpObjecting(body, qp){
  let noms = [];
  try{ const snap = await getDocs(qpNomsCol()); snap.forEach(d=> noms.push({id:d.id, ...d.data()})); }catch(e){ return; }
  noms.sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
  const myCount = noms.filter(n=>n.uid===currentUid && (n.status==='active'||n.status==='objected')).length;
  const rows = noms.map(n=>{
    if(n.status==='objected'){
      if(n.replacementFilled) return '';
      const canFill = (n.uid===currentUid) || myCount<QP_MAX_NOMINATIONS;
      return `<div class="qp-nom-row ghost" data-open-slot="${n.id}">
        ${canFill ? window.BH_I18N.template`<button type="button" class="qp-slot-fill-btn" data-fill-slot="${n.id}">+</button><span class="muted" style="font-size:12px;">boş yer — bir kitap öner</span>` : `<span class="muted" style="font-size:12px;">boş yer ("${escapeHtml(n.bookTitle)}" itiraz edildi)</span>`}
      </div>`;
    }
    return qpNomRowHtml(n, window.BH_I18N.template`<button type="button" class="secondary tiny" data-qp-object="${n.id}" data-qp-title="${escapeHtml(n.bookTitle)}">Bunu Okudum</button>`);
  }).join('');
  body.innerHTML = window.BH_I18N.template`
    <div class="qp-phase-label">İtiraz Süresi</div>
    <div class="qp-deadline">⏳ ${qpFmtRemaining(qp.phaseEndsAt)}</div>
    <p class="muted" style="font-size:12px; margin-bottom:8px;">Bir kitabı yakın zamanda okuduysan itiraz edebilirsin — düşen kitabın yerine öneren kişi ya da hakkı dolmayan biri (kim önce davranırsa) yeni bir öneri yapabilir.</p>
    <div class="qp-nom-list">${rows}</div>
  `;
  qpWireNomRowClicks(body);
  body.querySelectorAll('[data-qp-object]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); objectToQuarterlyNomination(btn.dataset.qpObject, btn.dataset.qpTitle); });
  });
  body.querySelectorAll('[data-fill-slot]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const slotId = btn.dataset.fillSlot;
      const row = btn.closest('.qp-nom-row');
      row.classList.remove('ghost');
      row.style.display = 'block';
      qpExpandRowToForm(row, qpNominationFormHtml('qpFill_'+slotId, window.BH_I18N.pick("Öner","Recommend")));
      qpWireNominationForm('qpFill_'+slotId, async ({title,author,cover,note})=>{
        await submitQuarterlyNomination(title, author, cover, note, slotId);
        showToast(window.BH_I18N.pick("Öneri gönderildi!","Recommendation sent!"));
        renderQuarterlyPickCard();
      });
    });
  });
}
async function renderQpVoting(body, qp){
  let matches = [];
  try{ const snap = await getDocs(qpMatchesCol(qp.round)); snap.forEach(d=> matches.push({id:d.id, ...d.data()})); }catch(e){ return; }
  matches.sort((a,b)=> a.id.localeCompare(b.id));
  const roundLabel = qp.round===qp.totalRounds ? 'Final' : (qp.round===qp.totalRounds-1 ? window.BH_I18N.pick("Yarı Final","Semifinal") : `${qp.round}. Tur`);
  const cardHtml = (matchId, slot, book, votes, voted)=> `
    <div class="qp-vs-card${voted?' voted':''}" data-qp-vote="${matchId}" data-qp-slot="${slot}">
      ${materialBookCover(book.bookTitle,book.bookCover,'qp-vs-cover')}
      <div class="qp-vs-title">${escapeHtml(book.bookTitle)}</div>
      <div class="qp-vs-author">${escapeHtml(book.bookAuthor||'')}</div>
      <div class="qp-vs-votes" data-vote-count>${votes} oy</div>
    </div>`;
  const rows = matches.map(m=>`<div class="qp-match-wrap" data-qp-match="${m.id}"><div class="qp-vs-row">
    ${cardHtml(m.id,'A',m.slotA,(m.votesA||[]).length,(m.votesA||[]).includes(currentUid))}
    <div class="qp-vs-mid">VS</div>
    ${cardHtml(m.id,'B',m.slotB,(m.votesB||[]).length,(m.votesB||[]).includes(currentUid))}
  </div></div>`).join('');
  body.innerHTML = `
    <div class="qp-phase-label">${roundLabel} — Oylama</div>
    <div class="qp-deadline">⏳ ${qpFmtRemaining(qp.phaseEndsAt)}</div>
    ${qp.fullyVotedAt ? window.BH_I18N.template`<p class="muted" style="font-size:12px; color:var(--gold); margin-bottom:8px;">✓ Herkes oy kullandı — kimse oyunu değiştirmezse bu tur birkaç dakika içinde erken bitecek.</p>` : ''}
    ${rows}
  `;
  body.querySelectorAll('[data-qp-vote]').forEach(card=>{
    card.addEventListener('click', ()=>{
      const matchWrap = card.closest('[data-qp-match]');
      const cardA = matchWrap.querySelector('[data-qp-slot="A"]');
      const cardB = matchWrap.querySelector('[data-qp-slot="B"]');
      const clickedSlot = card.dataset.qpSlot;
      const countA = cardA.querySelector('[data-vote-count]');
      const countB = cardB.querySelector('[data-vote-count]');
      let nA = parseInt(countA.textContent,10) || 0;
      let nB = parseInt(countB.textContent,10) || 0;
      // Anlık (iyimser) güncelleme — yazı Firestore'a arka planda gidiyor, ekranda beklemiyorsun.
      if(clickedSlot==='A'){
        if(cardA.classList.contains('voted')){ nA--; cardA.classList.remove('voted'); }
        else { nA++; cardA.classList.add('voted'); if(cardB.classList.contains('voted')){ nB--; cardB.classList.remove('voted'); } }
      } else {
        if(cardB.classList.contains('voted')){ nB--; cardB.classList.remove('voted'); }
        else { nB++; cardB.classList.add('voted'); if(cardA.classList.contains('voted')){ nA--; cardA.classList.remove('voted'); } }
      }
      countA.textContent = `${nA} oy`;
      countB.textContent = `${nB} oy`;
      voteQuarterlyMatch(qp.round, card.dataset.qpVote, clickedSlot);
    });
  });
}
function qpWinnerBigCardHtml(cover, title, author){
  const coverInner = materialBookCover(title,cover);
  return `<div class="bh-grid-inner" style="max-width:140px; margin:0 auto 10px;">
    <div class="bh-card">
      <div class="bh-cover-wrap">${coverInner}</div>
      <div class="bh-title">${escapeHtml(title||'')}</div>
      <div class="bh-author">${escapeHtml(author||'')}</div>
    </div>
  </div>`;
}
function renderQpReadingSummary(body, qp){
  body.innerHTML = '<div id="materialCommonReading"></div>';
  renderQpBookInBugun('materialCommonReading');
}
async function renderQpBookInBugun(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  let qp = qpCache;
  if(!qp){ try{ const snap = await getDoc(qpDocRef()); if(snap.exists()) qp = snap.data(); }catch(e){} }
  if(!qp || qp.phase!=='reading'){
    el.innerHTML = window.BH_I18N.template`
      <h2>📚 Ortak Kitap</h2>
      <p class="muted" style="text-align:center; font-size:13px;">Seçim Aşamasında</p>
    `;
    return;
  }
  if(containerId==='aSelfQpBook' || containerId==='mMyQpBook'){
    const days = Math.max(0,Math.ceil((new Date(qp.readingEndsAt)-Date.now())/86400000));
    el.innerHTML = window.BH_I18N.template`<h2>Ortak kitabımız</h2><div class="daily-book">${materialBookCover(qp.winnerTitle,qp.winnerCover,'daily-book-jacket')}<div><span class="chip ok">${days} gün kaldı</span><h3>${escapeHtml(qp.winnerTitle||'')}</h3><p class="muted">${escapeHtml(qp.winnerAuthor||'')}</p><button class="primary" data-material-route="quarterly">Kitaba git →</button></div></div>`;
    return;
  }
  const finished = (qp.finishedBy||[]).includes(currentUid);
  const daysLeft = Math.max(0, Math.ceil((new Date(qp.readingEndsAt) - Date.now())/(24*60*60*1000)));
  const coverHtml = materialBookCover(qp.winnerTitle,qp.winnerCover);
  el.innerHTML = window.BH_I18N.template`
    <h2>📚 Ortak Kitap</h2>
    <div class="qp-bugun-row">
      <div class="qp-bugun-cover">${coverHtml}</div>
      <div class="qp-bugun-info">
        <div class="qp-nom-title">${escapeHtml(qp.winnerTitle||'')}</div>
        <div class="qp-nom-meta">${escapeHtml(qp.winnerAuthor||'')}</div>
        <div class="muted" style="font-size:11px; margin-top:2px;">${daysLeft} gün kaldı</div>
      </div>
      <button type="button" class="stamp-btn read${finished?' selected':''}" id="qpFinishTick_${containerId}" title="Bitirdim" aria-disabled="true">✓ Bitirdim</button>
    </div>
    <p class="muted">Bitirme formu henüz kullanıma açık değil.</p><div id="qpFinishFormWrap_${containerId}"></div>
    ${myProfile.role==='admin' ? qpDiscussionQEditorHtml(qp, containerId) : ''}
    <div id="qpDiscussionWrap_${containerId}"></div>
  `;
  if(myProfile.role==='admin') qpWireDiscussionQEditor(containerId);
  const tickBtn = document.getElementById(`qpFinishTick_${containerId}`);
  if(tickBtn && !finished){
    tickBtn.addEventListener('click', ()=> showToast(window.BH_I18N.pick("Bu özellik hazırlanıyor, şu an beklemeniz gerekmektedir.","This feature is being prepared. Please wait.")));
  }
  if(qp.discussionOpen){
    renderQpDiscussion(`qpDiscussionWrap_${containerId}`, qp);
  }
}
function qpDiscussionQEditorHtml(qp){
  return window.BH_I18N.template`
    <details style="margin-top:14px;">
      <summary class="muted" style="font-size:12px; cursor:pointer;">⚙ Tartışma Sorularını Düzenle (yönetici)</summary>
      <div style="margin-top:8px;">
        <div class="field"><label>Karakter Sorusu</label><input type="text" id="qpDiscQ1Input" value="${escapeHtml(qp.discussionQ1||'')}" placeholder="${escapeHtml(QP_DEFAULT_Q1)}" /></div>
        <div class="field"><label>Olay Sorusu</label><input type="text" id="qpDiscQ2Input" value="${escapeHtml(qp.discussionQ2||'')}" placeholder="${escapeHtml(QP_DEFAULT_Q2)}" /></div>
        <button type="button" class="secondary tiny" id="qpDiscQSaveBtn">Kaydet</button>
      </div>
    </details>
  `;
}
function qpWireDiscussionQEditor(containerId){
  const btn = document.getElementById('qpDiscQSaveBtn');
  if(!btn) return;
  btn.addEventListener('click', async ()=>{
    const q1 = document.getElementById('qpDiscQ1Input').value.trim();
    const q2 = document.getElementById('qpDiscQ2Input').value.trim();
    btn.disabled = true;
    try{
      await updateDoc(qpDocRef(), { discussionQ1: q1, discussionQ2: q2 });
      showToast('Sorular kaydedildi.');
    }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
    btn.disabled = false;
  });
}
function qpFinishFormHtml(q1, q2){
  return window.BH_I18N.template`
    <div class="qp-finish-form">
      <div class="qp-disc-q-title">Kitabı puanla</div>
      <div class="rating-star-row" id="qpFinishStars" data-selected="0">${[1,2,3,4,5,6,7,8,9,10].map(n=>window.BH_I18N.template`<button type="button" class="rating-star" data-n="${n}" aria-label="10 üzerinden ${n} puan">${n}</button>`).join('')}</div>
      <div class="qp-disc-q-title" style="margin-top:14px;">Genel ruh hali nasıldı?</div>
      <div class="qp-mood-row">${QP_MOODS.map(m=>`<button type="button" class="qp-mood-chip" data-mood="${m.key}" data-label="${m.icon} ${m.label}">${m.icon} ${m.label}</button>`).join('')}</div>
      <div class="field" style="margin-top:14px;"><label>${escapeHtml(q1)}</label><textarea id="qpFinishCharAnswer" class="qp-finish-textarea"></textarea></div>
      <div class="field"><label>${escapeHtml(q2)}</label><textarea id="qpFinishEventAnswer" class="qp-finish-textarea"></textarea></div>
      <div class="field"><label>Eklemek istediğin başka bir şey var mı? (opsiyonel)</label><textarea id="qpFinishExtraNote" class="qp-finish-textarea"></textarea></div>
      <button class="primary" id="qpFinishSubmitBtn" style="width:100%; margin-top:6px;">Gönder ve Bitir</button>
      <p class="muted" style="font-size:11px; margin-top:6px;">Form gönderilmeden bu kitap bitirilmiş sayılmaz.</p>
    </div>
  `;
}
function qpOpenFinishForm(containerId, qp){
  const wrap = document.getElementById(`qpFinishFormWrap_${containerId}`);
  if(!wrap) return;
  const q1 = qp.discussionQ1 || QP_DEFAULT_Q1;
  const q2 = qp.discussionQ2 || QP_DEFAULT_Q2;
  wrap.style.overflow = 'hidden';
  wrap.style.maxHeight = '0px';
  wrap.style.transition = 'max-height .35s ease';
  wrap.innerHTML = qpFinishFormHtml(q1, q2);
  requestAnimationFrame(()=>{ wrap.style.maxHeight = wrap.scrollHeight+'px'; });
  const starRow = document.getElementById('qpFinishStars');
  const stars = starRow.querySelectorAll('.rating-star');
  stars.forEach(s=> s.addEventListener('click', ()=>{
    const n = parseInt(s.dataset.n,10);
    starRow.dataset.selected = n;
    stars.forEach(x=> x.classList.toggle('filled', parseInt(x.dataset.n,10)<=n));
  }));
  wrap.querySelectorAll('.qp-mood-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      wrap.querySelectorAll('.qp-mood-chip').forEach(c=>c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });
  document.getElementById('qpFinishSubmitBtn').addEventListener('click', ()=> qpSubmitFinishAnswers(containerId, qp));
}
async function qpSubmitFinishAnswers(containerId, qp){
  const starRow = document.getElementById('qpFinishStars');
  const rating = parseInt(starRow.dataset.selected||'0',10);
  const moodBtn = document.querySelector('.qp-mood-chip.selected');
  const charAnswer = document.getElementById('qpFinishCharAnswer').value.trim();
  const eventAnswer = document.getElementById('qpFinishEventAnswer').value.trim();
  const extraNote = document.getElementById('qpFinishExtraNote').value.trim();
  if(!rating){ alert(window.BH_I18N.pick("Önce bir puan seç (yıldızlara dokun).","Choose a rating first (tap the stars).")); return; }
  if(!moodBtn){ alert(window.BH_I18N.pick("Genel ruh halini seç.","Select the overall mood.")); return; }
  if(!charAnswer){ alert('Karakter sorusunu cevapla.'); return; }
  if(!eventAnswer){ alert('Olay sorusunu cevapla.'); return; }
  const btn = document.getElementById('qpFinishSubmitBtn');
  btn.disabled = true;
  try{
    await setDoc(doc(db,'quarterlyPick','current','finishAnswers',currentUid), {
      uid: currentUid, name: myProfile.name, rating, mood: moodBtn.dataset.mood, moodLabel: moodBtn.dataset.label,
      charAnswer, eventAnswer, extraNote, submittedAt: new Date().toISOString()
    });
    await updateDoc(qpDocRef(), { finishedBy: arrayUnion(currentUid) });
    // Kitaplığım'daki grup puanlama sistemine de aynı puan/yorum işleniyor.
    const bookKey = bookKeyFor({title:qp.winnerTitle, author:qp.winnerAuthor});
    const groupSnap = await getDoc(doc(db,'groupBookRatings',bookKey));
    const existing = groupSnap.exists() ? groupSnap.data() : {};
    const newRatings = { ...(existing.ratings||{}), [currentUid]: { score: rating, comment: extraNote, createdAt: new Date().toISOString() } };
    await setDoc(doc(db,'groupBookRatings',bookKey), {
      title: qp.winnerTitle||existing.title||'', author: qp.winnerAuthor||existing.author||'', cover: qp.winnerCover||existing.cover||'',
      category: existing.category||'', workKey: existing.workKey||'', ratings: newRatings
    });
    createOrBatchPost('book_review', { bookTitle: qp.winnerTitle, bookAuthor: qp.winnerAuthor||'', bookCover: qp.winnerCover||'', rating, reviewText: extraNote });
    showToast(window.BH_I18N.pick("Harika, bitirdiğini işaretledik!","Great, the book is marked as finished!"));
    renderQuarterlyPickCard();
    renderQpBookInBugun(containerId);
  }catch(err){ alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err)); btn.disabled = false; }
}
async function renderQpDiscussion(wrapId, qp){
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  let answers = [];
  try{ const snap = await getDocs(qpFinishAnswersCol()); snap.forEach(d=> answers.push(d.data())); }catch(e){ return; }
  let messages = [];
  try{ const snap = await getDocs(query(qpDiscussionMessagesCol(), orderBy('createdAt','asc'))); snap.forEach(d=> messages.push(d.data())); }catch(e){ return; }
  const q1 = qp.discussionQ1 || QP_DEFAULT_Q1;
  const q2 = qp.discussionQ2 || QP_DEFAULT_Q2;
  const answerRow = (a, text)=> `<div class="qp-disc-answer">
    <div>${avatarHtmlFromProfile(usersCache[a.uid]||{name:a.name}, 30)}</div>
    <div class="qp-disc-answer-text"><b>${escapeHtml(a.name||'')}:</b> ${escapeHtml(text)}</div>
  </div>`;
  const qBlock = (question, field)=>{
    const items = answers.filter(a=>a[field]).map(a=>answerRow(a, a[field])).join('');
    return `<div class="qp-disc-q"><div class="qp-disc-q-title">${escapeHtml(question)}</div>${items || window.BH_I18N.pick("<p class=\"muted\" style=\"font-size:12px;\">Henüz cevap yok.</p>","<p class=\"muted\" style=\"font-size:12px;\">No replies yet.</p>")}</div>`;
  };
  const extraItems = answers.filter(a=>a.extraNote).map(a=>answerRow(a, a.extraNote)).join('');
  const chatHtml = messages.map(m=>`
    <div class="qp-chat-msg">
      <div>${avatarHtmlFromProfile(usersCache[m.uid]||{name:m.name}, 26)}</div>
      <div><b style="font-size:12.5px;">${escapeHtml(m.name||'')}</b><div style="font-size:13px;">${escapeHtml(m.text)}</div></div>
    </div>`).join('');
  wrap.innerHTML = window.BH_I18N.template`
    <div class="qp-disc-q-title" style="margin-top:18px; font-size:15px;">💬 Tartışma</div>
    ${qBlock(q1,'charAnswer')}
    ${qBlock(q2,'eventAnswer')}
    ${extraItems ? window.BH_I18N.template`<div class="qp-disc-q"><div class="qp-disc-q-title">Eklemek istedikleri</div>${extraItems}</div>` : ''}
    <div class="qp-disc-q-title" style="margin-top:16px;">Sohbet</div>
    <div id="qpChatMessages">${chatHtml || window.BH_I18N.pick("<p class=\"muted\" style=\"font-size:12px;\">Henüz mesaj yok, ilk mesajı sen yaz!</p>","<p class=\"muted\" style=\"font-size:12px;\">No messages yet. Start the conversation!</p>")}</div>
    <div class="qp-chat-input-row">
      <input type="text" id="qpChatInput" placeholder="Bir şey yaz…" />
      <button class="secondary tiny" id="qpChatSendBtn">Gönder</button>
    </div>
  `;
  document.getElementById('qpChatSendBtn').addEventListener('click', async ()=>{
    const input = document.getElementById('qpChatInput');
    const text = input.value.trim();
    if(!text) return;
    input.disabled = true;
    try{
      await addDoc(qpDiscussionMessagesCol(), { uid:currentUid, name:myProfile.name, text, createdAt:new Date().toISOString() });
      renderQpDiscussion(wrapId, qp);
    }catch(err){ alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err)); input.disabled = false; }
  });
}
async function submitQuarterlyNomination(bookTitle, bookAuthor, bookCover, note, replacesNomId){
  const nomsCol = qpNomsCol();
  const mySnap = await getDocs(query(nomsCol, where('uid','==',currentUid)));
  let myCount = 0;
  mySnap.forEach(d=>{ const s=d.data().status; if(s==='active'||s==='objected') myCount++; });
  await runTransaction(db, async (tx)=>{
    const qpSnap = await tx.get(qpDocRef());
    if(!qpSnap.exists()) throw new Error(window.BH_I18N.pick("Seçim süreci bulunamadı.","Selection process not found."));
    const qp = qpSnap.data();
    if(replacesNomId){
      if(qp.phase!=='objecting') throw new Error(window.BH_I18N.pick("İtiraz süresi bitmiş.","The objection period has ended."));
      const origRef = doc(db,'quarterlyPick','current','nominations',replacesNomId);
      const origSnap = await tx.get(origRef);
      if(!origSnap.exists()) throw new Error(window.BH_I18N.pick("Orijinal öneri bulunamadı.","Original nomination not found."));
      const orig = origSnap.data();
      if(orig.status!=='objected' || orig.replacementFilled) throw new Error(window.BH_I18N.pick("Bu boşluk artık uygun değil, başka biri doldurmuş olabilir.","This slot is no longer available. Someone else may have filled it."));
      const isOriginalNominator = orig.uid===currentUid;
      if(!isOriginalNominator && myCount>=QP_MAX_NOMINATIONS) throw new Error(window.BH_I18N.pick("3 öneri hakkını kullanmışsın.","You’ve used all 3 nominations."));
      tx.update(origRef, { replacementFilled:true });
      const newRef = doc(nomsCol);
      tx.set(newRef, { uid:currentUid, name:myProfile.name, bookTitle, bookAuthor:bookAuthor||'', bookCover:bookCover||'', note:note||'', createdAt:new Date().toISOString(), status:'active', isReplacementFor:replacesNomId });
    } else {
      if(qp.phase!=='nominating') throw new Error(window.BH_I18N.pick("Öneri süresi bitmiş.","The nomination period has ended."));
      if(myCount>=QP_MAX_NOMINATIONS) throw new Error(window.BH_I18N.pick("En fazla 3 kitap önerebilirsin.","You can nominate up to 3 books."));
      const newRef = doc(nomsCol);
      tx.set(newRef, { uid:currentUid, name:myProfile.name, bookTitle, bookAuthor:bookAuthor||'', bookCover:bookCover||'', note:note||'', createdAt:new Date().toISOString(), status:'active' });
    }
  });
  createPost('quarterly_pick', { subtype:'nomination_made', bookTitle, bookAuthor: bookAuthor||'', bookCover: bookCover||'' }, currentUid, myProfile.name);
}
async function objectToQuarterlyNomination(nomId, bookTitle){
  if(!confirm(`"${bookTitle}" kitabını yakın zamanda okuduğunu belirtip öneriden düşürmek istediğine emin misin?`)) return;
  const nomRef = doc(db,'quarterlyPick','current','nominations',nomId);
  let nominatorUid = null;
  try{
    await runTransaction(db, async (tx)=>{
      const snap = await tx.get(nomRef);
      if(!snap.exists()) throw new Error(window.BH_I18N.pick("Öneri bulunamadı.","Recommendation not found."));
      const data = snap.data();
      if(data.status!=='active') throw new Error(window.BH_I18N.pick("Bu öneri zaten itiraz edilmiş.","This nomination already has an objection."));
      nominatorUid = data.uid;
      tx.update(nomRef, { status:'objected', objectedBy:currentUid, objectedByName:myProfile.name, objectedAt:new Date().toISOString() });
    });
    createPost('quarterly_pick', { subtype:'objection_made', bookTitle }, currentUid, myProfile.name);
    showToast(window.BH_I18N.pick("İtiraz kaydedildi.","Objection saved."));
    notifyQpObjectionEligible(nominatorUid, bookTitle);
    renderQuarterlyPickCard();
  }catch(err){ alert(window.BH_I18N.pick("İtiraz edilemedi: ","Could not submit objection: ")+(err.message||err)); }
}
// İtiraz edilen kitabı öneren kişiye (hakkı dolu olsa bile — kendi boşluğunu her zaman
// doldurabilir) VE hâlâ öneri hakkı dolmamış herkese "yerine önerebilirsin" bildirimi gider.
async function notifyQpObjectionEligible(nominatorUid, bookTitle){
  try{
    const snap = await getDocs(qpNomsCol());
    const counts = {};
    snap.forEach(d=>{
      const n = d.data();
      if(n.status==='active' || n.status==='objected'){
        counts[n.uid] = (counts[n.uid]||0) + 1;
      }
    });
    const toNotify = new Set();
    if(nominatorUid) toNotify.add(nominatorUid);
    activeUids().forEach(uid=>{
      if((counts[uid]||0) < QP_MAX_NOMINATIONS) toNotify.add(uid);
    });
    toNotify.forEach(uid=>{
      notifyUser(uid, `"${bookTitle}" kitabına itiraz edildi, öneriden düştü. Yerine yeni bir öneri yapabilirsin!`, 'recs');
    });
  }catch(e){ /* bildirim gönderilemezse sessizce geç */ }
}
async function voteQuarterlyMatch(round, matchId, slot){
  const matchRef = doc(db,'quarterlyPick','current','rounds',String(round),'matches',matchId);
  try{
    await runTransaction(db, async (tx)=>{
      const snap = await tx.get(matchRef);
      if(!snap.exists()) return;
      const m = snap.data();
      const votesA = (m.votesA||[]).filter(u=>u!==currentUid);
      const votesB = (m.votesB||[]).filter(u=>u!==currentUid);
      const alreadyThisSlot = slot==='A' ? (m.votesA||[]).includes(currentUid) : (m.votesB||[]).includes(currentUid);
      if(!alreadyThisSlot){
        if(slot==='A') votesA.push(currentUid); else votesB.push(currentUid);
      }
      tx.update(matchRef, { votesA, votesB });
    });
    qpCheckRoundFullyVoted(round); // arka planda, beklemeden — turun tamamı oylandıysa erken bitiş damgası basılır
  }catch(err){ alert('Oy verilemedi: '+(err.message||err)); renderQuarterlyPickCard(); }
}
// Bir oydan sonra, o turdaki TÜM eşleşmelerde AKTİF her üyenin oy kullanıp kullanmadığını
// kontrol eder. Herkes oy kullandıysa "fullyVotedAt" damgası basılır — sunucu tarafı bunu görüp
// 1 gün dolmadan, son oydan 5 dakika sonra turu erken kapatır (kimse oyunu geri çekmezse). Biri
// oyunu geri çekip tam katılımı bozarsa damga temizlenir (erken bitiş iptal olur).
async function qpCheckRoundFullyVoted(round){
  try{
    const qpSnap = await getDoc(qpDocRef());
    if(!qpSnap.exists()) return;
    const qp = qpSnap.data();
    if(qp.phase!=='voting' || qp.round!==round) return; // bu arada tur değişmiş olabilir, boşuna yazma
    const matchesSnap = await getDocs(qpMatchesCol(round));
    const matches = []; matchesSnap.forEach(d=> matches.push(d.data()));
    const activeUidList = activeUids();
    const fullyVoted = matches.length>0 && activeUidList.length>0 && matches.every(m=>{
      const voted = new Set([...(m.votesA||[]), ...(m.votesB||[])]);
      return activeUidList.every(uid=> voted.has(uid));
    });
    if(fullyVoted && !qp.fullyVotedAt){
      await updateDoc(qpDocRef(), { fullyVotedAt: new Date().toISOString() });
    } else if(!fullyVoted && qp.fullyVotedAt){
      await updateDoc(qpDocRef(), { fullyVotedAt: null });
    }
  }catch(e){ /* arka plan kontrolü, sessizce geç */ }
}

/* ============ YÖNETİCİYE ÖZEL DENEME: ORTAK KİTAP SEÇİMİ ============
   Gerçek sistemle AYNI mantık (öneri→itiraz→turnuva→okuma), ama tamamen ayrı bir Firestore
   yolunda (quarterlyPickTest), sınırsız öneri hakkıyla, süre sınırı olmadan ve faz geçişleri
   burada bir tuşla elle tetikleniyor. Hiçbir bildirim/akış gönderisi oluşturmuyor, üyelere hiç
   görünmüyor — sadece yöneticinin kendi deneme alanı. */
function qpTestDocRef(){ return doc(db,'quarterlyPickTest','current'); }
function qpTestNomsCol(){ return collection(db,'quarterlyPickTest','current','nominations'); }
function qpTestMatchesCol(round){ return collection(db,'quarterlyPickTest','current','rounds',String(round),'matches'); }
function qpTestBracketSizeFor(n){
  if(n<2) return n;
  let size=2;
  while(size*2<=n) size*=2;
  return size;
}
async function renderQpTestTab(){
  await renderQpTestCard();
  const resetBtn = document.getElementById('qpTestResetBtn');
  if(resetBtn && !resetBtn.dataset.bound){
    resetBtn.dataset.bound = '1';
    resetBtn.addEventListener('click', qpTestReset);
  }
}
async function renderQpTestCard(){
  const body = document.getElementById('qpTestBody');
  if(!body) return;
  let qp = null, qpFetchFailed = false;
  try{ const snap = await getDoc(qpTestDocRef()); qp = snap.exists() ? snap.data() : null; }catch(e){ qpFetchFailed = true; }
  if(qpFetchFailed) return;
  if(!qp){
    body.innerHTML = window.BH_I18N.template`<p class="muted">Henüz başlatılmadı.</p><button class="primary" id="qpTestStartBtn" style="margin-top:8px;">Denemeyi Başlat</button>`;
    document.getElementById('qpTestStartBtn').addEventListener('click', async ()=>{
      await setDoc(qpTestDocRef(), { phase:'nominating', cycleNumber:1, phaseStartedAt:new Date().toISOString() });
      renderQpTestCard();
    });
    return;
  }
  if(qp.phase==='nominating') return renderQpTestNominating(body, qp);
  if(qp.phase==='objecting') return renderQpTestObjecting(body, qp);
  if(qp.phase==='voting') return renderQpTestVoting(body, qp);
  if(qp.phase==='reading') return renderQpTestReading(body, qp);
}
function qpTestAdvanceBtnHtml(label){
  return `<button type="button" class="primary tiny" id="qpTestAdvanceBtn" style="margin-top:12px;">${label}</button>`;
}
function qpTestWireAdvanceBtn(){
  const btn = document.getElementById('qpTestAdvanceBtn');
  if(btn) btn.addEventListener('click', qpTestAdvancePhase);
}
async function renderQpTestNominating(body, qp){
  let noms = [];
  try{ const snap = await getDocs(qpTestNomsCol()); snap.forEach(d=> noms.push({id:d.id, ...d.data()})); }catch(e){ return; }
  noms.sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
  const rows = noms.map(n=>{
    const extra = n.uid===currentUid ? window.BH_I18N.template`<div class="row" style="flex:0 0 auto; width:auto; gap:6px;">
      <button type="button" class="secondary tiny" data-qp-test-edit="${n.id}">Düzenle</button>
      <button type="button" class="secondary tiny" data-qp-test-delete="${n.id}" style="border-color:var(--cloth-dark); color:var(--cloth-dark);">Sil</button>
    </div>` : '';
    return qpNomRowHtml(n, extra);
  }).join('');
  body.innerHTML = window.BH_I18N.template`
    <div class="qp-phase-label">Öneri Toplama (deneme — sınırsız hak)</div>
    <div class="qp-nom-list">${rows || window.BH_I18N.pick("<p class=\"muted\">Henüz öneri yok.</p>","<p class=\"muted\">No recommendations yet.</p>")}</div>
    <button type="button" class="secondary tiny" id="qpTestNomAddBtn">+ Kitap Öner</button>
    <div id="qpTestNomFormWrap" style="display:none; margin-top:12px;">${qpNominationFormHtml('qpTestNom',window.BH_I18N.pick("Öner","Recommend"))}</div>
    ${qpTestAdvanceBtnHtml(window.BH_I18N.pick("İtiraz Fazına Geç →","Start objection phase →"))}
  `;
  qpWireNomRowClicks(body);
  qpTestWireAdvanceBtn();
  body.querySelectorAll('[data-qp-test-delete]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!confirm(window.BH_I18N.pick("Bu öneriyi silmek istediğine emin misin?","Are you sure you want to delete this recommendation?"))) return;
      await deleteDoc(doc(db,'quarterlyPickTest','current','nominations',btn.dataset.qpTestDelete));
      renderQpTestCard();
    });
  });
  body.querySelectorAll('[data-qp-test-edit]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const nomId = btn.dataset.qpTestEdit;
      const nom = qpNomCache[nomId];
      const row = btn.closest('.qp-nom-row');
      qpExpandRowToForm(row, qpNominationFormHtml('qpTestEdit_'+nomId, window.BH_I18N.pick("Güncelle","Update")));
      document.getElementById('qpTestEdit_'+nomId+'Book').value = nom.bookTitle||'';
      document.getElementById('qpTestEdit_'+nomId+'Author').value = nom.bookAuthor||'';
      document.getElementById('qpTestEdit_'+nomId+'Cover').value = nom.bookCover||'';
      document.getElementById('qpTestEdit_'+nomId+'Note').value = nom.note||'';
      qpWireNominationForm('qpTestEdit_'+nomId, async ({title,author,cover,note})=>{
        await updateDoc(doc(db,'quarterlyPickTest','current','nominations',nomId), { bookTitle:title, bookAuthor:author, bookCover:cover, note });
        renderQpTestCard();
      });
    });
  });
  document.getElementById('qpTestNomAddBtn').addEventListener('click', ()=>{
    const wrap = document.getElementById('qpTestNomFormWrap');
    wrap.style.display = wrap.style.display==='none' ? 'block' : 'none';
  });
  qpWireNominationForm('qpTestNom', async ({title,author,cover,note})=>{
    await addDoc(qpTestNomsCol(), { uid:currentUid, name:myProfile.name, bookTitle:title, bookAuthor:author, bookCover:cover, note:note||'', createdAt:new Date().toISOString(), status:'active' });
    renderQpTestCard();
  });
}
async function renderQpTestObjecting(body, qp){
  let noms = [];
  try{ const snap = await getDocs(qpTestNomsCol()); snap.forEach(d=> noms.push({id:d.id, ...d.data()})); }catch(e){ return; }
  noms.sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
  const rows = noms.map(n=>{
    if(n.status==='objected'){
      if(n.replacementFilled) return '';
      return window.BH_I18N.template`<div class="qp-nom-row ghost" data-open-slot="${n.id}">
        <button type="button" class="qp-slot-fill-btn" data-fill-slot="${n.id}">+</button><span class="muted" style="font-size:12px;">boş yer — bir kitap öner</span>
      </div>`;
    }
    return qpNomRowHtml(n, window.BH_I18N.template`<button type="button" class="secondary tiny" data-qp-object="${n.id}">Bunu Okudum</button>`);
  }).join('');
  body.innerHTML = window.BH_I18N.template`
    <div class="qp-phase-label">İtiraz Süresi (deneme — süre yok)</div>
    <div class="qp-nom-list">${rows}</div>
    ${qpTestAdvanceBtnHtml(window.BH_I18N.pick("Turnuvayı Başlat →","Start tournament →"))}
  `;
  qpWireNomRowClicks(body);
  qpTestWireAdvanceBtn();
  body.querySelectorAll('[data-qp-object]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      await updateDoc(doc(db,'quarterlyPickTest','current','nominations',btn.dataset.qpObject), { status:'objected', objectedBy:currentUid, objectedByName:myProfile.name, objectedAt:new Date().toISOString() });
      renderQpTestCard();
    });
  });
  body.querySelectorAll('[data-fill-slot]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const slotId = btn.dataset.fillSlot;
      const row = btn.closest('.qp-nom-row');
      row.classList.remove('ghost');
      row.style.display = 'block';
      qpExpandRowToForm(row, qpNominationFormHtml('qpTestFill_'+slotId, window.BH_I18N.pick("Öner","Recommend")));
      qpWireNominationForm('qpTestFill_'+slotId, async ({title,author,cover,note})=>{
        await updateDoc(doc(db,'quarterlyPickTest','current','nominations',slotId), { replacementFilled:true });
        await addDoc(qpTestNomsCol(), { uid:currentUid, name:myProfile.name, bookTitle:title, bookAuthor:author, bookCover:cover, note:note||'', createdAt:new Date().toISOString(), status:'active', isReplacementFor:slotId });
        renderQpTestCard();
      });
    });
  });
}
async function renderQpTestVoting(body, qp){
  let matches = [];
  try{ const snap = await getDocs(qpTestMatchesCol(qp.round)); snap.forEach(d=> matches.push({id:d.id, ...d.data()})); }catch(e){ return; }
  matches.sort((a,b)=> a.id.localeCompare(b.id));
  const roundLabel = qp.round===qp.totalRounds ? 'Final' : (qp.round===qp.totalRounds-1 ? window.BH_I18N.pick("Yarı Final","Semifinal") : `${qp.round}. Tur`);
  const cardHtml = (matchId, slot, book, votes, voted)=> `
    <div class="qp-vs-card${voted?' voted':''}" data-qp-vote="${matchId}" data-qp-slot="${slot}">
      ${materialBookCover(book.bookTitle,book.bookCover,'qp-vs-cover')}
      <div class="qp-vs-title">${escapeHtml(book.bookTitle)}</div>
      <div class="qp-vs-author">${escapeHtml(book.bookAuthor||'')}</div>
      <div class="qp-vs-votes" data-vote-count>${votes} oy</div>
    </div>`;
  const rows = matches.map(m=>`<div class="qp-match-wrap" data-qp-match="${m.id}"><div class="qp-vs-row">
    ${cardHtml(m.id,'A',m.slotA,(m.votesA||[]).length,(m.votesA||[]).includes(currentUid))}
    <div class="qp-vs-mid">VS</div>
    ${cardHtml(m.id,'B',m.slotB,(m.votesB||[]).length,(m.votesB||[]).includes(currentUid))}
  </div></div>`).join('');
  body.innerHTML = `
    <div class="qp-phase-label">${roundLabel} — Oylama (deneme)</div>
    ${rows}
    ${qpTestAdvanceBtnHtml(qp.round>=qp.totalRounds ? window.BH_I18N.pick("Sonucu Kesinleştir →","Confirm result →") : window.BH_I18N.pick("Sonraki Tura Geç →","Next round →"))}
  `;
  qpTestWireAdvanceBtn();
  body.querySelectorAll('[data-qp-vote]').forEach(card=>{
    card.addEventListener('click', ()=>{
      const matchWrap = card.closest('[data-qp-match]');
      const cardA = matchWrap.querySelector('[data-qp-slot="A"]');
      const cardB = matchWrap.querySelector('[data-qp-slot="B"]');
      const clickedSlot = card.dataset.qpSlot;
      const countA = cardA.querySelector('[data-vote-count]');
      const countB = cardB.querySelector('[data-vote-count]');
      let nA = parseInt(countA.textContent,10) || 0;
      let nB = parseInt(countB.textContent,10) || 0;
      if(clickedSlot==='A'){
        if(cardA.classList.contains('voted')){ nA--; cardA.classList.remove('voted'); }
        else { nA++; cardA.classList.add('voted'); if(cardB.classList.contains('voted')){ nB--; cardB.classList.remove('voted'); } }
      } else {
        if(cardB.classList.contains('voted')){ nB--; cardB.classList.remove('voted'); }
        else { nB++; cardB.classList.add('voted'); if(cardA.classList.contains('voted')){ nA--; cardA.classList.remove('voted'); } }
      }
      countA.textContent = `${nA} oy`;
      countB.textContent = `${nB} oy`;
      (async ()=>{
        try{
          const matchRef = doc(db,'quarterlyPickTest','current','rounds',String(qp.round),'matches',card.dataset.qpVote);
          await runTransaction(db, async (tx)=>{
            const snap = await tx.get(matchRef);
            if(!snap.exists()) return;
            const m = snap.data();
            const votesA = (m.votesA||[]).filter(u=>u!==currentUid);
            const votesB = (m.votesB||[]).filter(u=>u!==currentUid);
            const already = clickedSlot==='A' ? (m.votesA||[]).includes(currentUid) : (m.votesB||[]).includes(currentUid);
            if(!already){ if(clickedSlot==='A') votesA.push(currentUid); else votesB.push(currentUid); }
            tx.update(matchRef, { votesA, votesB });
          });
        }catch(err){ alert('Oy verilemedi: '+(err.message||err)); renderQpTestCard(); }
      })();
    });
  });
}
function renderQpTestReading(body, qp){
  body.innerHTML = window.BH_I18N.template`
    <div class="qp-phase-label">Okuma Dönemi (deneme sonucu)</div>
    ${qpWinnerBigCardHtml(qp.winnerCover, qp.winnerTitle, qp.winnerAuthor)}
    <p class="muted" style="text-align:center; font-size:12px;">öneren: ${escapeHtml(qp.winnerNominatedByName||'')}</p>
    <button type="button" class="secondary tiny" id="qpTestAdvanceBtn" style="margin-top:12px;">Denemeyi Baştan Başlat →</button>
  `;
  qpTestWireAdvanceBtn();
}
async function qpTestAdvancePhase(){
  const snap = await getDoc(qpTestDocRef());
  if(!snap.exists()) return;
  const qp = snap.data();
  if(qp.phase==='nominating'){
    await updateDoc(qpTestDocRef(), { phase:'objecting', phaseStartedAt:new Date().toISOString() });
  } else if(qp.phase==='objecting'){
    const nomSnap = await getDocs(query(qpTestNomsCol(), where('status','==','active')));
    const activeNoms = []; nomSnap.forEach(d=> activeNoms.push({id:d.id, ...d.data()}));
    const bracketSize = qpTestBracketSizeFor(activeNoms.length);
    if(bracketSize<2){
      if(activeNoms.length===1){
        const only = activeNoms[0];
        await updateDoc(qpTestDocRef(), { phase:'reading', winnerTitle:only.bookTitle, winnerAuthor:only.bookAuthor||'', winnerCover:only.bookCover||'', winnerNominatedByName:only.name||'' });
      } else {
        alert(window.BH_I18N.pick("Turnuva başlatmak için en az 2 aktif öneri gerekli.","At least 2 active nominations are needed to start a tournament."));
        return;
      }
    } else {
      const chosen = shuffle(activeNoms).slice(0, bracketSize);
      const bracketOrder = shuffle(chosen);
      const totalRounds = Math.log2(bracketSize);
      const ops = [];
      for(let i=0;i<bracketOrder.length;i+=2){
        const a=bracketOrder[i], b=bracketOrder[i+1];
        ops.push(setDoc(doc(qpTestMatchesCol(1), `m${i/2}`), {
          slotA:{uid:a.uid,name:a.name,bookTitle:a.bookTitle,bookAuthor:a.bookAuthor||'',bookCover:a.bookCover||''},
          slotB:{uid:b.uid,name:b.name,bookTitle:b.bookTitle,bookAuthor:b.bookAuthor||'',bookCover:b.bookCover||''},
          votesA:[], votesB:[], winnerSlot:null,
        }));
      }
      await Promise.all(ops);
      await updateDoc(qpTestDocRef(), { phase:'voting', round:1, totalRounds, bracketSize });
    }
  } else if(qp.phase==='voting'){
    const matchesSnap = await getDocs(qpTestMatchesCol(qp.round));
    const results = [];
    matchesSnap.forEach(d=>{
      const m = d.data();
      const aV=(m.votesA||[]).length, bV=(m.votesB||[]).length;
      let winner;
      if(aV>bV) winner=m.slotA; else if(bV>aV) winner=m.slotB; else winner=Math.random()<0.5?m.slotA:m.slotB;
      results.push(winner);
    });
    if(qp.round>=qp.totalRounds){
      const winner = results[0];
      await updateDoc(qpTestDocRef(), { phase:'reading', winnerTitle:winner.bookTitle, winnerAuthor:winner.bookAuthor||'', winnerCover:winner.bookCover||'', winnerNominatedByName:winner.name||'' });
    } else {
      const nextRound = qp.round+1;
      const ops = [];
      for(let i=0;i<results.length;i+=2){
        ops.push(setDoc(doc(qpTestMatchesCol(nextRound), `m${i/2}`), { slotA:results[i], slotB:results[i+1], votesA:[], votesB:[], winnerSlot:null }));
      }
      await Promise.all(ops);
      await updateDoc(qpTestDocRef(), { round:nextRound });
    }
  } else if(qp.phase==='reading'){
    await qpTestReset();
    return;
  }
  renderQpTestCard();
}
async function qpTestReset(){
  if(!confirm(window.BH_I18N.pick("Deneme sıfırlansın mı? Tüm deneme önerileri/turları silinecek.","Reset the test? All test nominations and rounds will be deleted."))) return;
  const nomSnap = await getDocs(qpTestNomsCol());
  await Promise.all(nomSnap.docs.map(d=> deleteDoc(d.ref)));
  const roundNums = ['1','2','3','4','5','6'];
  for(const rn of roundNums){
    const mSnap = await getDocs(qpTestMatchesCol(rn));
    await Promise.all(mSnap.docs.map(d=> deleteDoc(d.ref)));
  }
  await setDoc(qpTestDocRef(), { phase:'nominating', cycleNumber:1, phaseStartedAt:new Date().toISOString() });
  showToast(window.BH_I18N.pick("Deneme sıfırlandı.","Test reset."));
  renderQpTestCard();
}

function setupAddToggle(btnId, wrapId){
  const btn = document.getElementById(btnId);
  const wrap = document.getElementById(wrapId);
  btn.addEventListener('click', ()=>{
    const isOpen = wrap.style.display !== 'none';
    if(isOpen){
      wrap.style.display = 'none';
    } else {
      wrap.style.display = 'block';
      wrap.classList.remove('slide-down-anim');
      void wrap.offsetWidth;
      wrap.classList.add('slide-down-anim');
    }
    btn.classList.toggle('open', !isOpen);
  });
}
setupAddToggle('recPersonalAddBtn', 'recPersonalFormWrap');
setupAddToggle('recGroupAddBtn', 'recGroupFormWrap');
function closeAddForm(btnId, wrapId){
  document.getElementById(wrapId).style.display = 'none';
  document.getElementById(btnId).classList.remove('open');
}

document.getElementById('recPersonalSendBtn').addEventListener('click', async ()=>{
  const toUid = document.getElementById('recPersonalTarget').value;
  const bookTitle = document.getElementById('recPersonalBook').value.trim();
  const note = document.getElementById('recPersonalNote').value.trim();
  const coverUrl = document.getElementById('recPersonalCover').value.trim();
  if(!toUid){ alert(window.BH_I18N.pick("Bir kişi seç.","Select a person.")); return; }
  if(!bookTitle){ alert(window.BH_I18N.pick("Kitap adı yaz.","Enter a book title.")); return; }
  try{
    await addDoc(collection(db,'recommendations'), {
      scope:'personal', fromUid: currentUid, fromName: myProfile.name,
      toUid, toName: usersCache[toUid]?.name||'', bookTitle, note, coverUrl, createdAt: new Date().toISOString()
    });
    document.getElementById('recPersonalBook').value='';
    document.getElementById('recPersonalNote').value='';
    document.getElementById('recPersonalCover').value='';
    hubPreviews.invalidate('library');
    await notifyUser(toUid, `${myProfile.name} sana bir kitap önerdi: "${bookTitle}"`, 'recs');
    createPost('rec_personal', { toName: usersCache[toUid]?.name||'' });
    showToast(window.BH_I18N.pick("Öneri gönderildi.","Recommendation sent."));
    closeAddForm('recPersonalAddBtn','recPersonalFormWrap');
    renderPersonalRecs();
  }catch(err){ alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err)); }
});

document.getElementById('recGroupSendBtn').addEventListener('click', async ()=>{
  const bookTitle = document.getElementById('recGroupBook').value.trim();
  const note = document.getElementById('recGroupNote').value.trim();
  const coverUrl = document.getElementById('recGroupCover').value.trim();
  if(!bookTitle){ alert(window.BH_I18N.pick("Kitap adı yaz.","Enter a book title.")); return; }
  try{
    await addDoc(collection(db,'recommendations'), {
      scope:'group', fromUid: currentUid, fromName: myProfile.name,
      bookTitle, note, coverUrl, createdAt: new Date().toISOString()
    });
    document.getElementById('recGroupBook').value='';
    document.getElementById('recGroupNote').value='';
    document.getElementById('recGroupCover').value='';
    hubPreviews.invalidate('library');
    createPost('rec_group', { bookTitle, bookCover: coverUrl });
    showToast(window.BH_I18N.pick("Grup önerisi gönderildi.","Recommendation sent to the club."));
    closeAddForm('recGroupAddBtn','recGroupFormWrap');
    renderGroupRecs();
  }catch(err){ alert(window.BH_I18N.pick("Gönderilemedi: ","Could not send: ")+(err.message||err)); }
});

/* ============ ORTAK: KİTAP ARAMA (Google Books API üzerinden otomatik tamamlama) ============ */
export async function searchGoogleBooks(q){
  const keyParam = GOOGLE_BOOKS_API_KEY ? `&key=${GOOGLE_BOOKS_API_KEY}` : '';
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8${keyParam}`);
  if(!res.ok) throw new Error('HTTP '+res.status);
  const json = await res.json();
  return (json.items||[]).filter(it=>it.volumeInfo && it.volumeInfo.title).map(it=>{
    const vi = it.volumeInfo;
    const isbn = (vi.industryIdentifiers||[]).find(x=>x.type==='ISBN_13') || (vi.industryIdentifiers||[])[0];
    return {
      title: vi.title,
      author: (vi.authors||[]).join(', ') || 'Bilinmeyen Yazar',
      year: vi.publishedDate ? vi.publishedDate.slice(0,4) : '',
      pageCount: vi.pageCount || '',
      description: vi.description || '',
      publisher: vi.publisher || '',
      categories: (vi.categories||[]).join(', '),
      rating: vi.averageRating || '',
      ratingsCount: vi.ratingsCount || '',
      isbn: isbn ? isbn.identifier : '',
      language: vi.language || '',
      link: vi.infoLink || (it.id ? `https://books.google.com/books?id=${it.id}` : ''),
      cover: vi.imageLinks ? (vi.imageLinks.thumbnail||vi.imageLinks.smallThumbnail||'').replace('http://','https://') : ''
    };
  });
}
export async function searchOpenLibrary(q){
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8`);
  if(!res.ok) throw new Error('HTTP '+res.status);
  const json = await res.json();
  return (json.docs||[]).filter(d=>d.title).map(d=>({
    title: d.title,
    author: (d.author_name||[]).join(', ') || 'Bilinmeyen Yazar',
    year: d.first_publish_year || '',
    pageCount: d.number_of_pages_median || '',
    description: '',
    publisher: (d.publisher||[])[0] || '',
    categories: (d.subject||[]).slice(0,4).join(', '),
    rating: d.ratings_average ? Math.round(d.ratings_average*10)/10 : '',
    ratingsCount: d.ratings_count || '',
    isbn: (d.isbn||[])[0] || '',
    language: (d.language||[])[0] || '',
    workKey: d.key || '',
    link: d.key ? `https://openlibrary.org${d.key}` : '',
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : ''
  }));
}
// search.json sonucu sadece temel bilgi veriyor; sayfa sayısı/dil/puan gibi detaylar kitabın
// kendi "work" sayfasına ait ayrı uç noktalarda duruyor — bu fonksiyon onları ek olarak çekip birleştirir.
async function enrichFromOpenLibraryWork(info){
  if(!info.workKey) return info;
  try{
    const [workRes, ratingsRes, editionsRes] = await Promise.all([
      fetch(`https://openlibrary.org${info.workKey}.json`).catch(()=>null),
      fetch(`https://openlibrary.org${info.workKey}/ratings.json`).catch(()=>null),
      fetch(`https://openlibrary.org${info.workKey}/editions.json?limit=5`).catch(()=>null)
    ]);
    if(workRes && workRes.ok){
      const w = await workRes.json();
      if(!info.description && w.description){ info.description = typeof w.description==='string' ? w.description : (w.description.value||''); }
      if(!info.categories && w.subjects){ info.categories = w.subjects.slice(0,4).join(', '); }
    }
    if(ratingsRes && ratingsRes.ok){
      const r = await ratingsRes.json();
      if(!info.rating && r.summary && r.summary.average){ info.rating = Math.round(r.summary.average*10)/10; info.ratingsCount = r.summary.count||''; }
    }
    if(editionsRes && editionsRes.ok){
      const e = await editionsRes.json();
      const eds = e.entries || [];
      if(!info.pageCount){ const withPages = eds.find(ed=>ed.number_of_pages); if(withPages) info.pageCount = withPages.number_of_pages; }
      if(!info.language){ const withLang = eds.find(ed=>ed.languages && ed.languages[0]); if(withLang) info.language = (withLang.languages[0].key||'').replace('/languages/',''); }
      if(!info.publisher){ const withPub = eds.find(ed=>ed.publishers && ed.publishers[0]); if(withPub) info.publisher = withPub.publishers[0]; }
      if(!info.isbn){ const withIsbn = eds.find(ed=>ed.isbn_13 && ed.isbn_13[0]); if(withIsbn) info.isbn = withIsbn.isbn_13[0]; }
    }
  }catch(e){}
  return info;
}
function attachBookAutocomplete(inputId, coverInputId, suggestBoxId, onSelect){
  const input = document.getElementById(inputId);
  const box = document.getElementById(suggestBoxId);
  const coverInput = coverInputId ? document.getElementById(coverInputId) : null;
  attachBookAutocompleteEl(input, coverInput, box, onSelect);
}
function attachBookAutocompleteEl(input, coverInput, box, onSelect){
  if(!input || !box) return;
  if(input.dataset.bookAutocompleteAttached) return; // aynı elemana iki kez bağlanmasın
  input.dataset.bookAutocompleteAttached = '1';
  let debounceTimer = null;
  let queryToken = 0;

  function hideBox(){ box.style.display='none'; box.innerHTML=''; }

  input.addEventListener('input', ()=>{
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if(q.length < 2){ hideBox(); return; }
    debounceTimer = setTimeout(()=> doSearch(q), 400);
  });
  input.addEventListener('focus', ()=>{ if(box.innerHTML.trim()) box.style.display='block'; });

  async function doSearch(q){
    const myToken = ++queryToken;
    box.style.display='block';
    box.innerHTML = window.BH_I18N.template`<div class="book-suggest-item" style="cursor:default;"><span class="muted" style="font-size:12.5px;">Aranıyor…</span></div>`;
    let items = [];
    let lastError = null;
    try{
      items = await searchOpenLibrary(q);
      if(!items.length) throw new Error(window.BH_I18N.pick("sonuç yok","no results"));
    }catch(e){
      lastError = e;
      try{
        items = await searchGoogleBooks(q);
        lastError = null;
      }catch(e2){ lastError = e2; }
    }
    if(myToken !== queryToken) return; // bu arada yeni bir arama başlamış, eski sonucu gösterme
    if(lastError){
      box.innerHTML = `<div class="book-suggest-item" style="cursor:default;"><span class="muted" style="font-size:12px;">Arama başarısız: ${escapeHtml(lastError.message||String(lastError))}</span></div>`;
      return;
    }
    if(!items.length){
      box.innerHTML = window.BH_I18N.template`<div class="book-suggest-item" style="cursor:default;"><span class="muted" style="font-size:12.5px;">Sonuç bulunamadı.</span></div>`;
      return;
    }
    box.innerHTML = items.map((b,i)=>{
      const title = escapeHtml(b.title);
      const author = escapeHtml(b.author);
      const thumbHtml = b.cover
        ? `<img class="book-suggest-thumb" src="${b.cover}" alt="" onerror="this.style.display='none';" />`
        : `<div class="book-suggest-thumb" style="background:var(--line);"></div>`;
      return `<div class="book-suggest-item" data-idx="${i}">${thumbHtml}<div><div style="font-weight:600; font-size:13px;">${title}</div><div class="muted" style="font-size:11px;">${author}</div></div></div>`;
    }).join('');
    box.style.display='block';
    box.querySelectorAll('.book-suggest-item').forEach(el=>{
      el.addEventListener('click', ()=>{
        const b = items[parseInt(el.dataset.idx,10)];
        if(typeof onSelect === 'function'){
          onSelect({ author: b.author, title: b.title, cover: b.cover, workKey: b.workKey||'' });
        } else {
          input.value = `${b.author} - ${b.title}`;
          if(coverInput) coverInput.value = b.cover;
        }
        hideBox();
      });
    });
  }

  document.addEventListener('click', (e)=>{
    if(e.target!==input && !box.contains(e.target)) hideBox();
  });
}
attachBookAutocomplete('recPersonalBook', 'recPersonalCover', 'recPersonalBookSuggest');
attachBookAutocomplete('recGroupBook', 'recGroupCover', 'recGroupBookSuggest');

/* ============ ORTAK: KİTAP GEÇMİŞİM (kişisel kitaplık) ============ */
function renderBookHistoryTab(){
  renderDiscoverTab();
  setupDiscoverNavObserver();
}
// Kitaplık sekmesinin en üstündeki büyük "Senin İçin Seçtik" kartı — okuma geçmişine göre
// birkaç kişisel öneri hazırlaması için sunucudaki (functions/index.js) getBookRecommendation
// Cloud Function'ını çağırıyor. Sonuç profildeki aiRecommendations alanına yazıldığı için
// her sekme açılışında yeniden çağırmıyoruz, sadece hiç öneri yoksa otomatik bir kere
// hesaplıyoruz; sonrasında kullanıcı "yeni öneri iste" ile manuel tetikliyor. Kapak resimleri
// Claude'un cevabında yok (uydurma bir link vermesi riskli olurdu) — bunun yerine, kitap
// ekleme formunda zaten kullandığımız Google Books aramasıyla ayrıca, istemci tarafında çekiliyor.
function aiRecItemHtml(rec, idx){
  let cover='';
  try{const url=new URL(rec.cover||'',location.href);if(rec.cover && ['https:','http:'].includes(url.protocol))cover=url.href;}catch(_){}
  const title=escapeHtml(rec.title||window.BH_I18N.pick("İsimsiz kitap","Untitled book"));
  return `<button type="button" class="ai-rec-item" data-ai-rec-idx="${idx}" data-ai-open="${idx}">
    ${materialBookCover(rec.title,cover,'hp-book-cover ai-preview-cover')}
    <b>${title}</b><span class="ai-preview-author">${escapeHtml(rec.author||'')}</span>
  </button>`;
}
function aiRecHtml(items){
  return window.BH_I18N.template`<div class="ai-rec-disclosure"><div class="ai-rec-list">${items.map(aiRecItemHtml).join('')}</div>
  <div class="ai-rec-expanded" id="aiRecDescriptions" hidden>${items.map((rec,idx)=>`<div class="ai-rec-explanation"><h3>${escapeHtml(rec.title||'')}</h3><p class="ai-expanded-pitch" data-pitch="${idx}"></p></div>`).join('')}</div></div>
  <button type="button" class="ai-text-action ai-refresh-action" id="aiRecRefreshBtn">Yeni öneri iste</button>`;
}
function wireAiRecRefresh(){
  const btn = document.getElementById('aiRecRefreshBtn');
  if(btn) btn.addEventListener('click', fetchAiRecommendation);
}
function wireAiRecItems(items){
  document.querySelectorAll('#aiRecBody [data-ai-open]').forEach(el=>{
    const idx=Number(el.dataset.aiOpen);
    el.addEventListener('click',()=>showAiRecDetail(items[idx],items,idx));
  });
  const heading=document.querySelector('.ai-card-heading');
  if(heading){
    heading.setAttribute('aria-expanded','false');
    const closeButton=document.querySelector('.ai-card-close');
    if(closeButton)closeButton.hidden=true;
    document.getElementById('aiRecCard').classList.remove('expanded');
    const toggleDescriptions=()=>{
      const panel=document.getElementById('aiRecDescriptions');if(!panel)return;
      if(hubLayoutEnabled('library')&&!panel.hidden)return;
      panel.hidden=!panel.hidden;heading.setAttribute('aria-expanded',String(!panel.hidden));
      document.getElementById('aiRecCard').classList.toggle('expanded',!panel.hidden);
      if(closeButton)closeButton.hidden=panel.hidden;
      if(!panel.hidden){
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches)panel.animate([{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'ease-out'});
        panel.querySelectorAll('[data-pitch]').forEach(async el=>{
          el.textContent=window.BH_I18N.pick("Sana özel açıklama hazırlanıyor…","Preparing your personalized explanation…");
          try{el.textContent=await getAiBookPitch(items[Number(el.dataset.pitch)]);}catch{el.textContent=window.BH_I18N.pick("Ayrıntılı anlatım şu an alınamadı. Tekrar açarak deneyebilirsin.","Details are unavailable right now. Reopen to try again.");}
        });
      }
    };
    heading.onclick=toggleDescriptions;
    if(closeButton)closeButton.onclick=toggleDescriptions;
    const card=document.getElementById('aiRecCard');
    if(card)card.onclick=event=>{
      // Kitap düğmeleri ve yenileme bağımsızdır; açıklamalara dokunmak kartı daraltır.
      if(event.target.closest('button, a, input, select, textarea'))return;
      if(window.getSelection()?.toString())return;
      toggleDescriptions();
    };
  }
  syncAiHubLayout();
}
// Kişisel açıklamalar yalnız sunucunun kullanıcıya özel, kitaplık sürümlü önbelleğinde.
// Ortak bookPitches koleksiyonu bu akışta kullanılmaz.
const aiPitchPending = new Map();
async function getAiBookPitch(rec){
 const uid=currentUid,key=`${uid}|${rec.title}|${rec.author}`;
 if(aiPitchPending.has(key))return aiPitchPending.get(key);
 const task=(async()=>{
  const res=await httpsCallable(cloudFunctions,'getBookPitch')({title:rec.title,author:rec.author});
  if(currentUid!==uid)throw new Error(window.BH_I18N.pick("Oturum değişti","Session changed"));
  if(typeof res.data?.text!=='string'||!res.data.text.trim())throw new Error(window.BH_I18N.pick("Açıklama alınamadı","Description unavailable"));
  return res.data.text;
 })();
 aiPitchPending.set(key,task);
 try{return await task;}finally{aiPitchPending.delete(key);}
}
async function showAiRecDetail(rec, items, idx){
  const body = document.getElementById('bookInfoModalBody');
  document.getElementById('bookInfoModal').style.display='flex';
  let safeCover='';
  try{const url=new URL(rec.cover||'',location.href);if(rec.cover && ['https:','http:'].includes(url.protocol))safeCover=url.href;}catch(_){}
  const coverHtml=materialBookCover(rec.title,safeCover,'book-cover-detail');
  const cacheKey = `${rec.title}|${rec.author}`;
  const pitchHtml = window.BH_I18N.template`<span class="muted">Sana özel açıklama hazırlanıyor…</span>`;
  body.innerHTML = window.BH_I18N.template`
    ${coverHtml}
    <h2 style="margin:4px 0 2px;">${escapeHtml(rec.title||'')}</h2>
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(rec.author||'')}</div>
    ${rec.reason?`<p class="ai-modal-reason">${escapeHtml(rec.reason)}</p>`:''}
    <div id="aiRecPitchText" style="text-align:left; font-size:14px; line-height:1.6;">${pitchHtml}</div>
    <div class="row" style="justify-content:center; gap:8px; margin-top:16px; flex-wrap:wrap;">
      <button type="button" class="primary" id="aiRecMarkReadingBtn">Okuyorum</button>
      <button type="button" class="secondary" id="aiRecMarkReadBtn">Okudum</button>
      <button type="button" class="secondary" id="aiRecMarkWantBtn">Okumak istiyorum</button>
    </div>
    <button type="button" class="ai-text-action" id="aiRecReplaceBtn" style="display:block;margin:16px auto 0;min-height:44px;">Yeniden öner</button>
  `;
  body.dataset.aiBookKey=cacheKey;
  wireAiRecDetailActions(rec, items, idx);
  {
    try{
      const text = await getAiBookPitch(rec);
      const pitchEl = document.getElementById('aiRecPitchText');
      if(pitchEl && body.dataset.aiBookKey===cacheKey) pitchEl.textContent = text;
    }catch(err){
      const pitchEl = document.getElementById('aiRecPitchText');
      if(pitchEl && body.dataset.aiBookKey===cacheKey) pitchEl.innerHTML = `<span class="muted">${escapeHtml(err.message||window.BH_I18N.pick("Metin alınamadı.","Could not load text."))}</span>`;
    }
  }
}
function wireAiRecDetailActions(rec, items, idx){
  const wire = (btnId, collectionName, toastMsg)=>{
    const btn = document.getElementById(btnId);
    if(!btn) return;
    btn.addEventListener('click', async ()=>{
      if(aiRecFetchInFlight){showToast(window.BH_I18N.pick("Devam eden öneri tamamlanıyor.","Finishing the current recommendation."));return;}
      document.querySelectorAll('#bookInfoModalBody button').forEach(b=>b.disabled=true);
      try{
        await addDoc(collection(db,'users',currentUid,collectionName), { title:rec.title||'', author:rec.author||'', cover:rec.cover||'', addedAt:new Date().toISOString() });
        hubPreviews.invalidate('library');
        closeModal('bookInfoModal');
        showToast(toastMsg);
        if(document.getElementById('readBooksGrid')) renderMyBooksTab();
        if(Array.isArray(items) && idx!==undefined) replaceAiRecSlot(items, idx);
      }catch(err){
        alert(window.BH_I18N.pick("Eklenemedi: ","Could not add: ")+(err.message||err));
        document.querySelectorAll('#bookInfoModalBody button').forEach(b=>b.disabled=false);
      }
    });
  };
  wire('aiRecMarkReadingBtn', 'readBooks', window.BH_I18N.pick("Şu An Okuduklarım'a eklendi!","Added to your currently reading list!"));
  wire('aiRecMarkReadBtn', 'bookHistory', window.BH_I18N.pick("Kitap Geçmişim'e eklendi!","Added to your reading history!"));
  wire('aiRecMarkWantBtn', 'wantToRead', window.BH_I18N.pick("Okumak İstediklerim'e eklendi!","Added to your reading list!"));
  const replaceBtn=document.getElementById('aiRecReplaceBtn');
  if(replaceBtn)replaceBtn.onclick=()=>refreshSingleAiRecommendation(rec,items,idx);

}
// Sadece seçilen öneriyi değiştir; yeni kitap kaydedilene kadar eskisini koru.
async function refreshSingleAiRecommendation(rec,items,idx){
 if(aiRecFetchInFlight){showToast(window.BH_I18N.pick("Devam eden öneri tamamlanıyor.","Finishing the current recommendation."));return;}
 if(!Array.isArray(items)||items[idx]!==rec)return;
 const uid=currentUid,modal=document.getElementById('bookInfoModalBody');
 const bookKey=`${rec.title}|${rec.author}`;
 const buttons=[...modal.querySelectorAll('button')];
 const refresh=document.getElementById('aiRecRefreshBtn');
 const button=document.getElementById('aiRecReplaceBtn');
 aiRecFetchInFlight=true;buttons.forEach(b=>b.disabled=true);if(refresh)refresh.disabled=true;
 if(button)button.textContent=window.BH_I18N.pick("Yeni kitap seçiliyor…","Choosing a new book…");
 try{
  const res=await httpsCallable(cloudFunctions,'getBookRecommendation')({count:1,exclude:items.map(({title,author})=>({title,author}))});
  const replacement=res.data?.items?.[0];
  if(!replacement?.title)throw new Error(window.BH_I18N.pick("Yeni öneri alınamadı.","Could not get a new recommendation."));
  await attachCoversToRecs([replacement]);
  if(currentUid!==uid)return;
  const next=items.slice();next[idx]=replacement;
  const saved={...myProfile.aiRecommendations,...res.data,items:next,generatedAt:new Date().toISOString()};
  await updateDoc(doc(db,'users',uid),{aiRecommendations:saved});
  if(currentUid!==uid)return;
  myProfile.aiRecommendations=saved;
  items.splice(idx,1,replacement);
  const body=document.getElementById('aiRecBody');
  if(body){body.innerHTML=aiRecHtml(next);wireAiRecRefresh();wireAiRecItems(next);}
  if(modal.dataset.aiBookKey===bookKey)closeModal('bookInfoModal');
  showToast(window.BH_I18N.pick("Bu kitap için yeni öneri hazır.","A replacement recommendation is ready."));
 }catch(err){
  if(currentUid===uid)showToast((err.message||window.BH_I18N.pick("Yeni öneri alınamadı.","Could not get a new recommendation."))+window.BH_I18N.pick(" Mevcut önerin korundu."," Your existing recommendation was kept."));
 }finally{
  aiRecFetchInFlight=false;buttons.forEach(b=>b.disabled=false);if(refresh)refresh.disabled=false;
  if(button)button.textContent=window.BH_I18N.pick("Yeniden öner","Replace recommendation");
 }
}
// Bir öneri "okuyorum/okudum/okumak istiyorum" ile kartından kaldırılınca, o TEK boşluk için tek
// bir yeni öneri isteyip aynı konuma yerleştiriyoruz — diğer iki öneri yerinde kalıyor, tüm liste
// baştan yüklenmiyor. Yeni öneri gelene kadar liste 2 kitapla gösterilir.
async function replaceAiRecSlot(items, idx){
  if(!Array.isArray(items) || idx<0 || idx>=items.length) return;
  const removed = items[idx];
  items.splice(idx, 1);
  const body = document.getElementById('aiRecBody');
  if(body){ body.innerHTML = aiRecHtml(items); wireAiRecRefresh(); wireAiRecItems(items); }
  myProfile.aiRecommendations = { ...myProfile.aiRecommendations, items: items.slice(), generatedAt: (myProfile.aiRecommendations && myProfile.aiRecommendations.generatedAt) || new Date().toISOString() };
  try{
    await updateDoc(doc(db,'users',currentUid), {aiRecommendations:myProfile.aiRecommendations});
    const exclude = [...items, removed].map(({title,author})=>({title,author}));
    const fn = httpsCallable(cloudFunctions, 'getBookRecommendation');
    const res = await fn({ count:1, exclude });
    const newItem = res.data && res.data.items && res.data.items[0];
    if(newItem){
      await attachCoversToRecs([newItem]);
      items.splice(idx, 0, newItem);
      myProfile.aiRecommendations = { ...res.data, items: items.slice(), generatedAt: new Date().toISOString() };
      await updateDoc(doc(db,'users',currentUid), { aiRecommendations: myProfile.aiRecommendations }).catch(()=>{});
      const bodyNow = document.getElementById('aiRecBody');
      if(bodyNow){ bodyNow.innerHTML = aiRecHtml(items); wireAiRecRefresh(); wireAiRecItems(items); }
    }
  }catch(err){
    // Sessizce 2 kitapla kalır — kullanıcı "Yeni öneri iste" ile tam listeyi yenileyebilir.
  }
}
// Her öneri için Google Books'ta başlık+yazarla arayıp ilk sonucun kapak resmini ekliyor;
// bulunamazsa rec.cover boş kalır ve aiRecItemHtml zaten var olan süslü yer tutucuya düşer.
async function attachCoversToRecs(items){
  await Promise.all(items.map(async (rec)=>{
    if(rec.cover) return; // zaten var (önbellekten geldi) — tekrar aranmıyor
    try{
      const results = await searchGoogleBooks(`intitle:${rec.title} inauthor:${rec.author||''}`);
      if(results[0] && results[0].cover) rec.cover = results[0].cover;
    }catch(e){}
  }));
}
// getBookRecommendation, sonucu users/{uid} belgesine yazdığı için istemcideki genel 'users'
// onSnapshot dinleyicisi (usersCache'i güncelleyip activeTab'i yeniden render eden) bu isteğin
// TAM ORTASINDA tekrar ateşleniyor — bu da renderAiRecCard()'ı ikinci kez çağırıp henüz
// bitmemiş isteği/DOM'u sıfırlıyordu (ekranın "seçiliyor" yazısına geri dönüp durması, hiç
// sonuç göstermemesi buradan geliyordu). Devam eden bir istek varken yenisini başlatmayan ve
// zaten ekranda öneri varken gereksiz yere yeniden render etmeyen bir koruma ekliyoruz.
let aiRecFetchInFlight = false;
async function fetchAiRecommendation(){
  if(aiRecFetchInFlight) return;
  const body = document.getElementById('aiRecBody');
  if(!body) return;
  aiRecFetchInFlight = true;
  const previousRecommendations=myProfile.aiRecommendations;
  body.innerHTML = window.BH_I18N.template`<span class="muted">Senin için kitaplar seçiliyor…</span>`;
  try{
    const fn = httpsCallable(cloudFunctions, 'getBookRecommendation');
    const previousItems=myProfile.aiRecommendations?.items||[];
    const res = await fn({exclude:previousItems.map(({title,author})=>({title,author}))});
    const items = res.data.items || [];
    myProfile.aiRecommendations = res.data;
    await attachCoversToRecs(items);
    // Kapaklar Cloud Function'ın kendi yazdığı belgeye dahil değildi (orada henüz aranmamışlardı)
    // — burada bulunduktan sonra üzerine yazıyoruz ki bir sonraki açılışta yine aranmasınlar.
    updateDoc(doc(db,'users',currentUid), { aiRecommendations: myProfile.aiRecommendations }).catch(()=>{});
    body.innerHTML = aiRecHtml(items);
    wireAiRecItems(items);
  }catch(err){
    if(previousRecommendations?.items?.length){
      myProfile.aiRecommendations=previousRecommendations;
      body.innerHTML=aiRecHtml(previousRecommendations.items);wireAiRecItems(previousRecommendations.items);
      showToast(err.message||window.BH_I18N.pick("Yeni öneri alınamadı. Önceki önerilerin korundu.","Could not get new recommendations. Your previous ones were kept."));
    }else{
      body.innerHTML=window.BH_I18N.template`<span class="muted">${escapeHtml(err.message||window.BH_I18N.pick("Öneri alınamadı.","Could not get a recommendation."))}</span><button type="button" class="secondary tiny" id="aiRecRefreshBtn">Tekrar dene</button>`;
    }
  }
  wireAiRecRefresh();
  aiRecFetchInFlight = false;
}
async function renderAiRecCard(){
  const body = document.getElementById('aiRecBody');
  if(!body) return;
  if(aiRecFetchInFlight) return;
  if(document.querySelector('#aiRecBody .ai-rec-item')) return; // zaten ekranda öneri var, ilgisiz bir profil güncellemesi yüzünden yeniden çizmeye gerek yok
  const cached = myProfile.aiRecommendations;
  if(cached && cached.items && cached.items.length && cached.version===2){
    const missingCovers = cached.items.some(it=>!it.cover);
    if(missingCovers){
      body.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
      await attachCoversToRecs(cached.items);
      // Kapaklar artık myProfile.aiRecommendations üzerinde (aynı obje referansı) — bir sonraki
      // sayfa açılışında da aynı Google Books aramalarını tekrarlamamak için Firestore'a da
      // yazıyoruz, böylece öneriler gerçekten "diğer her şey gibi" önbelleğe alınmış oluyor.
      updateDoc(doc(db,'users',currentUid), { aiRecommendations: myProfile.aiRecommendations }).catch(()=>{});
    }
    body.innerHTML = aiRecHtml(cached.items);
    wireAiRecRefresh();
    wireAiRecItems(cached.items);
  } else {
    fetchAiRecommendation();
  }
}
async function renderMyBooksTab(){
  await renderBookHistoryGrid(currentUid, 'readBooksGrid', true, 'readBooks');
  await renderBookHistoryGrid(currentUid, 'wantToReadGrid', true, 'wantToRead');
  await renderBookHistoryGrid(currentUid, 'bookHistoryGrid', true, 'bookHistory');
}
function positionDiscoverFabs(){
  const contentCol = document.getElementById('contentCol');
  const prevBtn = document.getElementById('discoverFabPrev');
  const nextBtn = document.getElementById('discoverFabNext');
  if(!contentCol || !prevBtn || !nextBtn) return;
  const rect = contentCol.getBoundingClientRect();
  prevBtn.style.left = (rect.left + rect.width*0.25) + 'px';
  nextBtn.style.left = (rect.left + rect.width*0.75) + 'px';
}
function updateDiscoverFabVisibility(){
  const bhTab = document.getElementById('tab-bookhistory');
  const prevBtn = document.getElementById('discoverFabPrev');
  const nextBtn = document.getElementById('discoverFabNext');
  if(!bhTab || !prevBtn || !nextBtn) return;
  const isActive = bhTab.classList.contains('active');
  prevBtn.classList.toggle('visible', isActive);
  nextBtn.classList.toggle('visible', isActive);
}
function setupDiscoverNavObserver(){
  positionDiscoverFabs();
  window.removeEventListener('scroll', updateDiscoverFabVisibility);
  window.addEventListener('scroll', updateDiscoverFabVisibility, {passive:true});
  window.removeEventListener('resize', positionDiscoverFabs);
  window.addEventListener('resize', positionDiscoverFabs);
  updateDiscoverFabVisibility();
}
const BH_PAGE_SIZE = 8;
const bhPageState = {};
async function renderBookHistoryGrid(uid, gridId, editable, collectionName){
  collectionName = collectionName || 'bookHistory';
  const grid = keepOrLoading(gridId);
  let items = [];
  try{
    const snap = await getDocs(query(collection(db,'users',uid,collectionName), orderBy('addedAt','desc')));
    snap.forEach(d=> items.push({ id:d.id, ...d.data() }));
  }catch(e){
    // Sorgu başarısız olursa (ör. uygulama az önce açılmış, ağ henüz hazır değil) ekranda duran
    // önbellek/placeholder'ı YANLIŞ bir "henüz kitap eklenmemiş" durumuyla ezip onu kalıcı olarak
    // önbelleğe yazmayalım — az sonra gelecek doğru sonucu birkaç kez girip çıkana kadar
    // göremiyordun, kök neden buydu. Mevcut görünümü olduğu gibi bırak.
    return;
  }
  if(!items.length){
    grid.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">📚</span>Henüz kitap eklenmemiş.</div>`;
    markLoaded(grid);
    return;
  }
  if(bhPageState[gridId]===undefined) bhPageState[gridId]=0;
  const totalPages = Math.max(1, Math.ceil(items.length / BH_PAGE_SIZE));
  if(bhPageState[gridId] >= totalPages) bhPageState[gridId] = totalPages-1;
  if(bhPageState[gridId] < 0) bhPageState[gridId] = 0;
  const page = bhPageState[gridId];
  const pageItems = items.slice(page*BH_PAGE_SIZE, page*BH_PAGE_SIZE + BH_PAGE_SIZE);

  const pagerHtml = totalPages>1 ? window.BH_I18N.template`<div class="bh-pager">
      <button type="button" class="secondary tiny bh-prev-btn" ${page<=0?'disabled':''}>◀ Önceki</button>
      <span class="muted mono" style="font-size:12px;">${page+1} / ${totalPages}</span>
      <button type="button" class="secondary tiny bh-next-btn" ${page>=totalPages-1?'disabled':''}>Sonraki ▶</button>
    </div>` : '';

  const cardsHtml = pageItems.map(b=>{
    const coverHtml = materialBookCover(b.title,b.cover);
    const delBtn = editable ? window.BH_I18N.template`<button class="bh-delete" data-id="${b.id}" title="Kaldır">✕</button>` : '';
    return `<div class="bh-card" data-bh-id="${b.id}" style="cursor:pointer;">
      <div class="bh-cover-wrap">${coverHtml}</div>
      <div class="bh-author">${escapeHtml(b.author||'')}</div>
      <div class="bh-title">${escapeHtml(b.title||'')}</div>
      ${editable&&collectionName!=='bookHistory'?`<span class="book-state-action">${collectionName==='readBooks'?window.BH_I18N.pick("✓ Okudum","✓ Read"):window.BH_I18N.pick("▤ Okuyorum","▤ Reading")}</span>`:''}
      ${delBtn}
    </div>`;
  }).join('');

  grid.innerHTML = pagerHtml + `<div class="bh-grid-inner">${cardsHtml}</div>`;
  if(totalPages>1){
    grid.querySelector('.bh-prev-btn')?.addEventListener('click', ()=>{ bhPageState[gridId]--; renderBookHistoryGrid(uid, gridId, editable, collectionName); });
    grid.querySelector('.bh-next-btn')?.addEventListener('click', ()=>{ bhPageState[gridId]++; renderBookHistoryGrid(uid, gridId, editable, collectionName); });
  }
  grid.querySelectorAll('.bh-card').forEach(card=>{
    card.addEventListener('click', (e)=>{
      if(e.target.closest('.bh-delete')) return;
      const b = pageItems.find(x=>x.id===card.dataset.bhId);
      if(b) showBhBookInfo(b, uid, gridId, collectionName);
    });
  });
  if(editable){
    grid.querySelectorAll('.bh-delete').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        try{
          await deleteDoc(doc(db,'users',currentUid,collectionName,btn.dataset.id));
          hubPreviews.invalidate('library');
          renderBookHistoryGrid(currentUid, gridId, true, collectionName);
        }catch(e){ alert('Silinemedi: '+(e.message||e)); }
      });
    });
  }
  markLoaded(grid);
}
// Kitaplığım'daki bir kitaba tıklayınca açılan pencere: kapak, yazar, kitap adı, ve listeye özel
// tek bir ilerleme tuşu — "Okumak İstediklerim"de "Okuyorum" (kitabı "Şu An Okuduklarım"a
// taşır), "Şu An Okuduklarım"da "Okudum" (kitabı "Kitap Geçmişim"e taşır). "Kitap Geçmişim"
// zaten son durak olduğu için orada bir tuş yok. Sadece kişinin KENDİ kitaplığında (başkasının
// profilini görüntülerken değil) gösteriliyor.
function showBhBookInfo(b, uid, gridId, collectionName){
  const body = document.getElementById('bookInfoModalBody');
  document.getElementById('bookInfoModal').style.display='flex';
  const coverHtml = materialBookCover(b.title,b.cover,'book-cover-detail');
  let actionBtn = '';
  if(uid===currentUid){
    if(collectionName==='wantToRead') actionBtn = window.BH_I18N.template`<button type="button" class="primary" id="bhMoveBtn" style="margin-top:10px;">📖 Okuyorum</button>`;
    else if(collectionName==='readBooks') actionBtn = window.BH_I18N.template`<button type="button" class="primary" id="bhMoveBtn" style="margin-top:10px;">✓ Okudum</button>`;
  }
  body.innerHTML = `
    ${coverHtml}
    <h2 style="margin:4px 0 2px;">${escapeHtml(b.title||'')}</h2>
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(b.author||'')}</div>
    ${actionBtn}
  `;
  const btn = document.getElementById('bhMoveBtn');
  if(btn){
    btn.addEventListener('click', async ()=>{
      btn.disabled = true;
      const destCollection = collectionName==='wantToRead' ? 'readBooks' : 'bookHistory';
      try{
        await moveBookWithGoal(b,collectionName,destCollection);
        closeModal('bookInfoModal');
        showToast(collectionName==='wantToRead' ? window.BH_I18N.pick("Şu An Okuduklarım'a taşındı!","Moved to your currently reading list!") : window.BH_I18N.pick("Kitap Geçmişim'e taşındı!","Moved to your reading history!"));
        renderBookHistoryGrid(currentUid, gridId, true, collectionName);
        const destGridId = destCollection==='readBooks' ? 'readBooksGrid' : 'bookHistoryGrid';
        if(document.getElementById(destGridId)) renderBookHistoryGrid(currentUid, destGridId, true, destCollection);
        // "Şu an okuyorum"dan "Okudum"a taşınan bir kitap aylık hedefe sayılabilir — "Bugün"
        // sekmesindeki hedef kartı bu ekrandan (Kitaplığım) tetiklenmediği için kendiliğinden
        // yenilenmiyordu, burada elle tazeliyoruz. Aktif olmayan (admin/üye) varyant no-op.
        renderTotalPagesCard('totalPagesNumber');
        renderTotalPagesCard('mTotalPagesNumber');
      }catch(err){ alert(window.BH_I18N.pick("Taşınamadı: ","Could not move: ")+(err.message||err)); btn.disabled = false; }
    });
  }
}
setupAddToggle('bookHistoryAddBtn', 'bookHistoryFormWrap');
setupAddToggle('wantToReadAddBtn', 'wantToReadFormWrap');
setupAddToggle('readBooksAddBtn', 'readBooksFormWrap');
attachBookAutocomplete('rbSearchInput', null, 'rbSearchSuggest', (sel)=>{
  document.getElementById('rbAuthorInput').value = sel.author;
  document.getElementById('rbTitleInput').value = sel.title;
  document.getElementById('rbCoverInput').value = sel.cover || '';
  document.getElementById('rbSearchInput').value = '';
});
document.getElementById('rbSaveBtn').addEventListener('click', async ()=>{
  const author = document.getElementById('rbAuthorInput').value.trim();
  const title = document.getElementById('rbTitleInput').value.trim();
  const cover = document.getElementById('rbCoverInput').value.trim();
  if(!title){ alert(window.BH_I18N.pick("Kitap adı yaz.","Enter a book title.")); return; }
  try{
    await addDoc(collection(db,'users',currentUid,'readBooks'), { author, title, cover, addedAt: new Date().toISOString() });
    hubPreviews.invalidate('library');
    document.getElementById('rbSearchInput').value='';
    document.getElementById('rbAuthorInput').value='';
    document.getElementById('rbTitleInput').value='';
    document.getElementById('rbCoverInput').value='';
    closeAddForm('readBooksAddBtn','readBooksFormWrap');
    renderBookHistoryGrid(currentUid, 'readBooksGrid', true, 'readBooks');
  }catch(err){ alert(window.BH_I18N.pick("Eklenemedi: ","Could not add: ")+(err.message||err)); }
});
attachBookAutocomplete('wtrSearchInput', null, 'wtrSearchSuggest', (sel)=>{
  document.getElementById('wtrAuthorInput').value = sel.author;
  document.getElementById('wtrTitleInput').value = sel.title;
  document.getElementById('wtrCoverInput').value = sel.cover || '';
  document.getElementById('wtrSearchInput').value = '';
});
document.getElementById('wtrSaveBtn').addEventListener('click', async ()=>{
  const author = document.getElementById('wtrAuthorInput').value.trim();
  const title = document.getElementById('wtrTitleInput').value.trim();
  const cover = document.getElementById('wtrCoverInput').value.trim();
  if(!title){ alert(window.BH_I18N.pick("Kitap adı yaz.","Enter a book title.")); return; }
  try{
    await addDoc(collection(db,'users',currentUid,'wantToRead'), { author, title, cover, addedAt: new Date().toISOString() });
    hubPreviews.invalidate('library');
    document.getElementById('wtrSearchInput').value='';
    document.getElementById('wtrAuthorInput').value='';
    document.getElementById('wtrTitleInput').value='';
    document.getElementById('wtrCoverInput').value='';
    closeAddForm('wantToReadAddBtn','wantToReadFormWrap');
    renderBookHistoryGrid(currentUid, 'wantToReadGrid', true, 'wantToRead');
  }catch(err){ alert(window.BH_I18N.pick("Eklenemedi: ","Could not add: ")+(err.message||err)); }
});
attachBookAutocomplete('bhSearchInput', null, 'bhSearchSuggest', (sel)=>{
  document.getElementById('bhAuthorInput').value = sel.author;
  document.getElementById('bhTitleInput').value = sel.title;
  document.getElementById('bhCoverInput').value = sel.cover || '';
  document.getElementById('bhSearchInput').value = '';
});
document.getElementById('bhSaveBtn').addEventListener('click', async ()=>{
  const author = document.getElementById('bhAuthorInput').value.trim();
  const title = document.getElementById('bhTitleInput').value.trim();
  const cover = document.getElementById('bhCoverInput').value.trim();
  if(!title){ alert(window.BH_I18N.pick("Kitap adı yaz.","Enter a book title.")); return; }
  try{
    await addDoc(collection(db,'users',currentUid,'bookHistory'), { author, title, cover, addedAt: new Date().toISOString() });
    hubPreviews.invalidate('library');
    createOrBatchPost('book_added', { bookTitle: title, bookAuthor: author, bookCover: cover });
    document.getElementById('bhSearchInput').value='';
    document.getElementById('bhAuthorInput').value='';
    document.getElementById('bhTitleInput').value='';
    document.getElementById('bhCoverInput').value='';
    closeAddForm('bookHistoryAddBtn','bookHistoryFormWrap');
    renderBookHistoryGrid(currentUid, 'bookHistoryGrid', true);
  }catch(err){ alert(window.BH_I18N.pick("Eklenemedi: ","Could not add: ")+(err.message||err)); }
});

const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🔥','👏','🎉','🤔','👎'];
function reactionTargetRef(target){
  const [kind, ids] = target.split(':');
  if(kind==='rec') return doc(db,'recommendations',ids);
  if(kind==='post') return doc(db,'posts',ids);
  if(kind==='postcomment'){ const [postId,commentId] = ids.split('|'); return doc(db,'posts',postId,'comments',commentId); }
  const [recId, commentId] = ids.split('|');
  return doc(db,'recommendations',recId,'comments',commentId);
}
function renderReactionBar(reactions, target){
  reactions = reactions || {};
  const allEmojis = [...REACTION_EMOJIS, ...Object.keys(reactions).filter(em => !REACTION_EMOJIS.includes(em))];
  // Kullanıcının kendi tepkisi artık başlıkta (avatarın solunda) tek başına gösterildiği için,
  // burada (alttaki çubukta) SADECE başkalarının tepkileri gösteriliyor — aynı tepki iki kere
  // (hem burada hem köşede) görünmesin.
  const activeEmojis = allEmojis.filter(em => (reactions[em]||[]).filter(u=>u!==currentUid).length>0);
  const pills = activeEmojis.map(em=>{
    const uids = (reactions[em] || []).filter(u=>u!==currentUid);
    return `<button type="button" class="reaction-pill" data-target="${target}" data-emoji="${em}" data-uids="${uids.join(',')}">${em}${uids.length>1?`<span class="rcount">${uids.length}</span>`:''}</button>`;
  }).join('');
  return `<div class="reaction-bar" data-target="${target}">${pills}<button type="button" class="reaction-add-btn" data-target="${target}">🙂</button></div>`;
}
let currentReactionDrawerBtn = null;
function closeReactionDrawer(){
  const drawer = document.getElementById('reactionDrawer');
  drawer.classList.remove('open');
  setTimeout(()=>{ if(!drawer.classList.contains('open')) drawer.style.display='none'; }, 200);
  if(currentReactionDrawerBtn) currentReactionDrawerBtn.classList.remove('expanded');
  currentReactionDrawerBtn = null;
}
function renderDrawerEmojiRow(target, availableWidth){
  const drawer = document.getElementById('reactionDrawer');
  const BTN_W = 34; // her emoji tuşunun kapladığı yaklaşık genişlik
  let maxCount = Math.max(1, Math.floor((availableWidth - BTN_W) / BTN_W) - 1);
  maxCount = Math.min(maxCount, REACTION_EMOJIS.length);
  const shown = REACTION_EMOJIS.slice(0, maxCount);
  drawer.innerHTML = shown.map(em=>`<button type="button" class="emoji-pick-btn" data-target="${target}" data-emoji="${em}">${em}</button>`).join('') +
    `<button type="button" class="emoji-pick-btn-toggle" id="drawerCustomToggleBtn" data-target="${target}">+</button>`;
  const toggleBtn = document.getElementById('drawerCustomToggleBtn');
  toggleBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    drawer.innerHTML = `<input type="text" class="drawer-custom-input" id="drawerCustomInput" placeholder="😀" maxlength="8" />
      <button type="button" class="emoji-pick-btn-toggle" id="drawerCustomSendBtn">✓</button>`;
    const input = document.getElementById('drawerCustomInput');
    input.focus();
    const sendBtn = document.getElementById('drawerCustomSendBtn');
    const doSend = async ()=>{
      const val = input.value.trim();
      if(!val) return;
      await setReaction(target, val);
      if(pendingReactionRefresh) await pendingReactionRefresh();
      burstMyReactionBadge(target);
      closeReactionDrawer();
    };
    sendBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); doSend(); });
    input.addEventListener('keydown', (ev)=>{
      if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation(); doSend(); }
    });
    input.addEventListener('click', (ev)=> ev.stopPropagation());
  });
}
function toggleReactionDrawer(btn, target){
  if(currentReactionDrawerBtn === btn){ closeReactionDrawer(); return; }
  closeReactionDrawer();
  const drawer = document.getElementById('reactionDrawer');
  const r = btn.getBoundingClientRect();
  const availableWidth = window.innerWidth - r.right - 16;
  drawer.style.display = 'flex';
  drawer.classList.remove('open');
  renderDrawerEmojiRow(target, availableWidth);
  drawer.style.left = (r.right + 8) + 'px';
  drawer.style.removeProperty('right');
  drawer.style.top = (r.top + r.height/2) + 'px';
  requestAnimationFrame(()=>{ drawer.classList.add('open'); });
  btn.classList.add('expanded');
  currentReactionDrawerBtn = btn;
}
document.addEventListener('click', (e)=>{
  const drawer = document.getElementById('reactionDrawer');
  if(drawer.classList.contains('open') && !drawer.contains(e.target) && !e.target.closest('.reaction-add-btn')){
    closeReactionDrawer();
  }
});
function showReactorsModal(uidsCsv, emoji){
  const uids = uidsCsv ? uidsCsv.split(',').filter(Boolean) : [];
  const names = uids.map(uid=> escapeHtml((usersCache[uid]&&usersCache[uid].name) || 'Bilinmeyen')).join('<br/>');
  showSimpleInfoModal(`<div style="font-size:30px; margin-bottom:8px;">${emoji}</div><div>${names || window.BH_I18N.pick("<span class=\"muted\">Kimse yok.</span>","<span class=\"muted\">No one yet.</span>")}</div>`);
}
async function setReaction(target, emoji){
  const ref = reactionTargetRef(target);
  try{
    const snap = await getDoc(ref);
    if(!snap.exists()){ alert(window.BH_I18N.pick("Bu gönderi/yorum artık bulunamadı, tepki eklenemedi (silinmiş olabilir).","This post or comment could not be found. It may have been deleted; no reaction was added.")); return; }
    const data = snap.data();
    const reactions = data.reactions || {};
    const hasThis = (reactions[emoji]||[]).includes(currentUid);
    const updates = {};
    Object.keys(reactions).forEach(em=>{
      if(em!==emoji && (reactions[em]||[]).includes(currentUid)){
        updates[`reactions.${em}`] = arrayRemove(currentUid);
      }
    });
    updates[`reactions.${emoji}`] = hasThis ? arrayRemove(currentUid) : arrayUnion(currentUid);
    await updateDoc(ref, updates);
    if(!hasThis){
      const ownerUid = data.uid || data.fromUid;
      if(ownerUid && ownerUid !== currentUid){
        const kind = target.split(':')[0];
        const tabHint = kind==='rec' ? 'recs' : 'social';
        const postIdForNotif = (kind==='post' || kind==='postcomment') ? target.split(':')[1].split('|')[0] : null;
        await notifyUser(ownerUid, `${myProfile.name} ${emoji} ile tepki verdi.`, tabHint, postIdForNotif);
      }
    }
  }catch(e){
    alert('Tepki kaydedilemedi: '+(e.message||e)+'\n\nBu genelde Firestore Rules izin vermediği için olur — yönetici kuralları güncellemesi gerekebilir.');
  }
}

/* ============ SOSYAL: TIMELINE + KEŞFET ============ */
const READ_MESSAGES_BY_HOUR = {
  0: ['Yeni günün ilk dakikaları, raflarda sessizce bekleyen bir hikâyeye "merhaba" demek için güzel bir bahaneydi.', 'Külkedisi balodan ayrılmış olabilir; ama en güzel masallar bazen tam gece yarısında başlar.', 'Şehrin gürültüsü sustuğunda kelimelerin sesi daha belirgin duyulur.', 'Takvim yeni bir güne geçti; o ise çoktan başka bir evrenin sınırlarını aşmıştı.', 'Gece yarısı, kitapların en cömert olduğu vakittir; okura hiç ummadığı dünyalar sunarlar.', 'Bazı kapılar anahtarla açılır, bazılarıysa gece yarısı çevrilen ilk sayfayla.', 'Uykunun daveti nazikti; merakın daveti ise karşı konulamayacak kadar güçlüydü.', 'Bir kütüphanenin rafları, tam bu saatte fısıldaşmaya başlıyor olmalı.', 'Saat sıfırı gösterirken gerçek dünya kısa bir mola verdi; hayal gücü nöbeti devraldı.', 'Yeni günün ilk izi, çevrilen bir sayfanın çıkardığı o tanıdık ses oldu.'],
  1: ['Sherlock Holmes bile böylesine sessiz bir gecede satırların arasındaki ipuçlarını takdir ederdi.', 'Gece ilerledikçe odadaki tek hareket, usulca çevrilen sayfalardı.', 'Merakın saate ihtiyacı yoktur; yalnızca anlatılmayı bekleyen iyi bir hikâyeye ihtiyacı vardır.', 'Bazı yolculuklar tren garından değil, ilk paragraftan başlar.', 'Ay gökyüzünü aydınlatırken kitap da düşünceleri aydınlatıyordu.', 'Bu saatte kelimeler, gündüz olduğundan biraz daha derin görünür.', 'Sessizlik, iyi yazılmış bir romanın en sadık okuma arkadaşıdır.', 'Gecenin en güzel yanı, kimsenin hayal kurmaya acele ettirmemesidir.', 'Saat ilerledikçe zaman değil, yalnızca okunacak sayfa sayısı önemini korudu.', 'Dışarıda gece vardı; içeride ise bambaşka bir mevsim yaşanıyordu.'],
  2: ['Morpheus sabırla bekledi; çünkü hikâye henüz son sözünü söylememişti.', 'Gecenin bu saatinde açılan kitaplar, okuruyla sessiz bir anlaşma yapar.', 'Uzak diyarlara gitmek bazen yalnızca bir sayfa çevirmek kadar kolaydır.', 'Ay ışığı pencereye vururken satırlar zihinde yeni yollar açıyordu.', 'Bazı cümleler, gündüzün telaşında değil gecenin dinginliğinde gerçek anlamını bulur.', 'Dünya yavaşlamıştı; ama hikâye tam aksine hız kazanıyordu.', 'En güzel keşiflerin bir pusulaya değil, iyi yazılmış bir romana ihtiyacı vardır.', 'Saat iki olduğunda kahramanlar çoktan hafızanın bir köşesine yerleşmişti.', 'Gözler yorulabilir; ama iyi bir hikâyeye duyulan merak kolay kolay yorulmaz.', 'Gece, satırların arasındaki boşlukları bile anlamla doldurur.'],
  3: ['Victor Frankenstein\'ın laboratuvarı kadar sessiz bir gecede, yeni fikirler sayfaların arasından doğuyordu.', 'Bu saat, yalnızca uykusuzların değil, hayal kurmaktan vazgeçmeyen okurların da zamanıdır.', 'Gecenin en derin sessizliği, en güçlü anlatıcılardan biridir.', 'Raflarda yıllarca bekleyen bir kitap, sonunda hak ettiği okurla buluştu.', 'Bazı hikâyeler güneş ışığını değil, yıldızların tanıklığını sever.', 'Saat üçte zaman ağır akar; ama iyi yazılmış bir roman bunu unutturur.', 'Her çevrilen sayfa, bilinmeyene doğru atılmış küçük bir adımdır.', 'Dışarıda herkes dinlenirken zihin yeni karakterlerle tanışıyordu.', 'En uzun geceler bile iyi bir kitabın içinde kısa gelir.', 'Sessizlik bazen en etkileyici ön sözdür.'],
  4: ['Şafak henüz görünmemişti; ama satırlar çoktan ufuk çizgisini aşmıştı.', 'Odysseus eve dönmek için denizleri aştı; o ise birkaç bölümle sayısız dünyayı dolaştı.', 'Gün doğmadan önce okunan sayfaların kendine özgü bir huzuru vardır.', 'Gökyüzü yavaş yavaş renk değiştirirken hikâye de yeni bir yöne evriliyordu.', 'Uyanan ilk şey bazen güneş değil, meraktır.', 'Sabahın serinliğiyle birlikte kelimeler de tazelenmiş gibiydi.', 'Günün ilk ışıkları yaklaşırken kitabın atmosferi odanın havasını değiştirmişti.', 'Şafaktan önce kazanılan sessizlik, okumanın en değerli armağanlarından biridir.', 'Her yeni gün, okunmayı bekleyen yeni bir hikâye demektir.', 'Gecenin son perdesi kapanırken kitabın sahnesi hâlâ açıktı.'],
  5: ['İlk kuş sesleri duyulurken roman son hız yoluna devam ediyordu.', 'Don Kişot değirmenlere doğru yola çıkmıştı; o ise yeni bir bölümün peşine.', 'Sabahın ilk ışıklarıyla birlikte zihinde onlarca yeni düşünce filizlenmişti.', 'Güne başlamak için bazılarının alarma, bazılarının ise yalnızca iyi bir kitaba ihtiyacı vardır.', 'Şafak, sayfalar arasında geçirilen saatleri usulca selamladı.', 'Gün doğarken raflardaki yüzlerce hikâyeden biri artık tanıdık bir dosta dönüşmüştü.', 'Erken saatlerin en güzel ayrıcalığı, dünyanın henüz sessiz olmasıdır.', 'Yeni gün, yeni hedefler getirdi; ama ilk durak yine kitap oldu.', 'Sabahın serin havası, hikâyenin bıraktığı sıcak duyguyla dengeleniyordu.', 'Güneş ufukta görünürken bir kitap daha unutulmaz anılar arasındaki yerini aldı.'],
  6: ['Güneş doğdu; ama bugünün ilk keşfi gökyüzünde değil, satırların arasındaydı.', 'Her sabah yeni bir başlangıçtır; en güzellerinden bazıları kitap kapağı açılarak yapılır.', 'Sabahın ilk ışıkları, okunan her cümlenin üzerine ayrı bir umut bırakır.', 'Gün henüz telaşa kapılmamışken birkaç sayfa okumak, zamana verilmiş küçük bir meydan okumadır.', 'Kuşlar şarkılarını söylerken kelimeler de kendi melodisini kuruyordu.', 'Yeni bir günün en güzel kahvaltısı bazen birkaç iyi paragraftır.', 'Sabahın sessizliği, yazarların en görünmez ortağıdır.', 'Güne erkenden başlayanların bildiği bir sır vardır: Hikâyeler de sabahları daha canlıdır.', 'Güneş pencereyi aydınlattı; kitap ise zihni.', 'İlk ışıklarla birlikte yeni bir dünyanın kapısı aralandı.'],
  7: ['Alice tavşanı izledi; o ise merakını.', 'Çayın buharı yükselirken hikâye de yavaş yavaş şekilleniyordu.', 'Gün planları bekleyebilir; iyi yazılmış bir bölüm her zaman önceliklidir.', 'Sabah telaşı başlamadan önce birkaç sayfa okumak, güne yapılan sessiz bir yatırımdır.', 'Raflardan seçilen o kitap, bugünün en doğru kararı oldu.', 'Bazı sabahlar haberlerle başlar; bazıları ise romanlarla güzelleşir.', 'Sabah güneşi perdeyi açtı, kitap ise hayal gücünü.', 'Yeni gün, yeni karakterlerle tanışmak için güzel bir fırsattı.', 'En sakin sabahlar, en unutulmaz hikâyeleri ağırlayabilir.', 'Takvim bugünü gösteriyordu; kitap ise bambaşka zamanları.'],
  8: ['Bilbo Baggins\'in kapısını bir büyücü çalmıştı; bugün ise macera kitabın ilk sayfasından geldi.', 'Günün koşuşturması başlamadan önce yapılan en değerli yolculuk, satırlar arasındaki yolculuktur.', 'Masadaki fincan boşalabilir; ama iyi bir hikâye kolay kolay tükenmez.', 'Her çevrilen sayfa güne yeni bir renk kattı.', 'Dünyanın en sessiz sohbetlerinden biri, okur ile kitap arasında gerçekleşir.', 'Bazı sabahlar yalnızca okunarak güzelleşir.', 'Güne umutla başlamanın pek çok yolu vardır; bunlardan biri de kitap açmaktır.', 'Kelimeler bazen kahveden daha güçlü uyandırır.', 'Yeni bir bölüm, yeni bir bakış açısı getirdi.', 'Gün başlamış olabilir; ama hayal gücü çok daha erken uyanmıştı.'],
  9: ['Jean Valjean\'ın ikinci bir şans bulduğu gibi, her kitap da okuruna yeni bir başlangıç sunar.', 'Üretken bir günün en sağlam temeli bazen tek bir sayfadır.', 'Okunan her bölüm, düşüncelere yeni bir pencere açtı.', 'Bilginin en sessiz öğretmeni çoğu zaman kitaplardır.', 'Sabahın enerjisiyle birleşen iyi bir hikâye uzun süre akılda kalır.', 'Zaman ilerledi; merak yerinde durmadı.', 'Kitaplar acele etmez; ama okuru mutlaka bir yere ulaştırır.', 'En güzel keşiflerden bazıları haritalarda bulunmaz.', 'Satırların arasında kaybolmak bazen kendini bulmanın başka bir yoludur.', 'Bugün öğrenilecek ilk şey, kitabın anlattıkları oldu.'],
  10: ['Hercule Poirot ayrıntıları incelerdi; iyi bir okur da satır aralarını.', 'Güneş yükseldikçe hikâye de derinleşmeye başladı.', 'Kitaplar konuşmaz; ama anlatacakları hiç bitmez.', 'Her bölüm yeni bir soru, her sayfa yeni bir cevap olabilir.', 'Okuma, zamana karşı değil, unutmaya karşı kazanılan bir mücadeledir.', 'Bazen en büyük keşif, yeni bir düşünceyle karşılaşmaktır.', 'Bugün de birkaç sayfa, yüzlerce düşünce doğurdu.', 'İyi yazılmış cümleler yıllar geçse de ilk günkü etkisini korur.', 'Hayal gücü için en verimli toprak, iyi kitapların sayfalarıdır.', 'Öğlene yaklaşırken hikâye tam anlamıyla hayat buldu.'],
  11: ['Edmond Dantès sabrı öğrendi; kitaplar da okura aynı erdemi fısıldar.', 'Gün yükseldikçe hikâye de kendi doruğunu arıyordu.', 'Öğleye yaklaşırken sayfalar zamanın nasıl geçtiğini unutturdu.', 'İyi bir kitap, saate bakmayı gereksiz kılar.', 'Bazı cümleler yalnızca okunmaz; uzun süre zihinde yaşamaya devam eder.', 'Her bölüm tamamlandığında yeni bir merak doğar.', 'Hikâyeler yalnızca anlatılmaz; yaşanır da.', 'Kitaplar raflarda bekler; doğru zamanı geldiğinde okurunu bulur.', 'Günün en güzel molası, birkaç satırlık bir yolculuktu.', 'Öğle güneşi yaklaşırken hikâye hâlâ bütün canlılığıyla devam ediyordu.'],
  12: ['Öğle güneşi yükselirken hikâye de tam anlamıyla ritmini buldu.', 'Günün ortasında yapılan kısa bir okuma, zihne uzun bir mola armağan eder.', 'Öğle saatleri bazen bir kitabın en güzel bölümüne denk gelir.', 'Masadaki tabak boşalabilir; ama merak kolay kolay doymaz.', 'Her çevrilen sayfa, günün telaşını biraz daha geride bıraktı.', 'Kütüphaneler sessizdir; ama içlerinde sayısız hayat aynı anda yaşar.', 'Güne kısa bir ara vermenin en güzel yollarından biri, iyi bir kitaptır.', 'Satırlar arasında geçirilen dakikalar, saatin gösterdiğinden daha değerlidir.', 'Bugünün en güzel sohbeti, yazar ile okur arasında gerçekleşti.', 'Öğle vakti, yeni düşüncelerin filizlenmesi için en verimli saatlerden biridir.'],
  13: ['Atticus Finch\'in öğrettiği gibi, anlamak bazen yalnızca dikkatle dinlemekle başlar; kitaplar da bunu sabırla öğretir.', 'Gün ilerledikçe karakterler de daha tanıdık gelmeye başladı.', 'Bazı yolculuklar bavul istemez; yalnızca açık bir kitap yeterlidir.', 'Her bölüm, zihne yeni bir pencere açtı.', 'Satırlar arasında dolaşırken zaman usulca akıp gitti.', 'Hikâyeler, onları paylaşan okurlarla yaşamaya devam eder.', 'Bir kitabın en güzel yanı, her okurun onu farklı okumasıdır.', 'Sessizce çevrilen sayfalar bile bazen uzun konuşmalardan daha çok şey anlatır.', 'Öğleden sonra yaklaşırken merak hâlâ ilk sayfadaki kadar canlıydı.', 'İyi yazılmış bir paragraf, günün bütün temposunu değiştirebilir.'],
  14: ['Kaptan Nemo okyanusun derinliklerini keşfetti; bugün ise keşfedilen yer, satırların derinliğiydi.', 'Günün en parlak ışığında bile kitaplar kendi gölgelerini oluşturur.', 'Her yeni bölüm, daha önce hiç gidilmemiş bir sokağa benzer.', 'Okunan her cümle, düşüncelere sessizce yerleşti.', 'En büyük keşiflerden bazıları masadan kalkmadan yapılır.', 'Gün ortasında birkaç sayfa okumak, zamana verilmiş küçük bir hediyedir.', 'Hayal gücü güneş saatine göre çalışmaz.', 'Her kitap, okurunun zihninde ikinci kez yazılır.', 'Bugün de yeni bir hikâye hafızada yerini aldı.', 'Bazen tek bir cümle, uzun bir yolculuğun başlangıcı olabilir.'],
  15: ['Raskolnikov\'un sorguladığı vicdan gibi, bazı kitaplar da okuru kendisiyle konuşmaya davet eder.', 'Gün yavaş yavaş akşama yaklaşırken hikâye hız kesmedi.', 'Her karakter, başka bir insanı anlamanın yeni bir yoludur.', 'Sayfalar arasında dolaşırken dışarıdaki zaman önemini yitirdi.', 'İyi kitaplar yalnızca okunmaz; uzun süre düşünülür.', 'Okuma, zihnin yaptığı en sessiz keşif yolculuğudur.', 'Her bölüm bittiğinde, geriye yeni sorular kaldı.', 'Bugünün en uzun yolculuğu birkaç santimetrelik sayfaların içinde gerçekleşti.', 'Bazı cümleler, ilk okunduğu andan itibaren unutulmayı reddeder.', 'Güneş batıya yönelirken hikâye de en güçlü anlarına ulaşıyordu.'],
  16: ['Dorian Gray zamana meydan okumaya çalıştı; kitaplar ise bunu her nesilde yeniden başarır.', 'Akşam yaklaşırken satırlar daha da derinleşti.', 'Her kitabın kendi mevsimi vardır; bazıları dört mevsimi aynı anda yaşatır.', 'Günün yorgunluğu, iyi yazılmış birkaç paragrafla hafifledi.', 'Sayfalar çevrildikçe düşünceler de yön değiştirdi.', 'Kitapların en güzel yanı, her dönüşte yeni bir ayrıntı göstermeleridir.', 'Bazen en sessiz anlar, en büyük farkındalıkları getirir.', 'İyi bir hikâye, günü bölmez; güzelleştirir.', 'Gözler satırları takip ederken zihin çoktan başka diyarlara ulaşmıştı.', 'Gün batımına doğru ilerlerken kitap hâlâ yeni sürprizler sunuyordu.'],
  17: ['Küçük Prens\'in tilkisi gibi, bazı kitaplarla da zaman geçirdikçe aranda görünmez bağlar oluşur.', 'Günün son mesaisi, hayal gücüne devredildi.', 'Gün boyunca biriken düşünceler, satırlar arasında yerini buldu.', 'Hikâyeler bazen yorgunluğu değil, yalnızca sessizliği ister.', 'Her kitap, okuruna küçük de olsa bir iz bırakır.', 'Akşam yaklaşırken merak hâlâ ilk bölümdeki kadar güçlüydü.', 'Okumak, günü daha uzun yaşamanın en güzel yollarından biridir.', 'Gün biterken hafızaya yeni isimler, yeni yerler ve yeni duygular eklendi.', 'Bazı karakterler kitabın içinde kalmaz; okurun zihnine taşınır.', 'Günün son ışıklarıyla birlikte hikâye de okurunun bir parçası hâline geldi.'],
  18: ['Gandalf\'ın dediği gibi, bize verilen zamanı nasıl değerlendireceğimiz önemlidir; bugün bunun cevabı birkaç güzel sayfada saklıydı.', 'Gün batımı gökyüzünü boyarken satırlar da hayal gücünü renklendiriyordu.', 'Günün yorgunluğu, iyi yazılmış bir hikâyenin omzuna bırakıldı.', 'Bazı akşamlar uzun sohbet ister, bazılarıysa yalnızca iyi bir kitap.', 'Güneş ufka çekilirken karakterler daha da canlı görünmeye başladı.', 'Akşamın serinliği, sayfalardaki sıcak hikâyelerle dengelendi.', 'Her günün sonunda anlatılacak yeni bir hikâye bulunabilir.', 'Gün kapanırken kitap yeni kapılar açmaya devam etti.', 'Günlük telaş yerini satırların dinginliğine bıraktı.', 'Akşamın ilk dakikaları, hayal gücü için en güzel davetiyelerden biridir.'],
  19: ['Harry Potter\'ın peron dokuz üç çeyreği vardı; bugün ise yolculuk yalnızca açılan bir kitapla başladı.', 'Çayın buharı yükselirken hikâye de usulca derinleşti.', 'Akşam, kitap raflarının en çok sevdiği misafirdir.', 'Günün en güzel kaçamağı bazen yalnızca birkaç bölüm sürer.', 'Dışarıda lambalar yanarken satırlar da zihinde ışık yakıyordu.', 'Her akşam yeni bir dünyanın kapısını çalmak mümkündür.', 'Koltuğa yerleşmek bazen uzun bir yolculuğun ilk adımıdır.', 'Günün temposu geride kaldı; sıra meraka geldi.', 'Akşam saatleri, kitapların sesi biraz daha güçlü çıkar.', 'Hikâyeler, gün batımını beklemeyi iyi bilir.'],
  20: ['Aslan\'ın cesareti gibi bazı hikâyeler de okurun içinde uzun süre yaşamaya devam eder.', 'Gecenin ilk perdesi açılırken roman da en etkileyici sahnelerini göstermeye başladı.', 'Düşünceler yavaşladı; merak hızlandı.', 'Her çevrilen sayfa günü biraz daha güzelleştirdi.', 'En iyi yol arkadaşlarından biri, kapağı açılmış bir kitaptır.', 'Zaman ilerledi; hikâye geride kalmayı reddetti.', 'Kitaplar, akşamın en sessiz misafiridir.', 'Günün son saatleri, yeni fikirler için her zaman bereketlidir.', 'Bazı karakterlerle vedalaşmak kolay değildir.', 'İyi bir roman, akşamı olduğundan daha kısa hissettirir.'],
  21: ['Arsène Lupin\'in çaldığı şey mücevherlerdi; iyi kitaplar ise fark ettirmeden kalpleri çalar.', 'Gün geride kaldı; anlatılacak hikâyeler ise hâlâ masadaydı.', 'Her bölüm, günü biraz daha unutulmaz kıldı.', 'Gecenin başlamasıyla birlikte hayal gücü de mesaisine başladı.', 'Kitaplar bazen en iyi dostluğu tek kelime etmeden kurar.', 'Sayfalar ilerledikçe düşünceler de derinleşti.', 'Hikâyeler, okurun zihninde ikinci bir ömür yaşar.', 'Bazı akşamlar yalnızca okumak yeterlidir.', 'Günün bütün gürültüsü dışarıda kaldı.', 'Kelimeler, geceyi usulca doldurmaya devam etti.'],
  22: ['Winston Smith gerçeği arıyordu; bugün ise cevaplar satırların arasında saklıydı.', 'Gecenin ilerleyen saatleri, düşüncelerin en berrak olduğu anlardır.', 'Kitabın sonlarına yaklaşmak bazen sevilen bir şehirden ayrılmak gibidir.', 'Her sayfa, zihinde yeni bir iz bıraktı.', 'Hikâyenin ritmi gecenin ritmiyle uyum içindeydi.', 'Gün biterken öğrenilecek yeni şeyler hâlâ vardı.', 'İyi kitaplar, kapakları kapandıktan sonra da konuşmaya devam eder.', 'Gece büyüdükçe hayal gücü de sınırlarını genişletti.', 'Bazı cümleler yalnızca okunmaz; insanın içinde yankılanır.', 'Saat ilerledi, ama hikâye acele etmiyordu.'],
  23: ['Gregor Samsa\'nın sabahı sıra dışı başlamıştı; bu gün ise sıra dışı bir hikâyeyle sona erdi.', 'Günün son saatleri, en güzel vedaların yaşandığı sayfalara ayrıldı.', 'Kapanan yalnızca gün oldu; hikâye zihinde yaşamaya devam etti.', 'Kitabın kapağı kapandı, ama bıraktığı iz kapanmadı.', 'Günün sonunda kazanılan en değerli şey, yeni bir bakış açısıydı.', 'Her hikâye biter; iyi olanlar ise okurun içinde yaşamayı sürdürür.', 'Yıldızlar gökyüzünü süslerken satırlar hafızayı süslüyordu.', 'Bugün okunan sayfalar, yarının düşüncelerine sessizce karışacak.', 'Gün sona erdi; ama keşfedilecek dünyaların sayısı hiç azalmadı.', 'Yarın yeni bir gün, rafta ise yeni bir macera bekliyor.'],
};
const SKIP_MESSAGES = {
  midnight: ["🌙 Gece yarısı oldu, kitap hâlâ kapalı.", "😴 Gün kitapsız bitmek üzere."],
  deepNight: ["🌌 Gece de kitapsız geçiyor.", "💤 Bugünlük pas geçti."],
  preDawn: ["😅 Sabaha karşı olmuş ama kitap açılmamış.", "🥱 Gün bitmeden bir şans daha var."],
  dawn: ["😅 Sabah olmuş ama kitap henüz açılmamış.", "🥱 Sabah biraz mola verdi."],
  morning: ["☁️ Bugünkü sayfalar bekliyor.", "🙈 Sabah kitaba vakit bulamadı."],
  lateMorning: ["🙈 Öğleye yaklaşıldı, kitap hâlâ kapalı.", "⏳ Sabah kitaba vakit ayıramadı."],
  midday: ["🙈 Öğlen oldu, kitap hâlâ kapalı.", "⏳ Vakit bulamadı bugün."],
  afternoon: ["📵 Bugün araya bir şey girdi.", "😬 Öğleden sonra da olmadı."],
  lateAfternoon: ["📚 Kitap masada bekliyor.", "😬 İkindi de geçti, okuyamadı."],
  evening: ["😬 Akşam oldu, henüz okumadı.", "🌆 Gün bitmeden bir fırsat kalsın."],
  dusk: ["📚 Kitap masada bekliyor.", "😴 Akşam da geçti, okuyamadı."],
  night: ["😴 Bugün kitapsız geçti.", "🌙 Yarın telafi vakti."]
};
function timeBucket(hour){
  if(hour>=0 && hour<2) return 'midnight';
  if(hour>=2 && hour<4) return 'deepNight';
  if(hour>=4 && hour<6) return 'preDawn';
  if(hour>=6 && hour<8) return 'dawn';
  if(hour>=8 && hour<10) return 'morning';
  if(hour>=10 && hour<12) return 'lateMorning';
  if(hour>=12 && hour<14) return 'midday';
  if(hour>=14 && hour<16) return 'afternoon';
  if(hour>=16 && hour<18) return 'lateAfternoon';
  if(hour>=18 && hour<20) return 'evening';
  if(hour>=20 && hour<22) return 'dusk';
  return 'night';
}
async function getLastPostMessageOfType(type){
  try{
    const snap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), limit(15)));
    let found = null;
    snap.forEach(d=>{ if(!found && d.data().type===type) found = d.data().variantText; });
    return found;
  }catch(e){ return null; }
}
async function pickVariantMessage(type){
  const hour = new Date().getHours();
  const pool = type==='read' ? READ_MESSAGES_BY_HOUR[hour] : SKIP_MESSAGES[timeBucket(hour)];
  const lastText = await getLastPostMessageOfType(type);
  const candidates = lastText ? pool.filter(m=>m!==lastText) : pool;
  const finalPool = candidates.length ? candidates : pool;
  return finalPool[Math.floor(Math.random()*finalPool.length)];
}
async function createPost(type, data, forUid, forName){
  try{
    await addDoc(collection(db,'posts'), {
      type, uid: forUid||currentUid, name: forName||myProfile.name,
      createdAt: new Date().toISOString(), commentCount: 0,
      ...data
    });
  }catch(e){ console.error('Gönderi oluşturulamadı:', e); }
}
const BATCHABLE_TYPES = {
  book_review: { batchType:'book_review_batch', extract:(p)=>({ bookTitle:p.bookTitle, bookAuthor:p.bookAuthor, bookCover:p.bookCover, rating:p.rating, reviewText:p.reviewText, at:p.createdAt }) },
  book_added: { batchType:'book_added_batch', extract:(p)=>({ bookTitle:p.bookTitle, bookAuthor:p.bookAuthor, bookCover:p.bookCover, at:p.createdAt }) }
};
async function deleteReadPostsRetroactively(){
  if(!confirm('Akıştaki tüm geçmiş "okudum" gönderileri silinecek. Bu geri alınamaz. Devam edilsin mi?')) return;
  const resultEl = document.getElementById('settingsDeleteReadPostsResult');
  if(resultEl) resultEl.textContent = window.BH_I18N.pick("Taranıyor…","Scanning…");
  showToast('Geçmiş "okudum" gönderileri taranıyor…');
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('type','==','read')));
    const ids = [];
    snap.forEach(d=> ids.push(d.id));
    await Promise.all(ids.map(id=> deleteDoc(doc(db,'posts',id))));
    if(resultEl) resultEl.textContent = `${ids.length} "okudum" gönderisi silindi.`;
    showToast(`${ids.length} "okudum" gönderisi silindi.`);
    renderTimelineTab();
    renderPinnedPostBar();
  }catch(e){
    console.error('Okudum gönderileri silinemedi:', e);
    if(resultEl) resultEl.textContent = window.BH_I18N.pick("Silinirken bir hata oluştu.","An error occurred while deleting.");
    showToast(window.BH_I18N.pick("Silinirken bir hata oluştu.","An error occurred while deleting."));
  }
}
async function migrateBatchPostsRetroactively(){
  if(!confirm('Bu işlem, geçmişteki tekli kitap puanlama/ekleme gönderilerinden aynı kişiye ait ve birbirine 1 saatten yakın olanları birleştirecek. Bu geri alınamaz (birleşenler silinip tek gönderiye dönüşür). Devam edilsin mi?')) return;
  showToast('Geçmiş gönderiler taranıyor…');
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('type','in',['book_review','book_added'])));
    const posts = [];
    snap.forEach(d=> posts.push({id:d.id, ...d.data()}));
    const groups = {};
    posts.forEach(p=>{
      const key = p.uid+'|'+p.type;
      if(!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    let mergedPostCount = 0, groupCount = 0;
    async function commitChain(chain){
      if(chain.length<2) return;
      groupCount++;
      mergedPostCount += chain.length;
      const type = chain[0].type;
      const cfg = BATCHABLE_TYPES[type];
      const items = chain.map(p=> cfg.extract(p));
      const last = chain[chain.length-1];
      await updateDoc(doc(db,'posts',last.id), { type: cfg.batchType, items, createdAt: last.createdAt });
      await Promise.all(chain.slice(0,-1).map(p=> deleteDoc(doc(db,'posts',p.id))));
    }
    for(const key in groups){
      const arr = groups[key].slice().sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
      let chain = [arr[0]];
      for(let i=1;i<arr.length;i++){
        const prev = chain[chain.length-1];
        const gapMs = new Date(arr[i].createdAt) - new Date(prev.createdAt);
        if(gapMs <= 60*60*1000){
          chain.push(arr[i]);
        } else {
          await commitChain(chain);
          chain = [arr[i]];
        }
      }
      await commitChain(chain);
    }
    showToast(window.BH_I18N.template`Tamamlandı! ${groupCount} grup birleştirildi (${mergedPostCount} eski gönderi).`);
    if(activeTab==='social') renderTimelineTab();
  }catch(err){ alert('Hata: '+(err.message||err)); }
}
export async function createOrBatchPost(singleType, itemData){
  const cfg = BATCHABLE_TYPES[singleType];
  try{
    const oneHourAgoMs = Date.now() - 60*60*1000;
    const snap = await getDocs(query(collection(db,'posts'), where('uid','==',currentUid), limit(30)));
    let candidates = [];
    snap.forEach(d=>{
      const data = d.data();
      if(data.type===singleType || data.type===cfg.batchType) candidates.push({id:d.id, ...data});
    });
    candidates.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
    const existing = candidates[0];
    const isRecent = existing && (new Date(existing.createdAt).getTime() >= oneHourAgoMs);
    const itemWithTime = { ...itemData, at: new Date().toISOString() };
    if(existing && isRecent){
      if(existing.type === cfg.batchType){
        const newItems = [...(existing.items||[]), itemWithTime];
        await updateDoc(doc(db,'posts',existing.id), { items:newItems, createdAt:new Date().toISOString() });
      } else {
        const firstItem = cfg.extract(existing);
        const newItems = [firstItem, itemWithTime];
        await updateDoc(doc(db,'posts',existing.id), { type: cfg.batchType, items:newItems, createdAt:new Date().toISOString() });
      }
      return;
    }
    await createPost(singleType, itemData);
  }catch(e){
    console.error('Gönderi birleştirilemedi, tekli oluşturuluyor:', e);
    await createPost(singleType, itemData);
  }
}
function exactTimeLabel(iso){
  const d = new Date(iso);
  const months = [window.BH_I18N.pick("Ocak","January"),window.BH_I18N.pick("Şubat","February"),window.BH_I18N.pick("Mart","March"),window.BH_I18N.pick("Nisan","April"),window.BH_I18N.pick("Mayıs","May"),window.BH_I18N.pick("Haziran","June"),window.BH_I18N.pick("Temmuz","July"),window.BH_I18N.pick("Ağustos","August"),window.BH_I18N.pick("Eylül","September"),window.BH_I18N.pick("Ekim","October"),window.BH_I18N.pick("Kasım","November"),window.BH_I18N.pick("Aralık","December")];
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
function timeAgoLabel(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs/60000);
  if(mins < 1) return window.BH_I18N.pick("az önce","just now");
  if(mins < 60) return window.BH_I18N.template`${mins} dk önce`;
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return window.BH_I18N.template`${hrs} sa önce`;
  const days = Math.floor(hrs/24);
  if(days < 10) return window.BH_I18N.template`${days} gün önce`;
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`;
}
// Reddit tarzı: her gönderinin kalın bir BAŞLIĞI, altında da açıklayıcı gövde metni var.
// Kullanıcı gönderilerinde başlığı kişi kendisi giriyor (p.title); sistem gönderilerinde ve
// anketlerde burada sabit/otomatik bir başlık üretiliyor.
// Translate automatic activity at render time. Stored posts and user-authored text stay untouched.
function automaticPostTitleEn(p){
 const titles={read:'✓ Read today',skip:'😴 Missed reading',badge_gained:'🏅 Badge earned',badge_lost:'💔 Badge lost',gift_won:'🎁 Book gift won',gift_requested:'📮 Gift request',gift_completed:'🎉 Gift received',new_member:'👋 New member',book_review:'⭐ Book rated',book_review_batch:'⭐ Book ratings',book_added:'📖 Added to library',book_added_batch:'📖 Added to library',record_dethrone:'👑 New record',no_lottery:'🍀 No draw needed',rec_personal:'💡 Book recommendation',rec_group:'💡 Club recommendation'};
 const quarterly={nominations_open:'📚 Nominations open',nominations_near_end:'⏰ Nominations closing',objecting_open:'🔎 Objections open',objecting_near_end:'⏰ Objections closing',objection_made:'🙅 Objection submitted',nomination_made:'📖 New nomination',round_start:'🗳️ Voting round started',round_near_end:'⏰ Voting closing',round_result:'📊 Round results',final_winner:'🏆 Shared book selected',gift_lottery_drawn:'🎁 Gift draw completed',gift_lottery_applied:'🎁 Shared book gifts confirmed',discussion_opened:'💬 Discussion opened'};
 return p.type==='quarterly_pick'?(quarterly[p.subtype]||'📚 Shared book'):(titles[p.type]??null);
}
function automaticPostBodyEn(p){
 const book=escapeHtml(p.bookTitle||'');
 const cover=p.bookCover?`<img src="${escapeHtml(p.bookCover)}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml((p.bookAuthor?p.bookAuthor+' - ':'')+(p.bookTitle||''))}" data-book-cover="${escapeHtml(p.bookCover)}" />`:'';
 const bookRow=text=>`<div style="display:flex;gap:10px;align-items:center;">${cover}<div style="min-width:0;">${text}</div></div>`;
 const quantity=(n,one,many)=>`${escapeHtml(String(n))} ${n===1?one:many}`;
 const badgeDef=BADGE_DEFS.find(b=>b.key===p.badgeKey);
 const badge=badgeDef?`${badgeDef.days}-day reading streak badge`:'reading streak badge';
 switch(p.type){
  case 'read':return '📖 Read today.';
  case 'skip':return '😴 Did not read today.';
  case 'badge_gained':return `🏅 Earned the <b>${escapeHtml(badge)}</b>!`;
  case 'badge_lost':return `💔 Lost the <b>${escapeHtml(badge)}</b>.`;
  case 'gift_won':return '🎁 Won a book gift in the draw!';
  case 'gift_requested':return `📮 Requested <b>${book}</b> from ${userChipHtml(p.giverUid)}.`;
  case 'gift_completed':return '🎉 Received their book gift!';
  case 'new_member':return '👋 Joined the club. Welcome!';
  case 'book_review':return bookRow(`<b>${book}</b><div style="color:var(--gold);font-size:13px;margin:2px 0;">⭐ Rated ${escapeHtml(String(p.rating??''))}/10</div>${p.reviewText?`<div class="muted" style="font-size:13px;">“${escapeHtml(p.reviewText)}”</div>`:''}`);
  case 'book_review_batch':return `⭐ Rated ${quantity((p.items||[]).length,'book','books')}. <span class="muted" style="font-size:12px;">(tap for details)</span>`;
  case 'book_added':return bookRow(`📖 Added <b>${book}</b> to their library.`);
  case 'book_added_batch':return `📖 Added ${quantity((p.items||[]).length,'book','books')} to their library. <span class="muted" style="font-size:12px;">(tap for details)</span>`;
  case 'record_dethrone':return `👑 Surpassed <b>${escapeHtml(p.dethronedName||'')}</b> in <b>${escapeHtml(window.BH_I18N.label(p.recordLabel||'record total'))}</b>: ${escapeHtml(String(p.recordCount??''))}.`;
  case 'no_lottery':return `🍀 No penalties this week${p.weekLabel?` (${escapeHtml(p.weekLabel)})`:''}, so no draw was needed!`;
  case 'rec_personal':return `✎ Recommended a book to <b>${escapeHtml(p.toName||'')}</b>.`;
  case 'rec_group':return bookRow(`✎ Recommended <b>${book}</b> to the club.`);
  case 'quarterly_pick':{
   switch(p.subtype){
    case 'nominations_open':return `📚 Nominations for the next shared book are open! Nominate up to 3 books over ${quantity(p.days||2,'day','days')} in the shared book selection section.`;
    case 'nominations_near_end':return '⏰ Only 2 hours left to nominate a shared book. Add your nomination now!';
    case 'objecting_open':return '🔎 The 1-day objection period has started. If you have recently read a nominated book, submit an objection in the shared book selection section.';
    case 'objecting_near_end':return '⏰ The objection period ends in 2 hours.';
    case 'objection_made':return `<b>${escapeHtml(p.name||'')}</b> objected to <b>${book}</b> because they read it recently. The book was removed from the nominations.`;
    case 'nomination_made':return bookRow(`<b>${escapeHtml(p.name||'')}</b> nominated <b>${book}</b>${p.bookAuthor?` (${escapeHtml(p.bookAuthor)})`:''}.`);
    case 'round_start':{
     const round=p.round===p.totalRounds?'Final':p.round===p.totalRounds-1?'Semifinal':`Round ${escapeHtml(String(p.round??''))}`;
     return `${round} voting has started${p.matchCount?` with ${quantity(p.matchCount,'match','matches')}`:''}! Vote in the shared book selection section.`;
    }
    case 'round_near_end':return '⏰ Voting in this round ends in 2 hours.';
    case 'round_result':return `This round has ended! Advancing to the next round: ${(p.results||[]).map(r=>escapeHtml(r.title||'')).join(', ')}.`;
    case 'final_winner':return `🏆 Our shared book is <b>${book}</b>! We will read it over the next 3 months.`;
    case 'discussion_opened':return `💬 Discussion is open for <b>${book}</b>! Submit the completion form to see everyone’s answers and join the conversation.`;
    case 'gift_lottery_drawn':return `🎁 The draw for members who did not finish the shared book is complete. ${quantity(p.pairCount||0,'member will','members will')} give a book. The gift book will be decided after the next shared book selection.`;
    case 'gift_lottery_applied':return `🎁 The shared book gifts have been confirmed: <b>${book}</b>! See the Gifts section for details.`;
    default:return 'Shared book selection updated.';
   }
  }
  default:return null;
 }
}

function postTitleFor(p){
  if(window.BH_I18N.language==='en'){const title=automaticPostTitleEn(p);if(title!==null)return title;}

  if(p.type==='user_post') return p.title ? escapeHtml(p.title) : null;
  if(p.type==='poll') return `📊 ${escapeHtml(p.question||window.BH_I18N.pick("Anket","Poll"))}`;
  const T = {
    read: '✓ Bugün Okudu',
    skip: '😴 Bugün Okuyamadı',
    badge_gained: '🏅 Rozet Kazandı',
    badge_lost: '💔 Rozet Kaybetti',
    gift_won: '🎁 Hediye Kazandı',
    gift_requested: '📮 Hediye İsteği',
    gift_completed: '🎉 Hediyeye Kavuştu',
    new_member: '👋 Yeni Üye',
    book_review: '⭐ Kitap Puanladı',
    book_review_batch: '⭐ Kitap Puanlamaları',
    book_added: '📖 Kitaplığa Ekledi',
    book_added_batch: '📖 Kitaplığa Ekledi',
    record_dethrone: '👑 Rekor Kırıldı',
    no_lottery: '🍀 Kura Çekilmedi',
    rec_personal: '💡 Kitap Önerdi',
    rec_group: '💡 Gruba Öneri',
  };
  if(p.type==='quarterly_pick'){
    const QT = {
      nominations_open: '📚 Öneriler Başladı',
      nominations_near_end: '⏰ Öneri Süresi Bitiyor',
      objecting_open: '🔎 İtiraz Süresi Başladı',
      objecting_near_end: '⏰ İtiraz Süresi Bitiyor',
      objection_made: '🙅 İtiraz Edildi',
      nomination_made: '📖 Yeni Öneri',
      round_start: '🗳️ Oylama Turu Başladı',
      round_near_end: '⏰ Tur Bitiyor',
      round_result: '📊 Tur Sonuçlandı',
      final_winner: '🏆 Ortak Kitap Seçildi',
      gift_lottery_drawn: '🎁 Hediye Kurası Çekildi',
      gift_lottery_applied: '🎁 Ortak Kitap Hediyeleri Belli Oldu',
      discussion_opened: '💬 Tartışma Açıldı',
    };
    return QT[p.subtype] || '📚 Ortak Kitap';
  }
  return T[p.type] || null;
}
function postBodyHtml(p, expanded){
  if(window.BH_I18N.language==='en'){const body=automaticPostBodyEn(p);if(body!==null)return body;}

  const name = escapeHtml(p.name||'');
  switch(p.type){
    case 'read': return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px; margin-right:5px; flex:0 0 auto;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>${p.variantText ? escapeHtml(p.variantText) : window.BH_I18N.pick("Bugün okudu.","Read today.")}`;
    case 'skip': return p.variantText ? escapeHtml(p.variantText) : `😴 Bugün okuyamadı.`;
    case 'badge_gained': return p.variantText ? escapeHtml(p.variantText) : `${p.badgeIcon||'🏅'} <b>${escapeHtml(p.badgeLabel||'')}</b> rozetini kazandı!`;
    case 'badge_lost': return p.variantText ? escapeHtml(p.variantText) : `💔 <b>${escapeHtml(p.badgeLabel||'')}</b> rozetini kaybetti.`;
    case 'gift_won': return p.variantText ? escapeHtml(p.variantText) : `🎁 Bu hafta hediye kitap kazandı!`;
    case 'gift_requested': return `📮 ${userChipHtml(p.giverUid)} kişisinden <b>${escapeHtml(p.bookTitle||'')}</b> istedi.`;
    case 'gift_completed': return p.variantText ? escapeHtml(p.variantText) : `🎉 Hediye kitabına kavuştu!`;
    case 'new_member': return `👋 Kulübe katıldı, hoş geldin!`;
    case 'book_review': {
      const cover = p.bookCover ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml((p.bookAuthor?p.bookAuthor+' - ':'')+(p.bookTitle||''))}" data-book-cover="${escapeHtml(p.bookCover)}" />` : '';
      return `<div style="display:flex; gap:10px;">${cover}<div style="min-width:0;"><b>${escapeHtml(p.bookTitle||'')}</b><div style="color:var(--gold); font-size:13px; margin:2px 0;">⭐ ${p.rating}/10 verdi</div>${p.reviewText?`<div class="muted" style="font-size:13px;">"${escapeHtml(p.reviewText)}"</div>`:''}</div></div>`;
    }
    case 'book_review_batch': return window.BH_I18N.template`⭐ ${(p.items||[]).length} kitap puanlaması yaptı. <span class="muted" style="font-size:12px;">(detaylar için tıkla)</span>`;
    case 'user_post': {
      const txt = p.text ? escapeHtml(p.text).replace(/\n/g,'<br/>') : '';
      const img = p.image ? `<img src="${p.image}" alt="" style="max-width:100%; border-radius:10px; margin-top:8px; display:block;" />` : '';
      return `${txt}${img}`;
    }
    case 'book_added': {
      const cover = p.bookCover ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml((p.bookAuthor?p.bookAuthor+' - ':'')+(p.bookTitle||''))}" data-book-cover="${escapeHtml(p.bookCover)}" />` : '';
      const addedSuffix = turkishAccusativeName(p.bookTitle||'').split("'").pop();
      return window.BH_I18N.template`<div style="display:flex; gap:10px; align-items:center;">${cover}<div>📖 Kitaplığına <b>${escapeHtml(p.bookTitle||'')}</b>'${addedSuffix} ekledi.</div></div>`;
    }
    case 'book_added_batch': return window.BH_I18N.template`📖 Kitaplığına ${(p.items||[]).length} kitap ekledi. <span class="muted" style="font-size:12px;">(detaylar için tıkla)</span>`;
    case 'record_dethrone': return `👑 ${p.recordIcon||'🏆'} <b>${escapeHtml(p.recordLabel||'')}</b> rekorunda <b>${escapeHtml(p.dethronedName||'')}</b>'ı geçti! (${p.recordCount})`;
    case 'no_lottery': return `🍀 Bu hafta (${escapeHtml(p.weekLabel||'')}) kimse cezalı olmadı, kura çekilmedi!`;
    case 'rec_personal': return `✎ ${turkishDativeName(escapeHtml(p.toName||''))} kitap önerdi.`;
    case 'rec_group': {
      const cover = p.bookCover ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml(p.bookTitle||'')}" data-book-cover="${escapeHtml(p.bookCover)}" />` : '';
      const recSuffix = turkishAccusativeName(p.bookTitle||'').split("'").pop();
      return window.BH_I18N.template`<div style="display:flex; gap:10px; align-items:center;">${cover}<div>✎ Gruba <b>${escapeHtml(p.bookTitle||'')}</b>'${recSuffix} önerdi.</div></div>`;
    }
    case 'poll': return pollBodyHtml(p, expanded);
    case 'quarterly_pick': {
      const sub = p.subtype;
      if(sub==='nominations_open') return `📚 Yeni ortak kitap önerileri başladı! ${p.days||2} gün içinde en fazla 3 kitap önerebilirsin. "Kulüp → Ortak kitap" bölümünden katılabilirsin.`;
      if(sub==='nominations_near_end') return `⏰ Ortak kitap önerileri için son 2 saat! Önerecek kitabın varsa şimdi ekle.`;
      if(sub==='objecting_open') return `🔎 1 günlük itiraz süresi başladı — bir kitabı yakın zamanda okuduysan "Kulüp → Ortak kitap" bölümünden itiraz edebilirsin.`;
      if(sub==='objecting_near_end') return `⏰ İtiraz süresi bitmek üzere (2 saat kaldı).`;
      if(sub==='objection_made') return `<b>${escapeHtml(p.name||'')}</b>, "${escapeHtml(p.bookTitle||'')}" kitabına itiraz etti (yakın zamanda okumuş) — öneriden düştü.`;
      if(sub==='nomination_made'){
        const cover = p.bookCover
          ? `<img src="${p.bookCover}" alt="" class="post-book-cover book-cover-clickable" data-book-title="${escapeHtml(p.bookTitle||'')}" data-book-cover="${escapeHtml(p.bookCover)}" />`
          : `<span class="post-book-cover" style="display:inline-block; overflow:hidden; border-radius:6px;">${materialBookCover(p.bookTitle,'')}</span>`;
        return window.BH_I18N.template`<div style="display:flex; gap:10px; align-items:center;">${cover}<div><b>${escapeHtml(p.name||'')}</b> bir kitap önerdi: <b>${escapeHtml(p.bookTitle||'')}</b>${p.bookAuthor?` (${escapeHtml(p.bookAuthor)})`:''}</div></div>`;
      }
      if(sub==='round_start'){
        const label = p.round===p.totalRounds ? 'Final' : (p.round===(p.totalRounds-1) ? window.BH_I18N.pick("Yarı final","Semifinal") : `${p.round}. tur`);
        return `${label} oylaması başladı! ${p.matchCount||''} eşleşme var, "Kulüp → Ortak kitap" bölümünden oy verebilirsin.`;
      }
      if(sub==='round_near_end') return window.BH_I18N.template`Bu turun oylaması bitmek üzere (2 saat kaldı).`;
      if(sub==='round_result'){
        const winners = (p.results||[]).map(r=>escapeHtml(r.title)).join(', ');
        return `Tur sona erdi! Bir üst tura geçenler: ${winners}`;
      }
      if(sub==='final_winner') return `Ortak kitap seçildi: <b>"${escapeHtml(p.bookTitle||'')}"</b>! 3 ay boyunca bunu okuyacağız.`;
      if(sub==='discussion_opened') return `"${escapeHtml(p.bookTitle||'')}" için tartışma açıldı! Bitirme formunu doldurduysan herkesin cevaplarını görebilir, sohbete katılabilirsin.`;
      if(sub==='gift_lottery_drawn') return `Ortak kitabı bitirmeyenler için hediye kurası çekildi (${p.pairCount||0} kişi hediye verecek) — hangi kitap olacağı bir sonraki ortak kitap seçimi tamamlanınca belli olacak.`;
      if(sub==='gift_lottery_applied') return `Ortak kitap hediyeleri belli oldu: <b>"${escapeHtml(p.bookTitle||'')}"</b>! "Hediye Kitap" sekmesinden bakabilirsin.`;
      return window.BH_I18N.pick("Ortak kitap seçimi güncellendi.","Shared book selection updated.");
    }
    default: return escapeHtml(p.text||'');
  }
}
// Anket gövdesi: WhatsApp tarzı — her seçenek tıklanabilir bir satır, oy sayısına göre arkada bir
// dolgu çubuğu var, kullanıcının kendi oyu vurgulanıyor. Toplam oy sayısı altta gösteriliyor.
function pollVoterAvatarsHtml(voters){
  if(!voters || !voters.length) return '';
  const maxShow = 4;
  const shown = voters.slice(0, maxShow);
  const extra = voters.length - maxShow;
  const circles = shown.map((uid,i)=>{
    const u = usersCache[uid] || {};
    const name = u.name || '?';
    const inner = profilePhotoHtml(u, 9);
    return `<span class="poll-voter-avatar" style="z-index:${maxShow-i};" title="${escapeHtml(name)}">${inner}</span>`;
  }).join('');
  const extraHtml = extra>0 ? `<span class="poll-voter-avatar poll-voter-extra">+${extra}</span>` : '';
  return `<div class="poll-option-voters">${circles}${extraHtml}</div>`;
}
function pollBodyHtml(p, expanded){
  const options = p.options || [];
  const totalVotes = options.reduce((sum,o)=> sum + (o.voters||[]).length, 0);
  const myVoteIdx = options.findIndex(o=> (o.voters||[]).includes(currentUid));
  const rows = options.map((o,i)=>{
    const count = (o.voters||[]).length;
    const pct = totalVotes>0 ? Math.round(count/totalVotes*100) : 0;
    const voted = i===myVoteIdx;
    // Oy verenlerin profil resimleri (sırayla, oy veriliş sırasında) sadece gönderi büyütülüp
    // açıldığında (expanded), o seçeneğin sağ tarafında gösteriliyor — akıştaki küçük kartta değil.
    const voterAvatars = expanded ? pollVoterAvatarsHtml(o.voters) : '';
    return `<div class="poll-option-row${voted?' voted':''}" data-poll-post="${p.id}" data-poll-option="${i}">
      <div class="poll-option-fill" style="width:${pct}%;"></div>
      <div class="poll-option-content">
        <span class="poll-option-text">${voted?'✓ ':''}${escapeHtml(o.text)}</span>
        <div class="poll-option-right">
          ${voterAvatars}
          <span class="poll-option-pct">${totalVotes>0?pct+'%':''}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  const img = p.image ? `<img src="${p.image}" alt="" style="max-width:100%; border-radius:10px; margin-bottom:8px; display:block;" />` : '';
  return `${img}${rows}<div class="poll-total-votes">${totalVotes} oy</div>`;
}
async function voteOnPoll(postId, optionIdx){
  if(!postId || Number.isNaN(optionIdx)) return;
  try{
    await runTransaction(db, async (tx)=>{
      const ref = doc(db,'posts',postId);
      const snap = await tx.get(ref);
      if(!snap.exists()) return;
      const data = snap.data();
      const options = (data.options||[]).map(o=> ({...o, voters:[...(o.voters||[])]}));
      const alreadyVotedIdx = options.findIndex(o=> o.voters.includes(currentUid));
      if(alreadyVotedIdx===optionIdx){
        // Aynı seçeneğe tekrar basıldı: oyu geri çeker.
        options[optionIdx].voters = options[optionIdx].voters.filter(u=>u!==currentUid);
      } else {
        if(alreadyVotedIdx!==-1) options[alreadyVotedIdx].voters = options[alreadyVotedIdx].voters.filter(u=>u!==currentUid);
        options[optionIdx].voters.push(currentUid);
      }
      tx.update(ref, {options});
    });
  }catch(e){ console.error('Oy verilemedi:', e); alert('Oy verilemedi: '+(e.message||e)); }
}
function isPostPinned(p){
  return !!(p.pinnedUntil && new Date(p.pinnedUntil).getTime() > Date.now());
}
function myReactionEmoji(reactions){
  if(!reactions) return null;
  for(const em of Object.keys(reactions)){
    if((reactions[em]||[]).includes(currentUid)) return em;
  }
  return null;
}
// Bir tepki verildiğinde/değiştirildiğinde, o gönderinin tepki hapına kısa bir zıplama
// animasyonu ekler.
function burstMyReactionBadge(target){
  const badge = document.querySelector(`[data-target="${target}"].reaction-add-btn`) || document.querySelector(`.my-reaction-badge[data-target="${target}"]`);
  if(badge){ badge.classList.add('reaction-burst'); setTimeout(()=>badge.classList.remove('reaction-burst'), 300); }
}
// ============ GÖNDERİLER İÇİN REDDİT TARZI BEĞEN/BEĞENME HAPI (yorumlar/öneriler hâlâ emoji
// tepki sistemini kullanıyor, bu sadece gönderilerin kendisi için). ============
function postVoteRowHtml(p){
  const up = (p.votes && p.votes.up) || [];
  const down = (p.votes && p.votes.down) || [];
  const score = up.length - down.length;
  const myUp = up.includes(currentUid), myDown = down.includes(currentUid);
  return window.BH_I18N.template`<div class="post-vote-row" data-vote-rail="${p.id}">
    <button type="button" class="post-vote-btn up${myUp?' active':''}" data-vote-post="${p.id}" data-dir="up" title="Beğen">▲</button>
    <span class="post-vote-score${myUp?' voted-up':myDown?' voted-down':''}" data-vote-score>${score}</span>
    <button type="button" class="post-vote-btn down${myDown?' active':''}" data-vote-post="${p.id}" data-dir="down" title="Beğenme">▼</button>
  </div>`;
}
// Reddit'teki "repost" hapının yerinde duran, tek bir kompakt emoji-tepki hapı — kendi tepkini
// (varsa) gösterir, tıklayınca tepki seçicisi açılır (mevcut .reaction-add-btn mekanizması).
function postReactionPillHtml(p){
  const reactions = p.reactions || {};
  const myReaction = myReactionEmoji(reactions);
  const totalCount = Object.values(reactions).reduce((sum,arr)=> sum + ((arr&&arr.length)||0), 0);
  return `<button type="button" class="post-action-btn reaction-add-btn" data-target="post:${p.id}">${myReaction||'🙂'}${totalCount>0?` ${totalCount}`:''}</button>`;
}
// Tıklanır tıklanmaz ekranı anında günceller (Firestore yazması arka planda gidiyor) — oy
// verme hiçbir zaman gecikmeli hissettirmesin diye.
function applyOptimisticVoteUI(railEl, dir){
  const upBtn = railEl.querySelector('.post-vote-btn.up');
  const downBtn = railEl.querySelector('.post-vote-btn.down');
  const scoreEl = railEl.querySelector('[data-vote-score]');
  let score = parseInt(scoreEl.textContent,10) || 0;
  const wasUp = upBtn.classList.contains('active');
  const wasDown = downBtn.classList.contains('active');
  if(dir==='up'){
    if(wasUp){ score -= 1; upBtn.classList.remove('active'); }
    else { score += wasDown ? 2 : 1; upBtn.classList.add('active'); downBtn.classList.remove('active'); }
  } else {
    if(wasDown){ score += 1; downBtn.classList.remove('active'); }
    else { score -= wasUp ? 2 : 1; downBtn.classList.add('active'); upBtn.classList.remove('active'); }
  }
  scoreEl.textContent = score;
  scoreEl.classList.remove('voted-up','voted-down');
  if(upBtn.classList.contains('active')) scoreEl.classList.add('voted-up');
  if(downBtn.classList.contains('active')) scoreEl.classList.add('voted-down');
}
function wireVoteButtons(container){
  container.querySelectorAll('.post-vote-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const postId = btn.dataset.votePost;
      const dir = btn.dataset.dir;
      const rail = btn.closest('[data-vote-rail]');
      applyOptimisticVoteUI(rail, dir);
      setPostVote(postId, dir);
    });
  });
}
async function setPostVote(postId, dir){
  const ref = doc(db,'posts',postId);
  let notifyUid = null;
  try{
    await runTransaction(db, async(tx)=>{
      const snap = await tx.get(ref);
      if(!snap.exists()) return;
      const data = snap.data();
      const up = ((data.votes&&data.votes.up)||[]).filter(u=>u!==currentUid);
      const down = ((data.votes&&data.votes.down)||[]).filter(u=>u!==currentUid);
      const wasUp = ((data.votes&&data.votes.up)||[]).includes(currentUid);
      const wasDown = ((data.votes&&data.votes.down)||[]).includes(currentUid);
      if(dir==='up' && !wasUp) up.push(currentUid);
      if(dir==='down' && !wasDown) down.push(currentUid);
      tx.update(ref, {'votes.up':up, 'votes.down':down});
      if(dir==='up' && !wasUp && data.uid && data.uid!==currentUid) notifyUid = data.uid;
    });
    if(notifyUid) notifyUser(notifyUid, `${myProfile.name} gönderini beğendi.`, 'social', postId);
  }catch(err){ alert('Oy verilemedi: '+(err.message||err)); }
}
// Gönderinin önemine göre görsel ağırlık sınıfı: manuel yazılan gönderiler en büyük, kitap
// ekleme/puanlama gönderileri orta, geri kalan her şey (rozet, hediye, sistem gönderileri vb.)
// varsayılan boyutta kalıyor.
function postWeightClass(p){
  if(p.type==='user_post') return 'weight-high';
  if(p.type==='book_review' || p.type==='book_review_batch' || p.type==='book_added' || p.type==='book_added_batch') return 'weight-medium';
  return '';
}
function renderPostCard(p){
  const canDelete = p.uid===currentUid || myProfile.role==='admin';
  const canEdit = p.uid===currentUid && p.type==='user_post';
  const pinned = isPostPinned(p);
  return window.BH_I18N.template`<div class="post-card ${postWeightClass(p)} modal-card-anim" data-post-id="${p.id}">
    <div class="post-inner">
      <div class="post-card-head">
        ${userChipHtml(p.uid)}
        <span class="post-card-time">&middot; ${timeAgoLabel(p.createdAt)}</span>
        ${pinned?`<span title="Sabitlenmiş" style="margin-left:auto; font-size:13px;">📌</span>`:''}
        ${canDelete?`<button type="button" class="post-menu-btn" data-post-menu="${p.id}" data-can-edit="${canEdit?'1':'0'}" data-is-pinned="${pinned?'1':'0'}" style="${pinned?'':'margin-left:auto;'}" title="Seçenekler">⋮</button>`:''}
      </div>
      <div class="post-card-body">${(()=>{const t=postTitleFor(p); return t?`<div class="post-title">${t}</div>`:'';})()}${postBodyHtml(p)}</div>
      <div class="post-actions">
        ${postVoteRowHtml(p)}
        <button type="button" class="post-action-btn post-comment-inline-btn" data-post-id="${p.id}"><span class="post-comment-count">💬 ${p.commentCount||0}</span></button>
        ${postReactionPillHtml(p)}
      </div>
      <div class="post-comments-panel" data-post-id="${p.id}" data-post-uid="${p.uid||''}" data-comment-count="${p.commentCount||0}">
        <div class="rec-comments-label">💬 Yorumlar</div>
        <div class="post-comments-list"><span class="muted">Yükleniyor…</span></div>
        <div class="row" style="margin-top:10px;">
          <input type="text" class="post-comment-inline-input" placeholder="Yorum yaz..." />
          <button type="button" class="secondary tiny post-comment-inline-send" style="flex:0 0 auto;">Gönder</button>
        </div>
      </div>
    </div>
  </div>`;
}
let timelinePostDocs = [];
let timelineAllPosts = [];
let timelineOlderClicks = 0;
const TIMELINE_PAGE_SIZE = 50;
async function renderTimelineTab(){
  renderPinnedPostBar();
  const feed = keepOrLoading('timelineFeed');
  timelinePostDocs = [];
  timelineAllPosts = [];
  timelineOlderClicks = 0;
  try{
    const snap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), limit(60)));
    snap.forEach(d=>{ timelinePostDocs.push(d); timelineAllPosts.push({id:d.id, ...d.data()}); });
  }catch(e){ return; }
  if(!timelineAllPosts.length){ feed.innerHTML = window.BH_I18N.template`<div class="empty-state"><span class="big">📰</span>Henüz gönderi yok. Okuma işaretlemeleri, rozetler ve hediyeler burada görünecek.</div>`; markLoaded(feed); return; }
  renderTimelineFeedHtml(feed);
  markLoaded(feed);
}
function renderTimelineFeedHtml(feed){
  let html = timelineAllPosts.map(p=> renderPostCard(p)).join('');
  const hasMore = timelinePostDocs.length>0 && timelinePostDocs[timelinePostDocs.length-1];
  if(timelineOlderClicks < 5){
    html += window.BH_I18N.template`<div style="text-align:center; padding:16px 0;"><button type="button" class="secondary" id="timelineLoadOlderBtn">⬇️ Daha Eski Gönderileri Gör</button></div>`;
  } else {
    html += window.BH_I18N.template`<div style="text-align:center; padding:16px 0;">
      <div class="muted" style="margin-bottom:8px; font-size:12.5px;">Daha eski gönderiler için bir tarih seç:</div>
      <input type="date" id="timelineJumpDateInput" style="margin-right:6px;" />
      <button type="button" class="secondary" id="timelineJumpDateBtn">Git</button>
    </div>`;
  }
  feed.innerHTML = html;
  wirePostCards(feed, renderTimelineTab);
  const olderBtn = document.getElementById('timelineLoadOlderBtn');
  if(olderBtn) olderBtn.addEventListener('click', async ()=>{
    olderBtn.disabled = true;
    olderBtn.textContent = window.BH_I18N.pick("Yükleniyor…","Loading…");
    const lastDoc = timelinePostDocs[timelinePostDocs.length-1];
    try{
      const snap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), startAfter(lastDoc), limit(TIMELINE_PAGE_SIZE)));
      let gotAny = false;
      snap.forEach(d=>{ gotAny = true; timelinePostDocs.push(d); timelineAllPosts.push({id:d.id, ...d.data()}); });
      timelineOlderClicks++;
      if(!gotAny) showToast(window.BH_I18N.pick("Gösterilecek daha eski gönderi kalmadı.","No older posts to show."));
      renderTimelineFeedHtml(feed);
    }catch(e){ alert(window.BH_I18N.pick("Yüklenemedi: ","Could not load: ")+(e.message||e)); olderBtn.disabled=false; olderBtn.textContent=window.BH_I18N.pick("⬇️ Daha Eski Gönderileri Gör","⬇️ View older posts"); }
  });
  const jumpBtn = document.getElementById('timelineJumpDateBtn');
  if(jumpBtn) jumpBtn.addEventListener('click', async ()=>{
    const dateVal = document.getElementById('timelineJumpDateInput').value;
    if(!dateVal){ alert(window.BH_I18N.pick("Önce bir tarih seç.","Select a date first.")); return; }
    jumpBtn.disabled = true;
    try{
      const cutoff = dateVal + 'T23:59:59.999Z';
      const snap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), where('createdAt','<=',cutoff), limit(60)));
      timelinePostDocs = [];
      timelineAllPosts = [];
      timelineOlderClicks = 0;
      snap.forEach(d=>{ timelinePostDocs.push(d); timelineAllPosts.push({id:d.id, ...d.data()}); });
      if(!timelineAllPosts.length){ showToast(window.BH_I18N.pick("Bu tarihten önce gönderi bulunamadı.","No posts found before this date.")); jumpBtn.disabled=false; return; }
      renderTimelineFeedHtml(feed);
      showToast(`${dateVal} tarihine gidildi.`);
    }catch(e){ alert('Gidilemedi: '+(e.message||e)); jumpBtn.disabled=false; }
  });
}
function openPostMenu(btn, postId, canEdit, refresh, isPinned){
  const isAdmin = myProfile.role==='admin';
  const html = window.BH_I18N.template`
    ${canEdit?window.BH_I18N.template`<button type="button" class="post-menu-item" id="postMenuEditBtn">✏️ Düzenle</button>`:''}
    ${isAdmin ? (isPinned ? window.BH_I18N.template`<button type="button" class="post-menu-item" id="postMenuUnpinBtn">📌 Pini Kaldır</button>` : `<button type="button" class="post-menu-item" id="postMenuPinBtn">📌 Pinle</button>`) : ''}
    <button type="button" class="post-menu-item danger" id="postMenuDeleteBtn">🗑 Kaldır</button>
  `;
  showAnchoredPopover(btn, html);
  const editBtn = document.getElementById('postMenuEditBtn');
  if(editBtn) editBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    openEditPostModal(postId, refresh);
  });
  const pinBtn = document.getElementById('postMenuPinBtn');
  if(pinBtn) pinBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    openPinDurationMenu(postId, refresh);
  });
  const unpinBtn = document.getElementById('postMenuUnpinBtn');
  if(unpinBtn) unpinBtn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    try{ await updateDoc(doc(db,'posts',postId), { pinnedUntil: null }); showToast(window.BH_I18N.pick("Sabitleme kaldırıldı.","Post unpinned.")); refresh(); renderPinnedPostBar(); }catch(err){ alert(window.BH_I18N.pick("Kaldırılamadı: ","Could not remove: ")+(err.message||err)); }
  });
  document.getElementById('postMenuDeleteBtn').addEventListener('click', async (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    if(!confirm(window.BH_I18N.pick("Bu gönderiyi silmek istediğine emin misin?","Are you sure you want to delete this post?"))) return;
    try{ await deleteDoc(doc(db,'posts',postId)); refresh(); renderPinnedPostBar(); }catch(err){ alert('Silinemedi: '+(err.message||err)); }
  });
}
function openPinDurationMenu(postId, refresh){
  const options = [
    {label:'30 dakika', mins:30},
    {label:'1 saat', mins:60},
    {label:'1 gün', mins:1440},
    {label:'1 ay', mins:43200},
    {label:'6 ay', mins:259200}
  ];
  showSimpleInfoModal(window.BH_I18N.template`<h2 style="margin-bottom:10px;">Ne Kadar Sabitlensin?</h2>
    <div style="display:flex; flex-direction:column; gap:4px;">
      ${options.map(o=>`<button type="button" class="post-menu-item" data-pin-mins="${o.mins}">${o.label}</button>`).join('')}
    </div>`);
  document.querySelectorAll('#bookInfoModalBody [data-pin-mins]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const mins = parseInt(b.dataset.pinMins,10);
      const until = new Date(Date.now() + mins*60000).toISOString();
      try{
        await updateDoc(doc(db,'posts',postId), { pinnedUntil: until });
        closeModal('bookInfoModal');
        showToast(window.BH_I18N.pick("Gönderi sabitlendi!","Post pinned!"));
        if(refresh) refresh();
        renderPinnedPostBar();
      }catch(err){ alert('Sabitlenemedi: '+(err.message||err)); }
    });
  });
}
async function renderPinnedPostBar(){
  const bar = document.getElementById('pinnedPostBar');
  if(!bar) return;
  let pinned = null;
  try{
    const snap = await getDocs(query(collection(db,'posts'), where('pinnedUntil','>', new Date().toISOString()), orderBy('pinnedUntil','desc'), limit(1)));
    snap.forEach(d=>{ pinned = {id:d.id, ...d.data()}; });
  }catch(e){ return; }
  if(!pinned){ bar.style.display='none'; bar.innerHTML=''; document.getElementById('timelineFeed').style.marginTop=''; return; }
  const previewText = (pinned.text || postBodyHtml(pinned).replace(/<[^>]+>/g,'')).slice(0,80);
  bar.innerHTML = `<span class="pin-icon">📌</span><span class="pin-author">${escapeHtml(usersCache[pinned.uid]?.name||'')}</span><span class="pin-preview">${escapeHtml(previewText)}</span>`;
  bar.style.display = 'flex';
  document.getElementById('timelineFeed').style.marginTop = '54px';
  positionPinnedPostBar();
  bar.onclick = ()=>{
    const card = document.querySelector(`.post-card[data-post-id="${pinned.id}"]`);
    if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
    else openPostModal(pinned.id);
  };
}
function positionPinnedPostBar(){
  const contentCol = document.getElementById('contentCol');
  const bar = document.getElementById('pinnedPostBar');
  if(!contentCol || !bar) return;
  const rect = contentCol.getBoundingClientRect();
  bar.style.left = (rect.left + 16) + 'px';
  bar.style.width = (rect.width - 32) + 'px';
}
window.addEventListener('resize', positionPinnedPostBar);
function resizeImageToDataUrl(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w > h){ h = Math.round(h * maxDim/w); w = maxDim; }
          else { w = Math.round(w * maxDim/h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
let composeImageDataUrl = null;
// "Konuşmaya Katıl" — tıklanınca pencere açmadan, sayfa üzerinde aşağı doğru genişleyip
// başlık+metin girme alanı çıkıyor. Görsel eklemek istenirse küçük "+" tuşu dosya seçiciyi açıyor.
let jcImageDataUrl = null;
function jcExpand(){
  document.getElementById('joinConversationTrigger').style.display = 'none';
  const form = document.getElementById('joinConversationForm');
  form.style.display = 'block';
  document.getElementById('jcTitleInput').focus();
}
function jcCollapse(){
  document.getElementById('joinConversationTrigger').style.display = 'flex';
  document.getElementById('joinConversationForm').style.display = 'none';
  document.getElementById('jcTitleInput').value = '';
  document.getElementById('jcTextInput').value = '';
  document.getElementById('jcImageInput').value = '';
  jcImageDataUrl = null;
  document.getElementById('jcImagePreviewWrap').style.display = 'none';
}
document.getElementById('joinConversationTrigger').addEventListener('click', jcExpand);
document.getElementById('jcCancelBtn').addEventListener('click', jcCollapse);
document.getElementById('jcImageBtn').addEventListener('click', ()=> document.getElementById('jcImageInput').click());
document.getElementById('jcImageInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try{
    jcImageDataUrl = await resizeImageToDataUrl(file, 800, 0.72);
    document.getElementById('jcImagePreview').src = jcImageDataUrl;
    document.getElementById('jcImagePreviewWrap').style.display = 'block';
  }catch(err){ alert(window.BH_I18N.pick("Görsel işlenemedi: ","Could not process image: ")+(err.message||err)); }
});
document.getElementById('jcImageRemoveBtn').addEventListener('click', ()=>{
  jcImageDataUrl = null;
  document.getElementById('jcImagePreviewWrap').style.display = 'none';
  document.getElementById('jcImageInput').value = '';
});
document.getElementById('jcSendBtn').addEventListener('click', async ()=>{
  const title = document.getElementById('jcTitleInput').value.trim();
  const text = document.getElementById('jcTextInput').value.trim();
  if(!title){ alert(window.BH_I18N.pick("Başlık yazmalısın.","Enter a title.")); return; }
  const btn = document.getElementById('jcSendBtn');
  btn.disabled = true;
  try{
    await createPost('user_post', { title, text, image: jcImageDataUrl||'' });
    await notifyAllMembers(`${myProfile.name} yeni bir gönderi paylaştı.`, 'social', currentUid);
    jcCollapse();
    showToast(window.BH_I18N.pick("Gönderi paylaşıldı!","Post shared!"));
    renderTimelineTab();
  }catch(err){ alert(window.BH_I18N.pick("Paylaşılamadı: ","Could not share: ")+(err.message||err)); }
  finally{ btn.disabled = false; }
});
document.getElementById('composePostBtn').addEventListener('click', ()=>{
  composeImageDataUrl = null;
  let composeMode = 'text';
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Yeni Gönderi</h2>
    <div style="display:flex; gap:6px; margin-bottom:12px;">
      <button type="button" class="secondary tiny compose-mode-btn active" data-mode="text" style="flex:1;">📝 Metin</button>
      <button type="button" class="secondary tiny compose-mode-btn" data-mode="poll" style="flex:1;">📊 Anket</button>
    </div>
    <div id="composeTextMode">
      <input type="text" id="composeTitle" class="compose-poll-input" maxlength="100" placeholder="Başlık" style="margin-bottom:8px;" />
      <textarea id="composeText" class="compose-textarea" maxlength="280" placeholder="Ne düşünüyorsun?"></textarea>
      <div class="muted" id="composeCharCount" style="text-align:right; font-size:11px; margin-top:2px;"></div>
    </div>
    <div id="composePollMode" style="display:none;">
      <input type="text" id="composePollQuestion" placeholder="Anket sorusu" class="compose-poll-input" />
      <div id="composePollOptions" style="margin-top:8px;"></div>
      <button type="button" class="secondary tiny" id="composePollAddOptionBtn" style="margin-top:4px;">+ Seçenek Ekle</button>
    </div>
    <div id="composeImagePreviewWrap" style="display:none; margin-top:10px; text-align:center;">
      <img id="composeImagePreview" src="" style="max-width:100%; border-radius:10px;" />
      <button type="button" class="secondary tiny" id="composeImageRemoveBtn" style="margin-top:6px;">Görseli Kaldır</button>
    </div>
    <input type="file" id="composeImageInput" accept="image/*" style="display:none;" />
    <button type="button" class="secondary tiny" id="composeImageBtn" style="margin-top:10px;">📷 Görsel Ekle</button>
    <div class="row" style="margin-top:12px;">
      <button type="button" class="primary" id="composeSendBtn" style="flex:1;">Paylaş</button>
    </div>
  `);
  document.querySelectorAll('.compose-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      composeMode = btn.dataset.mode;
      document.querySelectorAll('.compose-mode-btn').forEach(b=> b.classList.toggle('active', b===btn));
      document.getElementById('composeTextMode').style.display = composeMode==='text' ? 'block' : 'none';
      document.getElementById('composePollMode').style.display = composeMode==='poll' ? 'block' : 'none';
    });
  });
  function addPollOptionRow(placeholder){
    const container = document.getElementById('composePollOptions');
    const row = document.createElement('div');
    row.className = 'compose-poll-option-row';
    row.innerHTML = window.BH_I18N.template`<input type="text" class="compose-poll-input compose-poll-option" placeholder="${placeholder}" />
      <button type="button" class="compose-poll-option-remove" title="Kaldır">✕</button>`;
    container.appendChild(row);
    row.querySelector('.compose-poll-option-remove').addEventListener('click', ()=>{
      if(container.querySelectorAll('.compose-poll-option-row').length<=2){ showToast(window.BH_I18N.pick("En az 2 seçenek olmalı.","At least 2 options are required.")); return; }
      row.remove();
    });
  }
  addPollOptionRow(window.BH_I18N.pick("Seçenek 1","Option 1"));
  addPollOptionRow(window.BH_I18N.pick("Seçenek 2","Option 2"));
  document.getElementById('composePollAddOptionBtn').addEventListener('click', ()=>{
    const count = document.querySelectorAll('.compose-poll-option-row').length;
    if(count>=8){ showToast(window.BH_I18N.pick("En fazla 8 seçenek eklenebilir.","You can add up to 8 options.")); return; }
    addPollOptionRow(window.BH_I18N.template`Seçenek ${count+1}`);
  });
  const textarea = document.getElementById('composeText');
  const counter = document.getElementById('composeCharCount');
  function updateLimit(){
    const max = composeImageDataUrl ? 140 : 280;
    textarea.maxLength = max;
    if(textarea.value.length > max) textarea.value = textarea.value.slice(0, max);
    counter.textContent = `${max - textarea.value.length} karakter kaldı`;
  }
  textarea.addEventListener('input', updateLimit);
  updateLimit();
  document.getElementById('composeImageBtn').addEventListener('click', ()=> document.getElementById('composeImageInput').click());
  document.getElementById('composeImageInput').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      composeImageDataUrl = await resizeImageToDataUrl(file, 800, 0.72);
      document.getElementById('composeImagePreview').src = composeImageDataUrl;
      document.getElementById('composeImagePreviewWrap').style.display='block';
      updateLimit();
    }catch(err){ alert(window.BH_I18N.pick("Görsel işlenemedi: ","Could not process image: ")+(err.message||err)); }
  });
  document.getElementById('composeImageRemoveBtn').addEventListener('click', ()=>{
    composeImageDataUrl = null;
    document.getElementById('composeImagePreviewWrap').style.display='none';
    document.getElementById('composeImageInput').value = '';
    updateLimit();
  });
  document.getElementById('composeSendBtn').addEventListener('click', async ()=>{
    if(composeMode==='poll'){
      const question = document.getElementById('composePollQuestion').value.trim();
      const options = [...document.querySelectorAll('.compose-poll-option')].map(inp=>inp.value.trim()).filter(Boolean);
      if(!question){ alert(window.BH_I18N.pick("Anket sorusu yazmalısın.","Enter a poll question.")); return; }
      if(options.length<2){ alert(window.BH_I18N.pick("En az 2 seçenek yazmalısın.","Enter at least 2 options.")); return; }
      try{
        await createPost('poll', { question, options: options.map(text=>({text, voters:[]})), image: composeImageDataUrl||'' });
        await notifyAllMembers(`${myProfile.name} bir anket paylaştı: "${question}"`, 'social', currentUid);
        closeModal('bookInfoModal');
        showToast(window.BH_I18N.pick("Anket paylaşıldı!","Poll shared!"));
        renderTimelineTab();
      }catch(err){ alert(window.BH_I18N.pick("Paylaşılamadı: ","Could not share: ")+(err.message||err)); }
      return;
    }
    const title = document.getElementById('composeTitle').value.trim();
    const text = textarea.value.trim();
    if(!title){ alert(window.BH_I18N.pick("Başlık yazmalısın.","Enter a title.")); return; }
    if(!text && !composeImageDataUrl){ alert(window.BH_I18N.pick("Bir şey yazmalısın veya görsel eklemelisin.","Write something or add an image.")); return; }
    try{
      await createPost('user_post', { title, text, image: composeImageDataUrl||'' });
      await notifyAllMembers(`${myProfile.name} yeni bir gönderi paylaştı.`, 'social', currentUid);
      closeModal('bookInfoModal');
      showToast(window.BH_I18N.pick("Gönderi paylaşıldı!","Post shared!"));
      renderTimelineTab();
    }catch(err){ alert(window.BH_I18N.pick("Paylaşılamadı: ","Could not share: ")+(err.message||err)); }
  });
});
async function openEditPostModal(postId, refresh){
  let p = null;
  try{ const snap = await getDoc(doc(db,'posts',postId)); if(snap.exists()) p = {id:postId, ...snap.data()}; }catch(e){}
  if(!p) return;
  composeImageDataUrl = p.image || null;
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Gönderiyi Düzenle</h2>
    <input type="text" id="composeTitle" class="compose-poll-input" maxlength="100" placeholder="Başlık" value="${escapeHtml(p.title||'')}" style="margin-bottom:8px;" />
    <textarea id="composeText" class="compose-textarea" maxlength="280">${escapeHtml(p.text||'')}</textarea>
    <div class="muted" id="composeCharCount" style="text-align:right; font-size:11px; margin-top:2px;"></div>
    <div id="composeImagePreviewWrap" style="${p.image?'':'display:none;'} margin-top:10px; text-align:center;">
      <img id="composeImagePreview" src="${p.image||''}" style="max-width:100%; border-radius:10px;" />
      <button type="button" class="secondary tiny" id="composeImageRemoveBtn" style="margin-top:6px;">Görseli Kaldır</button>
    </div>
    <input type="file" id="composeImageInput" accept="image/*" style="display:none;" />
    <div class="row" style="margin-top:10px;">
      <button type="button" class="secondary tiny" id="composeImageBtn">📷 ${p.image?window.BH_I18N.pick("Görseli Değiştir","Change image"):window.BH_I18N.pick("Görsel Ekle","Add image")}</button>
      <button type="button" class="primary" id="composeSendBtn" style="flex:1;">Kaydet</button>
    </div>
  `);
  const textarea = document.getElementById('composeText');
  const counter = document.getElementById('composeCharCount');
  function updateLimit(){
    const max = composeImageDataUrl ? 140 : 280;
    textarea.maxLength = max;
    if(textarea.value.length > max) textarea.value = textarea.value.slice(0, max);
    counter.textContent = `${max - textarea.value.length} karakter kaldı`;
  }
  textarea.addEventListener('input', updateLimit);
  updateLimit();
  document.getElementById('composeImageBtn').addEventListener('click', ()=> document.getElementById('composeImageInput').click());
  document.getElementById('composeImageInput').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      composeImageDataUrl = await resizeImageToDataUrl(file, 800, 0.72);
      document.getElementById('composeImagePreview').src = composeImageDataUrl;
      document.getElementById('composeImagePreviewWrap').style.display='block';
      updateLimit();
    }catch(err){ alert(window.BH_I18N.pick("Görsel işlenemedi: ","Could not process image: ")+(err.message||err)); }
  });
  document.getElementById('composeImageRemoveBtn').addEventListener('click', ()=>{
    composeImageDataUrl = null;
    document.getElementById('composeImagePreviewWrap').style.display='none';
    document.getElementById('composeImageInput').value = '';
    updateLimit();
  });
  document.getElementById('composeSendBtn').addEventListener('click', async ()=>{
    const title = document.getElementById('composeTitle').value.trim();
    const text = textarea.value.trim();
    if(!title){ alert(window.BH_I18N.pick("Başlık yazmalısın.","Enter a title.")); return; }
    if(!text && !composeImageDataUrl){ alert(window.BH_I18N.pick("Bir şey yazmalısın veya görsel eklemelisin.","Write something or add an image.")); return; }
    try{
      await updateDoc(doc(db,'posts',postId), { title, text, image: composeImageDataUrl||'' });
      closeModal('bookInfoModal');
      showToast(window.BH_I18N.pick("Gönderi güncellendi!","Post updated!"));
      refresh();
    }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
  });
}
function wirePostCards(container, refreshFn){
  const refresh = refreshFn || renderTimelineTab;
  container.querySelectorAll('[data-post-menu]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      openPostMenu(btn, btn.dataset.postMenu, btn.dataset.canEdit==='1', refresh, btn.dataset.isPinned==='1');
    });
  });
  wireVoteButtons(container);
  container.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); pendingReactionRefresh = refresh; toggleReactionDrawer(btn, btn.dataset.target); });
  });
  container.querySelectorAll('[data-poll-option]').forEach(row=>{
    row.addEventListener('click', async (e)=>{
      e.stopPropagation();
      await voteOnPoll(row.dataset.pollPost, parseInt(row.dataset.pollOption,10));
      refresh();
    });
  });
  container.querySelectorAll('.post-comment-inline-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const card = btn.closest('.post-card');
      if(card) togglePostComments(card.dataset.postId);
    });
  });
  container.querySelectorAll('.post-comments-panel').forEach(panel=>{
    panel.addEventListener('click', (e)=> e.stopPropagation());
    const input = panel.querySelector('.post-comment-inline-input');
    const sendBtn = panel.querySelector('.post-comment-inline-send');
    const submit = async ()=>{
      const text = input.value.trim();
      if(!text) return;
      const postId = panel.dataset.postId;
      const postUid = panel.dataset.postUid;
      const newCount = parseInt(panel.dataset.commentCount,10) + 1;
      sendBtn.disabled = true;
      try{
        await addDoc(collection(db,'posts',postId,'comments'), { uid:currentUid, name:myProfile.name, text, createdAt:new Date().toISOString() });
        await updateDoc(doc(db,'posts',postId), { commentCount: newCount });
        panel.dataset.commentCount = newCount;
        syncFeedCardCommentCount(postId, newCount);
        if(postUid && postUid!==currentUid) notifyUser(postUid, `${myProfile.name} gönderine yorum yaptı.`, 'social', postId);
        input.value = '';
        renderPostCommentsPanel(postId);
      }catch(err){ alert(window.BH_I18N.pick("Yorum gönderilemedi: ","Could not send comment: ")+(err.message||err)); }
      finally{ sendBtn.disabled = false; }
    };
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
  });
  container.querySelectorAll('.post-card').forEach(card=>{
    card.addEventListener('click', (e)=>{
      if(e.target.closest('.user-chip') || e.target.closest('.book-cover-clickable') || e.target.closest('[data-poll-option]') || e.target.closest('.post-comment-inline-btn') || e.target.closest('.post-comments-panel') || e.target.closest('.post-vote-btn') || e.target.closest('.reaction-add-btn') || e.target.closest('.post-menu-btn')) return;
      togglePostComments(card.dataset.postId);
    });
  });
}
// Yorum eklenince/silinince gönderi modalı kendini yeniliyor, ama arkadaki akış kartı (feed'de
// duran ayrı bir DOM öğesi) bunu otomatik görmüyordu — sayfayı yenileyene kadar eski yorum
// sayısı orada takılı kalıyordu. Bu, o karttaki sayıyı da doğrudan güncelliyor.
function syncFeedCardCommentCount(postId, newCount){
  document.querySelectorAll(`.post-card[data-post-id="${postId}"] .post-comment-count`).forEach(el=>{
    el.textContent = `💬 ${newCount}`;
  });
}
// Akıştaki gönderiye tıklayınca ayrı bir modal açmak yerine kartın kendisini genişletiyoruz —
// diğer kartlar hub kartlarındaki gibi aşağı kayıyor, yorumlar da aynı yerde okunup yazılabiliyor.
function togglePostComments(postId){
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if(!card) return;
  const wasExpanded = card.classList.contains('expanded');
  document.querySelectorAll('.post-card.expanded').forEach(c=>{ if(c!==card) c.classList.remove('expanded'); });
  if(wasExpanded){
    card.classList.remove('expanded');
  }else{
    card.classList.add('expanded');
    renderPostCommentsPanel(postId);
  }
}
async function renderPostCommentsPanel(postId){
  const panel = document.querySelector(`.post-comments-panel[data-post-id="${postId}"]`);
  if(!panel) return;
  const list = panel.querySelector('.post-comments-list');
  list.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  let comments = [];
  const commentsSnap = await getDocs(collection(db,'posts',postId,'comments')).catch(()=>null);
  if(commentsSnap){
    commentsSnap.forEach(d=> comments.push({id:d.id, ...d.data()}));
    comments.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  }
  list.innerHTML = comments.length ? comments.map(c=>`<div class="rec-comment-row">
    <div class="rec-comment-body">${userChipHtml(c.uid,18)}<span class="muted" style="font-size:11px; margin-left:4px;">· ${timeAgoLabel(c.createdAt)}</span><div style="margin-top:2px;">${escapeHtml(c.text)}</div>${renderReactionBar(c.reactions, `postcomment:${postId}|${c.id}`)}</div>
    ${(c.uid===currentUid||myProfile.role==='admin')?`<button class="rec-comment-del" data-del-postcomment="${c.id}">✕</button>`:''}
  </div>`).join('') : window.BH_I18N.template`<span class="muted">Henüz yorum yok.</span>`;
  list.querySelectorAll('.reaction-pill').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); showReactorsModal(btn.dataset.uids, btn.dataset.emoji); });
  });
  list.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); pendingReactionRefresh = ()=>renderPostCommentsPanel(postId); toggleReactionDrawer(btn, btn.dataset.target); });
  });
  list.querySelectorAll('[data-del-postcomment]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!confirm(window.BH_I18N.pick("Bu yorumu silmek istediğine emin misin?","Are you sure you want to delete this comment?"))) return;
      try{
        const newCount = Math.max(0, parseInt(panel.dataset.commentCount,10) - 1);
        await deleteDoc(doc(db,'posts',postId,'comments',btn.dataset.delPostcomment));
        await updateDoc(doc(db,'posts',postId), {commentCount: newCount});
        panel.dataset.commentCount = newCount;
        syncFeedCardCommentCount(postId, newCount);
        renderPostCommentsPanel(postId);
      }catch(err){ alert('Silinemedi: '+(err.message||err)); }
    });
  });
}
async function openPostModal(postId){
  const body = document.getElementById('postModalBody');
  body.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  document.getElementById('postModal').style.display='flex';
  let p = null, comments = [];
  // Gönderiyi ve yorumlarını birbirine bağlı olmadıkları için birbirini beklemeden, aynı anda
  // çekiyoruz — bu, açılma süresini kabaca yarıya indiriyor.
  const [postSnap, commentsSnap] = await Promise.all([
    getDoc(doc(db,'posts',postId)).catch(()=>null),
    getDocs(collection(db,'posts',postId,'comments')).catch(()=>null)
  ]);
  if(postSnap && postSnap.exists()) p = {id:postId, ...postSnap.data()};
  if(!p){ body.innerHTML = window.BH_I18N.template`<span class="muted">Gönderi bulunamadı.</span>`; return; }
  if(commentsSnap){
    commentsSnap.forEach(d=> comments.push({id:d.id, ...d.data()}));
    comments.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  }
  const commentsHtml = comments.map(c=>`<div class="rec-comment-row">
    <div class="rec-comment-body">${userChipHtml(c.uid,18)}<span class="muted" style="font-size:11px; margin-left:4px;">· ${timeAgoLabel(c.createdAt)}</span><div style="margin-top:2px;">${escapeHtml(c.text)}</div>${renderReactionBar(c.reactions, `postcomment:${postId}|${c.id}`)}</div>
    ${(c.uid===currentUid||myProfile.role==='admin')?`<button class="rec-comment-del" data-del-postcomment="${c.id}">✕</button>`:''}
  </div>`).join('');
  const batchItemsHtml = (p.type==='book_review_batch' || p.type==='book_added_batch') ? `
    <div class="rec-comments-label" style="margin-top:2px;">${window.BH_I18N.pick("📋 Kronolojik Liste","📋 Activity timeline")}</div>
    ${(p.items||[]).slice().sort((a,b)=> new Date(a.at)-new Date(b.at)).map(it=>`<div class="rec-comment-row">
      ${it.bookCover?`<img src="${it.bookCover}" alt="" style="width:32px;height:46px;object-fit:cover;border-radius:4px;" />`:''}
      <div class="rec-comment-body">
        <b>${escapeHtml(it.bookTitle||'')}</b>
        <div class="muted" style="font-size:11px;">${timeAgoLabel(it.at)}</div>
        ${p.type==='book_review_batch' ? `<div style="color:var(--gold); font-size:12.5px; margin-top:2px;">⭐ ${it.rating}/10${it.reviewText?` — "${escapeHtml(it.reviewText)}"`:''}</div>` : window.BH_I18N.template`<div class="muted" style="font-size:12.5px; margin-top:2px;">Kitaplığa eklendi</div>`}
      </div>
    </div>`).join('')}
  ` : '';
  body.innerHTML = window.BH_I18N.template`
    <div class="post-card-head">${userChipHtml(p.uid)}<span class="post-card-time">&middot; ${exactTimeLabel(p.createdAt)}</span></div>
    <div class="post-card-body" style="margin-bottom:10px;">${(()=>{const t=postTitleFor(p); return t?`<div class="post-title" style="font-size:19px;">${t}</div>`:'';})()}${postBodyHtml(p, true)}</div>
    ${batchItemsHtml}
    <div class="post-card-footer">
      ${postVoteRowHtml(p)}
      ${postReactionPillHtml(p)}
      ${(p.uid===currentUid||myProfile.role==='admin')?window.BH_I18N.template`<button type="button" class="secondary tiny" id="postModalDelBtn" style="margin-left:auto;">Kaldır</button>`:''}
    </div>
    <div class="rec-comments-label">💬 ${comments.length} Yorum</div>
    <div id="postModalComments">${commentsHtml}</div>
    <div class="row" style="margin-top:10px;">
      <input type="text" id="postCommentInput" placeholder="Yorum yaz..." />
      <button class="secondary tiny" id="postCommentSendBtn" style="flex:0 0 auto;">Gönder</button>
    </div>
  `;
  wireVoteButtons(body);
  body.querySelectorAll('.reaction-pill').forEach(btn=>{
    btn.addEventListener('click', ()=> showReactorsModal(btn.dataset.uids, btn.dataset.emoji));
  });
  body.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); pendingReactionRefresh = ()=>openPostModal(postId); toggleReactionDrawer(btn, btn.dataset.target); });
  });
  body.querySelectorAll('[data-poll-option]').forEach(row=>{
    row.addEventListener('click', async (e)=>{
      e.stopPropagation();
      await voteOnPoll(row.dataset.pollPost, parseInt(row.dataset.pollOption,10));
      openPostModal(postId);
    });
  });
  body.querySelectorAll('[data-del-postcomment]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Bu yorumu silmek istediğine emin misin?","Are you sure you want to delete this comment?"))) return;
      try{
        const newCount = Math.max(0,(p.commentCount||1)-1);
        await deleteDoc(doc(db,'posts',postId,'comments',btn.dataset.delPostcomment));
        await updateDoc(doc(db,'posts',postId), {commentCount: newCount});
        syncFeedCardCommentCount(postId, newCount);
        openPostModal(postId);
      }catch(e){ alert('Silinemedi: '+(e.message||e)); }
    });
  });
  const delPostBtn = document.getElementById('postModalDelBtn');
  if(delPostBtn) delPostBtn.addEventListener('click', async ()=>{
    if(!confirm(window.BH_I18N.pick("Bu gönderiyi silmek istediğine emin misin?","Are you sure you want to delete this post?"))) return;
    try{ await deleteDoc(doc(db,'posts',postId)); closeModal('postModal'); renderTimelineTab(); }catch(err){ alert('Silinemedi: '+(err.message||err)); }
  });
  document.getElementById('postCommentSendBtn').addEventListener('click', async (e)=>{
    const input = document.getElementById('postCommentInput');
    const text = input.value.trim();
    if(!text) return;
    const sendBtn = e.currentTarget;
    sendBtn.disabled = true;
    try{
      const newCount = (p.commentCount||0)+1;
      await addDoc(collection(db,'posts',postId,'comments'), { uid:currentUid, name:myProfile.name, text, createdAt:new Date().toISOString() });
      await updateDoc(doc(db,'posts',postId), { commentCount: newCount });
      syncFeedCardCommentCount(postId, newCount);
      // Bildirimler asıl sonucu etkilemiyor — arka planda tamamlanırken bekletmiyoruz.
      if(p.uid!==currentUid) notifyUser(p.uid, `${myProfile.name} gönderine yorum yaptı.`, 'social', p.id);
      const priorCommenterUids = new Set(comments.map(c=>c.uid));
      priorCommenterUids.delete(currentUid);
      priorCommenterUids.delete(p.uid);
      priorCommenterUids.forEach(uid=> notifyUser(uid, `${myProfile.name} de yorum yaptığın bir gönderiye yorum yaptı.`, 'social', p.id));
      openPostModal(postId);
    }catch(err){ alert(window.BH_I18N.pick("Yorum gönderilemedi: ","Could not send comment: ")+(err.message||err)); sendBtn.disabled = false; }
  });
}
document.getElementById('postModalClose').addEventListener('click', ()=> closeModal('postModal'));
document.getElementById('postModal').addEventListener('click', (e)=>{ if(e.target.id==='postModal') closeModal('postModal'); });

/* --- Sosyal pill çubuğu: alt sekme geçişi + kaydırınca gizle/göster --- */
let lastSocialScrollY = 0;
initDiscover();
window.addEventListener('scroll', ()=>{
  const socialTab = document.getElementById('tab-social');
  if(!socialTab || !socialTab.classList.contains('active')) return;
  const pinBar = document.getElementById('pinnedPostBar');
  const pillBar = document.getElementById('socialPillBar');
  const cur = window.scrollY;
  if(cur > lastSocialScrollY + 4){ if(pinBar) pinBar.classList.add('hidden'); if(pillBar && pillBar.style.display!=='none') pillBar.classList.add('hidden'); }
  else if(cur < lastSocialScrollY - 4){ if(pinBar) pinBar.classList.remove('hidden'); if(pillBar) pillBar.classList.remove('hidden'); }
  lastSocialScrollY = cur;
}, {passive:true});

const PLACEHOLDER_COVER_PALETTE = ['#CEC4E1','#C8DDC4','#F0D5B9','#C5DAE8','#E8C9D2','#E5DFB9'];
function placeholderCoverHtml(title){
 const t=String(title||'Kitap').trim()||'Kitap';
 let hash=0;for(const ch of t)hash=(Math.imul(hash,31)+ch.codePointAt(0))|0;
 const color=PLACEHOLDER_COVER_PALETTE[(hash>>>0)%PLACEHOLDER_COVER_PALETTE.length];
 return `<span class="book-cover-template" style="--cover-paper:${color}" aria-hidden="true"><span class="book-cover-letter">${escapeHtml(Array.from(t)[0].toLocaleUpperCase('tr-TR'))}</span><span class="book-cover-name">${escapeHtml(t)}</span></span>`;
}
export function materialBookCover(title,cover,extraClass=''){
 let url='';try{const u=new URL(cover||'',location.href);if(cover&&['http:','https:'].includes(u.protocol))url=u.href;}catch(_){}
 return `<span class="material-book-cover ${extraClass}">${placeholderCoverHtml(title)}${url?`<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:''}</span>`;
}
export function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function renderSettingsTab(){
  document.getElementById('settingsPasswordError').textContent = '';
  const pwCard = document.getElementById('settingsChangePasswordBtn').closest('.card');
  pwCard.style.display = isGoogleUser() ? 'none' : 'block';
  if(pwCard.parentElement.classList.contains('settings-group'))pwCard.parentElement.hidden=isGoogleUser();
  const adminWrap = document.getElementById('settingsAdminOnlyWrap');
  adminWrap.style.display = myProfile.role==='admin' ? 'block' : 'none';
  if(myProfile.role==='admin'){
    const btn = document.getElementById('settingsSeedCoversBtn');
    if(btn) btn.onclick = seedDiscoverCovers;
    const migrateBtn = document.getElementById('settingsMigrateBatchBtn');
    if(migrateBtn) migrateBtn.onclick = migrateBatchPostsRetroactively;
    const deleteReadPostsBtn = document.getElementById('settingsDeleteReadPostsBtn');
    if(deleteReadPostsBtn) deleteReadPostsBtn.onclick = deleteReadPostsRetroactively;
    await ensureDiscoverPageSizeLoaded();
    const row = document.getElementById('settingsPageSizeRow');
    const options = [100, 50, 20];
    row.innerHTML = options.map(n=>`<button type="button" class="secondary tiny" data-pagesize="${n}" style="flex:1; ${discoverPageSize===n?'background:var(--gold); color:#fff; border-color:var(--gold);':''}">${n}</button>`).join('');
    row.querySelectorAll('[data-pagesize]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const n = parseInt(b.dataset.pagesize,10);
        try{
          await setDoc(doc(db,'settings','discover'), { pageSize: n }, { merge:true });
          setDiscoverPageSize(n);
          showToast(`Sayfa boyutu ${n} olarak ayarlandı.`);
          renderSettingsTab();
        }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
      });
    });
  }
  materialSettingsPresentation();
  const prefs = myProfile.notifPrefs || {};
  const giftsChk = document.getElementById('notifPrefGifts');
  const socialChk = document.getElementById('notifPrefSocial');
  giftsChk.checked = prefs.gifts !== false;
  socialChk.checked = prefs.social !== false;
  const saveNotifPref = async (field, val)=>{
    try{
      const newPrefs = { ...(myProfile.notifPrefs||{}), [field]: val };
      await updateDoc(doc(db,'users',currentUid), { notifPrefs: newPrefs });
      myProfile.notifPrefs = newPrefs;
      showToast(window.BH_I18N.pick("Bildirim ayarı güncellendi.","Notification preferences updated."));
    }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
  };
  giftsChk.onchange = ()=> saveNotifPref('gifts', giftsChk.checked);
  socialChk.onchange = ()=> saveNotifPref('social', socialChk.checked);
}

async function fetchRecComments(recId){
  // Hata yutulup boş yorum listesi döndürülürse, bu kartı çağıran renderPersonalRecs/
  // renderGroupRecs sonucu "yorum yok" diye kalıcı önbelleğe yazardı — hatayı yukarı fırlatıp
  // o render'ın tamamını iptal etmesini (ekranı olduğu gibi bırakmasını) sağlıyoruz.
  const snap = await getDocs(collection(db,'recommendations',recId,'comments'));
  const items = [];
  snap.forEach(d=> items.push({id:d.id, ...d.data()}));
  items.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  return items;
}

async function renderRecCard(it, isGroup){
  const comments = await fetchRecComments(it.id);
  const canDelete = isGroup
    ? (it.fromUid===currentUid || myProfile.role==='admin')
    : (it.fromUid===currentUid || it.toUid===currentUid);
  const directionLabel = isGroup
    ? `${userChipHtml(it.fromUid)} gruba önerdi`
    : (it.fromUid===currentUid ? `Sen ${userChipHtml(it.toUid)} kişisine önerdin` : `${userChipHtml(it.fromUid)} sana önerdi`);
  const dt = new Date(it.createdAt);
  const dtLabel = isNaN(dt.getTime()) ? '' : `${pad(dt.getDate())}.${pad(dt.getMonth()+1)}.${dt.getFullYear()}`;
  const topComments = comments.filter(c=>!c.replyTo);
  const repliesOf = pid => comments.filter(c=>c.replyTo===pid);
  const renderComment = (c, isReply)=>{
    const canDeleteComment = c.uid===currentUid || (isGroup && myProfile.role==='admin');
    return `<div class="rec-comment-row"${isReply?' style="margin-left:26px;"':''}>
      <div class="rec-comment-body">${userChipHtml(c.uid,18)}<div style="margin-top:2px;">${escapeHtml(c.text)}</div>${renderReactionBar(c.reactions, `comment:${it.id}|${c.id}`)}
        ${!isReply?window.BH_I18N.template`<button type="button" class="secondary tiny rec-comment-reply-btn" data-rec-id="${it.id}" data-comment-id="${c.id}" style="margin-top:4px;">Cevapla</button>`:''}
      </div>
      ${canDeleteComment?`<button class="rec-comment-del" data-del-comment="${it.id}|${c.id}">✕</button>`:''}
    </div>`;
  };
  const commentsHtml = topComments.map(c=> renderComment(c,false) + repliesOf(c.id).map(r=>renderComment(r,true)).join('')).join('');
  const coverHtml = `<span class="recommendation-cover book-cover-clickable" data-book-title="${escapeHtml(it.bookTitle)}" data-book-cover="${escapeHtml(it.coverUrl||'')}">${materialBookCover(it.bookTitle,it.coverUrl)}</span>`;
  return window.BH_I18N.template`<div class="receipt" data-rec-id="${it.id}">
    <div class="rweek"><span>${directionLabel} &middot; ${dtLabel}</span>${canDelete?window.BH_I18N.template`<button class="secondary tiny" data-del-rec="${it.id}">Sil</button>`:''}</div>
    <div style="display:flex; gap:12px; align-items:flex-start;">
      ${coverHtml}
      <div style="min-width:0; flex:1;">
        <div style="font-weight:600;">${escapeHtml(it.bookTitle)}</div>
        ${it.note?`<div class="muted" style="margin-top:2px;">${escapeHtml(it.note)}</div>`:''}
      </div>
    </div>
    ${renderReactionBar(it.reactions, `rec:${it.id}`)}
    ${comments.length ? window.BH_I18N.template`<button type="button" class="rec-comments-toggle" data-toggle-comments="${it.id}">💬 ${comments.length} Yorum</button><div class="rec-comments-wrap" id="recComments-${it.id}" style="display:none;">${commentsHtml}</div>` : ''}
    <div class="row" style="margin-top:10px;">
      <input type="text" class="rec-comment-input" placeholder="Yorum yaz..." data-rec-id="${it.id}" />
      <button class="secondary tiny rec-comment-send" data-rec-id="${it.id}" style="flex:0 0 auto;">Gönder</button>
    </div>
  </div>`;
}

function wireRecCards(box, items, isGroup){
  box.querySelectorAll('[data-toggle-comments]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const wrap = document.getElementById('recComments-'+btn.dataset.toggleComments);
      if(!wrap) return;
      if(wrap.style.display==='none'){
        wrap.style.display = 'block';
        wrap.classList.remove('slide-down-anim');
        void wrap.offsetWidth;
        wrap.classList.add('slide-down-anim');
      } else {
        wrap.style.display = 'none';
      }
    });
  });
  box.querySelectorAll('.reaction-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{ showReactorsModal(btn.dataset.uids, btn.dataset.emoji); });
  });
  box.querySelectorAll('.reaction-add-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); pendingReactionRefresh = isGroup ? renderGroupRecs : renderPersonalRecs; toggleReactionDrawer(btn, btn.dataset.target); });
  });
  box.querySelectorAll('[data-del-rec]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm(window.BH_I18N.pick("Bu öneri (ve tüm yorumları) silinsin mi?","Delete this recommendation and all its comments?"))) return;
      try{ await deleteDoc(doc(db,'recommendations',btn.dataset.delRec)); }
      catch(e){ alert('Silinemedi: '+(e.message||e)); return; }
      hubPreviews.invalidate('library');
      isGroup ? renderGroupRecs() : renderPersonalRecs();
    });
  });
  box.querySelectorAll('[data-del-comment]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const [recId, commentId] = btn.dataset.delComment.split('|');
      if(!confirm('Yorum silinsin mi?')) return;
      try{ await deleteDoc(doc(db,'recommendations',recId,'comments',commentId)); }
      catch(e){ alert('Silinemedi: '+(e.message||e)); return; }
      isGroup ? renderGroupRecs() : renderPersonalRecs();
    });
  });
  box.querySelectorAll('.rec-comment-reply-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const existing = btn.parentElement.querySelector('.rec-reply-input-wrap');
      if(existing){ existing.remove(); return; }
      const wrap = document.createElement('div');
      wrap.className = 'rec-reply-input-wrap row';
      wrap.style.marginTop = '6px';
      wrap.innerHTML = window.BH_I18N.template`<input type="text" class="rec-reply-input" placeholder="Cevap yaz..." /><button type="button" class="secondary tiny rec-reply-send" style="flex:0 0 auto;">Gönder</button>`;
      btn.after(wrap);
      wrap.querySelector('.rec-reply-send').addEventListener('click', async ()=>{
        const text = wrap.querySelector('.rec-reply-input').value.trim();
        if(!text) return;
        const recId = btn.dataset.recId, commentId = btn.dataset.commentId;
        try{
          await addDoc(collection(db,'recommendations',recId,'comments'), { uid: currentUid, name: myProfile.name, text, replyTo: commentId, createdAt: new Date().toISOString() });
          const it = items.find(x=>x.id===recId);
          if(it){
            if(isGroup){
              if(it.fromUid!==currentUid) await notifyUser(it.fromUid, `${myProfile.name}, "${it.bookTitle}" önerine cevap yazdı.`, 'recs');
            } else {
              const otherUid = it.fromUid===currentUid ? it.toUid : it.fromUid;
              await notifyUser(otherUid, `${myProfile.name}, "${it.bookTitle}" önerisine cevap yazdı.`, 'recs');
            }
          }
          isGroup ? renderGroupRecs() : renderPersonalRecs();
        }catch(err){ alert(window.BH_I18N.pick("Cevap gönderilemedi: ","Could not send reply: ")+(err.message||err)); }
      });
    });
  });
  box.querySelectorAll('.rec-comment-send').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const recId = btn.dataset.recId;
      const input = box.querySelector(`.rec-comment-input[data-rec-id="${recId}"]`);
      const text = input.value.trim();
      if(!text) return;
      try{
        await addDoc(collection(db,'recommendations',recId,'comments'), { uid: currentUid, name: myProfile.name, text, createdAt: new Date().toISOString() });
        const it = items.find(x=>x.id===recId);
        if(it){
          if(isGroup){
            if(it.fromUid!==currentUid) await notifyUser(it.fromUid, `${myProfile.name}, "${it.bookTitle}" önerine yorum yaptı.`, 'recs');
          } else {
            const otherUid = it.fromUid===currentUid ? it.toUid : it.fromUid;
            await notifyUser(otherUid, `${myProfile.name}, "${it.bookTitle}" önerisine yorum yaptı.`, 'recs');
          }
        }
        input.value='';
        isGroup ? renderGroupRecs() : renderPersonalRecs();
      }catch(err){ alert(window.BH_I18N.pick("Yorum gönderilemedi: ","Could not send comment: ")+(err.message||err)); }
    });
  });
}

async function renderPersonalRecs(){
  const box = keepOrLoading('recPersonalList');
  let items = [];
  try{
    const [snapFrom, snapTo] = await Promise.all([
      getDocs(query(collection(db,'recommendations'), where('scope','==','personal'), where('fromUid','==',currentUid))),
      getDocs(query(collection(db,'recommendations'), where('scope','==','personal'), where('toUid','==',currentUid)))
    ]);
    const seen = new Set();
    [...snapFrom.docs, ...snapTo.docs].forEach(d=>{
      if(!seen.has(d.id)){ seen.add(d.id); items.push({id:d.id, ...d.data()}); }
    });
  }catch(e){ return; }
  items.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  if(items.length===0){ box.innerHTML = window.BH_I18N.template`<p class="muted">Henüz şahsi öneri yok.</p>`; markLoaded(box); return; }
  const cards = await Promise.all(items.map(it=>renderRecCard(it,false)));
  box.innerHTML = cards.join('');
  markLoaded(box);
  wireRecCards(box, items, false);
}

async function renderGroupRecs(){
  const box = keepOrLoading('recGroupList');
  let items = [];
  try{
    const snap = await getDocs(query(collection(db,'recommendations'), where('scope','==','group')));
    snap.forEach(d=> items.push({id:d.id, ...d.data()}));
  }catch(e){ return; }
  items.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  items = items.slice(0,50);
  if(items.length===0){ box.innerHTML = window.BH_I18N.template`<p class="muted">Henüz grup önerisi yok.</p>`; markLoaded(box); return; }
  const cards = await Promise.all(items.map(it=>renderRecCard(it,true)));
  box.innerHTML = cards.join('');
  markLoaded(box);
  wireRecCards(box, items, true);
}

/* ============ ÜYE: KİTAP KURTLARI ============ */
async function renderMemberWorms(){ await renderWormsShared('mWormsMyStreak','mWormsClubStreaks','mWormsHistory'); }

/* ============ GİRİŞ / AUTH DURUM TAKİBİ ============ */
/* BookHook Material UI adapter. Only presentation/navigation; existing data model retained. */
function materialIcon(kind){
 const paths={bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',logout:'<path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',feed:'<path d="M4 5h16M4 10h16M4 15h10M4 20h6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',book:'<path d="M12 5C9 2 5 2 2 3v16c4-1 7-1 10 2 3-3 6-3 10-2V3c-3-1-7-1-10 2Z"/><path d="M12 5v16"/>',club:'<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M3 9a3 3 0 0 0 0 6m18-6a3 3 0 0 1 0 6M2 21v-2m20 2v-2"/>',gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z"/>',badge:'<circle cx="12" cy="9" r="6"/><path d="m8 14-2 8 6-3 6 3-2-8m-6-6 2-3 2 3"/>',records:'<path d="M4 3h16v18H4ZM8 8h8M8 12h8M8 16h5"/>',settings:'<path d="m9 3-1 3-3 1v4l-2 1 2 2v4l3 1 1 3h6l1-3 3-1v-4l2-2-2-1V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',rules:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',heart:'<path d="M12 21s-6.5-4.2-9-8.4C1.3 9 2.7 5.5 6 4.6c2-.5 3.8.3 5 2 .1.2.5.2.6 0 1.2-1.7 3-2.5 5-2 3.3.9 4.7 4.4 3 8C18.5 16.8 12 21 12 21Z"/>',account:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',import:'<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>'};
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]||paths.book}</svg>`;
}
function materialPrimaryTabs(){
 const admin=myProfile&&myProfile.role==='admin';
 const tabs=[{id:admin?'today':'msurvey',label:window.BH_I18N.pick("Bugün","Today"),icon:materialIcon('home')},{id:'social',label:window.BH_I18N.pick("Akış","Feed"),icon:materialIcon('feed')}];
 for(const hub of ['club','library']){
  if(hubLayoutMode(hub)==='primary')hubSubtabEntries(hub).forEach(([id,label],i)=>tabs.push({id,label,icon:materialIcon((hub==='club'?['records','badge','gift']:['search','book','heart'])[i])}));
  else tabs.push({id:hub,label:hub==='club'?window.BH_I18N.pick("Kulüp","Club"):window.BH_I18N.pick("Kitaplık","Library"),icon:materialIcon(hub==='club'?'club':'book')});
 }
 return tabs;
}
function materialRoute(id){
 if(id==='records') return myProfile.role==='admin'?'week':'mtoday';
 if(id==='badges') return myProfile.role==='admin'?'worms':'mworms';
 return id;
}
function materialLink(id,label,description,icon){
 return `<button class="destination-row" data-material-route="${id}"><span class="route-icon">${materialIcon(icon)}</span><span><b>${label}</b><small>${description}</small></span><span aria-hidden="true">›</span></button>`;
}
/* ============ KULÜP/KİTAPLIK HUB'LARI: yerinde büyüyen kartlar (accordion) ============
   Her hub kartı ayrı bir sayfaya gitmek yerine kendi içinde büyüyor, hedef ekranın <section>'ı
   (tüm mevcut render fonksiyonları değişmeden) kartın içine taşınıyor. HUB_PARENT, switchTab()'a
   dışarıdan (geri tuşu, bildirim, "Haftalık kayıtlar" gibi kısayollar) bu id'lerden biriyle
   gelindiğinde önce doğru hub sekmesine gidip sonra ilgili kartı açması için kullanılıyor. */
const HUB_PARENT = {};
// Ayarlar sekmesindeki kartlar (Yönetim, Grup kuralları, Uygulama ayarları) accordion yerine eski
// usül ayrı sayfa + geri okuna gitsin diye bu setle işaretleniyor — bkz. materialHubLink().
const HUB_NO_ACCORDION = new Set();
const HUB_ILLUSTRATIONS = {
 records: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><rect x="60" y="6" width="16" height="14" rx="2" fill="none" stroke="var(--gold)" stroke-width="2"/><line x1="64" y1="4" x2="64" y2="9" stroke="var(--gold)" stroke-width="2" stroke-linecap="round"/><line x1="72" y1="4" x2="72" y2="9" stroke="var(--gold)" stroke-width="2" stroke-linecap="round"/><path d="M64,14 66.5,16.5 72,11" fill="none" stroke="var(--forest)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12,80 12,42 22,42 26,36 44,36 44,42 80,42 80,80 Z" fill="var(--secondary-ink)"/><rect x="28" y="20" width="32" height="40" rx="3" fill="var(--card)"/><circle cx="35" cy="29" r="2.4" fill="var(--secondary-container)"/><rect x="40" y="27.5" width="15" height="3" rx="1.5" fill="var(--line)"/><rect x="34" y="36" width="21" height="3" rx="1.5" fill="var(--line)"/><path d="M34.5,45 36,46.5 39,43" fill="none" stroke="var(--forest)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="40" y="43.5" width="15" height="3" rx="1.5" fill="var(--primary-container)"/></svg>`,
 badge: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><path d="M32,52 22,80 45,69 68,80 58,52" fill="var(--secondary-ink)"/><circle cx="45" cy="34" r="21" fill="var(--gold)"/><polygon points="45,22 48.5,31 58,31 50.5,36.5 53,46 45,40.5 37,46 39.5,36.5 32,31 41.5,31" fill="var(--card)"/><path d="M80,10 80,16 M80,24 80,30 M72,20 78,20 M82,20 88,20" stroke="var(--forest)" stroke-width="2.2" stroke-linecap="round"/></svg>`,
 gift: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><rect x="18" y="38" width="52" height="42" rx="3" fill="var(--secondary-ink)"/><rect x="18" y="38" width="52" height="12" fill="var(--secondary-container)"/><rect x="39" y="38" width="10" height="42" fill="var(--gold)"/><path d="M44,38 C36,25 24,28 27,37 C29,44 38,41 44,38 Z" fill="var(--gold)"/><path d="M44,38 C52,25 64,28 61,37 C59,44 50,41 44,38 Z" fill="var(--gold-dark)"/><circle cx="83" cy="18" r="5" fill="var(--rust)"/></svg>`,
 rules: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><rect x="24" y="12" width="52" height="68" rx="6" fill="var(--card)" stroke="var(--secondary-ink)" stroke-width="2.5"/><rect x="38" y="6" width="24" height="11" rx="3" fill="var(--secondary-ink)"/><path d="M33,32 36.5,35.5 43,27" fill="none" stroke="var(--forest)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="48" y="28" width="20" height="3" rx="1.5" fill="var(--line)"/><path d="M33,50 36.5,53.5 43,45" fill="none" stroke="var(--forest)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="48" y="46" width="20" height="3" rx="1.5" fill="var(--line)"/><path d="M33,68 36.5,71.5 43,63" fill="none" stroke="var(--forest)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="48" y="64" width="20" height="3" rx="1.5" fill="var(--line)"/></svg>`,
 settings: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><line x1="18" y1="18" x2="82" y2="18" stroke="var(--line)" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="18" r="8" fill="var(--gold)"/><line x1="18" y1="42" x2="82" y2="42" stroke="var(--line)" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="42" r="8" fill="var(--secondary-ink)"/><line x1="18" y1="66" x2="82" y2="66" stroke="var(--line)" stroke-width="5" stroke-linecap="round"/><circle cx="64" cy="66" r="8" fill="var(--forest)"/></svg>`,
 search: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><rect x="12" y="52" width="28" height="9" rx="2" fill="var(--gold)"/><rect x="12" y="63" width="32" height="9" rx="2" fill="var(--gold-dark)"/><rect x="12" y="74" width="24" height="9" rx="2" fill="var(--secondary-ink)"/><circle cx="64" cy="38" r="17" fill="none" stroke="var(--forest)" stroke-width="4.5"/><line x1="76" y1="50" x2="88" y2="62" stroke="var(--forest)" stroke-width="5.5" stroke-linecap="round"/></svg>`,
 book: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><rect x="18" y="12" width="16" height="68" rx="2" fill="var(--gold)"/><rect x="38" y="20" width="16" height="60" rx="2" fill="var(--forest)"/><rect x="58" y="6" width="16" height="74" rx="2" fill="var(--secondary-ink)"/><path d="M58,6 74,6 74,30 66,23 58,30 Z" fill="var(--gold-dark)"/></svg>`,
 heart: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><path d="M20,80 20,16 62,16 62,80 41,68 Z" fill="var(--secondary-ink)"/><rect x="28" y="30" width="26" height="3" rx="1.5" fill="var(--line)"/><rect x="28" y="40" width="26" height="3" rx="1.5" fill="var(--line)"/><path d="M76,16 C71,9 60,11 60,20 C60,29 76,39 76,39 C76,39 92,29 92,20 C92,11 81,9 76,16 Z" fill="var(--cloth)"/></svg>`,
 account: `<svg class="hub-illustration" viewBox="0 0 100 84" aria-hidden="true"><rect x="30" y="6" width="34" height="72" rx="8" fill="var(--secondary-ink)"/><rect x="35" y="14" width="24" height="50" rx="2" fill="var(--card)"/><circle cx="47" cy="70" r="3" fill="var(--card)"/><circle cx="80" cy="18" r="10" fill="var(--gold)"/><path d="M76,18 79,21 84,14" fill="none" stroke="var(--on-primary)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="50" r="9" fill="var(--forest)"/><circle cx="16" cy="47" r="3.2" fill="var(--card)"/><path d="M10,57 C10,51.5 22,51.5 22,57" fill="none" stroke="var(--card)" stroke-width="2.2" stroke-linecap="round"/></svg>`,
};
function materialHubLink(hubId,targetId,label,description,icon,noAccordion){
 HUB_PARENT[targetId] = hubId;
 if(noAccordion) HUB_NO_ACCORDION.add(targetId);
 return window.BH_I18N.template`<div class="hub-item" data-hub-target="${targetId}"><button type="button" class="destination-row hub-item-toggle"><div class="hub-item-summary">${HUB_ILLUSTRATIONS[icon]||''}<span class="route-icon">${materialIcon(icon)}</span><span><b>${label}</b><small>${description}</small></span></div><span class="hub-chevron" aria-hidden="true">›</span></button><div class="hub-item-panel"><div class="hub-item-panel-inner"></div></div><button type="button" class="hub-item-close-btn icon-button" aria-label="Kapat"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15l7-7 7 7"/></svg></button></div>`;
}
function materialExpandHubItem(item, targetId){
 if(item.closest(".hub-flat")){const root=item.closest(".hub-subtabs");if(root)selectHubSubtab(root.id.replace("tab-",""),targetId);const section=document.getElementById("tab-"+targetId);if(section)section.scrollIntoView({behavior:"smooth",block:"start"});return;}
 const inner = item.querySelector('.hub-item-panel-inner');
 const section = document.getElementById('tab-'+targetId);
 if(section){ inner.appendChild(section); section.classList.add('active'); renderTab(targetId); }
 item.classList.add('expanded');
 watchPanelHeightGrowth(inner);
 // Kart kapalıyken dar grid hücresi genişliğine göre kurulmuş olabilecek kart-içi karuseller
 // (bkz. wireInnerPaneCarousel), kart açılıp tam genişliğe geçince yanlış ölçülü kalır —
 // açılışta bir kez yeniden ölçüp konumluyoruz.
 requestAnimationFrame(()=>{
  inner.querySelectorAll('.inner-pane-viewport').forEach(vp=>{
   if(vp._carousel) vp._carousel.goTo(vp._carousel.current, false);
  });
 });
}
// Kart açılırken panel, o anda içeride ne varsa ona göre büyüyor — ama sekmenin verisi
// Firestore'dan asenkron geliyor, o yüzden tıklama anında panelde genelde sadece küçük bir
// "Yükleniyor…" yer tutucusu oluyor. Gerçek veri biraz sonra gelip DOM'u değiştirdiğinde
// grid-template-rows değeri hiç değişmediği için CSS geçişi tekrar tetiklenmiyor ve içerik
// animasyonsuz aniden tam boyuna zıplıyor. Açılıştan sonraki kısa bir pencerede panelin asıl
// yüksekliğini izleyip her büyümede ölçülmüş, ayrı bir max-height geçişiyle bunu yumuşatıyoruz.
function watchPanelHeightGrowth(inner){
 if(!inner) return;
 if(inner._growthObserver){ inner._growthObserver.disconnect(); }
 let active = true;
 let lastHeight = inner.scrollHeight;
 const ro = new ResizeObserver(()=>{
  if(!active) return;
  const newHeight = inner.scrollHeight;
  if(newHeight > lastHeight + 4){
   const from = lastHeight;
   inner.style.maxHeight = from+'px';
   inner.style.transition = 'none';
   void inner.offsetHeight;
   inner.style.transition = 'max-height .3s var(--ease)';
   requestAnimationFrame(()=>{ inner.style.maxHeight = newHeight+'px'; });
   const cleanup = ()=>{ inner.style.maxHeight=''; inner.style.transition=''; inner.removeEventListener('transitionend', cleanup); };
   inner.addEventListener('transitionend', cleanup);
  }
  lastHeight = newHeight;
 });
 inner._growthObserver = ro;
 ro.observe(inner);
 setTimeout(()=>{
  active = false;
  ro.disconnect();
  if(inner._growthObserver===ro) inner._growthObserver = null;
  inner.style.maxHeight = '';
  inner.style.transition = '';
 }, 2500);
}
function materialCollapseHubItem(item){ if(!item.closest('.hub-flat'))item.classList.remove('expanded'); }
document.body.addEventListener('click', e=>{
 const closeBtn = e.target.closest('.hub-item-close-btn');
 if(!closeBtn) return;
 const item = closeBtn.closest('.hub-item');
 if(item) materialCollapseHubItem(item);
});
document.body.addEventListener('click', e=>{
 const toggle = e.target.closest('.hub-item-toggle');
 if(!toggle) return;
 const item = toggle.closest('.hub-item');
 const targetId = item.dataset.hubTarget;
 if(HUB_NO_ACCORDION.has(targetId)){ switchTab(targetId); return; }
 const container = item.parentElement;
 const wasExpanded = item.classList.contains('expanded');
 container.querySelectorAll('.hub-item.expanded').forEach(other=>{ if(other!==item) materialCollapseHubItem(other); });
 if(wasExpanded){ materialCollapseHubItem(item); }
 else { materialExpandHubItem(item, targetId); item.scrollIntoView({behavior:'smooth', block:'start'}); }
});
// Genişleyen kartın başlık şeridi tamamen kayboluyor (bkz. .hub-item.expanded .destination-row),
// o yüzden kapatmak için ayrı bir "boşluğa" ihtiyaç yok: içerik olmayan herhangi bir yere —
// kartın kendisine, panelin gövdesine veya taşınan <section>'ın doğrudan üstüne — tıklamak
// yeterli. Gerçek içerik (buton, kart, metin vb.) tıklamaları e.target'ı daha derin bir öğeye
// taşıdığı için bu eşleşmeye hiç girmiyor.
document.body.addEventListener('click', e=>{
 const item = e.target.closest('.hub-item.expanded');
 if(!item) return;
 const panel = item.querySelector(':scope>.hub-item-panel');
 const inner = panel && panel.querySelector(':scope>.hub-item-panel-inner');
 const section = inner && inner.querySelector(':scope>section.tab');
 if(e.target===item || e.target===panel || e.target===inner || e.target===section){
  materialCollapseHubItem(item);
 }
});
// Kart içi sekme geçişini (bkz. yukarıdaki .inner-pane-* CSS yorumu) yöneten düşük seviye
// karusel — bir viewport/track/pane üçlüsü üzerinde parmakla sürükleme, mesafe+hız eşiğiyle
// karar verme ve pane değişince yükseklik geçişini üstleniyor. Sayfa seviyesindeki
// setupSwipeNav() ile aynı deseni (mesafe/hız eşiği, watchdog'a gerek yok çünkü tek dokunuşluk
// kısa bir alan) kart-içi ölçeğe indirgenmiş hali.
function wireInnerPaneCarousel(viewport, track, panes, onIndexChange){
 const PEEK=22, GAP=10; // GAP, .inner-pane-track>.inner-pane margin-right ile eşleşmeli
 let current=0, cardW=0, touchStartX=null, touchStartY=0, dragging=false, lastMoveX=0, lastMoveTime=0, velocity=0;
 function measure(){
  const vw = viewport.clientWidth || 1;
  cardW = Math.max(40, vw - PEEK*2);
  panes.forEach(p=>{ p.style.width = cardW+'px'; });
 }
 function baseX(i){ return PEEK - i*(cardW+GAP); }
 function setHeight(animate){
  if(viewport.closest(".hub-flat"))return;
  const el = panes[current];
  if(!el) return;
  const h = el.scrollHeight;
  // "from", viewport'un O ANKİ gerçek render edilmiş yüksekliğinden (getBoundingClientRect)
  // DEĞİL, bizim EN SON kendi belirlediğimiz px değerinden okunuyor. Bunun sebebi: bu fonksiyon
  // artık paneResizeObserver tarafından da (içerik asenkron değiştiğinde) tetikleniyor — o an
  // DOM zaten yeni boyutuna reflow olmuş oluyor (ResizeObserver her zaman DEĞİŞİKLİKTEN SONRA
  // ateşlenir), yani getBoundingClientRect zaten "h" ile aynı değeri verir ve "geçiş" görünmeden
  // anında zıplardı. Kendi son belirlediğimiz değeri hatırlayarak gerçek bir "eski->yeni" farkı
  // elde ediyoruz — bu yüzden viewport'un height'ını ASLA ''(auto)'ya geri sıfırlamıyoruz, hep
  // açık bir piksel değeri olarak kalıyor.
  const currentPx = parseFloat(viewport.style.height);
  const from = !isNaN(currentPx) ? currentPx : (viewport.getBoundingClientRect().height || h);
  viewport.style.transition = 'none';
  if(animate && from!==h){
   viewport.style.height = from+'px';
   void viewport.offsetHeight;
   viewport.style.transition = 'height .26s var(--ease)';
   requestAnimationFrame(()=>{ viewport.style.height = h+'px'; });
  } else {
   viewport.style.height = h+'px';
  }
 }
 function goTo(i, animate){
  if(viewport.closest(".hub-flat")){touchStartX=null;dragging=false;panes.forEach(p=>p.setAttribute("aria-hidden","false"));return;}
  i = Math.max(0, Math.min(panes.length-1, i));
  measure();
  current = i;
  track.style.transition = animate ? 'transform .26s cubic-bezier(0.25,0.8,0.25,1)' : 'none';
  track.style.transform = `translateX(${baseX(i)}px)`;
  setHeight(animate);
  panes.forEach((p,j)=> p.setAttribute('aria-hidden', String(j!==i)));
  if(onIndexChange) onIndexChange(i);
 }
 viewport.addEventListener('touchstart', (e)=>{
  if(viewport.closest('.hub-flat')){touchStartX=null;return;}
  if(e.touches.length!==1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  dragging = false; velocity = 0;
  lastMoveX = touchStartX; lastMoveTime = e.timeStamp;
  measure();
  track.style.transition = 'none';
 }, {passive:true});
 viewport.addEventListener('touchmove', (e)=>{
  if(touchStartX===null) return;
  const touch = e.touches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if(!dragging){
   if(Math.abs(dx) < 5 || Math.abs(dx) <= Math.abs(dy)*2.2) return;
   dragging = true;
  }
  if(e.cancelable) e.preventDefault();
  const dt = e.timeStamp - lastMoveTime;
  if(dt>0) velocity = (touch.clientX - lastMoveX)/dt;
  lastMoveX = touch.clientX; lastMoveTime = e.timeStamp;
  // Uçtaki (ilk/son) sekmede daha ileri çekilirse lastik gibi hafifçe direnç göster — ama jesti
  // asla sayfa seviyesindeki sekme geçişine bırakma (o zaten touchstart'ta devre dışı bırakıldı).
  let d = dx;
  if(current<=0 && dx>0) d = dx*0.35;
  if(current>=panes.length-1 && dx<0) d = dx*0.35;
  track.style.transform = `translateX(${baseX(current)+d}px)`;
 }, {passive:false});
 viewport.addEventListener('touchend', (e)=>{
  if(touchStartX===null) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  touchStartX = null;
  if(!dragging) return;
  dragging = false;
  const distanceOk = Math.abs(dx) > cardW*0.3;
  const flickOk = Math.abs(velocity) > 0.35 && Math.sign(velocity)===Math.sign(dx);
  let target = current;
  if(distanceOk || flickOk){
   if(dx<0 && current<panes.length-1) target = current+1;
   else if(dx>0 && current>0) target = current-1;
  }
  goTo(target, true);
 }, {passive:true});
 viewport.addEventListener('touchcancel', ()=>{
  touchStartX = null;
  if(!dragging) return;
  dragging = false;
  goTo(current, true);
 }, {passive:true});
 goTo(0, false);
 // goTo() yüksekliği SADECE geçiş anında ölçüyor — ama ör. Hediyeler kartındaki "Geçmiş" panesi
 // gibi içeriği Firestore'dan asenkron gelen bir pane'e tam o veri gelmeden hemen önce/sırasında
 // kaydırılırsa, ölçülen yükseklik eski (kısa) kalıyor ve veri az sonra gelince viewport ya
 // içeriği kırpıyor ya da (dışarıdaki akordeon yükseklik izleyicisiyle çakışınca) kart aniden
 // küçülüp büyüyormuş gibi görünüyordu. Aktif pane'in kendi yüksekliğini sürekli izleyip her
 // değiştiğinde viewport'u yumuşakça buna göre ayarlayarak bunu kalıcı olarak çözüyoruz.
 const paneResizeObserver = new ResizeObserver(()=>{
  if(dragging) return;
  setHeight(true);
 });
 panes.forEach(p=>paneResizeObserver.observe(p));
 return { goTo, get current(){ return current; } };
}
// section: pane gruplarının (her biri bir veya birden çok .card) şu an düz sırayla çocuğu olduğu
// <section>. groups: [[cardEl], [cardEl], ...] veya gift gibi gruplu [[card1,card2],[card3]].
// buttonEntries: [{el:button, index:Number}] — segmented kontrolündeki sekme düğmeleri.
function buildInnerPaneCarousel(section, groups, buttonEntries){
 if(groups.length<2 || !groups[0] || !groups[0][0]) return null;
 const marker = document.createComment('inner-pane-carousel');
 section.insertBefore(marker, groups[0][0]);
 const viewport = document.createElement('div');
 viewport.className = 'inner-pane-viewport';
 const track = document.createElement('div');
 track.className = 'inner-pane-track';
 groups.forEach(group=>{
  const pane = document.createElement('div');
  pane.className = 'inner-pane';
  group.forEach(el=>{ if(el) pane.appendChild(el); });
  track.appendChild(pane);
 });
 viewport.appendChild(track);
 section.insertBefore(viewport, marker);
 marker.remove();
 const panes = [...track.children];
 const carousel = wireInnerPaneCarousel(viewport, track, panes, (i)=>{
  buttonEntries.forEach(({el,index})=>{
   const match = index===i;
   el.classList.toggle('active', match);
   el.setAttribute('role','tab');
   el.setAttribute('aria-selected', String(match));
  });
 });
 buttonEntries.forEach(({el,index})=> el.onclick = ()=> carousel.goTo(index, true));
 viewport._carousel = carousel;
 return carousel;
}
let innerCarouselResizeTimeout = null;
window.addEventListener('resize', ()=>{
 clearTimeout(innerCarouselResizeTimeout);
 innerCarouselResizeTimeout = setTimeout(()=>{
  document.querySelectorAll('.hub-item.expanded .inner-pane-viewport').forEach(vp=>{
   if(vp._carousel) vp._carousel.goTo(vp._carousel.current, false);
  });
 }, 150);
});
// Görünüm tercihleri tema gibi bu cihazda, kullanıcıya özel tutulur.
export function hubLayoutMode(hub){
 try{const value=localStorage.getItem('bookhook_layout_'+currentUid+'_'+hub);return ['expanded','tabs','primary'].includes(value)?value:'cards';}catch(_){return 'cards';}
}
function hubLayoutEnabled(hub){return hubLayoutMode(hub)!=='cards';}
function hubSubtabEntries(hub){
 return hub==='club'?[[materialRoute('records'),window.BH_I18N.pick("Kayıtlar","Records")],[materialRoute('badges'),window.BH_I18N.pick("Rozetler","Badges")],['gifts',window.BH_I18N.pick("Hediyeler","Gifts")]]:[['bookhistory',window.BH_I18N.pick("Keşfet","Discover")],['mybooks',window.BH_I18N.pick("Kitaplığım","My books")],['recs',window.BH_I18N.pick("Kitap önerileri","Recommendations")]];
}
function selectHubSubtab(hub,target,{focus=false}={}){
 const root=document.getElementById('tab-'+hub);if(!root)return;
 const enabled=hubLayoutMode(hub)==='tabs',entries=hubSubtabEntries(hub);
 if(!entries.some(([id])=>id===target))target=entries[0][0];
 root.dataset.hubSubtab=target;
 root.querySelectorAll('.hub-item').forEach(item=>{
  item.hidden=enabled&&item.dataset.hubTarget!==target;
  if(enabled){item.setAttribute('role','tabpanel');item.setAttribute('aria-labelledby','hub-subtab-'+hub+'-'+item.dataset.hubTarget);}
  else{item.removeAttribute('role');item.removeAttribute('aria-labelledby');}
 });
 const nav=root.querySelector('.hub-subtab-nav');
 if(nav){nav.hidden=!enabled;nav.querySelectorAll('[data-hub-subtab]').forEach(button=>{
  const selected=button.dataset.hubSubtab===target;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  if(selected&&focus)button.focus();
 });}
 if(hub==='library')document.getElementById('aiRecCard').hidden=enabled&&target!=='recs';
}
function applyHubLayout(hub,{render=false}={}){
 const root=document.getElementById('tab-'+hub);if(!root)return;
 const mode=hubLayoutMode(hub),flat=mode==='expanded'||mode==='tabs';
 root.classList.toggle('hub-flat',flat);root.classList.toggle('hub-subtabs',mode==='tabs');
 const entries=hubSubtabEntries(hub);
 let nav=root.querySelector('.hub-subtab-nav');
 const signature=entries.map(([id])=>id).join('|');
 if(nav&&nav.dataset.entries!==signature){nav.remove();nav=null;}
 if(!nav){
  nav=document.createElement('div');nav.className='hub-subtab-nav';nav.dataset.entries=signature;nav.setAttribute('role','tablist');nav.setAttribute('aria-label',hub==='club'?window.BH_I18N.pick("Kulüp bölümleri","Club sections"):window.BH_I18N.pick("Kitaplık bölümleri","Library sections"));
  nav.innerHTML=entries.map(([id,label])=>`<button type="button" role="tab" id="hub-subtab-${hub}-${id}" data-hub-subtab="${id}" aria-controls="hub-subpanel-${hub}-${id}">${label}</button>`).join('');
  root.querySelector('.page-subtitle').after(nav);
  nav.onclick=event=>{const button=event.target.closest('[data-hub-subtab]');if(button)selectHubSubtab(hub,button.dataset.hubSubtab);};
  nav.onkeydown=event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   const buttons=[...nav.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(i<0)return;
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
   selectHubSubtab(hub,buttons[next].dataset.hubSubtab,{focus:true});
  };
 }
 const main=document.querySelector('.content-col > main');
 root.querySelectorAll('.hub-item').forEach(item=>{
  item.id='hub-subpanel-'+hub+'-'+item.dataset.hubTarget;
  const section=document.getElementById('tab-'+item.dataset.hubTarget);if(!section)return;
  const panelInner=item.querySelector('.hub-item-panel-inner');
  section.classList.toggle('hub-flat',mode==='primary');section.classList.toggle('hub-primary-section',mode==='primary');
  if(mode==='primary'){main.append(section);section.classList.toggle('active',activeTab===item.dataset.hubTarget);}
  else if(flat){panelInner.append(section);section.classList.add('active');if(render)renderTab(item.dataset.hubTarget);}
  else if(main&&panelInner.contains(section)&&!item.classList.contains('expanded')){section.classList.remove('active');main.append(section);}
  section.querySelectorAll('.inner-pane-viewport').forEach(viewport=>{if(viewport._carousel)viewport._carousel.goTo(viewport._carousel.current,false);});
 });
 selectHubSubtab(hub,root.dataset.hubSubtab);
 moveHubPrimaryExtras(hub);
 if(hub==='library')syncAiHubLayout();
}
function syncAiHubLayout(){
 const heading=document.querySelector('.ai-card-heading'),panel=document.getElementById('aiRecDescriptions');
 if(hubLayoutEnabled('library')&&heading&&panel?.hidden)heading.click();
}
function initHubLayoutSettings(){
 const theme=document.getElementById('materialThemeSettings');
 if(!document.getElementById('hubLayoutSettings'))theme.insertAdjacentHTML('beforeend',window.BH_I18N.template`<div id="hubLayoutSettings"><h3>Sekme görünümü</h3>${[['club',window.BH_I18N.pick("Kulüp","Club")],['library',window.BH_I18N.pick("Kitaplık","Library")]].map(([id,label])=>`<div class="hub-layout-choice"><span id="hub-layout-label-${id}" class="hub-layout-label">${label}</span><div class="segmented hub-layout-segmented" role="group" aria-labelledby="hub-layout-label-${id}">${[['cards',window.BH_I18N.pick("Kartlar","Cards")],['expanded',window.BH_I18N.pick("Tüm İçerik","All content")],['tabs',window.BH_I18N.pick("Alt Sekme","Subtabs")],['primary',window.BH_I18N.pick("Ana Sekme","Main tabs")]].map(([mode,text])=>`<button type="button" data-hub-mode="${id}" data-layout-value="${mode}" aria-pressed="false">${text}</button>`).join('')}</div></div>`).join('')}</div>`);
 const controls=[...document.querySelectorAll('[data-hub-mode]')];
 const sync=()=>controls.forEach(input=>{const selected=input.dataset.layoutValue===hubLayoutMode(input.dataset.hubMode);input.classList.toggle('active',selected);input.setAttribute('aria-pressed',String(selected));});
 controls.forEach(input=>{input.onclick=()=>{
  const hub=input.dataset.hubMode;
  if(hubLayoutMode(hub)===input.dataset.layoutValue)return;
  try{localStorage.setItem('bookhook_layout_'+currentUid+'_'+hub,input.dataset.layoutValue);}
  catch(_){sync();showToast(window.BH_I18N.pick("Görünüm tercihi kaydedilemedi.","Could not save appearance preference."));return;}
  sync();applyHubLayout(hub,{render:activeTab===hub});renderMaterialNav();
  if(activeTab===hub&&hubLayoutMode(hub)==='primary')switchTab(hubSubtabEntries(hub)[0][0]);
  else if(hubSubtabEntries(hub).some(([id])=>id===activeTab)&&hubLayoutMode(hub)!=='primary')switchTab(hub);
  else materialSyncNavigation(activeTab,{resetScroll:false});
 };});
 sync();for(const hub of ['club','library'])applyHubLayout(hub);
}
function moveHubPrimaryExtras(hub){
 const root=document.getElementById('tab-'+hub),primary=hubLayoutMode(hub)==='primary';
 const extra=hub==='library'?document.getElementById('aiRecCard'):document.querySelector('.club-feature');
 const target=document.getElementById('tab-'+(hub==='library'?'recs':materialRoute('records')));
 const grid=root.querySelector('.club-grid');
 if(extra){if(primary){target.prepend(extra);extra.hidden=false;}else{root.insertBefore(extra,grid);if(hub==='library')extra.hidden=hubLayoutMode(hub)==='tabs'&&root.dataset.hubSubtab!=='recs';}}
}
function renderMaterialNav(){
 const tabs=materialPrimaryTabs(),nav=document.getElementById('tabs');
 nav.classList.toggle('many-tabs',tabs.length>4);
 nav.innerHTML=tabs.map(t=>`<button data-tab="${t.id}" aria-label="${t.label}"><span class="tab-icon">${t.icon}</span><span>${tabs.length>4&&t.id==='recs'?window.BH_I18N.pick("Öneriler","Recommendations"):t.label}</span></button>`).join('');
 nav.querySelectorAll('button').forEach(button=>button.onclick=()=>switchTab(button.dataset.tab));
}
// Yeniden menü kurulurken taşınmış asıl bölümler innerHTML ile silinmesin.
function preserveHubSections(){
 const main=document.querySelector('.content-col > main');
 document.querySelectorAll('#materialClubGrid .hub-item-panel-inner > section.tab, #materialLibraryGrid .hub-item-panel-inner > section.tab').forEach(section=>{
  section.classList.remove('active');main.append(section);
 });
}

function materialInit(){
 preserveHubSections();
 document.querySelectorAll('[data-material-name]').forEach(el=>el.textContent=myProfile.name||'');
 document.querySelectorAll('[data-material-date]').forEach(el=>el.textContent=nowLogical().toLocaleDateString(window.BH_I18N.locale,{day:'numeric',month:'long',weekday:'long'}));
 document.querySelectorAll('[data-panels]').forEach(control=>{
  const section=document.getElementById('tab-'+control.dataset.panels);
  // materialInit() ikinci kez çalışabiliyor (ör. profil tamamlanıp buildNav() tekrar çağrılınca) —
  // karusel zaten kurulduysa kartlar artık .inner-pane içine taşınmış olur, section.children'da
  // .card kalmaz; burada dokunmadan bırakıyoruz, yoksa düğmelerin onclick'i boş bir diziye
  // bağlanıp sekme geçişi sessizce kırılırdı.
  if(section.querySelector(':scope>.inner-pane-viewport')) return;
  const cards=[...section.children].filter(x=>x.classList.contains('card'));
  const chosen=Number(control.dataset.selected || (control.dataset.panels==='recs'?'1':control.dataset.panels==='week'||control.dataset.panels==='mtoday'?'1':'0'));
  const buttonEntries=[...control.querySelectorAll('[data-pane]')].map(btn=>({el:btn, index:Number(btn.dataset.pane)}));
  const carousel = buildInnerPaneCarousel(section, cards.map(c=>[c]), buttonEntries);
  if(carousel){ control.dataset.selected=String(chosen); carousel.goTo(chosen, false); }
  else {
   // Tek panelli/az kartlı güvenlik ağı — karusel kurulamadıysa eski göster/gizle davranışı.
   const select=(i)=>{ control.dataset.selected=String(i); cards.forEach((card,j)=>{card.hidden=i!==j;}); buttonEntries.forEach(({el,index})=>{el.classList.toggle('active',index===i); el.setAttribute('aria-selected', String(index===i));}); };
   buttonEntries.forEach(({el,index})=> el.onclick=()=>select(index));
   select(chosen);
  }
 });
 // Not: eskiden burada "Gruba" düğmesi görsel olarak başa alınıyordu (varsayılan seçili pane
 // buydu) — ama artık karusel pane'leri fiziksel olarak index sırasına göre yan yana dizildiği
 // için, düğme sırası içerikle eşleşmeli: Kişisel solda/0, Gruba sağda/1, ikisi de karusel
 // konumuyla tutarlı. Varsayılan "chosen" hâlâ Gruba (1) gösteriyor, karusel açılışta oraya kayıp
 // solundan Kişisel'in ufak bir dilimini (peek) gösteriyor.
 const gifts=document.getElementById('tab-gifts');
 if(!document.getElementById('materialGiftTabs'))gifts.insertAdjacentHTML('afterbegin',window.BH_I18N.pick("<div class=\"segmented scrollable\" id=\"materialGiftTabs\"><button data-gift-view=\"0\" class=\"active\">Bekleyen</button><button data-gift-view=\"1\">Geçmiş</button><button data-gift-view=\"2\">Hediye Kayıtları</button><button data-gift-view=\"3\">Hediye Kitap Geçmişi</button></div>","<div class=\"segmented scrollable\" id=\"materialGiftTabs\"><button data-gift-view=\"0\" class=\"active\">Pending</button><button data-gift-view=\"1\">History</button><button data-gift-view=\"2\">Gift records</button><button data-gift-view=\"3\">Book gift history</button></div>"));
 if(!gifts.querySelector(':scope>.inner-pane-viewport')){
  // Burada artık .card sınıfına göre otomatik dilimleme yerine elemanları tek tek isimlendirip
  // elle grupluyoruz — 4 sekme hepsi aynı seviyede, yan yana: Bekleyen / Geçmiş / Hediye
  // Kayıtları / Hediye Kitap Geçmişi (iç içe değil, düz bir karusel).
  const giftMainCard = document.getElementById('giftsContent') ? document.getElementById('giftsContent').closest('.card') : null;
  const qpGiftCard = document.getElementById('qpGiftCardWrap');
  const lastWeekCard = document.getElementById('giftsMemberLastWeekWrap');
  const drawHistCard = document.getElementById('giftsDrawHistAdminWrap') ? document.getElementById('giftsDrawHistAdminWrap').closest('.card') : null;
  const giftStatsCard = document.getElementById('giftStatsList') ? document.getElementById('giftStatsList').closest('.card') : null;
  const giftBooksCard = document.getElementById('giftBooksGrid') ? document.getElementById('giftBooksGrid').closest('.card') : null;
  const giftButtonEntries=[...document.querySelectorAll('[data-gift-view]')].map(btn=>({el:btn, index:Number(btn.dataset.giftView)}));
  const giftGroups=[
   [giftMainCard, qpGiftCard].filter(Boolean),
   [lastWeekCard, drawHistCard].filter(Boolean),
   [giftStatsCard].filter(Boolean),
   [giftBooksCard].filter(Boolean)
  ].filter(g=>g.length);
  const giftCarousel = giftGroups.length>1 ? buildInnerPaneCarousel(gifts, giftGroups, giftButtonEntries) : null;
  if(!giftCarousel){
   const allGiftCards=[giftMainCard, qpGiftCard, lastWeekCard, drawHistCard, giftStatsCard, giftBooksCard].filter(Boolean);
   const selectGifts=(view)=>{ allGiftCards.forEach(c=>c.hidden=false); giftButtonEntries.forEach(({el,index})=>el.classList.toggle('active',index===view)); };
   giftButtonEntries.forEach(({el,index})=>el.onclick=()=>selectGifts(index));
   selectGifts(0);
  }
 }
 const admin=myProfile.role==='admin';
 document.getElementById('materialClubGrid').innerHTML=[[materialRoute('records'),window.BH_I18N.pick("Kayıtlar","Records"),window.BH_I18N.pick("Haftalık okuma durumları","Weekly reading status"),'records'],[materialRoute('badges'),window.BH_I18N.pick("Rozetler","Badges"),window.BH_I18N.pick("Okuma serilerini kutlayalım","Celebrate reading streaks"),'badge'],['gifts',window.BH_I18N.pick("Hediyeler","Gifts"),window.BH_I18N.pick("Kitaplaşan dostluklar","Friendships through books"),'gift']].map(x=>materialHubLink('club',...x)).join('');
 document.getElementById('materialLibraryGrid').innerHTML=[['bookhistory',window.BH_I18N.pick("Keşfet","Discover"),window.BH_I18N.pick("Popüler kitaplar ve öneriler","Popular books and recommendations"),'search'],['mybooks',window.BH_I18N.pick("Kitaplığım","My books"),window.BH_I18N.pick("Okuduğun ve okuyacağın kitaplar","Books you’ve read and want to read"),'book'],['recs',window.BH_I18N.pick("Kitap önerileri","Recommendations"),window.BH_I18N.pick("Kulüpten ve senden gelen öneriler","Recommendations from you and your club"),'heart']].map(x=>materialHubLink('library',...x)).join('');
 document.getElementById('materialSettingsGrid').innerHTML=[['rules',window.BH_I18N.pick("Grup kuralları","Club rules"),'Birlikte daha iyi bir deneyim','rules',true],['settings',window.BH_I18N.pick("Uygulama ayarları","App settings"),'Bildirimler, tema, hesap','account',true],...(admin?[['admin',window.BH_I18N.pick("Yönetim","Administration"),window.BH_I18N.pick("Kulüp ayarları ve üyeler","Club settings and members"),'settings',true]]:[])].map(x=>materialHubLink('appsettings',...x)).join('');
 document.getElementById('materialAdminLinks').innerHTML=[['members',window.BH_I18N.pick("Üyeler","Members"),window.BH_I18N.pick("Rol, katılım tarihi, ban ve silme","Roles, join dates, suspensions and deletion"),'club'],['whoreadtoday',window.BH_I18N.pick("Bugün kim okudu","Who read today"),window.BH_I18N.pick("Günlük durumları yönet","Manage daily check-ins"),'records'],['editpast',window.BH_I18N.pick("Geçmiş okumaları düzenle","Edit past reading"),window.BH_I18N.pick("Gün ve hafta kayıtları","Daily and weekly records"),'records'],['rules',window.BH_I18N.pick("Kurallar ve öneriler","Rules and suggestions"),window.BH_I18N.pick("Kulüp kuralları ve gelen öneriler","Club rules and incoming suggestions"),'book']].map(x=>materialLink(...x)).join('');
 const maintenance=document.getElementById('settingsAdminOnlyWrap');
 if(maintenance) document.getElementById('materialMaintenance').append(maintenance);
 const settings=document.getElementById('tab-settings');
 if(!document.getElementById('materialThemeSettings')){
  settings.insertAdjacentHTML('afterbegin',window.BH_I18N.template`<div class="card" id="materialThemeSettings"><h2>Görünüm</h2><p class="muted">Uygulamanın temasını seç.</p><div class="segmented" id="materialThemeChoices"><button data-theme-choice="light">Açık</button><button data-theme-choice="dark">Koyu</button><button data-theme-choice="auto">Otomatik</button></div><p class="muted">Otomatik tema günün saatine göre değişir.</p></div>`);
  settings.insertAdjacentHTML('beforeend',window.BH_I18N.template`<div class="settings-list">${materialLink('profile',window.BH_I18N.pick("Profilim","My profile"),window.BH_I18N.pick("Ad, iletişim ve adres bilgilerin","Name, contact and address details"),'account')}<button class="destination-row" id="materialEnablePush"><span class="route-icon">${materialIcon('bell')}</span><span><b>Bildirimleri Aç</b><small>Bu cihazdaki bildirim izni</small></span><span aria-hidden="true">›</span></button><button class="destination-row" id="materialGuideBtn"><span class="route-icon">${materialIcon('book')}</span><span><b>Kullanım rehberi</b><small>BookHook nasıl çalışır?</small></span><span aria-hidden="true">›</span></button><button class="destination-row danger" id="materialLogout"><span class="route-icon">${materialIcon('logout')}</span><span><b>Çıkış yap</b></span><span aria-hidden="true">›</span></button></div>`);
  document.getElementById('materialEnablePush').onclick=enablePushNotifications;
  document.getElementById('materialGuideBtn').onclick=()=>{ document.getElementById('guideModal').style.display='flex'; };
  document.getElementById('materialLogout').onclick=()=>document.getElementById('logoutBtn').click();
 }
 document.querySelectorAll('[data-theme-choice]').forEach(button=>{
  button.onclick=()=>{const v=button.dataset.themeChoice;setAutoThemeEnabled(v==='auto');setTheme(v==='auto'?computeAutoTheme():v);materialThemeSync();};
 });
 initLanguageSettings();
 initPaletteSettings();
 materialThemeSync();
 initHubLayoutSettings();
 materialSettingsPresentation();
 const name=document.getElementById('whoamiClickable');name.setAttribute('role','button');name.tabIndex=0;name.setAttribute('aria-label',window.BH_I18N.pick("Profilim","My profile"));name.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();name.click();}};
 document.querySelectorAll('button[title]').forEach(button=>{if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.title);});
 document.getElementById('notifBellBtn').setAttribute('aria-label',window.BH_I18N.pick("Bildirimler","Notifications"));
 document.getElementById('hamburgerBtn').setAttribute('aria-label','Hesap ve ayarlar');
}
function materialSettingsPresentation(){
 const settings=document.getElementById('tab-settings');
 for(const card of settings.querySelectorAll(':scope > .card')){
  const heading=card.querySelector(':scope > h2');if(!heading)continue;
  const group=document.createElement('div');group.className='settings-group';
  card.before(group);group.append(heading,card);card.classList.add('settings-surface');
 }
 settings.querySelectorAll('[data-setting-icon]').forEach(label=>{
  if(label.querySelector('svg'))return;
  label.insertAdjacentHTML('afterbegin',`<span class="route-icon">${materialIcon(label.dataset.settingIcon)}</span>`);
  const row=label.closest('.member-row'),input=row.querySelector('input');
  row.classList.add('notification-setting');input.setAttribute('role','switch');input.setAttribute('aria-label',label.textContent.trim());
  const text=document.createElement('label');text.htmlFor=input.id;label.replaceWith(text);text.append(label);
  const knob=document.createElement('span');knob.className='layout-switch';knob.setAttribute('aria-hidden','true');input.after(knob);
 });
 const push=document.getElementById('materialEnablePush');
 if(push)push.querySelector('b').textContent=('Notification' in window&&Notification.permission==='granted')?window.BH_I18N.pick("Bildirimler Açık","Notifications enabled"):window.BH_I18N.pick("Bildirimleri Aç","Enable notifications");
 const rules=document.getElementById('tab-rules');
 for(const card of rules.querySelectorAll(':scope > .card')){
  const heading=card.querySelector(':scope > h2');if(!heading)continue;
  const group=document.createElement('div');group.className='settings-group';card.before(group);group.append(heading,card);card.classList.add('settings-surface');
 }
}
function initPaletteSettings(){
 const host=document.getElementById('materialThemeSettings');
 if(!host)return;
 if(!document.getElementById('materialPaletteChoices')){
  host.insertAdjacentHTML('beforeend',window.BH_I18N.template`<h3 id="materialPaletteLabel">Renk paleti</h3><div class="segmented palette-choices" id="materialPaletteChoices" role="group" aria-labelledby="materialPaletteLabel">${[['green',window.BH_I18N.pick("Yeşil","Green"),'#42664b'],['blue',window.BH_I18N.pick("Mavi","Blue"),'#415f91'],['purple',window.BH_I18N.pick("Mor","Purple"),'#6750a4'],['rose',window.BH_I18N.pick("Pembe","Pink"),'#984061'],['amber','Amber','#805610']].map(([id,label,color])=>`<button type="button" data-palette-choice="${id}" aria-pressed="false"><span class="palette-swatch" style="--swatch:${color}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg></span><span>${label}</span></button>`).join('')}</div>`);
 }
 host.querySelectorAll('[data-palette-choice]').forEach(button=>{
  button.onclick=()=>{
   document.documentElement.dataset.palette=button.dataset.paletteChoice;
   try{localStorage.setItem('bookhook_palette',button.dataset.paletteChoice);}catch(e){}
   materialThemeSync();
  };
 });
}
function initLanguageSettings(){
 const host=document.getElementById('materialThemeSettings');
 if(!host||document.getElementById('materialLanguageChoices'))return;
 const section=document.createElement('div');section.className='language-setting';
 section.innerHTML=window.BH_I18N.pick("<h3 id=\"materialLanguageLabel\">Dil</h3><div class=\"segmented\" id=\"materialLanguageChoices\" role=\"group\" aria-labelledby=\"materialLanguageLabel\"><button type=\"button\" data-language=\"tr\" lang=\"tr\">Türkçe</button><button type=\"button\" data-language=\"en\" lang=\"en\">English</button></div>","<h3 id=\"materialLanguageLabel\">Language</h3><div class=\"segmented\" id=\"materialLanguageChoices\" role=\"group\" aria-labelledby=\"materialLanguageLabel\"><button type=\"button\" data-language=\"tr\" lang=\"tr\">Türkçe</button><button type=\"button\" data-language=\"en\" lang=\"en\">English</button></div>");
 host.prepend(section);
 section.querySelectorAll('[data-language]').forEach(button=>{
  const selected=button.dataset.language===window.BH_I18N.language;
  button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
  button.onclick=()=>{
   if(button.dataset.language===window.BH_I18N.language)return;
   try{localStorage.setItem('bookhook_language',button.dataset.language);sessionStorage.setItem('bookhook_language_return','settings');}
   catch(e){showToast(window.BH_I18N.pick("Dil tercihi kaydedilemedi.","Could not save your language preference."));return;}
   location.reload();
  };
 });
}

function materialThemeSync(){
 const selected=getAutoThemeEnabled()?'auto':document.documentElement.getAttribute('data-theme')||'light';
 document.querySelectorAll('[data-theme-choice]').forEach(button=>{button.classList.toggle('active',button.dataset.themeChoice===selected);button.setAttribute('aria-pressed',String(button.dataset.themeChoice===selected));});
 const palette=document.documentElement.dataset.palette||'green';
 document.querySelectorAll('[data-palette-choice]').forEach(button=>{const active=button.dataset.paletteChoice===palette;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
}
// Herhangi bir ekranın, birincil (alt gezinme) sekmelerinden hangisine ait olduğunu bulur —
// admin alt ekranları (members/manual/...) önce 'admin'e, o da HUB_PARENT üzerinden kendi
// hub'ına (artık 'appsettings') çözülür; hub kartı id'leri (gifts/rules/bookhistory/...) zaten
// HUB_PARENT'ta kayıtlı. Eşleşme yoksa güvenli varsayılan olarak 'club' döner.
const ADMIN_SUB_SCREENS = ['members','manual','qptest','editpast','whoreadtoday','goodreadsimport'];
function materialHubRoot(id){
 if(ADMIN_SUB_SCREENS.includes(id)) id = 'admin';
 if(['club','library','appsettings'].includes(id)) return id;
 return HUB_PARENT[id] || 'club';
}
// materialHubRoot() admin alt ekranlarını (members/manual/goodreadsimport/...) İKİ seviye birden
// çözüyor (önce 'admin'e, sonra HUB_PARENT üzerinden 'appsettings'e) — bu, alt nav'da hangi
// birincil sekmenin vurgulanacağını bulmak için doğru, ama geri tuşu için YANLIŞ: geri tuşu bir
// üst seviyeye (admin alt ekranından → admin'e) çıkmalı, direkt en tepeye (appsettings) değil.
// Bu yüzden geri tuşu ayrı, TEK seviye çözen bu fonksiyonu kullanıyor.
function materialImmediateParent(id){
 if(ADMIN_SUB_SCREENS.includes(id)) return 'admin';
 if(['club','library','appsettings'].includes(id)) return id;
 return HUB_PARENT[id] || 'club';
}
// Her sekme değişiminde sayfayı en üste sıfırlamak için düz window.scrollTo(0,0) kullanmak,
// kullanıcı önceki sekmede aşağı kaymışsa GERÇEK, tarayıcının kendisinin de fark ettiği bir
// kaydırma sıçraması yaratıyordu — bu da (dokunuşla hiç ilgisi olmadan, sadece bu programatik
// sıçramadan dolayı) Android Chrome'un adres çubuğu animasyonunu tetikleyip alt sekme çubuğunun
// geçiş boyunca kaybolmasına sebep olabiliyordu (kaydırma kilidimiz sadece parmakla sürüklerken
// çalışıyordu, bu programatik sıçrama ondan tamamen bağımsızdı). Burada da aynı "body'yi olduğu
// yerde dondur" tekniğiyle, tarayıcının fark edeceği gerçek bir kaydırma hiç oluşturmadan üste
// zıplıyoruz.
// Video kanıtıyla doğrulandı: burada önceden body.style.position='fixed' ile "sessizce"
// kaydırma sıfırlama numarası vardı — ama .sidebar (alt nav) da position:fixed olduğu için,
// body'yi de position:fixed yapmak Android Chrome'da "fixed içinde fixed" durumu oluşturuyor ve
// nav birkaç kare boyunca tamamen kayboluyordu (tam olarak bu fonksiyonun her swipe/sekme
// geçişinde iki kez çağrıldığı anlarla örtüşen bir video kaydında doğrulandı). body'nin
// Body'nin position değerini değiştirmeden kaydırmayı aynı karede sıfırla.
// CSS scroll-behavior:smooth, scrollTop atamasını da yumuşatabildiği için geçici olarak kapat.
function silentScrollToTop(){
 const roots=[document.documentElement,document.body];
 const previous=roots.map(el=>[el.style.getPropertyValue('scroll-behavior'),el.style.getPropertyPriority('scroll-behavior')]);
 roots.forEach(el=>el.style.setProperty('scroll-behavior','auto','important'));
 roots.forEach(el=>{el.scrollTop=0;});
 roots.forEach((el,i)=>{const [value,priority]=previous[i];if(value)el.style.setProperty('scroll-behavior',value,priority);else el.style.removeProperty('scroll-behavior');});
}
function materialSyncNavigation(id, { resetScroll = true } = {}){
 const primary=materialPrimaryTabs().map(t=>t.id);
 document.body.dataset.screen=id;
 document.body.classList.toggle('detail-screen',!primary.includes(id));
 const back=document.getElementById('materialBack');back.hidden=primary.includes(id);
 back.onclick=()=>switchTab((id==='profile'||id==='appsettings')?getTabOrder()[0]:materialImmediateParent(id));
 document.querySelectorAll('nav.tabs button').forEach(button=>{const selected=button.dataset.tab===(primary.includes(id)?id:materialHubRoot(id));button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');});
 const nav=document.getElementById('tabs'),selected=nav.querySelector('button.active');
 if(selected&&nav.classList.contains('many-tabs')){
  const n=nav.getBoundingClientRect(),r=selected.getBoundingClientRect();
  if(r.left<n.left)nav.scrollLeft-=n.left-r.left;else if(r.right>n.right)nav.scrollLeft+=r.right-n.right;
  if(r.top<n.top)nav.scrollTop-=n.top-r.top;else if(r.bottom>n.bottom)nav.scrollTop+=r.bottom-n.bottom;
 }
 const names={week:window.BH_I18N.pick("Kayıtlar","Records"),mtoday:window.BH_I18N.pick("Kayıtlar","Records"),bookhistory:window.BH_I18N.pick("Keşfet","Discover"),mybooks:window.BH_I18N.pick("Kitaplığım","My books"),club:window.BH_I18N.pick("Kulüp","Club"),library:window.BH_I18N.pick("Kitaplık","Library"),appsettings:window.BH_I18N.pick("Ayarlar","Settings"),quarterly:window.BH_I18N.pick("Ortak kitap","Shared book"),admin:window.BH_I18N.pick("Yönetim","Administration"),worms:window.BH_I18N.pick("Rozetler","Badges"),mworms:window.BH_I18N.pick("Rozetler","Badges"),gifts:window.BH_I18N.pick("Hediyeler","Gifts"),recs:window.BH_I18N.pick("Kitap önerileri","Recommendations"),rules:window.BH_I18N.pick("Grup kuralları","Club rules"),settings:window.BH_I18N.pick("Uygulama ayarları","App settings"),today:window.BH_I18N.pick("Bugün","Today"),msurvey:window.BH_I18N.pick("Bugün","Today")};
 if(names[id]) setTabTitleAnimated(names[id]);
 if(resetScroll) silentScrollToTop();
}
async function materialRenderClub(){
 try{
  const snap=await getDoc(qpDocRef());const qp=snap.exists()?snap.data():null;
  document.getElementById('clubBookTitle').textContent=qp&&qp.winnerTitle||window.BH_I18N.pick("Sıradaki kitabımızı seçelim","Let’s choose our next book");
  const labels={nominating:window.BH_I18N.pick("Öneri toplama","Collecting nominations"),objecting:window.BH_I18N.pick("İtiraz süresi","Objection period"),voting:'Oylama',reading:window.BH_I18N.pick("Okuma dönemi","Reading period")};
  document.getElementById('clubBookMeta').textContent=qp?labels[qp.phase]||window.BH_I18N.pick("Ortak kitap","Shared book"):window.BH_I18N.pick("Birlikte seç, birlikte oku","Choose together, read together");
 }catch(e){document.getElementById('clubBookMeta').textContent=window.BH_I18N.pick("Ortak kitap seçimine git","Go to shared book selection");}
}
function materialRenderPhase(qp){
 const steps=document.getElementById('materialQpSteps');if(!steps)return;
 const phases=['nominating','objecting','voting','reading'];const labels=[window.BH_I18N.pick("Öneri","Recommendation"),window.BH_I18N.pick("İtiraz","Objection"),'Oylama','Okuma'];
 const i=qp?phases.indexOf(qp.phase):-1;
 steps.innerHTML=phases.map((p,n)=>`<div class="phase-step ${n===i?'current':''} ${n<i?'complete':''}" ${n===i?'aria-current="step"':''}><span>${n<i?'✓':n+1}</span><small>${labels[n]}</small></div>`).join('');
}
document.body.addEventListener('click',e=>{
 const route=e.target.closest('[data-material-route]');if(!route||!myProfile)return;
 const id=materialRoute(route.dataset.materialRoute);
 if(['admin','members','manual','qptest','editpast','whoreadtoday','goodreadsimport'].includes(id)&&myProfile.role!=='admin')return;
 switchTab(id);
});
// Keyboard support for dynamically rendered interactive cards without changing their actions.
document.body.addEventListener('keydown',e=>{
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('.bh-card,.discover-book-card,.qp-vs-card,.notif-row')){e.preventDefault();e.target.click();}
});
const materialObserver=new MutationObserver(records=>{
 for(const record of records)for(const added of record.addedNodes){
  if(added.nodeType!==1)continue;
  const cards=[...(added.matches('.bh-card,.discover-book-card,.qp-vs-card,.notif-row')?[added]:[]),...added.querySelectorAll('.bh-card,.discover-book-card,.qp-vs-card,.notif-row')];
  cards.forEach(card=>{card.tabIndex=0;card.setAttribute('role','button');});
 }
});
materialObserver.observe(document.getElementById('appRoot'),{childList:true,subtree:true});
// Dialogs stay in the viewport and keep keyboard focus inside the active screen.
let materialDialog=null, materialReturnFocus=null;
const materialModalObserver=new MutationObserver(()=>{
 const open=[...document.querySelectorAll('.modal-overlay-anim')].filter(el=>el.style.display==='flex').sort((a,b)=>Number(getComputedStyle(a).zIndex)-Number(getComputedStyle(b).zIndex));
 const top=open.at(-1)||null;
 if(top===materialDialog)return;
 if(top){
  if(!materialDialog)materialReturnFocus=document.activeElement;
  document.documentElement.style.overflow='hidden';top.setAttribute('role','dialog');top.setAttribute('aria-modal','true');
  const heading=top.querySelector('h2');top.setAttribute('aria-label',heading?.textContent||'Detay');
  top.querySelector('button')?.focus({preventScroll:true});
 }else{
  document.documentElement.style.overflow='';materialReturnFocus?.focus({preventScroll:true});materialReturnFocus=null;
 }
 materialDialog=top;
});
document.querySelectorAll('.modal-overlay-anim').forEach(el=>materialModalObserver.observe(el,{attributes:true,attributeFilter:['style']}));
document.addEventListener('keydown',e=>{
 if(!materialDialog)return;
 if(e.key==='Escape'){closeModal(materialDialog.id);e.preventDefault();return;}
 if(e.key!=='Tab')return;
 const items=[...materialDialog.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
 if(!items.length)return;
 if(e.shiftKey&&document.activeElement===items[0]){items.at(-1).focus();e.preventDefault();}
 else if(!e.shiftKey&&document.activeElement===items.at(-1)){items[0].focus();e.preventDefault();}
});

/* Kart özetleri: salt okunur veri, sabit boyut, görünürken 3 saniyelik dönüşüm. */
const hubPreviews=(()=>{
 const states=new Map(), cache=new Map();
 let owner=null, touching=false, quietUntil=0, observer=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const esc=v=>escapeHtml(String(v??''));
 const metric=(label,value,detail='',icon='✦',tone='')=>({label,value:String(value),detail,icon,tone});
 const book=(b,label)=>({label,title:b.title||b.bookTitle||b.t||window.BH_I18N.pick("İsimsiz kitap","Untitled book"),detail:b.author||b.a||b.note||'',cover:b.cover||b.coverUrl||'',book:true});
 function coverURL(url){try{const u=new URL(url,location.href);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
 function content(s){
  if(s.book){const url=coverURL(s.cover);return `${materialBookCover(s.title,url,'hp-book-cover')}<span class="hp-copy"><small class="hp-eyebrow">${esc(s.label)}</small><strong class="hp-book-title">${esc(s.title)}</strong><span class="hp-detail">${esc(s.detail)}</span></span>`;}
  if(s.stats)return `<span class="hp-copy"><small class="hp-eyebrow">${esc(s.label)}</small><span class="hp-stats">${s.stats.map(x=>`<span class="hp-stat ${x.tone}"><i>${esc(x.icon)}</i><b>${esc(x.value)}</b><small>${esc(x.label)}</small></span>`).join('')}</span><span class="hp-detail">${esc(s.detail)}</span></span>`;
  const badge=BADGE_DEFS.find(d=>d.icon===s.icon);
  return `<span class="hp-emblem ${esc(s.tone)}">${badge?badgeIllustration(badge.key):esc(s.icon)}</span><span class="hp-copy"><small class="hp-eyebrow">${esc(s.label)}</small><strong class="hp-value">${esc(s.value)}</strong><span class="hp-detail">${esc(s.detail)}</span></span>`;
 }
 function paint(st,animate=false,direction=0){
  const slide=st.slides[st.index%st.slides.length], host=st.item.querySelector('.hp-stage');if(!host)return;
  const frame=document.createElement('span');frame.className='hp-frame';frame.innerHTML=content(slide);
  frame.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
  host.replaceChildren(frame);
  if(animate&&!reduced.matches)frame.animate([{opacity:0,transform:direction?`translateX(${direction*24}px)`:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.2,0,0,1)'});
  st.item.querySelector('.hp-position').textContent=st.slides.length>1?`${st.index+1} / ${st.slides.length}`:window.BH_I18N.pick("Özet","Summary");
  st.item.querySelectorAll('.hp-controls button').forEach(b=>b.disabled=st.slides.length<2);
  st.at=performance.now();
 }
 function set(key,slides){const st=states.get(key);if(!st)return;st.slides=slides.length?slides:[metric(window.BH_I18N.pick("Henüz kayıt yok","No records yet"),window.BH_I18N.pick("Yeni bir başlangıç","A new beginning"),window.BH_I18N.pick("Ayrıntılar için kartı aç.","Open the card for details."))];st.index=0;paint(st);}
 function mount(){
  if(!observer)observer=new IntersectionObserver(entries=>{for(const e of entries){const st=states.get(e.target.dataset.preview);if(st){st.visible=e.isIntersecting;st.at=performance.now();}}},{threshold:.25});
  for(const gridId of ['materialClubGrid','materialLibraryGrid']){
   const grid=document.getElementById(gridId);if(!grid)continue;
   grid.querySelectorAll('.hub-item').forEach(item=>{
    const target=item.dataset.hubTarget;
    const key=['week','mtoday'].includes(target)?'records':['worms','mworms'].includes(target)?'badges':target;
    if(!['records','badges','gifts','bookhistory','mybooks','recs'].includes(key))return;
    if(states.get(key)?.item===item)return;
    const old=states.get(key);if(old)observer.unobserve(old.item);
    item.dataset.preview=key;
    const summary=item.querySelector('.hub-item-summary'), label=(summary.querySelector('.hp-heading')||summary.querySelector('b')).textContent;
    const illustrationKey={records:'records',badges:'badge',gifts:'gift',bookhistory:'search',mybooks:'book',recs:'heart'}[key];
    summary.innerHTML=window.BH_I18N.template`<span class="hp-illustration" aria-hidden="true">${HUB_ILLUSTRATIONS[illustrationKey]||''}</span><span class="hp-heading">${esc(label)}</span><span class="hp-stage"></span><span class="hp-footer"><span class="hp-position">Özet</span></span>`;
    const st={item,slides:old?.slides||[metric(window.BH_I18N.pick("Hazırlanıyor","Preparing"),'Birazdan burada',window.BH_I18N.pick("Güncel özetler yükleniyor.","Loading current previews."))],index:0,at:performance.now(),visible:false};states.set(key,st);observer.observe(item);wirePreviewArrows(st);paint(st);
   });
  }
 }
 function wirePreviewArrows(st){
  st.item.querySelector('.hp-controls')?.remove();
  const controls=document.createElement('div');controls.className='hp-controls';
  controls.innerHTML='<button type="button" data-step="-1" aria-label="Önceki önizleme">‹</button><button type="button" data-step="1" aria-label="Sonraki önizleme">›</button>';
  controls.querySelectorAll('button').forEach(button=>button.addEventListener('click',e=>{
    e.stopPropagation();if(st.slides.length<2)return;
    const direction=Number(button.dataset.step);
    st.index=(st.index+direction+st.slides.length)%st.slides.length;paint(st,true,direction);
    if(e.detail>0)button.blur();
  }));
  st.item.append(controls);
 }
 function safe(key,fn,uid){return Promise.resolve().then(fn).then(slides=>{if(currentUid===uid)set(key,slides);}).catch(()=>{if(currentUid===uid)set(key,[metric('Şu an yüklenemedi',window.BH_I18N.pick("Özet hazır değil","Summary not ready"),window.BH_I18N.pick("Ayrıntıları açarak tekrar deneyebilirsin.","Open the details to try again."),'↻')]);});}
 async function club(uid){
  await Promise.all([
   safe('records',async()=>{
    const rows=await computeWeekStats(getMonday(nowLogical()));const me=rows.find(x=>x.uid===uid);const classified=rows.filter(x=>x.marked>0);
    const status=!me?.marked?metric(window.BH_I18N.pick("Bu haftaki durumun","Your status this week"),window.BH_I18N.pick("Henüz kayıt yok","No records yet"),window.BH_I18N.pick("İlk okumanı işaretleyebilirsin.","You can record your first reading day."),'·'):me.miss>=2?metric(window.BH_I18N.pick("Bu haftaki durumun","Your status this week"),window.BH_I18N.pick("Cezalı","Penalty"),`${me.read} okuma · ${me.miss} okunmayan gün`,'×','hp-danger'):me.miss===1?metric(window.BH_I18N.pick("Bu haftaki durumun","Your status this week"),window.BH_I18N.pick("Pas","Pass"),`${me.read} okuma · 1 pas`,'−','hp-pass'):metric(window.BH_I18N.pick("Bu haftaki durumun","Your status this week"),window.BH_I18N.pick("Tam okuyan","Read every day"),window.BH_I18N.template`${me.read} okuma · Şu ana kadarki kayıtların`,'✓','hp-ok');
    return [status,{label:window.BH_I18N.pick("Kulübün bu haftası","The club this week"),stats:[{icon:'✓',tone:'hp-ok',value:classified.filter(x=>!x.miss).length,label:window.BH_I18N.pick("Tam okuyan","Read every day")},{icon:'−',tone:'hp-pass',value:classified.filter(x=>x.miss===1).length,label:window.BH_I18N.pick("Pas","Pass")},{icon:'×',tone:'hp-danger',value:classified.filter(x=>x.miss>=2).length,label:window.BH_I18N.pick("Cezalı","Penalty")}],detail:window.BH_I18N.template`${rows.length-classified.length} kişi için henüz haftalık kayıt yok`}];
   },uid),
   safe('badges',async()=>{
    // Aynı gün verileri tüm üyeler için bir kez okunur; üye başına 61 sorgu açılmaz.
    const dates=Array.from({length:61},(_,i)=>toStr(addDays(nowLogical(),-i)));
    const days=[];
    for(let i=0;i<dates.length;i+=8) days.push(...await Promise.all(dates.slice(i,i+8).map(fetchDayAnswers)));
    const leaders=activeUids().map(id=>{
      let count=0,start=days[0]?.[id]?.status==='read'?0:1;
      for(let i=start;i<days.length && days[i]?.[id]?.status==='read';i++)count++;
      return {uid:id,streak:count,name:usersCache[id]?.name||window.BH_I18N.pick("Kulüp üyesi","Club member")};
    });
    // 61 günlük ortak pencerenin sonuna kadar dolu okuyanların serisi daha uzun olabilir; onları
    // tek tek, sınırsız sayan computeStreak ile kesinleştir (yoksa 60'ta takılı görünürdü).
    await Promise.all(leaders.map(async l=>{ if(l.streak>=days.length-1) l.streak=await computeStreak(l.uid); }));
    leaders.sort((a,b)=>b.streak-a.streak||a.name.localeCompare(b.name,'tr')||a.uid.localeCompare(b.uid));
    const streak=leaders.find(x=>x.uid===uid)?.streak||0;const def=BADGE_DEFS.find(x=>x.key===currentTierForStreak(streak));const u=usersCache[uid]||{};
    const next=BADGE_DEFS.find(x=>x.days>streak);
    const slides=[metric(window.BH_I18N.pick("Okuma serin","Reading streak"),window.BH_I18N.template`${streak} gün`,next?window.BH_I18N.template`Sonraki rozete ${next.days-streak} gün`:window.BH_I18N.pick("En yüksek seri rozetindesin.","You’ve reached the highest streak badge."),'♨','hp-ok'),metric('Aktif rozetin',def?def.label:window.BH_I18N.pick("Henüz rozet yok","No badges yet"),def?window.BH_I18N.pick("Her gün okumaya devam.","Keep reading every day."):window.BH_I18N.pick("İlk rozet için 3 gün üst üste oku.","Read for 3 days in a row to earn your first badge."),def?.icon||'✦'),metric(def?window.BH_I18N.pick("Bu rozetin geçmişi","History of this badge"):window.BH_I18N.pick("Rozet geçmişin","Your badge history"),def?`${Number(u.badgeCounts?.[def.key]||0)+1} kez`:`${Object.values(u.badgeCounts||{}).reduce((a,b)=>a+Number(b||0),0)} rozet`,def?window.BH_I18N.pick("Geçmiş kazanımlar + aktif serin","Past achievements and your current streak"):'Tamamlanmış serilerde kazanılan rozetler','✧')];
    leaders.slice(0,3).forEach(person=>{
      const badge=BADGE_DEFS.find(d=>d.key===currentTierForStreak(person.streak));
      const rank=1+leaders.filter(x=>x.streak>person.streak).length;
      slides.push(metric(window.BH_I18N.template`Seri liderleri · ${rank}. sıra`,person.name,window.BH_I18N.template`${person.streak} gün · ${badge?badge.label:'Aktif rozeti yok'}`,badge?.icon||'✦'));
    });
    return slides;
   },uid),
   safe('gifts',async()=>{
    const [drawSnap,receivedSnap,quarterlySnap]=await Promise.all([getDocs(query(collection(db,'draws'),orderBy('weekStart','desc'))),getDocs(query(collection(db,'giftRequests'),where('received','==',true))),getDocs(query(collection(db,'quarterlyGiftRequests'),where('received','==',true))).catch(()=>null)]);
    const draws=drawSnap.docs.map(d=>d.data());const gifts=[...receivedSnap.docs,...(quarterlySnap?.docs||[])].map(d=>d.data());
    const latest=draws[0];const week=latest?.weekStart;
    const pairs=(latest?.pairs||[]).filter(p=>p.giverUid&&p.receiverUid);
    const name=id=>id===uid?'Sen':usersCache[id]?.name||window.BH_I18N.pick("Kulüp üyesi","Club member");
    const slides=pairs.map(p=>metric(week?window.BH_I18N.template`${week} haftası · son kura`:'Son kura',`${name(p.giverUid)} → ${name(p.receiverUid)}`,window.BH_I18N.pick("Kitap hediyesi eşleşmesi","Book gift match"),'→'));
    if(!slides.length)slides.push(metric(window.BH_I18N.pick("Hediye eşleşmeleri","Gift matches"),window.BH_I18N.pick("Henüz kura yok","No draws yet"),window.BH_I18N.pick("İlk eşleşmeler burada görünecek.","The first matches will appear here."),'→'));
    slides.push({label:window.BH_I18N.pick("Senin hediye geçmişin","Your gift history"),stats:[{icon:'↓',tone:'hp-ok',value:gifts.filter(g=>g.receiverUid===uid).length,label:window.BH_I18N.pick("Aldığın","Received")},{icon:'↑',tone:'',value:gifts.filter(g=>g.giverUid===uid).length,label:window.BH_I18N.pick("Verdiğin","Given")}],detail:quarterlySnap?window.BH_I18N.pick("Teslim alındığı onaylanan kitaplar","Books confirmed as received"):window.BH_I18N.pick("Haftalık hediyeler · ortak kitap verisi alınamadı","Weekly gifts · shared book data unavailable")});
    slides.push(metric(window.BH_I18N.pick("Kulüpte bugüne kadar","In the club so far"),window.BH_I18N.template`${gifts.length} kitap`,quarterlySnap?window.BH_I18N.pick("Haftalık + ortak kitap · teslim onaylı","Weekly and shared books · delivery confirmed"):window.BH_I18N.pick("Haftalık hediyeler · ortak kitap verisi alınamadı","Weekly gifts · shared book data unavailable"),'♡','hp-ok'));return slides;
   },uid)
  ]);
 }
 async function library(uid){
  await ensureDiscoverCoversLoaded();
  if(currentUid!==uid)return;
  const catalog=CURATED_CATALOG.flatMap(c=>c.books.map(b=>({title:b.t,author:b.a,category:c.label})));
  const unique=[...new Map(catalog.map(b=>[b.title+'|'+b.author,b])).values()];
  for(let i=unique.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[unique[i],unique[j]]=[unique[j],unique[i]];}
  set('bookhistory',unique.map(b=>book({...b,cover:discoverCoversCache[bookKeyFor(b)]?.cover},window.BH_I18N.category(b.category))));
  await Promise.all([
   safe('mybooks',async()=>{
    const [reading,want]=await Promise.all(['readBooks','wantToRead'].map(c=>getDocs(query(collection(db,'users',uid,c),orderBy('addedAt','desc')))));
    const r=reading.docs.map(d=>book(d.data(),window.BH_I18N.pick("Şu an okuyorum","Currently reading"))),w=want.docs.map(d=>book(d.data(),window.BH_I18N.pick("Okuyacaklarım","To read")));
    if(!r.length)r.push(metric(window.BH_I18N.pick("Şu an okuyorum","Currently reading"),window.BH_I18N.pick("Listen boş","Your list is empty"),window.BH_I18N.pick("Okumaya başladığın kitabı ekle.","Add a book you’ve started reading."),'▤'));
    if(!w.length)w.push(metric(window.BH_I18N.pick("Okuyacaklarım","To read"),window.BH_I18N.pick("Sırada ne var?","What’s next?"),window.BH_I18N.pick("Okumak istediğin kitapları biriktir.","Collect books you want to read."),'▤'));
    const slides=[];for(let i=0;i<Math.max(r.length,w.length);i++){if(r[i])slides.push(r[i]);if(w[i])slides.push(w[i]);}return slides;
   },uid),
   safe('recs',async()=>{
    const queries=[query(collection(db,'recommendations'),where('scope','==','personal'),where('fromUid','==',uid)),query(collection(db,'recommendations'),where('scope','==','personal'),where('toUid','==',uid)),query(collection(db,'recommendations'),where('scope','==','group'))];
    const snaps=await Promise.all(queries.map(getDocs));const map=new Map();snaps.forEach(s=>s.docs.forEach(d=>map.set(d.id,d.data())));
    return [...map.values()].sort((a,b)=>(a.scope==='personal'?0:1)-(b.scope==='personal'?0:1)||String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(r=>book({...r,note:r.note||r.fromName||''},r.scope==='personal'?(r.fromUid===uid?window.BH_I18N.pick("Senden · ","From you · ")+(r.toName||window.BH_I18N.pick("Şahsi öneri","Personal recommendation")):window.BH_I18N.pick("Sana · ","For you · ")+(r.fromName||window.BH_I18N.pick("Şahsi öneri","Personal recommendation"))):window.BH_I18N.pick("Kulüpten · ","From the club · ")+(r.fromName||window.BH_I18N.pick("Kitap önerisi","Book recommendation"))));
   },uid)
  ]);
 }
 function sync(id){
  if(!['club','library'].includes(id)||!currentUid)return;
  if(owner!==currentUid){owner=currentUid;cache.clear();for(const st of states.values()){observer?.unobserve(st.item);}states.clear();}
  mount();const uid=currentUid,key=uid+':'+id,entry=cache.get(key);
  if(entry&&(entry.pending||Date.now()-entry.at<60000))return;
  const state={pending:true,at:Date.now()};cache.set(key,state);
  (id==='club'?club(uid):library(uid)).finally(()=>{state.pending=false;});
 }
 // Önizlemeler normalde 60 sn boyunca önbellekten gösterilir (her sekme dönüşünde yeniden
 // hesaplamasın) — ama kullanıcı o önbelleği besleyen veriyi (kitap ekleme/taşıma, okuma
 // işaretleme, öneri gönderme) kendisi değiştirdiğinde, kartı bir dakika boyunca eski göstermek
 // yerine ilgili önbelleği burada geçersiz kılıp bir sonraki sync()'in gerçekten tazelemesini
 // sağlıyoruz.
 function invalidate(id){ if(currentUid) cache.delete(currentUid+':'+id); }
 document.addEventListener('pointerdown',()=>{touching=true;},true);
 const idle=()=>{touching=false;quietUntil=performance.now()+500;};
 document.addEventListener('pointerup',idle,true);document.addEventListener('pointercancel',idle,true);window.addEventListener('blur',idle);
 document.addEventListener('scroll',()=>{quietUntil=performance.now()+500;},{passive:true,capture:true});
 setInterval(()=>{
  const now=performance.now();
  for(const st of states.values()){
   const root=st.item.closest('main > section.tab');
   if(document.hidden||touching||now<quietUntil||!st.visible||!root||root.id!=='tab-'+activeTab||root.style.transform||st.item.classList.contains('expanded')||st.item.contains(document.activeElement)){st.at=now;continue;}
   if(st.slides.length>1&&now-st.at>=3000){st.index=(st.index+1)%st.slides.length;paint(st,true);}
  }
 },250);
 return {sync, invalidate};
})();

/* ============ ADMIN: GOODREADS'TEN İÇE AKTARMA ============
   Bir üyenin Goodreads'ten dışa aktardığı CSV'sini (goodreads_library_export.csv) okuyup
   Exclusive Shelf'e göre doğru koleksiyona (bookHistory/readBooks/wantToRead) yazar. Kitap/yazar
   adları CSV'deki haliyle DOKUNULMADAN kaydedilir; sadece kapak arama sorgusunda kullanılır —
   kaydedilen title/author asla API'nin döndürdüğü isimle değiştirilmez, sadece cover doldurulur.
   Kapak arama, seedDiscoverCovers()'daki ile aynı iki-kaynaklı (Google Books + Open Library) +
   hız sınırlamalı deseni kullanır. firestore.rules'taki admin-override sayesinde admin başka bir
   üyenin bookHistory/readBooks/wantToRead koleksiyonlarına yazabiliyor. */
function parseGoodreadsCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* \n zaten satırı kapatıyor, atla */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  if(!rows.length) return [];
  const header = rows[0].map(h=>h.trim());
  return rows.slice(1).filter(r=>r.some(v=>v!=='')).map(r=>{
    const obj = {};
    header.forEach((h,idx)=>{ obj[h] = r[idx]!==undefined ? r[idx] : ''; });
    return obj;
  });
}
// 'read'/'currently-reading' dışındaki her şey (to-read, did-not-finish, veya üyenin kendi
// oluşturduğu herhangi bir özel raf) "okumak istiyorum"a düşer — sadece raf tamamen boşsa atlanır.
function goodreadsShelfToCollection(shelf){
  if(shelf==='read') return 'bookHistory';
  if(shelf==='currently-reading') return 'readBooks';
  if(!shelf) return null;
  return 'wantToRead';
}
function goodreadsDateToIso(dateStr){
  if(!dateStr) return new Date().toISOString();
  const d = new Date(dateStr.replace(/\//g,'-'));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function bookDedupeKey(title, author){ return (title||'').trim().toLowerCase()+'|'+(author||'').trim().toLowerCase(); }
async function findGoodreadsBookCover(title, author){
  try{
    const settled = await Promise.allSettled([
      searchGoogleBooks(`${title} ${author}`),
      searchOpenLibrary(`${title} ${author}`)
    ]);
    const pick = (r)=> (r.status==='fulfilled' && r.value && r.value[0]) ? r.value[0] : null;
    const candidates = settled.map(pick).filter(Boolean);
    const withCover = candidates.find(c=>c.cover);
    return withCover ? withCover.cover : '';
  }catch(e){ return ''; }
}
function renderGoodreadsImportTab(){
  const select = document.getElementById('griUserSelect');
  const fileInput = document.getElementById('griFileInput');
  const startBtn = document.getElementById('griStartBtn');
  const log = document.getElementById('griLog');
  if(!select || !fileInput || !startBtn || !log) return;
  const sortedUids = Object.keys(usersCache).filter(uid=>!usersCache[uid].deleted).sort((a,b)=> (usersCache[a].name||'').localeCompare(usersCache[b].name||'','tr'));
  select.innerHTML = window.BH_I18N.pick("<option value=\"\">Seç…</option>","<option value=\"\">Select…</option>") + sortedUids.map(uid=>{
    const u = usersCache[uid];
    const label = u.surname ? `${u.name||'?'} ${u.surname}` : (u.name||'?');
    return `<option value="${uid}">${escapeHtml(label)}</option>`;
  }).join('');
  // Sekmeden çıkıp geri girildiğinde önceki seçili dosya/kayıt kalmasın diye her girişte sıfırlanıyor.
  fileInput.value = '';
  const updateBtn = ()=>{ startBtn.disabled = !(select.value && fileInput.files && fileInput.files[0]); };
  select.onchange = updateBtn;
  fileInput.onchange = updateBtn;
  updateBtn();
  log.textContent = '';
  startBtn.onclick = async ()=>{
    const targetUid = select.value;
    const file = fileInput.files && fileInput.files[0];
    if(!targetUid || !file) return;
    const targetName = usersCache[targetUid]?.name || targetUid;
    if(!confirm(`${targetName} adlı üyenin hesabına CSV'deki kitaplar eklenecek. Devam edilsin mi?`)) return;
    startBtn.disabled = true;
    select.disabled = true;
    fileInput.disabled = true;
    const lines = [];
    const print = (s)=>{ lines.push(s); log.textContent = lines.join('\n'); log.scrollTop = log.scrollHeight; };
    try{
      const text = await file.text();
      const rows = parseGoodreadsCSV(text);
      print(`${rows.length} satır okundu.`);
      const grouped = { bookHistory:[], readBooks:[], wantToRead:[] };
      let skippedShelf = 0;
      rows.forEach(r=>{
        const shelf = (r['Exclusive Shelf']||'').trim();
        const collectionName = goodreadsShelfToCollection(shelf);
        const title = (r['Title']||'').trim();
        if(!collectionName || !title){ skippedShelf++; return; }
        grouped[collectionName].push({
          title,
          author: (r['Author']||'').trim() || 'Bilinmeyen Yazar',
          addedAt: goodreadsDateToIso(shelf==='read' ? (r['Date Read']||r['Date Added']) : r['Date Added'])
        });
      });
      print(`Atlanan (boş raf): ${skippedShelf}`);
      print(`Okundu (bookHistory): ${grouped.bookHistory.length}, Şu an okunuyor (readBooks): ${grouped.readBooks.length}, Okumak istenen (wantToRead): ${grouped.wantToRead.length}`);

      let totalAdded = 0, totalDup = 0, totalCoverFound = 0;
      for(const collectionName of ['bookHistory','readBooks','wantToRead']){
        const items = grouped[collectionName];
        if(!items.length) continue;
        print(`\n${collectionName}: mevcut kayıtlar kontrol ediliyor…`);
        const existingSnap = await getDocs(collection(db,'users',targetUid,collectionName));
        const existingKeys = new Set();
        existingSnap.forEach(d=>{ const x=d.data(); existingKeys.add(bookDedupeKey(x.title,x.author)); });
        let added=0, dup=0, coverFound=0, failStreak=0;
        for(const item of items){
          const key = bookDedupeKey(item.title, item.author);
          if(existingKeys.has(key)){ dup++; continue; }
          existingKeys.add(key);
          const cover = await findGoodreadsBookCover(item.title, item.author);
          if(cover) coverFound++; else failStreak++;
          await addDoc(collection(db,'users',targetUid,collectionName), {
            author: item.author, title: item.title, cover, addedAt: item.addedAt
          });
          added++;
          if(added % 10 === 0) print(`  ${collectionName}: ${added} eklendi (${items.length} kitaptan)…`);
          await sleep(failStreak > 8 ? 700 : 90);
        }
        print(`${collectionName}: ${added} eklendi, ${dup} zaten vardı (atlandı), ${coverFound} kapak bulundu.`);
        totalAdded += added; totalDup += dup; totalCoverFound += coverFound;
      }
      print(`\nTamamlandı. Toplam ${totalAdded} kitap eklendi (${totalCoverFound} kapaklı), ${totalDup} zaten mevcuttu.`);
      showToast(`${targetName}: ${totalAdded} kitap içe aktarıldı.`);
    }catch(err){
      print(`HATA: ${err.message||err}`);
    }finally{
      startBtn.disabled = false;
      select.disabled = false;
      fileInput.disabled = false;
    }
  };
}

/* PWA/tarayıcı Geri: ekranlar ve geçici ayrıntılar aynı geçmişi kullanır. */
const appBackNavigation=(()=>{
 const key='bookhookNavigation';let session='';
 let owner=null,entries=[],index=-1,applying=false,scheduled=false,dialogSequence=0,popRevision=0,pendingRoot=false;
 const dialogs=new Map();
 function snapshot(){
  const root=document.getElementById('tab-'+activeTab);
  const layers=[...document.querySelectorAll('.modal-overlay-anim')].filter(el=>el.style.display==='flex'&&!el.classList.contains('closing')).sort((a,b)=>Number(getComputedStyle(a).zIndex)-Number(getComputedStyle(b).zIndex)).map(el=>el.id);
  const native=[...document.querySelectorAll('dialog[open]')].map(el=>{
   if(!el.dataset.backDialog)el.dataset.backDialog='dialog-'+(++dialogSequence);
   dialogs.set(el.dataset.backDialog,el);return el.dataset.backDialog;
  });
  return {tab:activeTab,hubs:root?.classList.contains('hub-flat')?[]:[...(root?.querySelectorAll('.hub-item.expanded')||[])].map(el=>el.dataset.hubTarget),ai:activeTab==='library'&&!hubLayoutEnabled('library')&&document.getElementById('aiRecCard').classList.contains('expanded'),layers,native};
 }
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function state(){return {...(history.state||{}),[key]:{session,index}};}
 // Ana sekmeler aynı gezinme seviyesidir; ayrı geri adımı oluşturmaz.
 function replaceRoot(view){
  session=Date.now().toString(36)+Math.random().toString(36).slice(2);
  const base={...view,hubs:[],ai:false,layers:[],native:[]};
  entries=[{view:base,y:scrollY}];index=0;history.replaceState(state(),'');
  if(!same(base,view)){entries.push({view,y:scrollY});index=1;history.pushState(state(),'');}
 }
 function sync(){
  scheduled=false;if(applying||!currentUid||!activeTab)return;
  const next=snapshot();
  if(owner!==currentUid||index<0){session=Date.now().toString(36)+Math.random().toString(36).slice(2);owner=currentUid;entries=[{view:next,y:scrollY}];index=0;history.replaceState(state(),'');return;}
  if(same(entries[index].view,next))return;
  if(entries[index].view.tab!==next.tab&&getTabOrder().includes(next.tab)){
   if(index>0){pendingRoot=true;applying=true;history.go(-index);}
   else replaceRoot(next);
   return;
  }
  // X/boşluk/Vazgeç ile kapanışta boş bir "geri" adımı bırakma.
  let previous=-1;
  if(entries[index].view.tab===next.tab){
   for(let i=index-1;i>=0&&entries[i].view.tab===next.tab;i--)if(same(entries[i].view,next)){previous=i;break;}
  }
  if(previous>=0){applying=true;history.go(previous-index);return;}
  entries=entries.slice(0,index+1);entries.push({view:next,y:scrollY});index++;
  history.pushState(state(),'');
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(sync);}}
 function closeLayer(id){
  const el=document.getElementById(id);if(!el)return;
  const close=document.getElementById(id+'Close');
  if(close)close.click();else closeModal(id);
 }
 async function restore(entry,revision){
  const desired=entry.view;
  for(const dialog of document.querySelectorAll('dialog[open]')){
   if(desired.native.includes(dialog.dataset.backDialog))continue;
   dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
   // Kaydetme sürerken pencere kapatılmıyorsa geçişi de beklet.
   if(dialog.open)return false;
  }
  const current=snapshot();
  for(const id of current.layers.slice().reverse())if(!desired.layers.includes(id))closeLayer(id);
  if(activeTab!==desired.tab)switchTab(desired.tab,{animate:false});
  const root=document.getElementById('tab-'+desired.tab);
  if(!root?.classList.contains('hub-flat')){
   root?.querySelectorAll('.hub-item').forEach(item=>{
    if(desired.hubs.includes(item.dataset.hubTarget)){
     if(!item.classList.contains('expanded'))materialExpandHubItem(item,item.dataset.hubTarget);
    }else materialCollapseHubItem(item);
   });
  }
  if(desired.tab==='library'&&!hubLayoutEnabled('library')){
   const card=document.getElementById('aiRecCard');
   if(card.classList.contains('expanded')!==desired.ai)card.querySelector('.ai-card-heading').click();
  }
  // İleri gezinmede eldeki modal içeriği yeniden kullanılabilir; silinmiş form yeniden yaratılmaz.
  for(const id of desired.layers){const el=document.getElementById(id);if(el&&!el.classList.contains('closing'))el.style.display='flex';}
  await new Promise(resolve=>setTimeout(resolve,150));
  if(revision!==popRevision)return null;
  const previous=document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,entry.y);document.documentElement.style.scrollBehavior=previous;
  return true;
 }
 window.addEventListener('popstate',async event=>{
  if(!currentUid||currentUid!==owner)return;
  if(pendingRoot){pendingRoot=false;replaceRoot(snapshot());applying=false;return;}
  const target=event.state?.[key];if(!target||target.session!==session||!entries[target.index]){applying=false;return;}
  const from=index;applying=true;index=target.index;
  const accepted=await restore(entries[index],++popRevision);
  if(accepted===null)return;
  if(!accepted){index=from;history.go(from-target.index);return;}
  entries[index].view=snapshot();history.replaceState(state(),'');applying=false;
 });
 window.addEventListener('scroll',()=>{
  if(!applying&&entries[index]&&document.body.dataset.screen===entries[index].view.tab)entries[index].y=scrollY;
 },{passive:true});
 const relevant='.modal-overlay-anim,dialog,.hub-item,#aiRecCard,section.tab';
 new MutationObserver(records=>{
  if(records.some(r=>r.type==='attributes'?r.target.matches(relevant):[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches('dialog')||n.querySelector?.('dialog')))))schedule();
 }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','open']});
 // Başlıktaki ok, donanım Geri ile aynı geçmiş adımını kullanır.
 document.getElementById('materialBack').addEventListener('click',event=>{
  if(index>0){event.preventDefault();event.stopImmediatePropagation();if(!applying)history.back();}
 },true);
 return {schedule};
})();

onAuthStateChanged(auth, async (user)=>{
  if(unsubUsers){ unsubUsers(); unsubUsers=null; }
  if(unsubToday){ unsubToday(); unsubToday=null; subscribedTodayKey=null; }
  if(unsubNotifs){ unsubNotifs(); unsubNotifs=null; }

  if(!user){
    currentUid = null; myProfile = null;
    document.getElementById('hamburgerBadge').style.display='none';
    loadingScreen.style.display='none';
    authScreen.style.display='block';
    appRoot.style.display='none';
    return;
  }

  currentUid = user.uid;
  // Eski sürümlerden kalan (artık hiç okunmayan) önbellek kayıtlarını temizle — sürüm
  // numarası ilerledikçe bunlar aksi halde localStorage'da sonsuza kadar kullanılmadan
  // durur.
  try{
    const staleKeys = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.startsWith('bh_cache_') && !k.startsWith(CACHE_PREFIX)) staleKeys.push(k);
    }
    staleKeys.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
  }catch(e){}
  loadingScreen.style.display='block';
  authScreen.style.display='none';
  appRoot.style.display='none';

  let profSnap = await getDoc(doc(db,'users',user.uid));
  if(!profSnap.exists()){
    const defaultName = user.displayName || (user.email ? user.email.split('@')[0] : window.BH_I18N.pick("Üye","Member"));
    await setDoc(doc(db,'users',user.uid), {
      name: defaultName, email: user.email||'', role:'member', banned:false,
      phone:'', address:'', photoURL: user.photoURL||'', createdAt: new Date().toISOString()
    });
    profSnap = await getDoc(doc(db,'users',user.uid));
  }
  myProfile = profSnap.data();
  profileGateActive = !(myProfile.surname && myProfile.surname.trim() && myProfile.phone && myProfile.phone.trim() && myProfile.address && myProfile.address.trim());

  if(myProfile.banned){
    await signOut(auth);
    const notice = document.getElementById('bannedNotice');
    notice.textContent = myProfile.deleted
      ? window.BH_I18N.pick("Bu hesap silinmiş. Yeniden erişim için kulüp yöneticine ulaş.","This account has been deleted. Contact your club administrator for access.")
      : window.BH_I18N.pick("Bu hesap yönetici tarafından askıya alınmış. Sorularını kulüp yöneticine iletebilirsin.","This account has been suspended. Contact your club administrator with any questions.");
    notice.style.display='block';
    loadingScreen.style.display='none';
    authScreen.style.display='block';
    return;
  } else {
    document.getElementById('bannedNotice').style.display='none';
  }

  // Önce üye listesini bir kerelik senkron olarak çekiyoruz (onSnapshot'ın ilk verisi
  // asenkron geldiği için, hemen altındaki otomatik-doldurma/kura işlemleri boş listeyle
  // çalışıp hiçbir şey yapmıyordu — bu satırlar o hatayı çözüyor).
  try{
    const initialUsersSnap = await getDocs(collection(db,'users'));
    usersCache = {};
    initialUsersSnap.forEach(d=> usersCache[d.id] = d.data());
  }catch(e){}

  unsubUsers = onSnapshot(collection(db,'users'), (snap)=>{
    usersCache = {};
    snap.forEach(d=> usersCache[d.id] = d.data());
    if(activeTab) renderTab(activeTab);
  });
  resubscribeToday();
  subscribeNotifs();
  setupPushNotifications();

  loadingScreen.style.display='none';
  appRoot.style.display='block';
  renderHeader();
  buildNav();

  // Bildirime tıklanarak açılmışsa (?tab=xxx&post=yyy&notif=zzz), ilgili sekmeye/gönderiye geç ve URL'yi temizle.
  const notifUrlParams = new URLSearchParams(location.search);
  const notifTabParam = resolveNotifTab(notifUrlParams.get('tab'));
  const notifPostParam = notifUrlParams.get('post');
  const notifIdParam = notifUrlParams.get('notif');
  if(notifTabParam && document.getElementById('tab-'+notifTabParam)){
    switchTab(notifTabParam);
    if(notifPostParam) setTimeout(()=> openPostModal(notifPostParam), 250);
    if(notifIdParam) markNotifReadById(notifIdParam);
    history.replaceState(history.state, '', location.pathname);
  }

  if(myProfile.role==='admin'){
    const filledCount = await autoFillPastDays(30);
    if(filledCount>0) showToast(`${filledCount} eksik işaretleme otomatik "okumadı" olarak dolduruldu.`);
    // Otomatik doldurma birinin serisini bozmuş olabilir; herkesin rozet/seri durumunu tazele
    // ki profil resmindeki çerçeve/rozet güncel kalsın.
    await Promise.all(activeUids().map(async uid=>{
      try{ const s = await computeStreak(uid); await checkAndAwardBadges(uid, s); }catch(_){}
    }));
    const monday = getMonday(nowLogical());
    const prevMonday = addDays(monday,-7);
    const res = await finalizeWeek(prevMonday, false);
    if(res && !res.already){
      const n = res.data.pairs.length;
      showToast(n ? `Önceki hafta kapandı: ${n} kişi kitap hediye edecek. "Kura" sekmesine bak.` : `Önceki hafta kapandı, kimse cezalı çıkmadı 🎉`);
    }
  }
});

/* ============ SERVICE WORKER ============ */
if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    try{
      // Eskiden ayrı bir firebase-messaging-sw.js dosyası da kayıtlıydı; şimdi her şey sw.js
      // içinde. O eski kayıt hâlâ cihazda kalmışsa (asla otomatik silinmiyor), her push'ta
      // Chrome'un çakışma/güncelleme algılamasına sebep olabiliyor. Onu burada temizliyoruz.
      const regs = await navigator.serviceWorker.getRegistrations();
      for(const reg of regs){
        const scriptUrl = (reg.active && reg.active.scriptURL) || (reg.installing && reg.installing.scriptURL) || (reg.waiting && reg.waiting.scriptURL) || '';
        if(scriptUrl && !scriptUrl.endsWith('/sw.js')){
          await reg.unregister();
        }
      }
    }catch(e){}
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('message', (e)=>{
      const resolvedTab = e.data && resolveNotifTab(e.data.linkTab);
      if(e.data && e.data.type==='notifClick' && resolvedTab && document.getElementById('tab-'+resolvedTab)){
        switchTab(resolvedTab);
        if(e.data.postId) setTimeout(()=> openPostModal(e.data.postId), 250);
        if(e.data.notifId) markNotifReadById(e.data.notifId);
      }
    });
  }
}
async function markNotifReadById(id){
  try{ await updateDoc(doc(db,'notifications',currentUid,'items',id), {read:true}); }catch(e){}
}
