/*
 * @mentions in feed posts and comments: member suggestions while typing "@", extracting the
 * mentioned members from a text, and highlighting them when the text is shown.
 *
 * A member is written as "@Name", or "@Name Surname" when another member has the same first name.
 * "@herkes" ("everyone") mentions the whole club; only admins can use it (see canMentionAll).
 * Any text field with a data-mentions attribute gets the suggestion list.
 */

/*
 * This module and app.js import each other. Shared values are only read inside functions after startup,
 * not while the modules are loading.
 */
import { escapeHtml, myProfile, usersCache } from "./app.js";

export const MENTION_ALL = 'herkes';

const lower = (s)=> String(s||'').toLocaleLowerCase('tr');
const LETTER = /[\p{L}\p{N}_]/u;

function activeMemberUids(){
  return Object.keys(usersCache).filter(uid=>!usersCache[uid].banned && !usersCache[uid].deleted);
}

export function canMentionAll(){ return !!myProfile && myProfile.role==='admin'; }

// The text written after "@" for a member.
export function mentionLabel(uid){
  const u = usersCache[uid] || {};
  const name = String(u.name||'').trim();
  if(!name) return '';
  const sameName = activeMemberUids().filter(o=>o!==uid && lower(usersCache[o].name).trim()===lower(name));
  const surname = String(u.surname||'').trim();
  return sameName.length && surname ? `${name} ${surname}` : name;
}

function mentionLabels(){
  return activeMemberUids().map(uid=>({uid, label:mentionLabel(uid)})).filter(x=>x.label)
    .sort((a,b)=>b.label.length-a.label.length);
}

// Returns {mentions: [uid, ...], mentionAll} for the "@..." references in the given texts.
// mentionAll is only set for admins, so "@herkes" written by a member stays plain text.
export function extractMentions(...texts){
  const text = texts.filter(Boolean).join('\n');
  const found = new Set();
  let all = false;
  const labels = mentionLabels();
  for(let i=text.indexOf('@'); i>=0; i=text.indexOf('@', i+1)){
    if(i>0 && LETTER.test(text[i-1])) continue; // part of a word or an e-mail address
    const rest = lower(text.slice(i+1));
    const ends = (n)=> n===rest.length || !LETTER.test(rest[n]);
    if(rest.startsWith(MENTION_ALL) && ends(MENTION_ALL.length)){ all = true; continue; }
    const hit = labels.find(({label})=> rest.startsWith(lower(label)) && ends(label.length));
    if(hit) found.add(hit.uid);
  }
  return { mentions:[...found], mentionAll: all && canMentionAll() };
}

// Wraps the mentions in already escaped HTML text in a highlight span.
export function highlightMentions(html, mentions, mentionAll){
  const labels = (mentions||[]).map(mentionLabel).filter(Boolean).map(escapeHtml);
  if(mentionAll) labels.push(MENTION_ALL);
  if(!labels.length) return html;
  labels.sort((a,b)=>b.length-a.length);
  const pattern = new RegExp('(^|[^\\p{L}\\p{N}_])@(' + labels.map(l=>l.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
  return html.replace(pattern, (m, before, label)=> `${before}<span class="mention">@${label}</span>`);
}

/* ---- Suggestions while typing ---- */

let box = null, activeInput = null, items = [], selected = 0, tokenStart = -1;

function closeSuggestions(){
  if(box){ box.hidden = true; box.innerHTML = ''; }
  items = []; activeInput = null; tokenStart = -1;
}

function currentToken(input){
  const pos = input.selectionStart;
  if(pos==null || pos!==input.selectionEnd) return null;
  const before = input.value.slice(0, pos);
  const m = before.match(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_]*)$/u);
  return m ? { start: pos - m[2].length - 1, query: m[2] } : null;
}

function suggestionsFor(query){
  const q = lower(query);
  const list = activeMemberUids().map(uid=>{
    const u = usersCache[uid];
    return { uid, label: mentionLabel(uid), full: `${u.name||''} ${u.surname||''}`.trim() };
  }).filter(x=> x.label && (lower(x.label).startsWith(q) || lower(x.full).split(/\s+/).some(w=>w.startsWith(q))))
    .sort((a,b)=> a.label.localeCompare(b.label,'tr')).slice(0,6);
  if(canMentionAll() && MENTION_ALL.startsWith(q)) list.unshift({ uid:null, label:MENTION_ALL, full: window.BH_I18N.pick('Herkese bildirim gider','Notifies everyone') });
  return list;
}

function render(){
  box.innerHTML = items.map((it,i)=>`<button type="button" class="mention-option${i===selected?' active':''}" data-i="${i}"><b>@${escapeHtml(it.label)}</b>${it.full && it.full!==it.label ? `<span>${escapeHtml(it.full)}</span>` : ''}</button>`).join('');
}

function place(input){
  // A modal <dialog> is drawn above everything else, so the list has to live inside it.
  const host = input.closest('dialog') || document.body;
  if(box.parentElement!==host) host.appendChild(box);
  const r = input.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + 'px';
  box.style.width = Math.min(260, window.innerWidth - 16) + 'px';
  if(below < 220 && r.top > below){ box.style.top = ''; box.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
  else { box.style.bottom = ''; box.style.top = (r.bottom + 4) + 'px'; }
}

function update(input){
  const token = currentToken(input);
  if(!token){ closeSuggestions(); return; }
  const list = suggestionsFor(token.query);
  if(!list.length){ closeSuggestions(); return; }
  if(!box){
    box = document.createElement('div');
    box.className = 'mention-suggest';
    box.setAttribute('role','listbox');
    // Keep focus in the text field while picking a suggestion.
    box.addEventListener('pointerdown', e=> e.preventDefault());
    box.addEventListener('click', e=>{
      const btn = e.target.closest('.mention-option');
      if(btn) pick(Number(btn.dataset.i));
    });
  }
  activeInput = input; items = list; tokenStart = token.start;
  if(selected >= items.length) selected = 0;
  render(); place(input); box.hidden = false;
}

function pick(i){
  const it = items[i], input = activeInput;
  if(!it || !input) return;
  const end = input.selectionStart;
  const insert = '@' + it.label + ' ';
  input.value = input.value.slice(0, tokenStart) + insert + input.value.slice(end);
  const caret = tokenStart + insert.length;
  input.setSelectionRange(caret, caret);
  closeSuggestions();
  input.dispatchEvent(new Event('input', { bubbles:true }));
  input.focus();
}

export function initMentions(){
  document.addEventListener('input', e=>{
    const input = e.target;
    if(!input.matches || !input.matches('[data-mentions]')) return;
    selected = 0;
    update(input);
  });
  // Capture phase, so Enter picks a suggestion instead of sending the comment.
  document.addEventListener('keydown', e=>{
    if(!items.length || e.target!==activeInput) return;
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      selected = (selected + (e.key==='ArrowDown' ? 1 : items.length-1)) % items.length;
      render();
    } else if(e.key==='Enter' || e.key==='Tab'){
      pick(selected);
    } else if(e.key==='Escape'){
      closeSuggestions();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('focusout', e=>{ if(e.target===activeInput) setTimeout(()=>{ if(document.activeElement!==activeInput) closeSuggestions(); }, 150); });
  window.addEventListener('resize', ()=>{ if(activeInput) place(activeInput); });
}
