/* ============ ADMIN: KİTAP KURTLARI ============ */

// app.js ile karşılıklı import: buradaki kod bu adları sadece fonksiyonların içinde (uygulama
// açıldıktan sonra) kullanıyor, dosya yüklenirken değil; bu yüzden güvenli.
import {
  BADGE_DEFS, activeUids, avatarHtmlFromProfile, badgeIllustration, checkAndAwardBadges, computeStreak,
  currentUid, escapeHtml, keepOrLoading, markLoaded, shadeHexColor, userChipHtml, usersCache
} from "./app.js";

// Rozet Geçmişi: her üye tek satır, 6 rozet de her zaman yan yana madalyon şeklinde duruyor.
// Kazanılmamışlar kesikli çizgili soluk "hayalet" madalyon. Sayı, madalyonun köşesindeki metalik
// (gümüş gradyan + kabartma efektli) yuvarlak rozette duruyor.
// Sıralama SADECE bu listeye özgü: her rozet, o rozeti kazanmak için gereken gün sayısı (def.days)
// kadar puan eder; kişinin puanı = Σ (o rozetten kazandığı adet × o rozetin gün değeri). Bu, "Kitap
// Kurtları" listesindeki güncel seri sıralamasından tamamen bağımsız — orijinal diziyi bozmamak
// için önce bir kopyası alınıp öyle sıralanıyor.
// Rozet süre etiketini kısa/okunur biçime çevirir: 3→"3 gün", 7→"1 hafta", 14→"2 hafta", 30→"1 ay".
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
      // Tıklanınca (sadece kazanılmış rozetlerde) hafif bir sallanma animasyonu ve sağ üstte,
      // köşedeki sayaçla aynı metalik gradyan/font'ta ama hap (pill) şeklinde bir bilgi kutusu
      // açılıyor; içinde o rozet için gereken seri gün sayısı yazıyor.
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
// Rozet madalyonuna tıklayınca sallanma animasyonu oynatır ve o madalyonun bilgi kutusunu açar/
// kapatır; başka bir madalyon açılınca öncekini kapatır. Konteynere bir kez bağlanır (yeniden
// render'da tekrar tekrar dinleyici eklenmesin diye).
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
  // Eskiden "Kitap Kurtları" tek bir kartın içinde hem senin güncel serini hem kulübün tüm
  // serilerini üst üste gösteriyordu — artık kart-içi sekmelerde ayrı ayrı gösterildiği için
  // (bkz. tab-worms/tab-mworms) bu iki parça ayrı konteynerlere yazılıyor.
  const myBox = keepOrLoading(myStreakContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…"));
  const clubBox = keepOrLoading(clubStreaksContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…"));
  const historyBox = historyContainerId ? keepOrLoading(historyContainerId, window.BH_I18N.pick("Hesaplanıyor…","Calculating…")) : null;
  // Sekme açıldığında önce önbellekteki (eski) HTML anında gösteriliyor, gerçek veri henüz
  // gelmeden — tıklama dinleyicisi de bu yüzden en başta bağlanıyor, yoksa sayfa ilk açıldığında
  // önbellek gösterilirken tıklamalar hiçbir şey yapmıyordu (asıl render bitene kadar).
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
  // Bir üyenin serisi hesaplanamazsa onu 0 gündür sanıp herkesi bu şekilde çizip önbelleğe
  // yazarsak, geçici bir hata gerçek serileri bir süreliğine kalıcı olarak silerdi — bu durumda
  // ekranı olduğu gibi bırakıyoruz.
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

/* ============ ÜYE: KİTAP KURTLARI ============ */
export async function renderMemberWorms(){ await renderWormsShared('mWormsMyStreak','mWormsClubStreaks','mWormsHistory'); }

export function initWorms(){
  document.getElementById('calcStreaksBtn').addEventListener('click', renderAdminWorms);
  document.addEventListener('click', (e)=>{
    if(e.target.closest('.badge-shelf-coin')) return;
    document.querySelectorAll('.badge-shelf-info.show').forEach(p=> p.classList.remove('show'));
  });
}
