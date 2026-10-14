/* ============ ORTAK KİTAP SEÇİMİ (3 aylık turnuva usulü oylama) ============
   Faz geçişleri (öneri → itiraz → oylama turları → okuma) sunucu tarafında otomatik
   ilerliyor (bkz. functions/index.js: quarterlyPickTick). Burada sadece o anki fazı
   gösterip, öneri/itiraz/oy verme gibi kullanıcı eylemlerini Firestore transaction'larıyla
   güvenli şekilde kaydediyoruz. */

import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query,
  runTransaction, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { bookKeyFor } from "./catalog.js";
import { createPost, createOrBatchPost } from "./feed.js";
import { attachBookAutocompleteEl } from "./books.js";
import { notifyUser } from "./notifications.js";
// app.js ile karşılıklı import: buradaki kod bu adları sadece fonksiyonların içinde (uygulama
// açıldıktan sonra) kullanıyor, dosya yüklenirken değil; bu yüzden güvenli.
import {
  activeUids, avatarHtmlFromProfile, currentUid, db, escapeHtml, materialBookCover,
  materialRenderPhase, myProfile, showToast, shuffle, usersCache
} from "./app.js";

const QP_MAX_NOMINATIONS = 3;
let qpCache = null;
export function qpDocRef(){ return doc(db,'quarterlyPick','current'); }
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
export async function renderQuarterlyPickCard(){
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
export async function renderQpBookInBugun(containerId){
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
export async function renderQpTestTab(){
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
