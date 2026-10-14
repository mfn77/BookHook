/* Gift requests, delivery confirmations, shared-book gifts, gift totals, and received books. */

import {
  collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createPost } from "./feed.js";
import { attachBookAutocompleteEl, showBookInfo } from "./books.js";
import { notifyUser } from "./notifications.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import {
  avatarHtmlFromProfile, checkAndPostDethrone, currentUid, db, drawsCache, escapeHtml, fmtShort,
  keepOrLoading, loadDraws, markLoaded, materialBookCover, myProfile, pickGiftMessage, showToast,
  userChipHtml, usersCache
} from "./app.js";

/*
 * Every pair in every draw has one giftRequests/{weekStart_giver_receiver} document. Fetch them all in
 * parallel, so the load time stays close to a single request however many weeks the club has.
 */
async function fetchAllGiftRequests(){
  const reqIds = [];
  drawsCache.forEach(d=>{
    (d.pairs||[]).forEach(p=>{
      if(p.receiverUid) reqIds.push(`${d.weekStart}_${p.giverUid}_${p.receiverUid}`);
    });
  });
  /*
   * Let real failures (network, permissions) propagate to renderGiftsTab, which keeps the current screen;
   * treating them as "no request" would show finished gifts as pending and cache that. A missing document
   * is not an error.
   */
  const snaps = await Promise.all(reqIds.map(id=> getDoc(doc(db,'giftRequests',id))));
  const map = {};
  reqIds.forEach((id,i)=>{
    const s = snaps[i];
    map[id] = (s && s.exists()) ? s.data() : null;
  });
  return map;
}
/*
 * Gift card for the quarterly shared book. It is separate from the weekly gift draw and stored in
 * quarterlyGiftPending / quarterlyGiftRequests; the card is only shown to members who are part of a
 * pairing.
 */
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
/*
 * "So far" card: how many gifts each member has received and given since the club started, drawn like
 * the badge history shelf with two "badges".
 */
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
export async function renderGiftsTab(){
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
  /*
   * Look at every draw, not just the latest: a gift from an earlier week stays here until the receiver
   * confirms it arrived, even after newer draws.
   */
  for(const d of drawsCache){
    if(!d.pairs) continue;
    for(const p of d.pairs){
      const isReceiver = p.receiverUid===currentUid;
      const isGiver = p.giverUid===currentUid && p.receiverUid;
      if(!isReceiver && !isGiver) continue;
      const reqId = `${d.weekStart}_${p.giverUid}_${p.receiverUid}`;
      const req = reqMap[reqId];
      if(req && req.received) continue; // finished gifts are only listed in the history
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
      if(req && req.received) continue;
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
        // The notification and feed post don't affect the result, so they run in the background.
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
        /*
         * The notification, counter update and record check don't affect the result, so they run in the
         * background.
         */
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
export async function renderGiftBooksGrid(){
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


