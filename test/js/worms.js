/* Bookworms screen: the club's current reading streaks and each member's badge history
   shelf. The member and admin screens show the same data in different containers. */

// Circular import: app.js imports this module too. These names are only used inside
// functions (after startup), never while the module is being evaluated, so the cycle is safe.
import {
  BADGE_DEFS, activeUids, avatarHtmlFromProfile, badgeIllustration, checkAndAwardBadges, computeStreak,
  currentUid, escapeHtml, keepOrLoading, markLoaded, shadeHexColor, userChipHtml, usersCache
} from "./app.js";

// Badge history shelf: one row per member with all badges side by side; badges not
// earned yet are drawn as faded placeholders, and a corner counter shows how many times
// a badge was earned. Rows are ranked by score = sum over badges of
// (times earned x the badge's day threshold), independent of the current-streak ranking.
//
// Short label for a badge's day threshold: 3 -> "3 days", 7 -> "1 week", 30 -> "1 month".
function formatStreakDuration(days){
  if(days % 7 === 0) return (days/7) + window.BH_I18N.pick(" hafta"," weeks");
  if(days % 30 === 0) return (days/30) + ' ay';
  return days + window.BH_I18N.pick(" gün"," days");
}
function renderBadgeHistoryShelf(rows){
  const sorted = rows.slice().map(r=>{
    const u = usersCache[r.uid] || {};
    const bc = u.badgeCounts || {};
    const liveTier = u.currentTier;
    const score = BADGE_DEFS.reduce((sum,def)=>{
      const count = (bc[def.key]||0) + (liveTier===def.key ? 1 : 0);
      return sum + count*def.days;
    }, 0);
    return {...r, score};
  }).sort((a,b)=> b.score-a.score);
  return `<div class="badge-shelf-list">${sorted.map(r=>{
    const u = usersCache[r.uid] || {};
    const bc = u.badgeCounts || {};
    const liveTier = u.currentTier;
    const items = BADGE_DEFS.map(def=>{
      const count = (bc[def.key]||0) + (liveTier===def.key ? 1 : 0);
      const earned = count>0;
      const countBadge = count>1
        ? `<span class="badge-shelf-count" style="background:linear-gradient(145deg, ${shadeHexColor(def.color,-0.28)} 0%, ${shadeHexColor(def.color,-0.62)} 100%);"><span class="badge-shelf-count-num">${count}</span></span>`
        : '';
      // Earned badges get a popover with the streak length they require (opened on click).
      const infoPop = earned
        ? `<div class="badge-shelf-info" style="background:linear-gradient(145deg, ${shadeHexColor(def.color,-0.28)} 0%, ${shadeHexColor(def.color,-0.62)} 100%);"><span class="badge-shelf-info-text">${escapeHtml(formatStreakDuration(def.days))}</span></div>`
        : '';
      const coinHtml = earned
        ? `<div class="badge-shelf-coin" title="${escapeHtml(def.label)} — ${count} kere" style="background:${def.color};"><span>${badgeIllustration(def.key)}</span>${countBadge}${infoPop}</div>`
        : `<div class="badge-shelf-coin ghost" title="${escapeHtml(def.label)} — henüz kazanılmadı"><span>${badgeIllustration(def.key)}</span></div>`;
      return `<div class="badge-shelf-item">${coinHtml}</div>`;
    }).join('');
    return `<div class="badge-shelf-row">
      <div class="badge-shelf-name">${userChipHtml(r.uid,26)}</div>
      <div class="badge-shelf-icons">${items}</div>
    </div>`;
  }).join('')}</div>`;
}
// Clicking a badge plays a short wiggle and toggles its popover, closing any other open
// one. Bound once per container so re-renders don't stack listeners.
function bindBadgeShelfClicks(container){
  if(!container || container.dataset.shelfClicksBound) return;
  container.dataset.shelfClicksBound = '1';
  container.addEventListener('click', (e)=>{
    const coin = e.target.closest('.badge-shelf-coin');
    if(!coin || coin.classList.contains('ghost') || !container.contains(coin)) return;
    const info = coin.querySelector('.badge-shelf-info');
    if(!info) return;
    const wasOpen = info.classList.contains('show');
    container.querySelectorAll('.badge-shelf-info.show').forEach(p=> p.classList.remove('show'));
    if(!wasOpen){
      info.classList.add('show');
      coin.classList.remove('wobble');
      void coin.offsetWidth;
      coin.classList.add('wobble');
      setTimeout(()=> coin.classList.remove('wobble'), 420);
    }
  });
}
async function renderWormsShared(myStreakContainerId, clubStreaksContainerId, historyContainerId){
  const myBox = keepOrLoading(myStreakContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…"));
  const clubBox = keepOrLoading(clubStreaksContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…"));
  const historyBox = historyContainerId ? keepOrLoading(historyContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…")) : null;
  // Bind clicks before loading: cached HTML is shown immediately and should already respond.
  if(historyBox) bindBadgeShelfClicks(historyBox);
  const uids = activeUids();
  let failed = false;
  const results = await Promise.all(uids.map(async uid=>{
    try{
      const streak = await computeStreak(uid);
      await checkAndAwardBadges(uid, streak);
      return {uid, streak};
    }catch(e){ failed = true; return {uid, streak:0}; }
  }));
  // If any streak can't be read, keep what is on screen. Rendering it as 0 days would also
  // write the wrong values to the persistent cache.
  if(failed) return;
  results.sort((a,b)=>b.streak-a.streak);

  if(results.length===0){
    myBox.innerHTML = window.BH_I18N.template`<div class="empty-state">Henüz üye yok.</div>`;
    clubBox.innerHTML = window.BH_I18N.template`<div class="empty-state">Henüz üye yok.</div>`;
  } else {
    const own = results.find(r=>r.uid===currentUid);
    const streak = own ? own.streak : 0;
    myBox.innerHTML = window.BH_I18N.template`<div class="material-streak-hero"><div class="material-medal">${streak}</div><h2>${streak} gündür aralıksız</h2><p class="muted">Her gün birkaç sayfa, yeni bir alışkanlık.</p><div class="milestones">${BADGE_DEFS.map(d=>window.BH_I18N.template`<div class="milestone ${streak>=d.days?'earned':''}"><span>${badgeIllustration(d.key)}</span><small>${d.days} gün</small></div>`).join('')}</div></div>`;
    clubBox.innerHTML = `<div class="streak-grid">${results.map(r=>{
      const u = usersCache[r.uid] || {};
      return window.BH_I18N.template`<div class="streak-card ${r.uid===currentUid?'mine':''}">${avatarHtmlFromProfile(u,52)}<b>${escapeHtml(u.name||'?')}</b><span class="streak-card-days">${r.streak} gün</span></div>`;
    }).join('')}</div>`;
  }
  markLoaded(myBox);
  markLoaded(clubBox);

  if(historyBox){
    const rows = results;
    if(rows.length===0){
      historyBox.innerHTML = window.BH_I18N.template`<p class="muted">Henüz üye yok.</p>`;
    } else {
      historyBox.innerHTML = renderBadgeHistoryShelf(rows);
    }
    markLoaded(historyBox);
  }

}

export async function renderAdminWorms(){ await renderWormsShared('wormsMyStreak','wormsClubStreaks','wormsHistory'); }

/* Member screen */
export async function renderMemberWorms(){ await renderWormsShared('mWormsMyStreak','mWormsClubStreaks','mWormsHistory'); }

export function initWorms(){
  document.getElementById('calcStreaksBtn').addEventListener('click', renderAdminWorms);
  document.addEventListener('click', (e)=>{
    if(e.target.closest('.badge-shelf-coin')) return;
    document.querySelectorAll('.badge-shelf-info.show').forEach(p=> p.classList.remove('show'));
  });
}
