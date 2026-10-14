/* ============ ORTAK: KİTAP ÖNERİLERİ ============ */

import {
  addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { createPost } from "./feed.js";
import { renderQuarterlyPickCard } from "./quarterly.js";
import { searchGoogleBooks } from "./books.js";
import { renderMyBooksTab } from "./library.js";
import { renderReactionBar, setPendingReactionRefresh, showReactorsModal, toggleReactionDrawer } from "./reactions.js";
import { notifyUser } from "./notifications.js";
// app.js ile karşılıklı import: buradaki kod bu adları sadece fonksiyonların içinde (uygulama
// açıldıktan sonra) kullanıyor, dosya yüklenirken değil; bu yüzden güvenli.
import {
  activeUids, closeAddForm, closeModal, cloudFunctions, currentUid, db, escapeHtml,
  hubLayoutEnabled, hubPreviews, keepOrLoading, markLoaded, materialBookCover, myProfile, pad,
  setupAddToggle, showToast, syncAiHubLayout, userChipHtml, usersCache
} from "./app.js";

export async function renderRecsTab(){
  const select = document.getElementById('recPersonalTarget');
  const others = activeUids().filter(uid=>uid!==currentUid);
  select.innerHTML = others.length
    ? others.map(uid=>`<option value="${uid}">${escapeHtml(usersCache[uid].name)}</option>`).join('')
    : window.BH_I18N.pick("<option value=\"\">(başka üye yok)</option>","<option value=\"\">(no other members)</option>");

  await renderQuarterlyPickCard();
  await renderPersonalRecs();
  await renderGroupRecs();
}

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
export async function renderAiRecCard(){
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
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); setPendingReactionRefresh(isGroup ? renderGroupRecs : renderPersonalRecs); toggleReactionDrawer(btn, btn.dataset.target); });
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

export function initRecs(){
  setupAddToggle('recPersonalAddBtn', 'recPersonalFormWrap');
  setupAddToggle('recGroupAddBtn', 'recGroupFormWrap');
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
}
