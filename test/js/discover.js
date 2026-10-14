/*
 * Discover categories, book lists, ratings, and admin cover tools. The curated catalog is defined in
 * catalog.js.
 */
import {
  addDoc, collection, doc, getDoc, getDocs, query, setDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  CURATED_CATALOG, DISCOVER_CATEGORIES, ENGLISH_SEARCH_TITLES, bookKeyFor
} from "./catalog.js";
import { refreshLibraryButtons, searchGoogleBooks, searchOpenLibrary } from "./books.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import {
  closeModal, currentUid, db, escapeHtml, hideAnchoredPopover, hubLayoutMode, markLoaded,
  materialBookCover, myProfile, showAnchoredPopover, showCachedOrPlaceholder, showSimpleInfoModal,
  showToast, sleep, userChipHtml
} from "./app.js";
import { createOrBatchPost } from "./feed.js";

function discoverGoToOffset(offset){
  const total = DISCOVER_CATEGORIES.length;
  const cur = DISCOVER_CATEGORIES.findIndex(c=>c.slug===discoverActiveCategory);
  const curIdx = cur===-1 ? 0 : cur;
  const next = ((curIdx + offset) % total + total) % total;
  discoverActiveCategory = DISCOVER_CATEGORIES[next].slug;
  discoverPage = 0;
  renderDiscoverFilters();
  renderDiscoverContent();
}

const curatedBookByKey = {};
CURATED_CATALOG.forEach(cat=>{
  cat.books.forEach(b=>{
    const key = bookKeyFor({title:b.t, author:b.a});
    curatedBookByKey[key] = { title:b.t, author:b.a, why:b.w, level:b.lv, category:cat.slug };
  });
});
const LEVEL_COLORS = { baslangic:'#26A269', orta:'#D4A017', ileri:'#E01B24' };
const LEVEL_LABELS = { baslangic:window.BH_I18N.pick("🟢 Başlangıç","🟢 Beginner"), orta:window.BH_I18N.pick("🟡 Orta","🟡 Intermediate"), ileri:window.BH_I18N.pick("🔴 İleri","🔴 Advanced") };

export let discoverCoversCache = {};
let discoverCoversLoaded = false;
export async function ensureDiscoverCoversLoaded(){
  if(discoverCoversLoaded) return;
  try{
    const snap = await getDocs(collection(db,'discoverCovers'));
    snap.forEach(d=>{ discoverCoversCache[d.id] = d.data(); });
    /*
     * Only mark covers as loaded after a successful load, so a failed first attempt (e.g. before the
     * network is ready) is retried later in the session.
     */
    discoverCoversLoaded = true;
  }catch(e){}
}

export async function seedDiscoverCovers(){
  await ensureDiscoverCoversLoaded();
  const allBooks = [];
  CURATED_CATALOG.forEach(cat=> cat.books.forEach(b=> allBooks.push({title:b.t, author:b.a})));
  /*
   * Retry books never tried and books with no cover found; a book only counts as done once a cover has
   * been found.
   */
  const remaining = allBooks.filter(b=>{
    const cached = discoverCoversCache[bookKeyFor({title:b.title, author:b.author})];
    return !cached || !cached.cover;
  });
  if(!remaining.length){ showToast(window.BH_I18N.pick("Zaten tüm kapaklar taranmış.","All covers have already been scanned.")); return; }
  if(!confirm(`${remaining.length} kitabın kapağı/yılı aranacak. Sayfadan ayrılma. Devam edilsin mi?`)) return;
  showToast(`${remaining.length} kitap taranıyor, bu uzun sürecek…`);
  let done=0, found=0, failStreak=0;
  for(const b of remaining){
    const key = bookKeyFor({title:b.title, author:b.author});
    const enTitle = ENGLISH_SEARCH_TITLES[key];
    try{
      const queries = enTitle
        ? [ searchOpenLibrary(enTitle), searchGoogleBooks(enTitle) ]
        : [ searchGoogleBooks(`${b.title} ${b.author}`), searchOpenLibrary(`${b.title} ${b.author}`) ];
      const settled = await Promise.allSettled(queries);
      const pick = (r)=> (r.status==='fulfilled' && r.value && r.value[0]) ? r.value[0] : null;
      const candidates = settled.map(pick).filter(Boolean);
      const withCover = candidates.find(c=>c.cover);
      const withYear = candidates.find(c=>c.year) || withCover;
      const cover = withCover ? withCover.cover : '';
      const year = withYear ? withYear.year : '';
      const data = { cover, year, fetchedAt: new Date().toISOString() };
      await setDoc(doc(db,'discoverCovers',key), data);
      discoverCoversCache[key] = data;
      if(data.cover){ found++; failStreak = 0; } else { failStreak++; }
    }catch(e){ failStreak++; }
    done++;
    if(done % 20 === 0) showToast(`${done}/${remaining.length} tarandı, ${found} kapak bulundu…`);
    // many failures in a row usually means we hit the rate limit, so back off
    await sleep(failStreak > 8 ? 700 : 90);
  }
  showToast(window.BH_I18N.template`Tamamlandı! ${found}/${remaining.length} kapak bulundu.`);
  renderDiscoverContent();
}
function groupAvg(ratings){
  const vals = Object.values(ratings||{}).map(r=>r.score).filter(n=>typeof n==='number');
  if(!vals.length) return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
let discoverActiveCategory = null;
let discoverPage = 0;
let discoverBooksCache = [];
export function renderDiscoverTab(){
  if(!discoverActiveCategory) discoverActiveCategory = CURATED_CATALOG[0].slug;
  discoverPage = 0;
  renderDiscoverFilters();
  renderDiscoverContent();
}
let discoverFiltersExpanded = false;
export async function renderDiscoverFilters(){
  const bar = document.getElementById('discoverFilters');
  bar.innerHTML = DISCOVER_CATEGORIES.map(c=>`<button type="button" class="discover-filter-chip${discoverActiveCategory===c.slug?' active':''}" data-slug="${c.slug}">${escapeHtml(window.BH_I18N.category(c.label))}</button>`).join('');
  bar.querySelectorAll('.discover-filter-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      discoverActiveCategory = chip.dataset.slug;
      discoverPage = 0;
      renderDiscoverFilters();
      renderDiscoverContent();
    });
  });
  applyDiscoverFiltersHeight();
}
/*
 * The filter bar is collapsed to one row by default and expands with an animation from the arrow
 * button. Its height depends on how the chips wrap, so it is recalculated on render and on resize.
 */
function applyDiscoverFiltersHeight(){
  const bar = document.getElementById('discoverFilters');
  const toggle = document.getElementById('discoverFiltersToggle');
  if(!bar || !toggle) return;
  const firstChip = bar.querySelector('.discover-filter-chip');
  const collapsedHeight = firstChip ? firstChip.offsetHeight : 34;
  if(discoverFiltersExpanded){
    bar.style.maxHeight = bar.scrollHeight + 'px';
    toggle.classList.add('expanded');
  } else {
    bar.style.maxHeight = collapsedHeight + 'px';
    toggle.classList.remove('expanded');
  }
}
export function renderDiscoverContent(){
  renderDiscoverCategoryGrid(discoverActiveCategory);
}
// Search-and-pick dialog used by the "add a book to this category" button.

function openBookPickerModal(onSelect){
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Kitap Ekle</h2>
    <input type="text" id="bookPickerInput" placeholder="Kitap adı yazın..." style="width:100%; padding:10px; border:1.5px solid var(--line); border-radius:10px; font-family:'Inter',sans-serif; font-size:14px; background:var(--card); color:var(--ink); box-sizing:border-box;" />
    <div id="bookPickerResults" style="margin-top:10px; text-align:left;"></div>
  `);
  const input = document.getElementById('bookPickerInput');
  const results = document.getElementById('bookPickerResults');
  let debounceTimer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if(q.length < 2){ results.innerHTML=''; return; }
    debounceTimer = setTimeout(async ()=>{
      results.innerHTML = window.BH_I18N.template`<span class="muted">Aranıyor…</span>`;
      try{
        let items = [];
        try{ items = await searchOpenLibrary(q); }catch(e){ items = []; }
        if(!items.length){ try{ items = await searchGoogleBooks(q); }catch(e){ items = []; } }
        if(!items.length){ results.innerHTML = window.BH_I18N.template`<span class="muted">Sonuç bulunamadı.</span>`; return; }
        results.innerHTML = items.map((it,idx)=>`<div class="rec-comment-row" data-idx="${idx}" style="cursor:pointer;">
          ${it.cover?`<img src="${it.cover}" style="width:32px;height:46px;object-fit:cover;border-radius:4px;" />`:''}
          <div class="rec-comment-body"><b>${escapeHtml(it.title)}</b><div class="muted" style="font-size:11px;">${escapeHtml(it.author||'')}</div></div>
        </div>`).join('');
        results.querySelectorAll('[data-idx]').forEach(row=>{
          row.addEventListener('click', ()=>{
            const it = items[parseInt(row.dataset.idx,10)];
            openBookPickerDetailsStep(it, onSelect);
          });
        });
      }catch(err){ results.innerHTML = window.BH_I18N.template`<span class="muted">Arama başarısız oldu.</span>`; }
    }, 400);
  });
}
function openBookPickerDetailsStep(it, onSelect){
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Kitap Bilgisi</h2>
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:14px;">
      ${it.cover?`<img src="${it.cover}" style="width:48px;height:68px;object-fit:cover;border-radius:6px;" />`:''}
      <div><b>${escapeHtml(it.title)}</b><div class="muted" style="font-size:12px;">${escapeHtml(it.author||'')}</div></div>
    </div>
    <div class="field"><label>Neden okunmalı?</label><textarea id="bookPickerWhy" style="width:100%; min-height:60px; padding:10px; border:1.5px solid var(--line); border-radius:10px; font-family:'Inter',sans-serif; font-size:14px; background:var(--card); color:var(--ink); box-sizing:border-box;" placeholder="Bu kitap neden okunmalı, kısaca yaz"></textarea></div>
    <div class="field"><label>Seviye</label>
      <div style="display:flex; gap:8px;" id="bookPickerLevelRow">
        <button type="button" class="secondary tiny" data-level="baslangic" style="flex:1;">🟢 Başlangıç</button>
        <button type="button" class="secondary tiny" data-level="orta" style="flex:1;">🟡 Orta</button>
        <button type="button" class="secondary tiny" data-level="ileri" style="flex:1;">🔴 İleri</button>
      </div>
    </div>
    <button type="button" class="primary" id="bookPickerConfirmBtn" style="width:100%; margin-top:12px;">Ekle</button>
  `);
  let selectedLevel = null;
  const levelBtns = document.querySelectorAll('#bookPickerLevelRow [data-level]');
  levelBtns.forEach(b=>{
    b.addEventListener('click', ()=>{
      selectedLevel = b.dataset.level;
      levelBtns.forEach(x=>{
        const on = x===b;
        x.style.background = on ? 'var(--gold)' : '';
        x.style.color = on ? '#fff' : '';
        x.style.borderColor = on ? 'var(--gold)' : '';
      });
    });
  });
  document.getElementById('bookPickerConfirmBtn').addEventListener('click', ()=>{
    if(!selectedLevel){ alert(window.BH_I18N.pick("Bir seviye seç.","Select a level.")); return; }
    const why = document.getElementById('bookPickerWhy').value.trim();
    closeModal('bookInfoModal');
    onSelect({ title: it.title, author: it.author||'', cover: it.cover||'', workKey: it.workKey||'', why, level: selectedLevel });
  });
}
export let discoverPageSize = 100;
let discoverPageSizeLoaded = false;
export async function ensureDiscoverPageSizeLoaded(){
  if(discoverPageSizeLoaded) return;
  try{
    const snap = await getDoc(doc(db,'settings','discover'));
    if(snap.exists() && snap.data().pageSize) discoverPageSize = snap.data().pageSize;
    discoverPageSizeLoaded = true;
  }catch(e){}
}
// Called by the admin page-size setting in app.js (imported bindings are read-only).
export function setDiscoverPageSize(n){
  discoverPageSize = n;
  discoverPage = 0;
}

function openCoverFixMenu(btn, bookKey, book){
  const html = window.BH_I18N.template`
    <button type="button" class="post-menu-item" id="coverRescanBtn">🔄 Kapağı Yeniden Tara</button>
    <button type="button" class="post-menu-item" id="coverManualBtn">🔍 Manuel Ara ve Seç</button>
    <button type="button" class="post-menu-item" id="coverLinkBtn">🔗 Linkten Koy</button>
  `;
  showAnchoredPopover(btn, html);
  document.getElementById('coverRescanBtn').addEventListener('click', async (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    showToast(window.BH_I18N.pick("Kapak yeniden aranıyor…","Searching for a cover again…"));
    try{
      const enTitle = ENGLISH_SEARCH_TITLES[bookKey];
      const q = enTitle || `${book.title} ${book.author||''}`;
      let cover = '', year = '';
      try{
        const items = await searchOpenLibrary(q);
        const item = items[0];
        if(item && item.cover){ cover = item.cover; year = item.year||''; }
      }catch(err){}
      if(!cover){
        try{
          const items2 = await searchGoogleBooks(q);
          const item2 = items2[0];
          if(item2 && item2.cover){ cover = item2.cover; year = item2.year||''; }
        }catch(err){}
      }
      if(!cover){ alert(window.BH_I18N.pick("Yeniden tarama da bir sonuç bulamadı. Manuel ara ve seç veya linkten koy seçeneğini kullanabilirsin.","No result found after rescanning. Search manually or paste a cover URL.")); return; }
      await setDoc(doc(db,'discoverCovers',bookKey), { cover, year, fetchedAt:new Date().toISOString() });
      discoverCoversCache[bookKey] = { cover, year };
      showToast(window.BH_I18N.pick("Kapak güncellendi!","Cover updated!"));
      openBookDiscoverModal(book);
    }catch(err){ alert(window.BH_I18N.pick("Tarama başarısız: ","Scan failed: ")+(err.message||err)); }
  });
  document.getElementById('coverManualBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    openManualCoverSearchModal(bookKey, book);
  });
  document.getElementById('coverLinkBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    hideAnchoredPopover();
    openCoverLinkModal(bookKey, book);
  });
}
function openCoverLinkModal(bookKey, book){
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Linkten Kapak Koy</h2>
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:14px;">
      ${book.title?`<div><b>${escapeHtml(book.title)}</b><div class="muted" style="font-size:12px;">${escapeHtml(book.author||'')}</div></div>`:''}
    </div>
    <div class="field"><label>Kapak Görseli Linki</label><input type="text" id="coverLinkInput" placeholder="https://..." style="width:100%; padding:10px; border:1.5px solid var(--line); border-radius:10px; font-family:'Inter',sans-serif; font-size:14px; background:var(--card); color:var(--ink); box-sizing:border-box;" /></div>
    <div id="coverLinkPreviewWrap" style="display:none; text-align:center; margin:10px 0;"><img id="coverLinkPreview" style="width:90px; height:130px; object-fit:cover; border-radius:6px; box-shadow:var(--shadow);" /></div>
    <button type="button" class="primary" id="coverLinkSaveBtn" style="width:100%; margin-top:8px;">Kaydet</button>
  `);
  const input = document.getElementById('coverLinkInput');
  const previewWrap = document.getElementById('coverLinkPreviewWrap');
  const preview = document.getElementById('coverLinkPreview');
  input.addEventListener('input', ()=>{
    const url = input.value.trim();
    if(url){ preview.src = url; previewWrap.style.display = 'block'; }
    else { previewWrap.style.display = 'none'; }
  });
  document.getElementById('coverLinkSaveBtn').addEventListener('click', async ()=>{
    const url = input.value.trim();
    if(!url){ alert(window.BH_I18N.pick("Önce bir link yapıştır.","Paste a URL first.")); return; }
    try{
      await setDoc(doc(db,'discoverCovers',bookKey), { cover: url, year: (discoverCoversCache[bookKey]&&discoverCoversCache[bookKey].year)||'', fetchedAt:new Date().toISOString() });
      discoverCoversCache[bookKey] = { ...(discoverCoversCache[bookKey]||{}), cover: url };
      closeModal('bookInfoModal');
      showToast(window.BH_I18N.pick("Kapak güncellendi!","Cover updated!"));
      openBookDiscoverModal(book);
    }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
  });
}
function openManualCoverSearchModal(bookKey, book){
  showSimpleInfoModal(window.BH_I18N.template`
    <h2 style="margin-bottom:10px;">Manuel Kapak Ara</h2>
    <input type="text" id="coverSearchInput" value="${escapeHtml(book.title)} ${escapeHtml(book.author||'')}" style="width:100%; padding:10px; border:1.5px solid var(--line); border-radius:10px; font-family:'Inter',sans-serif; font-size:14px; background:var(--card); color:var(--ink); box-sizing:border-box;" />
    <div id="coverSearchResults" style="margin-top:10px; text-align:left;"></div>
  `);
  const input = document.getElementById('coverSearchInput');
  const results = document.getElementById('coverSearchResults');
  async function runSearch(){
    const q = input.value.trim();
    if(q.length < 2){ results.innerHTML=''; return; }
    results.innerHTML = window.BH_I18N.template`<span class="muted">Aranıyor…</span>`;
    try{
      let items = [];
      try{ items = await searchOpenLibrary(q); }catch(e){}
      try{ items = items.concat(await searchGoogleBooks(q)); }catch(e){}
      items = items.filter(it=>it.cover);
      if(!items.length){ results.innerHTML = window.BH_I18N.template`<span class="muted">Kapaklı sonuç bulunamadı.</span>`; return; }
      results.innerHTML = items.map((it,idx)=>`<div class="rec-comment-row" data-idx="${idx}" style="cursor:pointer;">
        <img src="${it.cover}" style="width:36px;height:52px;object-fit:cover;border-radius:4px;" />
        <div class="rec-comment-body"><b>${escapeHtml(it.title)}</b><div class="muted" style="font-size:11px;">${escapeHtml(it.author||'')}${it.year?' · '+escapeHtml(String(it.year)):''}</div></div>
      </div>`).join('');
      results.querySelectorAll('[data-idx]').forEach(row=>{
        row.addEventListener('click', async ()=>{
          const it = items[parseInt(row.dataset.idx,10)];
          try{
            await setDoc(doc(db,'discoverCovers',bookKey), { cover: it.cover, year: it.year||'', fetchedAt:new Date().toISOString() });
            discoverCoversCache[bookKey] = { cover: it.cover, year: it.year||'' };
            closeModal('bookInfoModal');
            showToast(window.BH_I18N.pick("Kapak güncellendi!","Cover updated!"));
            openBookDiscoverModal(book);
          }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
        });
      });
    }catch(err){ results.innerHTML = window.BH_I18N.template`<span class="muted">Arama başarısız oldu.</span>`; }
  }
  let debounceTimer = null;
  input.addEventListener('input', ()=>{ clearTimeout(debounceTimer); debounceTimer = setTimeout(runSearch, 400); });
  runSearch();
}
async function renderDiscoverCategoryGrid(slug){
  const main = document.getElementById('discoverFeed');
  showCachedOrPlaceholder(main, window.BH_I18N.template`<div class="empty-state">Yükleniyor…</div>`);
  const cat = CURATED_CATALOG.find(c=>c.slug===slug);
  const catLabel = cat ? `${window.BH_I18N.category(cat.label)} ${cat.emoji}` : slug;
  await ensureDiscoverCoversLoaded();
  await ensureDiscoverPageSizeLoaded();

  const groupPromise = getDocs(query(collection(db,'groupBookRatings'), where('category','==',slug)))
    .then(snap=>{ const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()})); return arr; })
    .catch(()=>[]);
  const additionsPromise = getDocs(query(collection(db,'discoverAdditions'), where('category','==',slug)))
    .then(snap=>{ const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()})); return arr; })
    .catch(()=>[]);
  const [groupDocs, additions] = await Promise.all([groupPromise, additionsPromise]);

  const catalogBooks = cat ? cat.books.map(b=>({title:b.t, author:b.a, why:b.w, level:b.lv})) : [];
  const groupIds = new Set(groupDocs.map(g=>g.id));
  const nonGroup = [
    ...catalogBooks.filter(b=>!groupIds.has(bookKeyFor(b))),
    ...additions.filter(b=>!groupIds.has(bookKeyFor(b)))
  ];
  const PAGE_SIZE = discoverPageSize;
  const totalPages = Math.max(1, Math.ceil(nonGroup.length / PAGE_SIZE));
  if(discoverPage >= totalPages) discoverPage = totalPages-1;
  if(discoverPage < 0) discoverPage = 0;
  const pageItems = nonGroup.slice(discoverPage*PAGE_SIZE, discoverPage*PAGE_SIZE+PAGE_SIZE);
  discoverBooksCache = [];
  function cardHtml(b, isGroup){
    const idx = discoverBooksCache.length;
    discoverBooksCache.push({...b, category:slug});
    const key = bookKeyFor(b);
    const curated = curatedBookByKey[key];
    const level = b.level || (curated && curated.level);
    const borderColor = LEVEL_COLORS[level] || 'var(--line)';
    const coverInfo = discoverCoversCache[key];
    const coverHtml = materialBookCover(b.title,coverInfo?.cover);
    const ratingLabel = isGroup ? `⭐ ${groupAvg(b.ratings).toFixed(1)} &middot; Grupta ${Object.keys(b.ratings||{}).length}` : '';
    return `<div class="discover-book-card" data-idx="${idx}">
      <div class="discover-book-cover-wrap" style="border:2px solid ${borderColor};">${coverHtml}${isGroup?window.BH_I18N.pick("<span class=\"discover-group-badge\">Grupta</span>","<span class=\"discover-group-badge\">In the club</span>"):''}</div>
      <div class="discover-book-title">${b.author?`<b>${escapeHtml(b.author)}</b> - `:''}<span style="font-weight:400;">${escapeHtml(b.title)}</span></div>
      ${ratingLabel?`<div class="discover-book-rating">${ratingLabel}</div>`:''}
    </div>`;
  }
  let html = '';
  if(groupDocs.length){
    html += `<div class="discover-cat-title">👥 Grupta Puanlananlar</div>`;
    html += `<div class="discover-grid" style="margin-bottom:22px;">${groupDocs.map(g=>cardHtml(g,true)).join('')}</div>`;
  }
  html += `<div class="discover-cat-title">${escapeHtml(catLabel)}</div>`;
  const canAddToCategory = slug!=='c01_toplu_onerilenler' || myProfile.isOwner;
  html += `<div class="discover-grid">${pageItems.map(b=>cardHtml(b,false)).join('')}${canAddToCategory?`<button type="button" class="discover-add-card" id="discoverAddCategoryBtn">+</button>`:''}</div>`;
  if(totalPages>1){
    html += `<div class="discover-pager">
      ${discoverPage>0?window.BH_I18N.template`<button id="discoverPrevPageBtn">◀ Önceki Sayfa</button>`:''}
      <span class="muted mono">${discoverPage+1} / ${totalPages}</span>
      ${discoverPage<totalPages-1?window.BH_I18N.template`<button id="discoverNextPageBtn">Sonraki Sayfa ▶</button>`:''}
    </div>`;
  }
  main.innerHTML = html;
  main.querySelectorAll('.discover-book-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const book = discoverBooksCache[parseInt(card.dataset.idx,10)];
      if(book) openBookDiscoverModal(book);
    });
  });
  const addBtn = document.getElementById('discoverAddCategoryBtn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    openBookPickerModal(async (sel)=>{
      try{
        await addDoc(collection(db,'discoverAdditions'), { ...sel, category:slug, addedBy:currentUid, createdAt:new Date().toISOString() });
        showToast('Kitap eklendi!');
        renderDiscoverCategoryGrid(slug);
      }catch(err){ alert(window.BH_I18N.pick("Eklenemedi: ","Could not add: ")+(err.message||err)); }
    });
  });
  const prevBtn = document.getElementById('discoverPrevPageBtn');
  if(prevBtn) prevBtn.addEventListener('click', ()=>{ discoverPage--; renderDiscoverCategoryGrid(slug); });
  const nextBtn = document.getElementById('discoverNextPageBtn');
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ discoverPage++; renderDiscoverCategoryGrid(slug); });
  markLoaded(main);
}
async function openBookDiscoverModal(book){
  const body = document.getElementById('bookDiscoverModalBody');
  document.getElementById('bookDiscoverModal').style.display='flex';
  body.innerHTML = window.BH_I18N.template`<span class="muted">Yükleniyor…</span>`;
  const bookKey = bookKeyFor(book);
  await ensureDiscoverCoversLoaded();
  const curated = curatedBookByKey[bookKey] || {};
  const level = book.level || curated.level;
  const why = book.why || curated.why;
  const coverInfo = discoverCoversCache[bookKey];
  const safeTitleJs = book.title.replace(/'/g, "\\'");
  const coverHtml = materialBookCover(book.title,coverInfo?.cover);
  let groupDoc = null;
  try{
    const snap = await getDoc(doc(db,'groupBookRatings',bookKey));
    if(snap.exists()) groupDoc = snap.data();
  }catch(e){}
  const myRating = groupDoc && groupDoc.ratings && groupDoc.ratings[currentUid];
  const groupList = groupDoc ? Object.entries(groupDoc.ratings||{}) : [];
  const groupHtml = groupList.length ? `
    <div class="rec-comments-label">👥 Gruptaki Puanlar</div>
    ${groupList.map(([uid,r])=>`<div class="rec-comment-row">
      <div class="rec-comment-body">${userChipHtml(uid,18)}<div style="color:var(--gold); font-size:12.5px; margin:2px 0;">⭐ ${r.score}/10</div>${r.comment?`<div style="margin-top:2px;">${escapeHtml(r.comment)}</div>`:''}</div>
    </div>`).join('')}` : '';
  const levelHtml = level ? `<div class="muted" style="margin-top:4px; font-size:12.5px;">Seviyesi: ${LEVEL_LABELS[level]||''}</div>` : '';
  const yearHtml = (coverInfo && coverInfo.year) ? `<div class="muted" style="font-size:12px;">${escapeHtml(String(coverInfo.year))}</div>` : '';
  const whyHtml = why ? window.BH_I18N.template`<p style="text-align:left; font-size:13.5px; line-height:1.5; margin-top:12px;"><b>Neden okunmalı?</b><br/>${escapeHtml(why)}</p>` : '';
  const isAdminView = myProfile.role==='admin';
  body.innerHTML = window.BH_I18N.template`
    <div style="text-align:center;">
      <div id="coverFixTarget" style="width:110px; height:160px; margin:0 auto 10px; border-radius:8px; overflow:hidden; box-shadow:var(--shadow); border:3px solid ${LEVEL_COLORS[level]||'var(--line)'}; ${isAdminView?'cursor:pointer;':''}" ${isAdminView?'title="Kapağı düzelt (sadece yönetici)"':''}>${coverHtml}</div>
      <h2 style="margin:0 0 2px;">${escapeHtml(book.title)}</h2>
      <div class="muted">${escapeHtml(book.author||'')}</div>
      ${groupList.length?window.BH_I18N.template`<div class="book-average">★ ${groupAvg(groupDoc.ratings).toLocaleString(window.BH_I18N.locale,{maximumFractionDigits:1})} <small>/ 10 · Kulüp ortalaması</small></div>`:''}
      ${yearHtml}
      ${levelHtml}
    </div>
    ${whyHtml}
    ${groupHtml}
    <div class="rec-comments-label" style="margin-top:14px;">${myRating?window.BH_I18N.pick("Puanını Güncelle","Update rating"):'Grupta Puan Ver'}</div>
    <div class="rating-star-row" id="ratingStarRow">${[1,2,3,4,5,6,7,8,9,10].map(n=>window.BH_I18N.template`<button type="button" class="rating-star" data-n="${n}" aria-label="10 üzerinden ${n} puan">${n}</button>`).join('')}</div>
    <textarea id="ratingCommentInput" placeholder="Yorumun (opsiyonel)" style="width:100%; margin-top:10px; padding:10px; border:1.5px solid var(--line); border-radius:10px; font-family:'Inter',sans-serif; font-size:14px; min-height:60px; background:var(--card); color:var(--ink);">${myRating?escapeHtml(myRating.comment||''):''}</textarea>
    <button class="primary" id="ratingSubmitBtn" style="width:100%; margin-top:8px;">Gönder</button>
    <div id="libraryBtnsWrapDiscover" style="margin-top:8px;"><span class="muted" style="font-size:12px;">…</span></div>
  `;
  refreshLibraryButtons('libraryBtnsWrapDiscover', book.title, book.author, (coverInfo&&coverInfo.cover)||'', 'Discover', true);
  if(isAdminView){
    const coverTarget = document.getElementById('coverFixTarget');
    coverTarget.addEventListener('click', (e)=>{
      e.stopPropagation();
      openCoverFixMenu(coverTarget, bookKey, book);
    });
  }
  let selectedScore = myRating ? myRating.score : 0;
  const stars = body.querySelectorAll('.rating-star');
  function paintStars(n){ stars.forEach(s=> s.classList.toggle('filled', parseInt(s.dataset.n,10)<=n)); }
  paintStars(selectedScore);
  stars.forEach(s=> s.addEventListener('click', ()=>{ selectedScore = parseInt(s.dataset.n,10); paintStars(selectedScore); }));
  document.getElementById('ratingSubmitBtn').addEventListener('click', async ()=>{
    if(!selectedScore){ alert(window.BH_I18N.pick("Önce bir puan seç (yıldızlara dokun).","Choose a rating first (tap the stars).")); return; }
    const comment = document.getElementById('ratingCommentInput').value.trim();
    try{
      const existingRatings = (groupDoc && groupDoc.ratings && typeof groupDoc.ratings==='object') ? groupDoc.ratings : {};
      const newRatings = { ...existingRatings, [currentUid]: { score: selectedScore, comment, createdAt: new Date().toISOString() } };
      await setDoc(doc(db,'groupBookRatings',bookKey), {
        title: book.title, author: book.author||'', cover: (coverInfo&&coverInfo.cover)||'', category: book.category||'', workKey: book.workKey||'',
        ratings: newRatings
      });
      const verifySnap = await getDoc(doc(db,'groupBookRatings',bookKey));
      const verifyOk = verifySnap.exists() && verifySnap.data().ratings && verifySnap.data().ratings[currentUid] && verifySnap.data().ratings[currentUid].score===selectedScore;
      if(!verifyOk){ alert(window.BH_I18N.pick("Puan kaydedilmiş gibi göründü ama doğrulanamadı. Lütfen Keşfet sekmesine dönüp tekrar kontrol et; sorun sürerse bana haber ver.","The rating appeared to save but could not be verified. Return to Discover and check again.")); }
      await createOrBatchPost('book_review', { bookTitle: book.title, bookAuthor: book.author||'', bookCover: (coverInfo&&coverInfo.cover)||'', rating: selectedScore, reviewText: comment });
      closeModal('bookDiscoverModal');
      showToast(window.BH_I18N.pick("Puanın kaydedildi, Akış'ta paylaşıldı!","Your rating was saved and shared in the feed!"));
    }catch(err){ alert('Kaydedilemedi: '+(err.message||err)); }
  });
}

/*
 * Discover's event listeners: previous/next category buttons, the filter toggle, closing the book
 * window, and swiping on the grid to move to the previous/next category (like tapping a chip, with a
 * short fade). Categories are paged lists loaded from Firestore, so they aren't laid out side by side
 * like the other swipeable panes; the page-level tab swipe ignores #discoverFeed. app.js calls this
 * once at startup.
 */
export function initDiscover(){
  document.getElementById('discoverFabPrev').addEventListener('click', ()=> discoverGoToOffset(-1));
  document.getElementById('discoverFabNext').addEventListener('click', ()=> discoverGoToOffset(1));
  document.getElementById('discoverFiltersToggle').addEventListener('click', ()=>{
    discoverFiltersExpanded = !discoverFiltersExpanded;
    applyDiscoverFiltersHeight();
  });
  window.addEventListener('resize', ()=>{
    if(document.getElementById('tab-bookhistory').classList.contains('active')) applyDiscoverFiltersHeight();
  });
  (function setupDiscoverSwipe(){
    const feed = document.getElementById('discoverFeed');
    if(!feed) return;
    let touchStartX=null, touchStartY=0, dragging=false;
    feed.addEventListener('touchstart', (e)=>{
      if(hubLayoutMode('library')==='primary'){touchStartX=null;dragging=false;return;}
      if(e.touches.length!==1){ touchStartX=null; return; }
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      dragging = false;
    }, {passive:true});
    feed.addEventListener('touchmove', (e)=>{
      if(hubLayoutMode('library')==='primary'){touchStartX=null;dragging=false;return;}
      if(touchStartX===null) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if(!dragging){
        if(Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)*2.2) return;
        dragging = true;
      }
    }, {passive:true});
    feed.addEventListener('touchend', (e)=>{
      if(hubLayoutMode('library')==='primary'){touchStartX=null;dragging=false;return;}
      if(touchStartX===null) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      touchStartX = null;
      if(!dragging) return;
      dragging = false;
      if(Math.abs(dx) < 60) return;
      const idx = DISCOVER_CATEGORIES.findIndex(c=>c.slug===discoverActiveCategory);
      if(idx===-1) return;
      const targetIdx = dx<0 ? idx+1 : idx-1;
      if(targetIdx<0 || targetIdx>=DISCOVER_CATEGORIES.length) return;
      discoverActiveCategory = DISCOVER_CATEGORIES[targetIdx].slug;
      discoverPage = 0;
      feed.classList.add('discover-swipe-fade');
      requestAnimationFrame(()=>{
        renderDiscoverFilters();
        renderDiscoverContent();
        requestAnimationFrame(()=>{ feed.classList.remove('discover-swipe-fade'); });
      });
    }, {passive:true});
  })();
  document.getElementById('bookDiscoverModalClose').addEventListener('click', ()=> closeModal('bookDiscoverModal'));
  document.getElementById('bookDiscoverModal').addEventListener('click', (e)=>{ if(e.target.id==='bookDiscoverModal') closeModal('bookDiscoverModal'); });
}

