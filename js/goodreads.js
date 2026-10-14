/*
 * Imports a Goodreads CSV into a member’s reading lists. Titles and authors are preserved; book APIs
 * are used only to find covers. Cover requests are spaced out to respect service limits.
 */

import { addDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { searchGoogleBooks, searchOpenLibrary } from "./books.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import {
  db, escapeHtml, showToast, sleep, usersCache
} from "./app.js";

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
      else if(c === '\r'){ /* the following \n ends the line */ }
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
/*
 * "read" -> finished books, "currently-reading" -> reading now. Everything else (to-read,
 * did-not-finish, custom shelves) becomes "want to read"; rows with no shelf are skipped.
 */
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
export function renderGoodreadsImportTab(){
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
  // Reset on every visit so a file picked earlier isn't imported by accident.
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

