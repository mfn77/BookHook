/*
 * Starts the app and manages Firebase, sign-in, shared data, navigation, and badge rules.
 * Screen-specific behavior lives in separate modules. To host your own copy, replace the Firebase
 * configuration below.
 */
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
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
// Weekly gift draw rules, shared with the server (functions/shared/lottery.js).
import {
  LOTTERY_ALGO, runLottery, drawHistory, checkDrawRules
} from "../functions/shared/lottery.js";
export { LOTTERY_ALGO, runLottery, drawHistory, checkDrawRules }; // re-exported for admin.js
// Reading streak and badge rules, shared with the server (functions/shared/streak.js).
import {
  BADGE_DEFS as SHARED_BADGE_DEFS, currentTierForStreak, countStreak, badgeTransition, replayBadgeHistory
} from "../functions/shared/streak.js";
// Screens and features, one module each:
import { initBooks, attachBookAutocomplete } from "./books.js";
import {
  initLibrary, renderBookHistoryTab, renderMyBooksTab, renderBookHistoryGrid, bhPageState,
  positionDiscoverFabs, updateDiscoverFabVisibility
} from "./library.js";
import { initReactions, pendingReactionRefresh, closeReactionDrawer, setReaction } from "./reactions.js";
import {
  initNotifications, notifyUser, notifyAdmins, notifyAllMembers, subscribeNotifs, unsubscribeNotifs,
  openNotifModal, setupPushNotifications, enablePushNotifications
} from "./notifications.js";
import { initToday, selfReadPending, computeTotalReadDays, wireSelfMarkCard } from "./today.js";
import { CURATED_CATALOG, bookKeyFor } from "./catalog.js";
import {
  initDiscover, renderDiscoverTab, renderDiscoverFilters, renderDiscoverContent,
  discoverCoversCache, ensureDiscoverCoversLoaded, seedDiscoverCovers,
  discoverPageSize, ensureDiscoverPageSizeLoaded, setDiscoverPageSize
} from "./discover.js";
import {
  initFeed, createPost, createOrBatchPost, pickVariantMessage, renderTimelineTab, renderPostCard,
  wirePostCards, openPostModal, positionPinnedPostBar, burstMyReactionBadge,
  deleteReadPostsRetroactively, migrateBatchPostsRetroactively
} from "./feed.js";
import {
  renderQuarterlyPickCard, renderQpBookInBugun, renderQpTestTab, qpDocRef
} from "./quarterly.js";
import { renderGiftsTab, renderGiftBooksGrid } from "./gifts.js";
import { initRecs, renderRecsTab, renderAiRecCard } from "./recs.js";
import { initWorms, renderAdminWorms, renderMemberWorms } from "./worms.js";
import { renderLibraryImportTab } from "./library-import.js";
import { initMentions } from "./mentions.js";
import {
  initAdmin, renderAdminToday, renderAdminOwnWeek, renderEditPastTab, renderWeekReportTable, renderAdminWeek,
  renderEditPastWeekReport, renderAdminDraws, renderManualTab, renderAdminMembers, setAdminWeekOffset, setEditPastWeekOffset
} from "./admin.js";

const firebaseConfig = {
  apiKey: "AIzaSyDpRov8Qs7rPQ7lILyhs7DuRHdQpTJZWJ4",
  authDomain: "bookhook-77.firebaseapp.com",
  projectId: "bookhook-77",
  storageBucket: "bookhook-77.firebasestorage.app",
  messagingSenderId: "611511209042",
  appId: "1:611511209042:web:3fa319fb5ee6ca5daba38b"
};
export const FCM_VAPID_KEY = "BE2rTmP33eegqZfz2p3wP-skKGpR0NuEWkal5-VaNbsX1ikgMa_mvIUg4uXATWXHzy1boy0yuBqeCb2Q-Wn3aXw";
export const GOOGLE_BOOKS_API_KEY = "AIzaSyBpIIf2aPenDO9E1ZgX96oNAznFmAadRxs"; /*
 * Optional Google Books API key. Without it, searches use a lower shared quota and may fail with HTTP
 * 429.
 */

export const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getFirestore(app);
const storage = getStorage(app);
export const cloudFunctions = getFunctions(app);

/* Date helpers. A reading day lasts until 06:00 the next morning. */
export const DOW = [window.BH_I18N.pick("Pzt","Mon"),window.BH_I18N.pick("Sal","Tue"),window.BH_I18N.pick("Çar","Wed"),window.BH_I18N.pick("Per","Thu"),window.BH_I18N.pick("Cum","Fri"),window.BH_I18N.pick("Cmt","Sat"),window.BH_I18N.pick("Paz","Sun")];
/* Light / dark theme */
function getStoredTheme(){ try{ return localStorage.getItem('bookhook_theme'); }catch(e){ return null; } }
function setTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{ localStorage.setItem('bookhook_theme', theme); }catch(e){}
}
/*
 * Device mode follows the system preference. data-theme always contains the resulting light or dark
 * value.
 */
function getSystemThemeEnabled(){try{return localStorage.getItem('bookhook_theme_system')==='true';}catch(e){return false;}}
function setSystemThemeEnabled(value){try{localStorage.setItem('bookhook_theme_system',value?'true':'false');}catch(e){}}
const deviceThemeQuery=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
function computeDeviceTheme(){return deviceThemeQuery?.matches?'dark':'light';}
function applyDeviceThemeIfEnabled(){
 if(!getSystemThemeEnabled())return;
 document.documentElement.setAttribute('data-theme',computeDeviceTheme());
 materialThemeSync();
}
if(deviceThemeQuery?.addEventListener)deviceThemeQuery.addEventListener('change',applyDeviceThemeIfEnabled);
else if(deviceThemeQuery?.addListener)deviceThemeQuery.addListener(applyDeviceThemeIfEnabled);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)return;
 if(getSystemThemeEnabled())applyDeviceThemeIfEnabled();else applyAutoThemeIfEnabled();
});
function getAutoThemeEnabled(){ try{ return localStorage.getItem('bookhook_theme_auto')==='true'; }catch(e){ return false; } }
function setAutoThemeEnabled(v){ try{ localStorage.setItem('bookhook_theme_auto', v?'true':'false'); }catch(e){} }
function computeAutoTheme(){
  const h = new Date().getHours();
  return (h>=8 && h<20) ? 'light' : 'dark';
}
function applyAutoThemeIfEnabled(){
  if(!getSystemThemeEnabled()&&getAutoThemeEnabled()){
    document.documentElement.setAttribute('data-theme', computeAutoTheme());
    materialThemeSync();
  }
}
function initTheme(){
  if(getSystemThemeEnabled()){document.documentElement.setAttribute('data-theme',computeDeviceTheme());return;}
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

export function pad(n){return n<10?"0"+n:""+n;}
export function toStr(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
export function fromStr(s){const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d);}
export function addDays(d,n){const r=new Date(d); r.setDate(r.getDate()+n); return r;}
export function getMonday(d){ const day=d.getDay(); const diff = day===0?-6:1-day; const m=addDays(d,diff); m.setHours(0,0,0,0); return m; }
export function weekDates(monday){ const arr=[]; for(let i=0;i<7;i++) arr.push(toStr(addDays(monday,i))); return arr; }
const MONTHS_TR = [window.BH_I18N.pick("Ocak","January"),window.BH_I18N.pick("Şubat","February"),window.BH_I18N.pick("Mart","March"),window.BH_I18N.pick("Nisan","April"),window.BH_I18N.pick("Mayıs","May"),window.BH_I18N.pick("Haziran","June"),window.BH_I18N.pick("Temmuz","July"),window.BH_I18N.pick("Ağustos","August"),window.BH_I18N.pick("Eylül","September"),window.BH_I18N.pick("Ekim","October"),window.BH_I18N.pick("Kasım","November"),window.BH_I18N.pick("Aralık","December")];
function isWideScreen(){ return window.matchMedia && window.matchMedia('(min-width:700px)').matches; }
// Shared records use a fixed day.month date format, matching fmtShortBackend on the server.
function fmtStoredDate(dstr){ const d = fromStr(dstr); return pad(d.getDate())+"."+pad(d.getMonth()+1); }
export function fmtShort(dstr){
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
// The "logical day": before 06:00 it is still the previous reading day (for late-night reading).
export function nowLogical(){ const d=new Date(); if(d.getHours()<6){ d.setDate(d.getDate()-1); } d.setHours(0,0,0,0); return d; }
export function todayStr(){ return toStr(nowLogical()); }
export function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
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
export function turkishDativeName(name){
  const { endsInVowel, isBack } = turkishLastVowelInfo(name);
  const v = isBack ? 'a' : 'e';
  return `${name}'${endsInVowel ? 'y'+v : v}`;
}
export function turkishAccusativeName(name){
  const { endsInVowel, isBack, isRounded } = turkishLastVowelInfo(name);
  const v = isBack ? (isRounded?'u':'ı') : (isRounded?'ü':'i');
  return `${name}'${endsInVowel ? 'y'+v : v}`;
}

/* Weekly draw. The rules are in functions/shared/lottery.js; these are app-side helpers. */
// Exact sign-up time; orders members who never won and joined on the same day.
export function joinedAtOf(uid){ const c=usersCache[uid]?.createdAt; const t=c?new Date(c):null; return t&&!isNaN(t)?t.toISOString():''; }

/* Shared state */
export let currentUid = null;
export let myProfile = null;
export let usersCache = {};
export let todayAnswers = {};
export let drawsCache = [];
export let activeTab = null;
let unsubUsers = null, unsubToday = null;
let subscribedTodayKey = null;

export function activeUids(){ return Object.keys(usersCache).filter(uid=>!usersCache[uid].banned && !usersCache[uid].deleted); }
export function profilePhotoHtml(profile, fontSize){
 const initial=((profile?.name||'?').trim().charAt(0)||'?').toLocaleUpperCase('tr');
 const url=typeof profile?.photoURL==='string'?profile.photoURL.trim():'';
 // Keep a visible fallback beneath the photo, including during loading/network errors.
 return `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:inherit;overflow:hidden;background:var(--gold);color:var(--on-primary);font-size:${fontSize}px;font-weight:700;line-height:1;">${escapeHtml(initial)}${url?`<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer" decoding="async" style="position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;object-fit:cover;object-position:center;border-radius:inherit;" onerror="this.remove()" />`:''}</span>`;
}
export function avatarHtmlFromProfile(profile, size, proportionHint){
  size = size || 22;
  /*
   * Avatar size accepts pixels or a CSS length. When the final size is unknown, proportionHint sets badge
   * proportions; use a smaller hint for small avatars.
   */
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
  // Keep the outer badge ring unclipped. Only the inner photo is cropped to a circle.
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

initBooks();
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
/*
 * An outside tap only closes the open menu. Capture it before it reaches an unrelated element
 * underneath.
 */
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

/*
 * Keep previous content visible while fresh data loads. Save it locally for later visits, but ignore
 * entries older than CACHE_TTL_MS.
 */
const APP_CACHE_VERSION = 'material-i18n-v1-'+window.BH_I18N.language;
const CACHE_PREFIX = 'bh_cache_'+APP_CACHE_VERSION+'_';
const CACHE_TTL_MS = 7*24*60*60*1000;
function getPersistedHTML(key){
  try{
    const raw = localStorage.getItem(CACHE_PREFIX+currentUid+'_'+key);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed.html!=='string' || typeof parsed.ts!=='number') return null;
    if(Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.html;
  }catch(e){ return null; }
}
function setPersistedHTML(key, html){
  const payload = JSON.stringify({html, ts: Date.now()});
  try{ localStorage.setItem(CACHE_PREFIX+currentUid+'_'+key, payload); }
  catch(e){
    // Storage may be full: drop a few of this app's older cache entries and retry.
    try{
      const ownKeys = [];
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(k && k.startsWith(CACHE_PREFIX)) ownKeys.push(k);
      }
      ownKeys.slice(0, 8).forEach(k=>{ try{ localStorage.removeItem(k); }catch(e2){} });
      localStorage.setItem(CACHE_PREFIX+currentUid+'_'+key, payload);
    }catch(e3){  }
  }
}
export function showCachedOrPlaceholder(el, placeholderHtml){
  if(!el) return;
  if(el.dataset.loaded === '1') return;
  const cached = getPersistedHTML(el.id);
  if(cached){ el.innerHTML = cached; el.dataset.loaded = '1'; }
  else { el.innerHTML = placeholderHtml; }
}
export function keepOrLoading(containerId, loadingText){
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

initNotifications();
document.getElementById('guideModalClose').addEventListener('click', ()=>{ closeModal('guideModal'); });
document.getElementById('guideModal').addEventListener('click', (e)=>{ if(e.target.id==='guideModal') closeModal('guideModal'); });
/* Sign-in screen */
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
      // the user closed the sign-in popup
    } else {
      alert(friendlyAuthError(err));
    }
  }
});

/* Tab definitions */
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
  {id:'libraryimport', label:window.BH_I18N.pick("Kütüphaneyi İçe Aktar","Import library"), icon:'📥'},
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
// These extra menu lists supply screen titles. Their screens are opened from settings.

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
// Map notification links to the recipient’s member or admin screen, since their tab IDs differ.
const TAB_ROLE_EQUIVALENTS = { msurvey:'today', today:'msurvey', mtoday:'week', week:'mtoday', mworms:'worms', worms:'mworms' };
const MEMBER_SIDE_TAB_IDS = ['msurvey','mtoday','mworms'];
export function resolveNotifTab(tabId){
  if(!tabId) return tabId;
  const equiv = TAB_ROLE_EQUIVALENTS[tabId];
  if(!equiv) return tabId; // shared tab (e.g. gifts, mybooks, settings): no mapping needed
  const isAdmin = myProfile && myProfile.role==='admin';
  const tabIsMemberSide = MEMBER_SIDE_TAB_IDS.includes(tabId);
  if(isAdmin && tabIsMemberSide) return equiv;
  if(!isAdmin && !tabIsMemberSide) return equiv;
  return tabId;
}
// Animate title changes for both tapped and swiped navigation.
function setTabTitleAnimated(newText){
  const el = document.getElementById('currentTabTitle');
  if(!el) return;
  /*
   * A swipe requests the same title twice. Compare the stored target instead of the animated text to
   * avoid restarting the animation.
   */
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
// Use one title lookup for both tapped and swiped navigation.
function getTabLabel(id){
  // Include the hub tabs when looking up titles; they are absent from the member and admin screen lists.
  const allTabDefs = [...ADMIN_TABS, ...MEMBER_TABS, ...HAMBURGER_ADMIN_EXTRA, ...HAMBURGER_MEMBER_EXTRA, ...materialPrimaryTabs()];
  const def = allTabDefs.find(t=>t.id===id);
  return def ? def.label : '';
}
export function switchTab(id, { animate = true } = {}){
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
    /*
     * After a completed swipe the page is already in place, so skip the entry animation; regular tab clicks
     * keep it.
     */
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

/*
 * Adjust bottom navigation for the browser’s visible viewport. Skip this adjustment in iOS home-screen
 * mode, where it would push the bar upward.
 */
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

/*
 * Move the current and neighbouring sections with the finger. Reuse their existing content during the
 * gesture and refresh only after completion. Distance and velocity determine whether to switch tabs.
 */
(function setupSwipeNav(){
  let touchStartX=null, touchStartY=0, dragging=false, containerWidth=0, pendingSettleTimeout=null, pendingFinish=null;
  let motionSamples=[];
  let previewCurrentSection=null, previewTargetSection=null, previewGoingNext=false, previewTargetIdx=-1, previewGap=0, previewWidth=0;
  let moveFrame=null, queuedDx=0, previewRect=null, transitionListener=null;
  let pointerId=null, recoveryTimer=null;
  const contentCol = document.querySelector('.content-col > main');
  const DISTANCE_THRESHOLD_RATIO = 0.5; // same as iOS/Android: half the width
  const VELOCITY_THRESHOLD = 0.35; // px/ms; faster flicks complete regardless of distance

  // Measure velocity over a short time window so a stationary final event does not cancel a fast flick.
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
  // Place the target section beside the current section using its measured screen position.
  function beginPreview(currentSection, targetSection, targetIdx, goingNext){
    const rect = previewRect || (previewRect = currentSection.getBoundingClientRect());
    /*
     * Keep the page margins between sections during dragging; the target lands exactly in the current
     * section’s position.
     */
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
    // Start the target at the height it will have once scrolled to the top.
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
  // Coalesce many touchmove events into one visual update per frame.
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
      // Commit the last finger position as the transition's starting point (on release only).
      if(previewCurrentSection) getComputedStyle(previewCurrentSection).transform;
    }
    if(!previewCurrentSection || !previewTargetSection) return;
    const transition = animate ? 'transform 0.24s cubic-bezier(0.25,0.8,0.25,1)' : 'none';
    previewCurrentSection.style.transition = transition;
    previewTargetSection.style.transition = transition;
    previewCurrentSection.style.transform = `translateX(${dx}px)`;
    previewTargetSection.style.transform = `translateX(${dx}px)`;
  }
  /*
   * Rebuild the preview if the drag reverses. If no tab exists in that direction, keep the movement at
   * zero.
   */
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
    // If the end event never arrives, don't leave the screen half-way.
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
    // Fallback for a hidden tab or a cancelled transition; normally the transitionend event fires.
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
    /*
     * Finish any pending tab switch before starting a new gesture, so the next swipe starts from the
     * section shown by the navigation.
     */
    if(pendingSettleTimeout){ clearTimeout(pendingSettleTimeout); pendingSettleTimeout=null; }
    if(pendingFinish){ pendingFinish(); }
    cleanupPreview();
    releaseGesture();
    const t = e.target;
    // Let inner swipeable panels handle their own gestures instead of starting a page-level swipe.
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
      // Wait for a clearly horizontal movement to avoid interfering with vertical scrolling.
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
      // Capture on the main element, which stays in place, rather than on the moving card.
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
    // Use the preview’s actual direction, which may have changed during the drag.
    const canComplete = previewCurrentSection && goingNext===previewGoingNext && previewTargetIdx>=0;
    const distanceOk = Math.abs(dx) > containerWidth * DISTANCE_THRESHOLD_RATIO;
    const velocity = releaseVelocity(e.clientX,e.timeStamp);
    const flickOk = Math.abs(dx)>=20 && Math.abs(velocity)>VELOCITY_THRESHOLD && Math.sign(velocity)===Math.sign(dx);
    const shouldComplete = canComplete && idx!==-1 && (distanceOk || flickOk);
    if(shouldComplete){
      const targetIdx = previewTargetIdx;
      /*
       * Use the section’s width without outer padding; including padding causes a jump when temporary styles
       * are removed.
       */
      const flyDist = goingNext ? -(previewWidth+previewGap) : (previewWidth+previewGap);
      settlePreview(flyDist, true);
      // Update the selected navigation item when the finger lifts, before the slide finishes.
      if(typeof materialSyncNavigation==='function') materialSyncNavigation(order[targetIdx], { resetScroll: false });
      // Update titles for non-hub screens too. Repeating the same title later has no effect.
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

export function renderTab(id){
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
  else if(id==='editpast'){ renderEditPastTab(); setEditPastWeekOffset(0); renderEditPastWeekReport(); }
  else if(id==='week'){ renderAdminWeek(); setAdminWeekOffset(0); renderAdminOwnWeek(); }
  else if(id==='gifts'){
    renderGiftsTab();
    renderGiftBooksGrid();
    if(myProfile.role==='admin'){ drawHistIndex.a=0; renderDrawHistoryCard('a'); }
    else { renderMemberLastWeek(); drawHistIndex.m=0; renderDrawHistoryCard('m'); }
  }
  else if(id==='manual') renderManualTab();
  else if(id==='qptest') renderQpTestTab();
  else if(id==='libraryimport') renderLibraryImportTab();
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

/* Firestore helpers */
function dayAnswersCol(dateStr){ return collection(db,'days',dateStr,'answers'); }
export async function fetchDayAnswers(dateStr){
  const snap = await getDocs(dayAnswersCol(dateStr));
  const map = {};
  snap.forEach(d=> map[d.id] = { status: d.data().status, auto: !!d.data().auto });
  return map;
}
export async function markStatus(uid, status, pages=null){
  const t = todayStr();
  const ref = doc(db,'days',t,'answers',uid);
  const current = todayAnswers[uid];
  if(current === status){
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { status, name: usersCache[uid]?.name || '', updatedAt: new Date().toISOString(), ...(status==='read'&&Number.isSafeInteger(pages)&&pages>=15?{pages}:{}) });
  }
}
export async function computeWeekStats(monday){
  const dates = weekDates(monday);
  const weekMondayStr = dates[0];
  const weekSundayStr = dates[6];
  const perDate = await Promise.all(dates.map(fetchDayAnswers));
  return activeUids().map(uid=>{
    const joinDs = joinDateStrOf(uid);
    // Members who join after Monday enter the draw from the following week.
    if(joinDs && joinDs > weekMondayStr && joinDs <= weekSundayStr){
      return {uid, name: usersCache[uid]?.name || '?', miss:0, read:0, marked:0, joinDate: joinDs||'', joinedAt: joinedAtOf(uid)};
    }
    // A closed day with no record counts as missed, even if the automatic fill has not run yet.
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
/*
 * Fill missing records for closed days. Only admins run this operation because it requires write
 * access.
 */
export const CLUB_START_DATE = '2026-07-06'; // no records exist before this date
function logicalDateStrOf(d){
  const copy = new Date(d);
  if(isNaN(copy.getTime())) return null;
  if(copy.getHours()<6) copy.setDate(copy.getDate()-1);
  copy.setHours(0,0,0,0);
  return toStr(copy);
}
export function joinDateStrOf(uid){
  const u = usersCache[uid];
  if(!u || !u.createdAt) return null;
  return logicalDateStrOf(new Date(u.createdAt));
}
async function autoFillPastDays(daysBack){
  daysBack = daysBack || 30;
  const uids = activeUids();
  if(uids.length===0) return 0;
  // Fetch every day x member combination in parallel.
  const tasks = [];
  for(let i=1;i<=daysBack;i++){
    const ds = toStr(addDays(nowLogical(), -i));
    if(ds < CLUB_START_DATE) continue; // never fill days before the club started
    uids.forEach(uid=>{
      const joinDs = joinDateStrOf(uid);
      if(joinDs && ds < joinDs) return; // never fill days before the member joined
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
/*
 * Remove only automatic missed records from before the club or membership started. Preserve manually
 * entered records.
 */
export async function cleanupBadAutoFills(daysBack){
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
/*
 * Rebuild badge history from the member’s eligible start date through yesterday. Today’s contribution
 * is handled separately.
 */
async function recomputeUserBadgeHistory(uid){
  const u = usersCache[uid];
  if(!u) return;
  const joinDs = joinDateStrOf(uid);
  const startDs = (joinDs && joinDs > CLUB_START_DATE) ? joinDs : CLUB_START_DATE;
  const yesterday = addDays(nowLogical(), -1);
  const dateStrs = [];
  let cursor = fromStr(startDs);
  while(toStr(cursor) <= toStr(yesterday)){ dateStrs.push(toStr(cursor)); cursor = addDays(cursor,1); }
  /*
   * Stop if any daily record cannot be read. Treating a failed read as missed would corrupt badge
   * history.
   */
  const snaps = await Promise.all(dateStrs.map(ds=> getDoc(doc(db,'days',ds,'answers',uid))));
  const {badgeCounts, streak, tier, bankedRepeats} = replayBadgeHistory(snaps.map(snap=> snap.exists() ? snap.data().status : null));
  const updates = { badgeCounts, lastStreak: streak, currentTier: tier, currentStreak: streak, bankedRepeats };
  try{
    await updateDoc(doc(db,'users',uid), updates);
    Object.assign(u, updates);
  }catch(e){}
}
export async function resetAndRecomputeAllBadges(){
  const uids = activeUids();
  let done = 0, failed = 0;
  for(const uid of uids){
    try{ await recomputeUserBadgeHistory(uid); }catch(_){ failed++; continue; }
    try{ const liveStreak = await computeStreak(uid); await checkAndAwardBadges(uid, liveStreak); }catch(_){}
    done++;
  }
  return {done, failed};
}
export async function finalizeWeek(monday, force){
  const wk = toStr(monday);
  const ref = doc(db,'draws',wk);
  if(!force){
    const existing = await getDoc(ref);
    if(existing.exists()) return {already:true, data:existing.data()};
  }
  // Win history: every draw except this week's own previous result (when drawing again).
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
    // Label stored in notifications and the post, independent of language and screen width.
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
export async function loadDraws(){
  const snap = await getDocs(query(collection(db,'draws'), orderBy('weekStart','desc')));
  drawsCache = [];
  snap.forEach(d=> drawsCache.push({id:d.id, ...d.data()}));
}
/*
 * Count backward to the first day not read, with no length limit. Failed reads must throw rather than
 * count as missed.
 */
export function computeStreak(uid){
  return countStreak(todayStr(), ds=> getDoc(doc(db,'days',ds,'answers',uid)).then(snap=> snap.exists() ? snap.data().status : null), {startMayBeUnmarked:true});
}


/*
 * The active badge belongs to the current streak. When that streak ends, badgeCounts preserves the
 * member’s previous awards.
 */
/*
 * Badge rules are shared with the server. Display names follow the selected language; shared records
 * use Turkish names.
 */
export const BADGE_DEFS = SHARED_BADGE_DEFS.map(def=>({...def, label: window.BH_I18N.pick(def.label, def.labelEn)}));
// Badge artwork (inline SVG) for each badge key.
export function badgeIllustration(key){
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
export const stampBtnInFlight = new Set();
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
export function pickGiftMessage(kind){
  const pool = kind==='won' ? GIFT_WON_MESSAGES : GIFT_COMPLETED_MESSAGES;
  return pool[Math.floor(Math.random()*pool.length)];
}
export async function checkAndPostDethrone(uid, newCount, getOthersCount, label, icon){
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
/*
 * Bank each repeated 30-day badge. Re-read the saved counts in a transaction so the client and server
 * cannot count the same award twice.
 */
async function bankRepeatBadges(uid, streak, uTab){
  const ref = doc(db,'users',uid);
  const saved = await runTransaction(db, async (tx)=>{
    const cur = (await tx.get(ref)).data() || {};
    const t = badgeTransition(streak, typeof cur.lastStreak==='number' ? cur.lastStreak : 0, cur.currentTier || null, cur.bankedRepeats || 0);
    if(t.kind==='drop' || t.bank<=0) return null;
    const badgeCounts = { ...(cur.badgeCounts || {}) };
    badgeCounts[t.newTier] = (badgeCounts[t.newTier] || 0) + t.bank;
    const updates = { lastStreak: streak, currentTier: t.newTier, currentStreak: streak, bankedRepeats: t.repeats, badgeCounts };
    tx.update(ref, updates);
    return updates;
  });
  if(!saved) return;
  const u = usersCache[uid];
  if(u) Object.assign(u, saved);
  const def = SHARED_BADGE_DEFS.find(d=>d.key===saved.currentTier);
  if(!def) return;
  const nth = saved.bankedRepeats + 1; // which 30-day badge of this streak this is
  await notifyUser(uid, `🎉 Tebrikler! ${nth}. kez "${def.label}" rozetini kazandın, ${streak} gündür aralıksız okuyorsun!`, uTab);
  createPost('badge_gained', { badgeKey:def.key, badgeLabel:def.label, badgeIcon:def.icon, variantText: `${def.icon} ${streak} gündür hiç ara vermeden okuyor: ${nth}. ${def.label.split(' (')[0]} rozeti!` }, uid, u?.name);
  await checkAndPostDethrone(uid, saved.badgeCounts[def.key], (ouid)=> (usersCache[ouid].badgeCounts||{})[def.key], `${def.label} rozeti`, def.icon);
}
export async function checkAndAwardBadges(uid, streak){
  if(badgeCheckInFlight.has(uid)) return; // skip a second check for the same member while one is running (avoids double counting)
  badgeCheckInFlight.add(uid);
  try{
    const u = usersCache[uid];
    if(!u) return;
    const lastStreak = typeof u.lastStreak==='number' ? u.lastStreak : 0;
    const {kind, newTier, bank} = badgeTransition(streak, lastStreak, u.currentTier || null, u.bankedRepeats || 0);
    /*
     * The client awards new badges and repeats only. The server settles streak losses after 06:00, allowing
     * check-in corrections before the day closes.
     */
    if(kind!=='rise' && kind!=='repeat') return;
    const uTab = u.role==='admin' ? 'worms' : 'mworms';
    if(kind==='rise'){
      // Posts and notifications are stored for everyone, so use the Turkish badge name.
      const notifyDef = SHARED_BADGE_DEFS.find(d=>d.key===newTier);

      const updates = { lastStreak: streak, currentTier: newTier, currentStreak: streak };
      await updateDoc(doc(db,'users',uid), updates);
      Object.assign(u, updates);
      if(notifyDef){
        await notifyUser(uid, `🎉 Tebrikler! "${notifyDef.label}" rozetini kazandın!`, uTab);
        createPost('badge_gained', { badgeKey:notifyDef.key, badgeLabel:notifyDef.label, badgeIcon:notifyDef.icon, variantText: pickBadgeGainedMessage(notifyDef.key) }, uid, u.name);
      }
    }
    if(bank>0) await bankRepeatBadges(uid, streak, uTab);
  }catch(e){ /* badge bookkeeping failures are ignored */ }
  finally{ badgeCheckInFlight.delete(uid); }
}

/* Day change (06:00): re-subscribe to the new day's check-ins */
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

export function shadeHexColor(hex, percent){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  let r = (num>>16)&255, g=(num>>8)&255, b=num&255;
  if(percent>=0){ r=r+(255-r)*percent; g=g+(255-g)*percent; b=b+(255-b)*percent; }
  else { const p=-percent; r=r*(1-p); g=g*(1-p); b=b*(1-p); }
  const clamp = v=>Math.max(0,Math.min(255,Math.round(v)));
  return '#'+[r,g,b].map(v=>clamp(v).toString(16).padStart(2,'0')).join('');
}
/*
 * The streak crest is adapted from the GNOME EarTag (app.drey.EarTag) icon. Colors follow the active
 * badge; gradient IDs are unique per member.
 */
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
export function buildWeekHistoryHTML(dates, perDate, joinDs, uid, extraColClass){
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
initAdmin();
initWorms();
initToday();
const renderMemberSurvey = wireSelfMarkCard({readBtn:'mReadBtn', dateNote:'mDateNote', statusNote:'mMyStatusNote', streakNote:'mMyStreakNote', pagesNumber:'mTotalPagesNumber', qpBook:'mMyQpBook', heading:'mTodayHeading'});
let memberWeekOffset = 0; // 0 = this week, -1 = previous week, ...
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

/* Member: this week (everyone) */


/* Member: last week */
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

/* Draw history (one week at a time, with previous/next) */
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

/* Profile */
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

/* Club rules */
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

export function setupAddToggle(btnId, wrapId){
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
export function closeAddForm(btnId, wrapId){
  document.getElementById(wrapId).style.display = 'none';
  document.getElementById(btnId).classList.remove('open');
}
initRecs();
attachBookAutocomplete('recPersonalBook', 'recPersonalCover', 'recPersonalBookSuggest');
attachBookAutocomplete('recGroupBook', 'recGroupCover', 'recGroupBookSuggest');

initLibrary();
initReactions();
initFeed();
initMentions();
/* Feed sub-tabs bar: switching sub-tabs, and hiding/showing the bar on scroll. */
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

/*
 * Signed-in UI: navigation, hubs and sign-in state Material UI layer: presentation and navigation only;
 * the data model is unchanged.
 */
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
/*
 * Expanding a hub card moves its existing screen section into the card. HUB_PARENT maps links and
 * navigation back to the correct hub.
 */
const HUB_PARENT = {};
// Settings cards open separate screens with a back button rather than expanding in place.
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
 // Re-measure inner panels after a card expands to full width.
 requestAnimationFrame(()=>{
  inner.querySelectorAll('.inner-pane-viewport').forEach(vp=>{
   if(vp._carousel) vp._carousel.goTo(vp._carousel.current, false);
  });
 });
}
/*
 * Data may arrive after the card opens. Briefly observe its height and animate changes so loaded
 * content does not jump into place.
 */
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
/*
 * Tapping an expanded card’s empty background closes it. Taps on nested content do not match these
 * targets.
 */
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
/*
 * Swipe between panels inside a card, using distance and velocity to choose the target and animating
 * the height between panels.
 */
function wireInnerPaneCarousel(viewport, track, panes, onIndexChange){
 const PEEK=22, GAP=10; // GAP must match .inner-pane-track > .inner-pane margin-right
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
  /*
   * Start height transitions from the last height set here. A resize observer runs after layout, so a
   * fresh measurement may already equal the target.
   */
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
  /*
   * Rubber-band resistance past the first/last pane; the page-level swipe is already disabled for this
   * touch.
   */
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
 /*
  * Watch the active panel’s height so late-arriving content is neither clipped nor shown with a sudden
  * jump.
  */
 const paneResizeObserver = new ResizeObserver(()=>{
  if(dragging) return;
  setHeight(true);
 });
 panes.forEach(p=>paneResizeObserver.observe(p));
 return { goTo, get current(){ return current; } };
}
/*
 * section contains the panels; groups defines which cards appear together; buttonEntries pairs each
 * navigation button with its panel index.
 */
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
// Save layout preferences separately for each member on this device.
export function hubLayoutMode(hub){
 try{const value=localStorage.getItem('bookhook_layout_'+currentUid+'_'+hub);return ['expanded','tabs','primary'].includes(value)?value:'cards';}catch(_){return 'cards';}
}
export function hubLayoutEnabled(hub){return hubLayoutMode(hub)!=='cards';}
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
export function syncAiHubLayout(){
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
// Keep the moved screen sections from being wiped by innerHTML when the menu is rebuilt.
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
  /*
   * Initialization can run again. Keep an existing carousel rather than rebuilding it from cards already
   * moved into panels.
   */
  if(section.querySelector(':scope>.inner-pane-viewport')) return;
  const cards=[...section.children].filter(x=>x.classList.contains('card'));
  const chosen=Number(control.dataset.selected || (control.dataset.panels==='recs'?'1':control.dataset.panels==='week'||control.dataset.panels==='mtoday'?'1':'0'));
  const buttonEntries=[...control.querySelectorAll('[data-pane]')].map(btn=>({el:btn, index:Number(btn.dataset.pane)}));
  const carousel = buildInnerPaneCarousel(section, cards.map(c=>[c]), buttonEntries);
  if(carousel){ control.dataset.selected=String(chosen); carousel.goTo(chosen, false); }
  else {
   // Fallback when there aren't enough cards for a carousel: plain show/hide.
   const select=(i)=>{ control.dataset.selected=String(i); cards.forEach((card,j)=>{card.hidden=i!==j;}); buttonEntries.forEach(({el,index})=>{el.classList.toggle('active',index===i); el.setAttribute('aria-selected', String(index===i));}); };
   buttonEntries.forEach(({el,index})=> el.onclick=()=>select(index));
   select(chosen);
  }
 });
 // Personal recommendations are panel 0 and Club recommendations are panel 1. Open on Club by default.
 const gifts=document.getElementById('tab-gifts');
 if(!document.getElementById('materialGiftTabs'))gifts.insertAdjacentHTML('afterbegin',window.BH_I18N.pick("<div class=\"segmented scrollable\" id=\"materialGiftTabs\"><button data-gift-view=\"0\" class=\"active\">Bekleyen</button><button data-gift-view=\"1\">Geçmiş</button><button data-gift-view=\"2\">Hediye Kayıtları</button><button data-gift-view=\"3\">Hediye Kitap Geçmişi</button></div>","<div class=\"segmented scrollable\" id=\"materialGiftTabs\"><button data-gift-view=\"0\" class=\"active\">Pending</button><button data-gift-view=\"1\">History</button><button data-gift-view=\"2\">Gift records</button><button data-gift-view=\"3\">Book gift history</button></div>"));
 if(!gifts.querySelector(':scope>.inner-pane-viewport')){
  // Group gifts into four panels: pending, history, statistics, and books.
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
 const themeChoices=document.getElementById('materialThemeChoices');
 if(themeChoices&&!themeChoices.querySelector('[data-theme-choice="system"]')){
  const button=document.createElement('button');button.type='button';button.dataset.themeChoice='system';
  button.textContent=window.BH_I18N.pick('Cihaz Ayarı','Device setting');themeChoices.append(button);
 }
 document.querySelectorAll('[data-theme-choice]').forEach(button=>{
  button.onclick=()=>{const v=button.dataset.themeChoice;setSystemThemeEnabled(v==='system');setAutoThemeEnabled(v==='auto');setTheme(v==='system'?computeDeviceTheme():v==='auto'?computeAutoTheme():v);materialThemeSync();};
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
 const selected=getSystemThemeEnabled()?'system':getAutoThemeEnabled()?'auto':document.documentElement.getAttribute('data-theme')||'light';
 document.querySelectorAll('[data-theme-choice]').forEach(button=>{button.classList.toggle('active',button.dataset.themeChoice===selected);button.setAttribute('aria-pressed',String(button.dataset.themeChoice===selected));});
 const palette=document.documentElement.dataset.palette||'green';
 document.querySelectorAll('[data-palette-choice]').forEach(button=>{const active=button.dataset.paletteChoice===palette;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
}
// Find the primary navigation tab for a screen, including nested admin screens.
const ADMIN_SUB_SCREENS = ['members','manual','qptest','editpast','whoreadtoday','libraryimport'];
function materialHubRoot(id){
 if(ADMIN_SUB_SCREENS.includes(id)) id = 'admin';
 if(['club','library','appsettings'].includes(id)) return id;
 return HUB_PARENT[id] || 'club';
}
/*
 * The back button moves up one level. Do not use the two-level lookup used to highlight primary
 * navigation.
 */
function materialImmediateParent(id){
 if(ADMIN_SUB_SCREENS.includes(id)) return 'admin';
 if(['club','library','appsettings'].includes(id)) return id;
 return HUB_PARENT[id] || 'club';
}
/*
 * Reset scroll in the same frame without fixing the body. Temporarily disable smooth scrolling to avoid
 * jumps and disappearing mobile navigation.
 */
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
export function materialRenderPhase(qp){
 const steps=document.getElementById('materialQpSteps');if(!steps)return;
 const phases=['nominating','objecting','voting','reading'];const labels=[window.BH_I18N.pick("Öneri","Recommendation"),window.BH_I18N.pick("İtiraz","Objection"),'Oylama','Okuma'];
 const i=qp?phases.indexOf(qp.phase):-1;
 steps.innerHTML=phases.map((p,n)=>`<div class="phase-step ${n===i?'current':''} ${n<i?'complete':''}" ${n===i?'aria-current="step"':''}><span>${n<i?'✓':n+1}</span><small>${labels[n]}</small></div>`).join('');
}
document.body.addEventListener('click',e=>{
 const route=e.target.closest('[data-material-route]');if(!route||!myProfile)return;
 const id=materialRoute(route.dataset.materialRoute);
 if(['admin','members','manual','qptest','editpast','whoreadtoday','libraryimport'].includes(id)&&myProfile.role!=='admin')return;
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

/* Hub card previews: read-only data, fixed size, rotating every 3 seconds while visible. */
export const hubPreviews=(()=>{
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
    // Read each day once for all members instead of 61 queries per member.
    const dates=Array.from({length:61},(_,i)=>toStr(addDays(nowLogical(),-i)));
    const days=[];
    for(let i=0;i<dates.length;i+=8) days.push(...await Promise.all(dates.slice(i,i+8).map(fetchDayAnswers)));
    const leaders=activeUids().map(id=>{
      let count=0,start=days[0]?.[id]?.status==='read'?0:1;
      for(let i=start;i<days.length && days[i]?.[id]?.status==='read';i++)count++;
      return {uid:id,streak:count,name:usersCache[id]?.name||window.BH_I18N.pick("Kulüp üyesi","Club member")};
    });
    // A streak spanning the full 61-day preview window may be longer; calculate its full length separately.
    await Promise.all(leaders.map(async l=>{ if(l.streak>=days.length-1) l.streak=await computeStreak(l.uid); }));
    leaders.sort((a,b)=>b.streak-a.streak||a.name.localeCompare(b.name,'tr')||a.uid.localeCompare(b.uid));
    const streak=leaders.find(x=>x.uid===uid)?.streak||0;const def=BADGE_DEFS.find(x=>x.key===currentTierForStreak(streak));const u=usersCache[uid]||{};
    const next=BADGE_DEFS.find(x=>x.days>streak);
    // The top badge repeats every 30 days, so show progress toward the next repeat.
    const repeatDef=!next&&def&&def.repeats?def:null;
    const nextHint=next?window.BH_I18N.template`Sonraki rozete ${next.days-streak} gün`:repeatDef?window.BH_I18N.template`Sonraki ${repeatDef.label.split(' (')[0]} rozetine ${repeatDef.days-streak%repeatDef.days} gün`:window.BH_I18N.pick("En yüksek seri rozetindesin.","You’ve reached the highest streak badge.");
    const slides=[metric(window.BH_I18N.pick("Okuma serin","Reading streak"),window.BH_I18N.template`${streak} gün`,nextHint,'♨','hp-ok'),metric('Aktif rozetin',def?def.label:window.BH_I18N.pick("Henüz rozet yok","No badges yet"),def?window.BH_I18N.pick("Her gün okumaya devam.","Keep reading every day."):window.BH_I18N.pick("İlk rozet için 3 gün üst üste oku.","Read for 3 days in a row to earn your first badge."),def?.icon||'✦'),metric(def?window.BH_I18N.pick("Bu rozetin geçmişi","History of this badge"):window.BH_I18N.pick("Rozet geçmişin","Your badge history"),def?`${Number(u.badgeCounts?.[def.key]||0)+1} kez`:`${Object.values(u.badgeCounts||{}).reduce((a,b)=>a+Number(b||0),0)} rozet`,def?window.BH_I18N.pick("Geçmiş kazanımlar + aktif serin","Past achievements and your current streak"):'Tamamlanmış serilerde kazanılan rozetler','✧')];
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
 /*
  * Preview data normally lasts 60 seconds. Invalidate it after a book, check-in, or recommendation
  * changes.
  */
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

/* Browser / PWA back button: screens and temporary views (dialogs, expanded cards) share one history. */
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
 // Primary tabs are one navigation level; switching between them adds no back step.
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
  // Closing with X, the backdrop or Cancel shouldn't leave an empty "back" step.
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
   // If the dialog refuses to close while saving, hold the navigation as well.
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
  // When going forward, reuse the dialog content that's still there; a removed form isn't recreated.
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
 // The arrow in the header uses the same history step as the hardware back button.
 document.getElementById('materialBack').addEventListener('click',event=>{
  if(index>0){event.preventDefault();event.stopImmediatePropagation();if(!applying)history.back();}
 },true);
 return {schedule};
})();

onAuthStateChanged(auth, async (user)=>{
  if(unsubUsers){ unsubUsers(); unsubUsers=null; }
  if(unsubToday){ unsubToday(); unsubToday=null; subscribedTodayKey=null; }
  unsubscribeNotifs();

  if(!user){
    currentUid = null; myProfile = null;
    document.getElementById('hamburgerBadge').style.display='none';
    loadingScreen.style.display='none';
    authScreen.style.display='block';
    appRoot.style.display='none';
    return;
  }

  currentUid = user.uid;
  // Remove cache entries from older cache versions; they would otherwise stay in localStorage unused.
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

  /*
   * Wait for the initial member list before filling records or drawing gifts; the live listener returns
   * asynchronously.
   */
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

  // Opened from a notification (?tab=...&post=...&notif=...): go to that tab/post and clean up the URL.
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
    // Automatic missed records may break streaks. Refresh badges so avatar rings match the current results.
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

/* Service worker */
if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    try{
      // Remove the retired messaging worker so only sw.js handles push notifications.
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


