/* Daily reading check-in, page counts, optional daily and monthly goals, and reading totals. */

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { notifyAllMembers } from "./notifications.js";
import { shareReadingNote } from "./feed.js";
import { renderQpBookInBugun } from "./quarterly.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import {
  CLUB_START_DATE, DOW, addDays, checkAndAwardBadges, computeStreak, currentUid, db, fromStr,
  hubPreviews, joinDateStrOf, markLoaded, myProfile, nowLogical, pad, showCachedOrPlaceholder,
  showToast, stampBtnInFlight, toStr, todayAnswers, todayStr, usersCache
} from "./app.js";

/*
 * "Read" updates the screen before the server confirms. While that write is in flight, a snapshot
 * triggered by someone else's check-in must not undo the optimistic state, so the pending check-in is
 * kept here (resubscribeToday in app.js re-applies it).
 */
export let selfReadPending = null;

export async function renderTotalPagesCard(elId){
  const pagesEl = document.getElementById(elId);
  if(!pagesEl) return;
  renderCompletedBooksCount(elId==='totalPagesNumber'?'completedBooksNumber':'mCompletedBooksNumber');
  showCachedOrPlaceholder(pagesEl, '…');
  const daysEl=document.getElementById(elId==='totalPagesNumber'?'totalDaysNumber':'mTotalDaysNumber');
  if(daysEl) showCachedOrPlaceholder(daysEl,'…');
  const uid=currentUid;let totals;
  try{totals=await computeReadingTotals(uid);}catch(_){return;}
  if(uid!==currentUid)return;
  const totalReadDays=totals.days;
  renderPersonalGoals(pagesEl.closest("section.tab"),totals,uid);
  pagesEl.textContent = totals.pages.toLocaleString(window.BH_I18N.locale);
  if(daysEl){daysEl.textContent=totalReadDays.toLocaleString(window.BH_I18N.locale);markLoaded(daysEl);}
  markLoaded(pagesEl);
}
async function renderCompletedBooksCount(elId){
  const el=document.getElementById(elId);if(!el||!currentUid)return;
  const uid=currentUid;showCachedOrPlaceholder(el,'…');
  try{
    // bookHistory = finished books, readBooks = currently reading
    const snap=await getDocs(collection(db,'users',uid,'bookHistory'));
    if(currentUid!==uid)return;
    el.textContent=snap.size.toLocaleString(window.BH_I18N.locale);markLoaded(el);
  }catch(_){}
}
export async function computeTotalReadDays(uid){return (await computeReadingTotals(uid)).days;}
async function computeReadingTotals(uid){
  const joinDs = joinDateStrOf(uid);
  const startDs = (joinDs && joinDs > CLUB_START_DATE) ? joinDs : CLUB_START_DATE;
  const today = nowLogical();
  const dateStrs = [];
  let cursor = fromStr(startDs);
  while(toStr(cursor) <= toStr(today)){ dateStrs.push(toStr(cursor)); cursor = addDays(cursor,1); }
  // Fetch all days in parallel; sequential reads were very slow for long-time members.
  const snaps = await Promise.all(dateStrs.map(ds => getDoc(doc(db,'days',ds,'answers',uid))));
  const totals={days:0,pages:0,records:{}};
  snaps.forEach((snap,i)=>{if(!snap.exists())return;const rec=snap.data();totals.records[dateStrs[i]]=rec;if(rec.status==='read'){totals.days++;totals.pages+=Number.isSafeInteger(rec.pages)&&rec.pages>=15?rec.pages:15;}});
  return totals;
}
/* Optional personal goals. Days follow the app's 06:00 day boundary. */
function personalGoals(data){return {daily:data?.daily||[],monthly:data?.monthly||[]};}
function dailyGoalAt(goals,day=todayStr()){
 return [...goals.daily].reverse().find(g=>g.start<=day&&(!g.end||day<g.end));
}
function activeMonthlyGoal(goals,now=Date.now()){
 return goals.monthly.find(g=>!g.cancelledAt&&Date.parse(g.start)<=now&&now<Date.parse(g.end));
}
function goalMonthEnd(start){
 const end=new Date(start),day=end.getDate();end.setDate(1);end.setMonth(end.getMonth()+1);
 const last=new Date(end.getFullYear(),end.getMonth()+1,0).getDate();end.setDate(Math.min(day,last));return end.toISOString();
}
async function loadPersonalGoals(uid=currentUid){
 const snapshot=await getDoc(doc(db,'users',uid));return personalGoals(snapshot.data()?.readingGoals);
}
async function savePersonalGoal(kind,target){
 if(!Number.isSafeInteger(target)||target<(kind==='daily'?15:1))throw Error(kind==='daily'?window.BH_I18N.pick("En az 15 sayfa yazmalısın.","Enter at least 15 pages."):window.BH_I18N.pick("En az 1 kitap yazmalısın.","Enter at least 1 book."));
 const uid=currentUid,ref=doc(db,'users',uid),day=todayStr(),now=new Date().toISOString();
 await runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref),goals=personalGoals(snapshot.data()?.readingGoals);
  if(kind==='daily'){
   if(dailyGoalAt(goals,day))throw Error(window.BH_I18N.pick("Günlük hedefin zaten var.","You already have a daily goal."));
   goals.daily.push({start:day,target});
  }else{
   if(activeMonthlyGoal(goals))throw Error(window.BH_I18N.pick("Aylık hedefin henüz bitmedi.","Your monthly goal is still active."));
   goals.monthly.push({start:now,end:goalMonthEnd(now),target,completed:[]});
  }
  tx.update(ref,{readingGoals:goals});
 });
}
async function stopDailyGoal(){
 const ref=doc(db,'users',currentUid),day=todayStr();
 await runTransaction(db,async tx=>{
  const snap=await tx.get(ref),goals=personalGoals(snap.data()?.readingGoals),goal=dailyGoalAt(goals,day);
  // Keep today's goal in the history; stopping takes effect at 06:00 tomorrow.
  if(goal&&!goal.end){goal.end=toStr(addDays(fromStr(day),1));tx.update(ref,{readingGoals:goals});}
 });
}
function goalHistoryCounts(goals,records,day=todayStr(),now=Date.now()){
 const count={dailyWin:0,dailyLoss:0,monthlyWin:0,monthlyLoss:0};
 for(const goal of goals.daily){
  for(let ds=goal.start;ds<=day&&(!goal.end||ds<goal.end);ds=toStr(addDays(fromStr(ds),1))){
   const rec=records[ds],pages=rec?.status==='read'?(Number.isSafeInteger(rec.pages)&&rec.pages>=15?rec.pages:15):0;
   if(pages>=goal.target)count.dailyWin++;else if(ds<day)count.dailyLoss++;
  }
 }
 for(const goal of goals.monthly){if(!goal.cancelledAt&&Date.parse(goal.end)<=now)count[(goal.completed||[]).length>=goal.target?'monthlyWin':'monthlyLoss']++;}
 return count;
}
function goalEditButton(kind){
 const label=kind==='daily'?window.BH_I18N.pick("Günlük sayfa hedefini düzenle","Edit daily page goal"):window.BH_I18N.pick("Aylık kitap hedefini düzenle","Edit monthly book goal");
 return `<button type="button" class="goal-edit-button icon-button" data-edit-goal="${kind}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19.5 10M4.5 14A8 8 0 0 0 17.9 17.9"/></svg></button>`;
}
async function updatePersonalGoal(kind,target,expected,uid,day,remove=false){
 if(!remove&&(!Number.isSafeInteger(target)||target<(kind==='daily'?15:1)))throw Error(kind==='daily'?window.BH_I18N.pick("En az 15 sayfa yazmalısın.","Enter at least 15 pages."):window.BH_I18N.pick("En az 1 kitap yazmalısın.","Enter at least 1 book."));
 const ref=doc(db,'users',uid);
 await runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref),goals=personalGoals(snapshot.data()?.readingGoals);
  if(uid!==currentUid||day!==todayStr())throw Error(window.BH_I18N.pick("Gün veya oturum değişti. Hedefi yeniden aç.","The day or session has changed. Reopen the goal."));
  const goal=kind==='daily'?dailyGoalAt(goals,day):activeMonthlyGoal(goals);
  if(!goal||goal.start!==expected.start||goal.target!==expected.target||goal.end!==expected.end)throw Error(window.BH_I18N.pick("Hedef değişmiş veya süresi dolmuş. Kartı yeniden aç.","The goal has changed or expired. Reopen the card."));
  if(remove){
   if(kind==='daily')goal.end=day;
   else goal.cancelledAt=new Date().toISOString();
   tx.update(ref,{readingGoals:goals});return;
  }
  if(goal.target===target)return;
  if(kind==='daily'&&goal.start<day){
   // Don't re-evaluate earlier days against the new target.
   const next={start:day,target,...(goal.end?{end:goal.end}:{})};
   goal.end=day;goals.daily.push(next);
  }else goal.target=target;
  // A monthly goal keeps its start, end and finished books unchanged.
  tx.update(ref,{readingGoals:goals});
 });
}
function openGoalEditor(kind,goal,section){
 if(document.querySelector('.goal-edit-dialog'))return;
 const uid=currentUid,day=todayStr(),expected={...goal};
 const dialog=document.createElement('dialog');dialog.className='reading-pages-dialog goal-edit-dialog';
 dialog.innerHTML=window.BH_I18N.template`<form novalidate><h2>${kind==='daily'?window.BH_I18N.pick("Günlük sayfa hedefi","Daily page goal"):window.BH_I18N.pick("Aylık kitap hedefi","Monthly book goal")}</h2><label>${kind==='daily'?window.BH_I18N.pick("Günde kaç sayfa?","How many pages per day?"):window.BH_I18N.pick("Bu dönemde kaç kitap?","How many books this period?")}<input name="target" type="number" inputmode="numeric" min="${kind==='daily'?15:1}" step="1" required value="${goal.target}" autofocus></label><p class="muted">${kind==='daily'?window.BH_I18N.pick("Yeni hedef bugünden itibaren geçerli. Önceki günlerin sonuçları korunur.","The new goal applies from today. Previous results are kept."):window.BH_I18N.pick("Dönem tarihleri ve bitirdiğin kitaplar korunur.","Your period dates and completed books will be kept.")}</p><p class="goal-error" role="alert"></p><div class="row"><button type="button" data-cancel>Vazgeç</button><button type="submit" class="primary">Kaydet</button></div><button type="submit" name="remove" class="goal-remove-button">Hedefi kaldır</button></form>`;
 let busy=false;
 const close=()=>{if(busy)return;dialog.close();dialog.remove();};
 dialog.querySelector('[data-cancel]').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
   await updatePersonalGoal(kind,Number(e.target.elements.target.value),expected,uid,day,e.submitter?.name==='remove');
   busy=false;close();
   if(currentUid===uid)renderTotalPagesCard(section.id==='tab-today'?'totalPagesNumber':'mTotalPagesNumber');
  }catch(err){dialog.querySelector('.goal-error').textContent=err.message||'Hedef kaydedilemedi.';}
  finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 document.body.append(dialog);dialog.showModal();dialog.querySelector('input').select();
}

function goalForm(kind){return window.BH_I18N.template`<form class="goal-form" data-goal-form="${kind}"><label>${kind==='daily'?window.BH_I18N.pick("Günde kaç sayfa?","How many pages per day?"):window.BH_I18N.pick("Bir ayda kaç kitap?","How many books per month?")}<input type="number" name="target" inputmode="numeric" min="${kind==='daily'?15:1}" step="1" required placeholder="${kind==='daily'?window.BH_I18N.pick("Örn. 30","e.g. 30"):window.BH_I18N.pick("Örn. 2","e.g. 2")}"></label><button class="primary" type="submit">Belirle</button><p class="goal-error" role="alert"></p></form>`;}
function goalProgress(value,target){return `<progress value="${Math.min(value,target)}" max="${target}" aria-label="Hedef ilerlemesi"></progress>`;}
async function renderPersonalGoals(section,totals,uid=currentUid){
 const grid=section.querySelector('.personal-goals'),history=section.querySelector('.goal-history');if(!grid)return;
 const revision=String(Number(grid.dataset.revision||0)+1);grid.dataset.revision=revision;
 try{
  const goals=await loadPersonalGoals(uid);if(uid!==currentUid||grid.dataset.revision!==revision)return;
  const day=todayStr(),daily=dailyGoalAt(goals,day),monthly=activeMonthlyGoal(goals),last=goals.monthly.filter(g=>!g.cancelledAt).at(-1);
  const nextDay=fromStr(toStr(addDays(nowLogical(),1)));nextDay.setHours(6,0,0,0);
  section.dataset.goalRefreshAt=String(Math.min(nextDay.getTime(),monthly?Date.parse(monthly.end):Infinity));
  const rec=totals.records[day],pages=rec?.status==='read'?(Number.isSafeInteger(rec.pages)&&rec.pages>=15?rec.pages:15):0;
  // Totals may have been read before the optimistic check-in; don't let them flip the button back.
  updateSelfReadButton(section,todayAnswers[uid]==='read'&&rec?.status!=='read'?{...rec,status:'read'}:rec,daily);
  const dailyText=pages>=daily?.target?window.BH_I18N.template`Bugünkü hedefini ${pages} sayfayla tamamladın.`:pages?window.BH_I18N.template`Bugün ${pages} sayfa okudun. Hedefine ${Math.max(0,(daily?.target||0)-pages)} sayfa kaldı.`:window.BH_I18N.pick("Bugün henüz okuma kaydın yok.","You haven’t recorded any reading today.");
  grid.innerHTML=window.BH_I18N.template`<div class="card personal-goal"><span class="goal-symbol" aria-hidden="true">▤</span><h2>Günlük sayfa hedefi</h2>${daily?goalEditButton("daily"):""}${daily?window.BH_I18N.template`<strong class="goal-value">${daily.target} <small>sayfa / gün</small></strong>${goalProgress(pages,daily.target)}<p role="status">${dailyText}</p>${daily.end?window.BH_I18N.pick("<p class=\"muted\">Hedefin yarın 06.00’da sona erecek.</p>","<p class=\"muted\">Your goal will end tomorrow at 06:00.</p>"):window.BH_I18N.pick("<button type=\"button\" class=\"ai-text-action\" data-stop-goal>Hedefi yarından itibaren bırak</button>","<button type=\"button\" class=\"ai-text-action\" data-stop-goal>End goal from tomorrow</button>")}`:goalForm('daily')}<p class="muted">İsteğe bağlı</p></div>
  <div class="card personal-goal"><span class="goal-symbol" aria-hidden="true">▥</span><h2>Aylık kitap hedefi</h2>${monthly?goalEditButton("monthly"):""}${monthly?window.BH_I18N.template`<strong class="goal-value">${monthly.target} <small>kitap</small></strong>${goalProgress((monthly.completed||[]).length,monthly.target)}<p role="status">Bu ay ${(monthly.completed||[]).length} kitap bitirdin.</p><p class="muted">${new Date(monthly.end).toLocaleString(window.BH_I18N.locale,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})} tarihinde sona erer.</p>`:`${last?`<p class="goal-result" role="status">${(last.completed||[]).length>=last.target?window.BH_I18N.pick("Son hedefinde başarılı oldun.","You completed your last goal."):window.BH_I18N.pick("Son hedefini tamamlayamadın.","You did not complete your last goal.")} ${(last.completed||[]).length} / ${last.target} kitap.</p>`:''}${goalForm('monthly')}` }<p class="muted">İsteğe bağlı</p></div>`;
  const counts=goalHistoryCounts(goals,totals.records);
  history.innerHTML=window.BH_I18N.template`<h2>Hedef geçmişin</h2><div class="goal-history-grid"><div><b>Günlük sayfa hedefleri</b><p><span class="goal-success"><strong class="goal-history-number">${counts.dailyWin}</strong> tamamladın</span><br><strong class="goal-history-number">${counts.dailyLoss}</strong> tamamlayamadın</p></div><div><b>Aylık kitap hedefleri</b><p><span class="goal-success"><strong class="goal-history-number">${counts.monthlyWin}</strong> tamamladın</span><br><strong class="goal-history-number">${counts.monthlyLoss}</strong> tamamlayamadın</p></div></div><span class="muted">Süresi devam eden hedefler başarısız sayılmaz.</span>`;
  grid.querySelectorAll('[data-goal-form]').forEach(form=>form.onsubmit=async e=>{
   e.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
   try{await savePersonalGoal(form.dataset.goalForm,Number(form.elements.target.value));await renderPersonalGoals(section,totals,uid);}
   catch(err){form.querySelector('.goal-error').textContent=err.message||'Hedef kaydedilemedi.';button.disabled=false;}
  });
  grid.querySelectorAll('[data-edit-goal]').forEach(button=>button.onclick=()=>openGoalEditor(button.dataset.editGoal,button.dataset.editGoal==='daily'?daily:monthly,section));
  const stop=grid.querySelector('[data-stop-goal]');if(stop)stop.onclick=async()=>{
   stop.disabled=true;try{await stopDailyGoal();await renderPersonalGoals(section,totals,uid);}catch(err){showToast(window.BH_I18N.pick("Hedef değiştirilemedi. Tekrar dene.","Could not change the goal. Try again."));stop.disabled=false;}
  };
 }catch(err){grid.innerHTML=window.BH_I18N.pick("<div class=\"card\">Hedefler yüklenemedi. <button type=\"button\" data-retry-goals>Tekrar dene</button></div>","<div class=\"card\">Could not load goals. <button type=\"button\" data-retry-goals>Try again</button></div>");grid.querySelector('button').onclick=()=>renderPersonalGoals(section,totals,uid);}
}
function validReadPages(rec){return Number.isSafeInteger(rec?.pages)&&rec.pages>=15?rec.pages:15;}
function updateSelfReadButton(section,rec,daily){
 const button=section.querySelector('.daily-actions .read');if(!button)return;
 const read=rec?.status==='read',pages=read?validReadPages(rec):0;
 const editable=read&&daily&&pages<daily.target;
 button.disabled=read&&!editable;button.classList.toggle('selected',read);
 button.classList.toggle('pages-editable',Boolean(editable));
 button.setAttribute('aria-pressed',String(read));
 /*
  * Only rewrite the button when its state actually changes, so an ongoing check-in animation isn't cut
  * short by an unrelated re-render.
  */
 const state=editable?'edit:'+pages:read?'read':'idle';
 if(button.dataset.markState!==state){
  button.dataset.markState=state;
  button.innerHTML=editable?window.BH_I18N.template`<span>Sayfa sayısını güncelle<small class="previous-page-count">${pages} sayfa</small></span>`:`${READ_CHECK_SVG}<span class="mark-label">${read?window.BH_I18N.pick("Bugün okudun","You read today"):window.BH_I18N.pick("Okudum","Read")}</span>`;
 }
 button.title=editable?window.BH_I18N.pick("Bugün okuduğun toplam sayfa sayısını güncelle","Update your total pages read today"):read?window.BH_I18N.pick("Bugün okudun","You read today"):window.BH_I18N.pick("Okudum","Read");
}
const READ_CHECK_SVG='<svg class="mark-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
/*
 * Instant check-in feedback: a fill spreading from the tap point, a self-drawing tick and a small burst
 * of sparks. Runs without waiting for the network.
 */
function playReadMarkFx(btn,point){
 try{navigator.vibrate?.(12);}catch(_){}
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const r=btn.getBoundingClientRect();
 const x=point&&point.x?point.x-r.left:r.width/2,y=point&&point.y?point.y-r.top:r.height/2;
 btn.style.setProperty('--fx-x',x+'px');btn.style.setProperty('--fx-y',y+'px');
 btn.style.setProperty('--fx-r',Math.hypot(Math.max(x,r.width-x),Math.max(y,r.height-y))+'px');
 btn.classList.remove('just-marked');void btn.offsetWidth;btn.classList.add('just-marked');
 clearTimeout(btn._markFxTimer);btn._markFxTimer=setTimeout(()=>btn.classList.remove('just-marked'),1200);
 const layer=document.createElement('span');layer.className='mark-burst';
 layer.style.left=(r.left+x)+'px';layer.style.top=(r.top+y)+'px';
 // Celebration colors that stay visible on both the dark green fill and the light card.
 const colors=['#F2B84B','#EF8A62','#9FD8A8','#B9A8E8'];
 for(let i=0;i<14;i++){
  const dot=document.createElement('i'),angle=(i/14)*Math.PI*2+Math.random()*.45,dist=42+Math.random()*36;
  dot.style.background=colors[i%colors.length];if(i%3===0)dot.classList.add('streak');
  layer.appendChild(dot);
  dot.animate([{transform:`rotate(${angle}rad) translateX(0) scale(1)`,opacity:1},{transform:`rotate(${angle}rad) translateX(${dist}px) scale(.2)`,opacity:0}],{duration:680+Math.random()*200,delay:60,easing:'cubic-bezier(.15,.8,.3,1)',fill:'both'});
 }
 document.body.appendChild(layer);setTimeout(()=>layer.remove(),1000);
}
async function saveSelfReadTotal(uid,day,pages){
 const ref=doc(db,'days',day,'answers',uid),userRef=doc(db,'users',uid);
 return runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref),user=await tx.get(userRef);
  if(uid!==currentUid||day!==todayStr())throw Error(window.BH_I18N.pick("Gün veya oturum değişti. Lütfen yeniden işaretle.","The day or session has changed. Please mark your reading again."));
  const rec=snapshot.data(),wasRead=rec?.status==='read';
  const daily=dailyGoalAt(personalGoals(user.data()?.readingGoals),day);
  if(wasRead&&(!daily||validReadPages(rec)>=daily.target))return false;
  if(daily&&(!Number.isSafeInteger(pages)||pages<15))throw Error('En az 15 tam sayfa girmelisin.');
  if(wasRead&&pages<validReadPages(rec))throw Error(window.BH_I18N.pick("Yeni toplam önceki sayfa sayısından az olamaz.","The new total cannot be less than the previous page count."));
  // Set the day's total (it replaces the previous count; it is not added to it).
  tx.set(ref,{status:'read',name:usersCache[uid]?.name||'',updatedAt:new Date().toISOString(),...(daily?{pages}:{})},{merge:true});
  return !wasRead;
 });
}
function askReadPages(previousPages=0){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='reading-pages-dialog';
  dialog.innerHTML=window.BH_I18N.pick("<form novalidate><h2>Bugün kaç sayfa okudun?</h2><label>Okuduğun sayfa sayısı<input name=\"pages\" type=\"number\" inputmode=\"numeric\" min=\"15\" step=\"1\" required autofocus></label><p class=\"muted\">En az 15 sayfa girmelisin.</p><div class=\"row\"><button type=\"button\" data-cancel>Vazgeç</button><button type=\"submit\" class=\"primary\">Kaydet</button></div></form>","<form novalidate><h2>How many pages did you read today?</h2><label>Pages you read<input name=\"pages\" type=\"number\" inputmode=\"numeric\" min=\"15\" step=\"1\" required autofocus></label><p class=\"muted\">Enter at least 15 pages.</p><div class=\"row\"><button type=\"button\" data-cancel>Cancel</button><button type=\"submit\" class=\"primary\">Save</button></div></form>");
  if(previousPages){dialog.querySelector('input').placeholder=String(previousPages);dialog.querySelector('h2').textContent=window.BH_I18N.pick("Bugün toplam kaç sayfa okudun?","How many pages have you read in total today?");dialog.querySelector('.muted').textContent=window.BH_I18N.pick("Önceki toplam: ","Previous total: ")+previousPages+window.BH_I18N.pick(" sayfa. Yeni günlük toplamını yaz."," pages. Enter your new daily total.");}
  const finish=value=>{dialog.close();dialog.remove();resolve(value);};
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const value=Number(e.target.elements.pages.value);if(!Number.isSafeInteger(value)||value<15){showToast('En az 15 tam sayfa girmelisin. Okuma kaydedilmedi.');finish(null);}else finish(value);};
  dialog.querySelector('[data-cancel]').onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};
  document.body.appendChild(dialog);dialog.showModal();
 });
}
export async function moveBookWithGoal(b,collectionName,destCollection){
 const uid=currentUid;
 if(collectionName!=='readBooks'){
  await addDoc(collection(db,'users',uid,destCollection),{title:b.title||'',author:b.author||'',cover:b.cover||'',addedAt:new Date().toISOString()});
  await deleteDoc(doc(db,'users',uid,collectionName,b.id));
  hubPreviews.invalidate('library');
  return;
 }
 const userRef=doc(db,'users',uid),sourceRef=doc(db,'users',uid,'readBooks',b.id),destRef=doc(db,'users',uid,'bookHistory','finished_'+b.id);
 const completedAt=new Date().toISOString();
 await runTransaction(db,async tx=>{
  const user=await tx.get(userRef),source=await tx.get(sourceRef);if(!source.exists())return;
  const goals=personalGoals(user.data()?.readingGoals),monthly=activeMonthlyGoal(goals,Date.parse(completedAt));
  const data=source.data();
  tx.set(destRef,{title:data.title||'',author:data.author||'',cover:data.cover||'',addedAt:completedAt,completedAt,completedFromReading:true});
  tx.delete(sourceRef);
  if(monthly){monthly.completed=[...new Set([...(monthly.completed||[]),b.id])];tx.update(userRef,{readingGoals:goals});}
 });
 hubPreviews.invalidate('library');
}
// Refresh the view at 06:00 and when a monthly goal period ends while the app stays open.

/*
 * "Did you read today?" card Members and admins see the same check-in card on their own Today screens;
 * it is wired to different element ids because both screens exist in the page at the same time.
 * Greeting for the card heading, based on the time of day and today's check-in status.
 */
function dailyGreetingText(status){
  const h = new Date().getHours();
  const part = h<6 ? 'gece' : h<11 ? 'sabah' : h<17 ? 'oglen' : h<21 ? 'aksam' : 'gece';
  const lines = {
    sabah: {
      read: window.BH_I18N.pick("Günaydın! Bugünün kitabını okudun, güne hazırsın.","Good morning! You’ve read today. You’re ready for the day."),
      skip: window.BH_I18N.pick("Günaydın! Bugün ara verdin, canın istediğinde devam edersin.","Good morning! You took a break today. Read whenever you feel ready."),
      none: window.BH_I18N.pick("Günaydın! Okumaya hazır mısın?","Good morning! Ready to read?")
    },
    oglen: {
      read: window.BH_I18N.pick("İyi günler! Bugün için okudun bile, harikasın.","Good afternoon! You’ve already read today. Well done!"),
      skip: window.BH_I18N.pick("İyi günler! Bugün ara verdin, yarın devam edebilirsin.","Good afternoon! You took a break today. You can continue tomorrow."),
      none: window.BH_I18N.pick("İyi günler! Güne birkaç sayfa sığdırmaya ne dersin?","Good afternoon! How about a few pages today?")
    },
    aksam: {
      read: window.BH_I18N.pick("İyi akşamlar! Günü okuyarak kapattın.","Good evening! You’ve rounded off the day with a book."),
      skip: window.BH_I18N.pick("İyi akşamlar! Bugün ara verdin, yarın kaldığın yerden devam.","Good evening! You took a break today. Pick up where you left off tomorrow."),
      none: window.BH_I18N.pick("İyi akşamlar! Günü bitirmeden birkaç sayfa okur musun?","Good evening! A few pages before the day ends?")
    },
    gece: {
      read: window.BH_I18N.pick("İyi geceler! Bugün okudun, tatlı rüyalar.","Good night! You read today. Sweet dreams."),
      skip: window.BH_I18N.pick("İyi geceler! Bugün ara verdin, yarın devam edersin.","Good night! You took a break today. Continue tomorrow."),
      none: window.BH_I18N.pick("İyi geceler! Yatmadan birkaç sayfa okumaya ne dersin?","Good night! How about a few pages before bed?")
    }
  };
  return lines[part][status] || lines[part].none;
}
/*
 * Optional reading note, offered on the Today card right after the first "Read" check-in of the day: the
 * button gives way to a small text box. "Not now", sending, switching to another tab or leaving the app
 * puts the button back. It is only called for the day's first check-in, so it appears once a day.
 */
function openReadingNoteBox(btn){
  const actions = btn.closest('.daily-actions'), card = btn.closest('.daily-checkin'), section = btn.closest('section.tab');
  if(!actions || !card || !section || card.querySelector('.reading-note-box')) return;
  const T = window.BH_I18N;
  const prompt = T.pick('Bugün okuduklarından aklında kalan bir cümle ya da paylaşmak istediğin bir şey','A sentence that stayed with you from today’s reading, or anything you’d like to share');
  const box = document.createElement('form');
  box.className = 'reading-note-box';
  box.noValidate = true;
  box.innerHTML = `<p class="reading-note-prompt">${prompt}</p>
    <textarea name="note" maxlength="280" rows="3" data-mentions aria-label="${prompt}"></textarea>
    <div class="reading-note-actions"><button type="button" class="reading-note-later" data-note-later>${T.pick('Şimdi değil','Not now')}</button><button type="submit" class="primary">${T.pick('Gönder','Send')}</button></div>`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let closed = false;
  const watcher = new MutationObserver(()=>{ if(!section.classList.contains('active')) close(true); });
  const onHide = ()=>{ if(document.visibilityState==='hidden') close(true); };
  function close(instant){
    if(closed) return;
    closed = true;
    watcher.disconnect();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    const restore = ()=>{
      box.remove(); actions.hidden = false; card.classList.remove('note-open');
      if(!instant && !reduced) actions.animate([{opacity:0, transform:'scale(.96)'},{opacity:1, transform:'none'}], {duration:220, easing:'cubic-bezier(.2,0,0,1)'});
    };
    if(instant || reduced){ restore(); return; }
    const anim = box.animate([{height:box.offsetHeight+'px', opacity:1},{height:actions.offsetHeight+'px', opacity:0}], {duration:220, easing:'cubic-bezier(.3,0,.8,.15)'});
    anim.onfinish = restore;
  }
  box.querySelector('[data-note-later]').onclick = ()=> close(false);
  box.onsubmit = async (e)=>{
    e.preventDefault();
    const text = box.elements.note.value.trim();
    if(!text){ close(false); return; }
    box.querySelectorAll('button').forEach(b=> b.disabled = true);
    const shared = await shareReadingNote(text);
    if(!shared) showToast(T.pick('Not paylaşılamadı.','Could not share the note.'));
    close(false);
  };
  // Let the check-in animation play before the button makes room for the box.
  setTimeout(()=>{
    if(closed || !section.classList.contains('active') || document.visibilityState==='hidden'){ closed = true; return; }
    const from = actions.offsetHeight;
    card.classList.add('note-open');
    actions.hidden = true;
    actions.after(box);
    watcher.observe(section, { attributes:true, attributeFilter:['class'] });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    if(!reduced) box.animate([{height:from+'px', opacity:0, borderRadius:'999px'},{height:box.offsetHeight+'px', opacity:1, borderRadius:'20px'}], {duration:340, easing:'cubic-bezier(.2,0,0,1)'});
    box.elements.note.focus({ preventScroll:true });
  }, 900);
}
export function wireSelfMarkCard(ids){
  function render(){
    const st = todayAnswers[currentUid];
    updateSelfReadButton(document.getElementById(ids.readBtn).closest('section.tab'),{status:st},null);
    if(ids.heading){
      document.getElementById(ids.heading).textContent = dailyGreetingText(st==='read'?'read':st==='skip'?'skip':'none');
    }
    const ld = nowLogical();
    const dowLabel = DOW[ld.getDay()===0?6:ld.getDay()-1];
    const dateLabel = `${dowLabel} ${pad(ld.getDate())}.${pad(ld.getMonth()+1)}.${ld.getFullYear()}`;
    document.getElementById(ids.dateNote).textContent =
      (window.BH_I18N.language==='en'
       ? `Today’s reading date: ${dateLabel}. This check-in is valid until 06:00 tomorrow morning. Check-ins after 06:00 count toward the next day. If you do not check in by 06:00, today will automatically be marked as “didn’t read”.`
       : `Bugünün okuma tarihi: ${dateLabel}. Bu işaretleme yarın sabah 06:00'a kadar geçerli; 06:00'dan sonra yaptığın işaretleme bir sonraki güne yazılır. 06:00'a kadar hiç işaretleme yapmazsan bu gün otomatik "okumadım" sayılır.`);
    document.getElementById(ids.statusNote).textContent =
      st==='read' ? window.BH_I18N.pick("Bugün için \"Okudum\" işaretledin. Harika!","You marked today as read. Great!") :
      st==='skip' ? window.BH_I18N.pick("Bugün için okuma kaydın yok.","You haven’t recorded any reading today.") :
      window.BH_I18N.pick("Bugün için henüz işaretleme yapmadın.","You haven’t checked in today.");
    computeStreak(currentUid).then(s=>{
      document.getElementById(ids.streakNote).textContent = window.BH_I18N.template`${s} gün`;
    }).catch(()=>{});
    renderTotalPagesCard(ids.pagesNumber);
    if(ids.qpBook) renderQpBookInBugun(ids.qpBook);
  }
  document.getElementById(ids.readBtn).addEventListener('click', async (ev)=>{
    const key = ids.readBtn+'|read';
    if(stampBtnInFlight.has(key)) return;
    stampBtnInFlight.add(key);
    const btn=ev.currentTarget,point={x:ev.clientX,y:ev.clientY};
    const uid=currentUid,day=todayStr(),prevStatus=todayAnswers[uid];
    let optimistic=false;
    try{
      /*
       * Goals and today's status are already kept up to date by live listeners, so the click doesn't wait for
       * the server.
       */
      const goals=personalGoals((usersCache[uid]||myProfile)?.readingGoals);
      const daily=dailyGoalAt(goals,day),wasRead=prevStatus==='read';
      let previousPages=0;
      if(wasRead){
        if(!daily){render();return;}
        previousPages=validReadPages((await getDoc(doc(db,'days',day,'answers',uid))).data());
        if(previousPages>=daily.target){render();return;}
      }
      let pages=null;
      if(daily){
        pages=await askReadPages(previousPages);
        if(pages===null){render();return;}
        if(wasRead&&pages<previousPages){showToast(window.BH_I18N.pick("Yeni toplam önceki ","The new total cannot be below the previous ")+previousPages+' sayfadan az olamaz.');render();return;}
      }
      if(uid!==currentUid||day!==todayStr()){showToast(window.BH_I18N.pick("Gün veya oturum değişti. Lütfen yeniden işaretle.","The day or session has changed. Please mark your reading again."));render();return;}
      if(!wasRead){
        optimistic=true;selfReadPending={uid,day};
        todayAnswers[uid]='read';render();playReadMarkFx(btn,point);
      }
      const created=await saveSelfReadTotal(uid,day,pages);
      selfReadPending=null;
      todayAnswers[uid]='read';
      hubPreviews.invalidate('club');
      render();
      if(created){
        openReadingNoteBox(btn);
        notifyAllMembers(`${myProfile.name} bugün "Okudum" işaretledi.`, 'week', uid);
        // The check-in is already saved; if the streak can't be read, badges are checked later.
        try{const streak=await computeStreak(uid);await checkAndAwardBadges(uid,streak);}catch(_){}
      }
    }catch(err){
      selfReadPending=null;
      if(optimistic){
        if(prevStatus===undefined) delete todayAnswers[uid]; else todayAnswers[uid]=prevStatus;
        btn.classList.remove('just-marked');
      }
      showToast(err.message||window.BH_I18N.pick("Okuma kaydedilemedi. Lütfen yeniden dene.","Could not save your reading. Please try again."));render();
    }
    finally{setTimeout(()=>stampBtnInFlight.delete(key),1200);}
  });
  return render;
}
export function playMarkFx(btn, type){
  const cls = type==='read' ? 'pop-read' : 'pop-skip';
  const r = btn.getBoundingClientRect();
  const ghost = btn.cloneNode(true);
  ghost.classList.remove('selected');
  ghost.removeAttribute('id');
  ghost.style.position = 'fixed';
  ghost.style.left = r.left + 'px';
  ghost.style.top = r.top + 'px';
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.margin = '0';
  ghost.style.zIndex = '500';
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);
  void ghost.offsetWidth; // force a reflow so the animation restarts
  ghost.classList.add(cls);
  setTimeout(()=> ghost.remove(), 700);
}

export function initToday(){
  setInterval(()=>{
   if(document.hidden||!currentUid)return;
   const section=document.querySelector('#tab-today.active, #tab-msurvey.active');
   if(section&&Date.now()>=Number(section.dataset.goalRefreshAt||Infinity))renderTotalPagesCard(section.id==='tab-today'?'totalPagesNumber':'mTotalPagesNumber');
  },60000);
}

