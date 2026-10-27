/*
 * Daily questions: a stack of quick yes/no opinion questions about books at the top of the feed's
 * "Kulüp" view. Swiping a card right answers "Evet", left answers "Hayır" (buttons do the same). When the
 * last card is answered, the answers are shared as a "daily_questions" post, which also shows how the
 * club answered each question.
 *
 * Everyone gets the same questions on the same day. The day starts at 06:00, like check-ins. Questions
 * come from question-bank.js in a shuffled order that only repeats after the whole bank has been used.
 */
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { QUESTION_BANK } from "./question-bank.js";
import { createPost, notifyFeedActivity, renderTimelineTab } from "./feed.js";
/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import { currentUid, db, escapeHtml, myProfile, todayStr } from "./app.js";

export const DAILY_QUESTION_COUNT = 7;

// Small seeded random generator (mulberry32), so every member shuffles the bank the same way.
function seededRandom(seed){
  return ()=>{
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Question ids for a day ("YYYY-MM-DD"). Each cycle walks through a fresh shuffle of the bank.
export function questionIdsForDay(day){
  const [y, m, d] = day.split('-').map(Number);
  const dayNumber = Math.round((Date.UTC(y, m-1, d) - Date.UTC(2026, 0, 1)) / 864e5);
  const perCycle = Math.floor(QUESTION_BANK.length / DAILY_QUESTION_COUNT);
  const cycle = Math.floor(dayNumber / perCycle);
  const slot = dayNumber - cycle * perCycle;
  const order = QUESTION_BANK.map((_, i)=> i);
  const random = seededRandom(cycle + 1);
  for(let i = order.length - 1; i > 0; i--){
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(slot * DAILY_QUESTION_COUNT, (slot + 1) * DAILY_QUESTION_COUNT);
}

/* ---- Answers of the whole club, per day ---- */

const dayAnswersCache = new Map();

// All daily-question posts of a day (one per member who finished), cached for this session.
function loadDayPosts(day, { fresh = false } = {}){
  if(!fresh && dayAnswersCache.has(day)) return dayAnswersCache.get(day);
  const posts = collection(db,'posts');
  const promise = getDocs(query(posts, where('type','==','daily_questions'), where('day','==',day)))
    .catch(()=> getDocs(query(posts, where('day','==',day))))
    .then(snap=> snap.docs.map(d=> d.data()).filter(p=> p.type==='daily_questions'))
    .catch(()=>{ dayAnswersCache.delete(day); return []; });
  dayAnswersCache.set(day, promise);
  return promise;
}

/* ---- Saved progress ---- */

const progressKey = ()=> 'bh_daily_questions_' + currentUid;
function loadProgress(day){
  try{
    const saved = JSON.parse(localStorage.getItem(progressKey()) || 'null');
    if(saved && saved.day===day) return saved;
  }catch(_){}
  return { day, answers: [], done: false };
}
function saveProgress(progress){
  try{ localStorage.setItem(progressKey(), JSON.stringify(progress)); }catch(_){}
}

/* ---- The card ---- */

let state = null; // { day, ids, progress, sharing }

const T = ()=> window.BH_I18N;

export async function renderDailyQuestionsCard(){
  const card = document.getElementById('dailyQuestionsCard');
  if(!card || !currentUid || !myProfile) return;
  const day = todayStr();
  const progress = loadProgress(day);
  if(progress.done){ card.hidden = true; return; }
  if(!state || state.day!==day || state.uid!==currentUid){
    state = { day, uid: currentUid, ids: questionIdsForDay(day), progress, sharing: false };
  }
  drawCard();
  // Answered on another device: the shared post is the record.
  const posts = await loadDayPosts(day);
  if(state.day!==day) return;
  if(posts.some(p=> p.uid===currentUid)){
    state.progress.done = true;
    saveProgress(state.progress);
    card.hidden = true;
  } else if(state.progress.answers.length >= state.ids.length && !state.sharing){
    share(); // finished earlier but sharing failed
  }
}

function drawCard(){
  const card = document.getElementById('dailyQuestionsCard');
  const { ids, progress } = state;
  const index = progress.answers.length;
  card.hidden = false;
  if(index >= ids.length){
    card.innerHTML = `<div class="dq-head"><b>${T().pick('Günün Soruları','Questions of the day')}</b></div>
      <p class="dq-done">${state.sharing ? T().pick('Cevapların paylaşılıyor…','Sharing your answers…') : T().pick('Cevapların paylaşılamadı.','Your answers could not be shared.')}</p>
      ${state.sharing ? '' : `<div class="dq-actions"><button type="button" class="dq-undo" data-dq-undo>${T().pick('Geri al','Undo')}</button><button type="button" class="dq-btn dq-yes" data-dq-retry>${T().pick('Tekrar dene','Try again')}</button></div>`}`;
    return;
  }
  const question = (i)=> escapeHtml(QUESTION_BANK[ids[i]] || '');
  const next = index + 1 < ids.length ? `<div class="dq-q dq-next" aria-hidden="true"><span>${question(index + 1)}</span></div>` : '';
  card.innerHTML = `<div class="dq-head"><b>${T().pick('Günün Soruları','Questions of the day')}</b><span class="dq-count">${index + 1} / ${ids.length}</span></div>
    <div class="dq-stack" data-own-swipe>
      ${next}
      <div class="dq-q dq-top" tabindex="0" role="group" aria-label="${question(index)}">
        <span>${question(index)}</span>
        <b class="dq-stamp dq-stamp-yes" aria-hidden="true">${T().pick('EVET','YES')}</b>
        <b class="dq-stamp dq-stamp-no" aria-hidden="true">${T().pick('HAYIR','NO')}</b>
      </div>
    </div>
    <div class="dq-actions">
      <button type="button" class="dq-btn dq-no" data-dq-answer="no">${T().pick('Hayır','No')}</button>
      <button type="button" class="dq-undo" data-dq-undo ${index ? '' : 'disabled'}>${T().pick('Geri al','Undo')}</button>
      <button type="button" class="dq-btn dq-yes" data-dq-answer="yes">${T().pick('Evet','Yes')}</button>
    </div>
    <p class="dq-hint">${T().pick('Sağa kaydır: Evet, sola kaydır: Hayır','Swipe right for yes, left for no')}</p>`;
  wireTopCard(card.querySelector('.dq-top'));
}

const reducedMotion = ()=> matchMedia('(prefers-reduced-motion: reduce)').matches;

function answer(yes, top){
  if(!state || state.sharing || top.dataset.leaving) return;
  top.dataset.leaving = '1';
  const finish = ()=>{
    state.progress.answers.push({ id: state.ids[state.progress.answers.length], a: yes });
    saveProgress(state.progress);
    if(state.progress.answers.length >= state.ids.length) share();
    else drawCard();
  };
  if(reducedMotion()){ finish(); return; }
  const width = top.parentElement.offsetWidth;
  const from = top.style.transform || 'none';
  top.style.setProperty('--dq-stamp-yes', yes ? 1 : 0);
  top.style.setProperty('--dq-stamp-no', yes ? 0 : 1);
  top.animate([{ transform: from }, { transform: `translateX(${yes ? width * 1.3 : -width * 1.3}px) rotate(${yes ? 18 : -18}deg)`, opacity: 0 }],
    { duration: 260, easing: 'cubic-bezier(.3,0,.8,.15)', fill: 'forwards' }).onfinish = finish;
}

function undo(){
  if(!state || state.sharing || !state.progress.answers.length) return;
  state.progress.answers.pop();
  saveProgress(state.progress);
  drawCard();
}

function wireTopCard(top){
  let startX = null, startY = 0, dx = 0, pointer = null, horizontal = false;
  const setDrag = (x)=>{
    dx = x;
    top.style.transform = `translateX(${x}px) rotate(${x / 18}deg)`;
    top.style.setProperty('--dq-stamp-yes', Math.max(0, Math.min(1, x / 90)));
    top.style.setProperty('--dq-stamp-no', Math.max(0, Math.min(1, -x / 90)));
  };
  const reset = ()=>{
    top.classList.remove('dragging');
    if(!reducedMotion()) top.animate([{ transform: top.style.transform || 'none' }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,0,0,1)' });
    top.style.transform = '';
    top.style.setProperty('--dq-stamp-yes', 0);
    top.style.setProperty('--dq-stamp-no', 0);
  };
  top.addEventListener('pointerdown', (e)=>{
    if(e.button>0 || top.dataset.leaving) return;
    startX = e.clientX; startY = e.clientY; dx = 0; pointer = e.pointerId; horizontal = false;
  });
  top.addEventListener('pointermove', (e)=>{
    if(e.pointerId!==pointer || startX===null) return;
    const x = e.clientX - startX, y = e.clientY - startY;
    if(!horizontal){
      if(Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)){ startX = null; return; } // a vertical scroll
      if(Math.abs(x) < 8) return;
      horizontal = true;
      top.classList.add('dragging');
      try{ top.setPointerCapture(pointer); }catch(_){}
    }
    setDrag(x);
  });
  const release = (e)=>{
    if(e.pointerId!==pointer || startX===null){ startX = null; return; }
    startX = null;
    if(!horizontal) return;
    if(Math.abs(dx) > Math.min(110, top.offsetWidth * 0.28)){ top.classList.remove('dragging'); answer(dx > 0, top); }
    else reset();
  };
  top.addEventListener('pointerup', release);
  top.addEventListener('pointercancel', (e)=>{ if(e.pointerId===pointer && startX!==null){ startX = null; if(horizontal) reset(); } });
  top.addEventListener('keydown', (e)=>{
    if(e.key==='ArrowRight'){ e.preventDefault(); answer(true, top); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); answer(false, top); }
  });
}

async function share(){
  state.sharing = true;
  drawCard();
  const { day, progress } = state;
  try{
    const posts = await loadDayPosts(day, { fresh: true });
    if(!posts.some(p=> p.uid===currentUid)){
      // Stored in Turkish with the question texts, so the post still reads right if the bank changes.
      const answers = progress.answers.map(({ id, a })=> ({ id, q: QUESTION_BANK[id], a }));
      const postId = await createPost('daily_questions', { day, answers });
      if(!postId) throw new Error('post');
      dayAnswersCache.delete(day);
      notifyFeedActivity({ kind:'post', postId, everyoneMessage: `${myProfile.name} günün sorularını cevapladı.` });
    }
    progress.done = true;
    saveProgress(progress);
    document.getElementById('dailyQuestionsCard').hidden = true;
    renderTimelineTab();
  }catch(e){
    // The answers stay saved on this device and the card offers to try again.
    state.sharing = false;
    drawCard();
  }
  state.sharing = false;
}

export function initDailyQuestions(){
  document.addEventListener('click', (e)=>{
    const card = document.getElementById('dailyQuestionsCard');
    if(!card || !card.contains(e.target)) return;
    const top = card.querySelector('.dq-top');
    const btn = e.target.closest('[data-dq-answer]');
    if(btn && top) answer(btn.dataset.dqAnswer==='yes', top);
    else if(e.target.closest('[data-dq-undo]')) undo();
    else if(e.target.closest('[data-dq-retry]') && state && !state.sharing) share();
  });
}

/* ---- The shared post ---- */

export function dailyQuestionsPostBodyHtml(p){
  const rows = (p.answers || []).map(({ id, q, a })=> `<li>
      <span class="dq-a-q">${escapeHtml(q || QUESTION_BANK[id] || '')}</span>
      <span class="dq-a-chip ${a ? 'yes' : 'no'}">${a ? T().pick('Evet','Yes') : T().pick('Hayır','No')}</span>
      <span class="dq-a-stat" data-dq-day="${escapeHtml(p.day || '')}" data-dq-id="${Number(id)}"></span>
    </li>`).join('');
  return `<ul class="dq-answers">${rows}</ul>`;
}

// Fills in "how the club answered" under each answer of the daily-question posts in a container.
export async function fillDailyQuestionStats(container){
  const cells = [...container.querySelectorAll('.dq-a-stat[data-dq-day]')];
  const days = [...new Set(cells.map(c=> c.dataset.dqDay).filter(Boolean))];
  for(const day of days){
    const posts = await loadDayPosts(day);
    cells.filter(c=> c.dataset.dqDay===day).forEach(cell=>{
      const id = Number(cell.dataset.dqId);
      const votes = posts.map(p=> (p.answers || []).find(x=> x.id===id)).filter(Boolean);
      if(!votes.length){ cell.textContent = ''; return; }
      const yes = votes.filter(x=> x.a).length;
      const percent = Math.round(yes * 100 / votes.length);
      cell.innerHTML = `<span class="dq-a-bar" style="--dq-yes:${percent}%"></span>${T().pick(`Kulüpte ${votes.length} kişiden %${percent} evet`, `${percent}% of ${votes.length} members said yes`)}`;
    });
  }
}
