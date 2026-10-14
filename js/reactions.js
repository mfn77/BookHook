/* ============ ORTAK: EMOJİ TEPKİLERİ (akış gönderileri, yorumlar ve kitap önerileri) ============ */

import {
  arrayRemove, arrayUnion, doc, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { burstMyReactionBadge } from "./feed.js";
// app.js ile karşılıklı import: buradaki kod bu adları sadece fonksiyonların içinde (uygulama
// açıldıktan sonra) kullanıyor, dosya yüklenirken değil; bu yüzden güvenli.
import {
  currentUid, db, escapeHtml, myProfile, notifyUser, showSimpleInfoModal, usersCache
} from "./app.js";

export let pendingReactionRefresh = null;
// Tepki seçilince yenilenecek görünüm. Başka dosyalar (feed.js) bu değişkene doğrudan yazamadığı için.
export function setPendingReactionRefresh(fn){ pendingReactionRefresh = fn; }

const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🔥','👏','🎉','🤔','👎'];
function reactionTargetRef(target){
  const [kind, ids] = target.split(':');
  if(kind==='rec') return doc(db,'recommendations',ids);
  if(kind==='post') return doc(db,'posts',ids);
  if(kind==='postcomment'){ const [postId,commentId] = ids.split('|'); return doc(db,'posts',postId,'comments',commentId); }
  const [recId, commentId] = ids.split('|');
  return doc(db,'recommendations',recId,'comments',commentId);
}
export function renderReactionBar(reactions, target){
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
export function closeReactionDrawer(){
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
export function toggleReactionDrawer(btn, target){
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
export function showReactorsModal(uidsCsv, emoji){
  const uids = uidsCsv ? uidsCsv.split(',').filter(Boolean) : [];
  const names = uids.map(uid=> escapeHtml((usersCache[uid]&&usersCache[uid].name) || 'Bilinmeyen')).join('<br/>');
  showSimpleInfoModal(`<div style="font-size:30px; margin-bottom:8px;">${emoji}</div><div>${names || window.BH_I18N.pick("<span class=\"muted\">Kimse yok.</span>","<span class=\"muted\">No one yet.</span>")}</div>`);
}
export async function setReaction(target, emoji){
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

export function initReactions(){
  document.addEventListener('click', (e)=>{
    const drawer = document.getElementById('reactionDrawer');
    if(drawer.classList.contains('open') && !drawer.contains(e.target) && !e.target.closest('.reaction-add-btn')){
      closeReactionDrawer();
    }
  });
}
