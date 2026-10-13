/* ============ OKUMA SERİSİ VE ROZETLER — ORTAK KURALLAR ============
   Hem uygulama (app.js) hem sunucu (functions/index.js, her gece 06:00'daki rozet kesinleştirmesi)
   bu dosyayı AYNEN kullanıyor. Veritabanına kendisi erişmez: gün kayıtlarını okuyan fonksiyonu
   çağıran taraf verir.

   - Seri: bugünden (bugün henüz işaretlenmediyse dünden) geriye, arka arkaya "okudum" gün sayısı.
   - Rozet: serinin ulaştığı en yüksek eşik (BADGE_DEFS). Seri bozulunca rozet kaybolur, o rozet
     üyenin rozet geçmişine (badgeCounts) bir kez sayılır. */

// label: kayıtlara (gönderi, bildirim) yazılan, herkesin gördüğü Türkçe ad. labelEn: sadece ekranda.
export const BADGE_DEFS = [
  {key:'b3',  days:3,  icon:'🔥', label:'3 gün aralıksız seri',             labelEn:'3-day reading streak',              color:'#CD7F32'},
  {key:'b5',  days:5,  icon:'⭐', label:'5 gün aralıksız seri',             labelEn:'5-day reading streak',              color:'#9E9E9E'},
  {key:'b7',  days:7,  icon:'🎯', label:'1 hafta aralıksız seri',           labelEn:'1-week reading streak',             color:'#FFC107'},
  {key:'b14', days:14, icon:'💎', label:'2 hafta aralıksız seri',           labelEn:'2-week reading streak',             color:'#29B6F6'},
  {key:'b21', days:21, icon:'🏆', label:'3 hafta aralıksız seri',           labelEn:'3-week reading streak',             color:'#AB47BC'},
  {key:'b30', days:30, icon:'🐺', label:'Kitap Kurdu (1 ay aralıksız seri)', labelEn:'Bookworm (1-month reading streak)', color:'#FF6F00'}
];

export function currentTierForStreak(streak){
  let tier = null;
  BADGE_DEFS.forEach(def=>{ if(streak>=def.days) tier = def.key; });
  return tier;
}

function addDaysToDateStr(dateStr, n){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}

// Seriyi sayar: startDateStr'den (YYYY-MM-DD) geriye, 31'er günlük paketlerle, okunmamış ilk güne
// kadar (üst sınır yok). readStatus(dateStr) o günün durumunu ('read' | 'skip' | null) döndürür ve
// okuma başarısız olursa HATA FIRLATMALI: başarısız okuma "okumadı" sayılırsa seri yanlışlıkla
// bozulmuş görünür. startMayBeUnmarked: başlangıç günü (bugün) henüz işaretlenmediyse dünden say.
export async function countStreak(startDateStr, readStatus, {startMayBeUnmarked=false}={}){
  const CHUNK = 31;
  let streak = 0;
  for(let offset=0;;offset+=CHUNK){
    const dates = Array.from({length:CHUNK},(_,i)=> addDaysToDateStr(startDateStr, -(offset+i)));
    const statuses = await Promise.all(dates.map(readStatus));
    for(let i=0;i<statuses.length;i++){
      if(startMayBeUnmarked && offset===0 && i===0 && statuses[0]!=='read') continue;
      if(statuses[i]!=='read') return streak;
      streak++;
    }
  }
}

// Kayıtlı durum (lastStreak, currentTier) ile yeni seri arasındaki değişim:
// - 'rise': yeni (daha yüksek) bir rozete ulaşıldı → rozet ver, bildir.
// - 'drop': seri bozuldu/kısaldı → completedTier (bozulmadan önceki rozet, varsa) geçmişe sayılır.
//   Uygulama düşüşleri yok sayar; kesinleştirme sunucuda, gün kapandıktan sonra yapılır.
// - 'none': kayda değer bir değişiklik yok.
export function badgeTransition(streak, lastStreak, prevTier){
  const newTier = currentTierForStreak(streak);
  if(streak===lastStreak && prevTier===newTier) return {kind:'none', newTier};
  if(streak<lastStreak) return {kind:'drop', newTier, completedTier: prevTier||null};
  if(newTier && newTier!==prevTier) return {kind:'rise', newTier};
  return {kind:'none', newTier};
}

// Bir üyenin tüm geçmişini (eskiden yeniye gün durumları) baştan oynatıp rozet geçmişini hesaplar.
// Sadece bozulmuş (tamamlanmış) serilerin rozetleri sayılır; sona kalan seri hâlâ devam ediyor.
export function replayBadgeHistory(statusesOldestFirst){
  const badgeCounts = {};
  let streak = 0, tier = null;
  for(const status of statusesOldestFirst){
    if(status==='read') streak++;
    else {
      if(tier) badgeCounts[tier] = (badgeCounts[tier]||0) + 1;
      streak = 0; tier = null;
    }
    tier = currentTierForStreak(streak);
  }
  return {badgeCounts, streak, tier};
}
