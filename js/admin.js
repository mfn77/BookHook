/* ============ ADMIN: BUGÜN ============ */

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { createPost, pickVariantMessage } from "./feed.js";
// app.js ile karşılıklı import: buradaki kod bu adları sadece fonksiyonların içinde (uygulama
// açıldıktan sonra) kullanıyor, dosya yüklenirken değil; bu yüzden güvenli.
import {
  activeTab, activeUids, addDays, buildWeekHistoryHTML, checkDrawRules, cleanupBadAutoFills,
  cloudFunctions, CLUB_START_DATE, computeWeekStats, currentUid, db, DOW, drawHistory, drawsCache,
  escapeHtml, fetchDayAnswers, finalizeWeek, fmtShort, fromStr, getMonday, hubPreviews,
  joinDateStrOf, joinedAtOf, keepOrLoading, loadDraws, LOTTERY_ALGO, markLoaded, markStatus,
  notifyAllMembers, nowLogical, pad, playMarkFx, renderTab, renderTotalPagesCard,
  resetAndRecomputeAllBadges, runLottery, showCachedOrPlaceholder, showToast, stampBtnInFlight,
  todayAnswers, todayStr, toStr, userChipHtml, usersCache, weekDates
} from "./app.js";

let manualGrid = {}; // uid -> ['', 'read', 'skip', ...] length 7
let manualHistoryCache = [];
let adminWeekOffset = 0; // 0 = bu hafta, -1 = önceki hafta, ...
export function setAdminWeekOffset(n){ adminWeekOffset = n; }
export function renderAdminToday(){
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

export async function renderAdminOwnWeek(){
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
export async function renderEditPastTab(){
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
export async function renderWeekReportTable(monday, tableId){
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
export async function renderAdminWeek(){
  await renderWeekReportTable(getMonday(nowLogical()), 'weekGrid');
}


let editPastWeekOffset = 0;
export function setEditPastWeekOffset(n){ editPastWeekOffset = n; }
export async function renderEditPastWeekReport(){
  const monday = addDays(getMonday(nowLogical()), editPastWeekOffset*7);
  const dates = weekDates(monday);
  document.getElementById('editPastWeekRangeLabel').textContent = `${fmtShort(dates[0])} — ${fmtShort(dates[6])}`;
  document.getElementById('editPastWeekNextBtn').disabled = editPastWeekOffset>=0;
  await renderWeekReportTable(monday, 'editPastWeekGrid');
}

/* ============ ADMIN: KURA (gerçek, esnek hafta seçimi) ============ */
export async function renderAdminDraws(){
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
export function renderManualTab(){
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
export async function renderAdminMembers(){
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

export function initAdmin(){
  document.getElementById('aWeekPrevBtn').addEventListener('click', ()=>{ adminWeekOffset -= 1; renderAdminOwnWeek(); });
  document.getElementById('aWeekNextBtn').addEventListener('click', ()=>{ if(adminWeekOffset<0){ adminWeekOffset += 1; renderAdminOwnWeek(); } });
  editPastDateInput.max = todayStr();
  if(!editPastDateInput.value) editPastDateInput.value = toStr(addDays(nowLogical(),-1));
  editPastDateInput.addEventListener('change', renderEditPastTab);
  document.getElementById('refreshWeekBtn').addEventListener('click', renderAdminWeek);
  document.getElementById('editPastWeekPrevBtn').addEventListener('click', ()=>{ editPastWeekOffset--; renderEditPastWeekReport(); });
  document.getElementById('editPastWeekNextBtn').addEventListener('click', ()=>{ if(editPastWeekOffset<0){ editPastWeekOffset++; renderEditPastWeekReport(); } });
  document.getElementById('drawWeekPicker').value = toStr(addDays(getMonday(nowLogical()),-7));
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
}
