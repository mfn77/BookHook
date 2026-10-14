/* Shared book details, reading-list buttons, and book search with autocomplete. */

import {
  addDoc, collection, deleteDoc, doc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createOrBatchPost } from "./feed.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import { GOOGLE_BOOKS_API_KEY, closeModal, currentUid, db, escapeHtml, showToast } from "./app.js";

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
export async function showBookInfo(rawTitle, cover, prependHtml, sourceContext){
  if(!rawTitle) return;
  const body = document.getElementById('bookInfoModalBody');
  document.getElementById('bookInfoModal').style.display='flex';
  // Titles may come as "Author - Title"; only the title part is used for the search.
  let author = '', title = rawTitle;
  const dashIdx = rawTitle.indexOf(' - ');
  if(dashIdx>0){ author = rawTitle.slice(0,dashIdx).trim(); title = rawTitle.slice(dashIdx+3).trim(); }

  /*
   * Render what we already know (cover, title, author, list buttons) right away. Details that only the
   * book APIs have (description, rating, ...) load in the background and are added to a separate section.
   */
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
  if(!extraEl) return; // the window may have been closed in the meantime
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
  // Show the cover from the API if none was given.
  if(!cover && info.cover && !body.querySelector('img')){
    const h2 = body.querySelector('h2');
    if(h2) h2.insertAdjacentHTML('beforebegin', `<img src="${info.cover}" alt="" style="width:100px; height:150px; object-fit:cover; border-radius:8px; box-shadow:var(--shadow); margin-bottom:12px;" onerror="this.style.display='none';" />`);
  }
}

/* Book search (Google Books, with Open Library as a fallback) and autocomplete */
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
/*
 * search.json only returns basic fields; page count, language and ratings live on the book's "work"
 * endpoints, so fetch those and merge them in.
 */
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
export function attachBookAutocomplete(inputId, coverInputId, suggestBoxId, onSelect){
  const input = document.getElementById(inputId);
  const box = document.getElementById(suggestBoxId);
  const coverInput = coverInputId ? document.getElementById(coverInputId) : null;
  attachBookAutocompleteEl(input, coverInput, box, onSelect);
}
export function attachBookAutocompleteEl(input, coverInput, box, onSelect){
  if(!input || !box) return;
  if(input.dataset.bookAutocompleteAttached) return; // attach only once per element
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
    if(myToken !== queryToken) return; // a newer search has started; drop this result
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

export function initBooks(){
  document.getElementById('bookInfoModalClose').addEventListener('click', ()=>{ closeModal('bookInfoModal'); });
  document.getElementById('bookInfoModal').addEventListener('click', (e)=>{ if(e.target.id==='bookInfoModal') closeModal('bookInfoModal'); });
  document.body.addEventListener('click', (e)=>{
    const cover = e.target.closest('.book-cover-clickable');
    if(cover && cover.dataset.bookTitle){
      let sourceContext;
      if(cover.closest('#bookHistoryGrid')) sourceContext = 'history';
      showBookInfo(cover.dataset.bookTitle, cover.dataset.bookCover||cover.src||'', undefined, sourceContext);
    }
  });
}

