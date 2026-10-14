/* "My books": the member's three lists (reading now, want to read, finished), moving a
   book between them, the add forms, and the Discover tab's floating buttons. */

import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createOrBatchPost } from "./feed.js";
import { renderDiscoverTab } from "./discover.js";
import { attachBookAutocomplete } from "./books.js";
import { moveBookWithGoal, renderTotalPagesCard } from "./today.js";
// Circular import: app.js imports this module too. These names are only used inside
// functions (after startup), never while the module is being evaluated, so the cycle is safe.
import {
  closeAddForm, closeModal, currentUid, db, escapeHtml, hubPreviews, keepOrLoading, markLoaded,
  materialBookCover, setupAddToggle, showToast
} from "./app.js";

export function renderBookHistoryTab(){
  renderDiscoverTab();
  setupDiscoverNavObserver();
}
// Renders all three lists of the signed-in member.
export async function renderMyBooksTab(){
  await renderBookHistoryGrid(currentUid, 'readBooksGrid', true, 'readBooks');
  await renderBookHistoryGrid(currentUid, 'wantToReadGrid', true, 'wantToRead');
  await renderBookHistoryGrid(currentUid, 'bookHistoryGrid', true, 'bookHistory');
}
export function positionDiscoverFabs(){
  const contentCol = document.getElementById('contentCol');
  const prevBtn = document.getElementById('discoverFabPrev');
  const nextBtn = document.getElementById('discoverFabNext');
  if(!contentCol || !prevBtn || !nextBtn) return;
  const rect = contentCol.getBoundingClientRect();
  prevBtn.style.left = (rect.left + rect.width*0.25) + 'px';
  nextBtn.style.left = (rect.left + rect.width*0.75) + 'px';
}
export function updateDiscoverFabVisibility(){
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
export const bhPageState = {};
export async function renderBookHistoryGrid(uid, gridId, editable, collectionName){
  collectionName = collectionName || 'bookHistory';
  const grid = keepOrLoading(gridId);
  let items = [];
  try{
    const snap = await getDocs(query(collection(db,'users',uid,collectionName), orderBy('addedAt','desc')));
    snap.forEach(d=> items.push({ id:d.id, ...d.data() }));
  }catch(e){
    // On a failed query (e.g. right after startup, before the network is ready), keep what is
    // on screen; showing "no books yet" here would also be written to the persistent cache.
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
// Book window for an item in "My books": cover, title, author and one button that moves
// the book one step forward (want to read -> reading now -> finished). Finished books
// have no button. Only shown for the member's own library.
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
        // A finished book can count toward the monthly goal, so refresh the Today card's totals
        // as well. The id that isn't on the current screen (admin vs member) is a no-op.
        renderTotalPagesCard('totalPagesNumber');
        renderTotalPagesCard('mTotalPagesNumber');
      }catch(err){ alert(window.BH_I18N.pick("Taşınamadı: ","Could not move: ")+(err.message||err)); btn.disabled = false; }
    });
  }
}

export function initLibrary(){
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
}
