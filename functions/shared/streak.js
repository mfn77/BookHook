/* ============ OKUMA SERİSİ VE ROZETLER — ORTAK KURALLAR ============
   Hem uygulama (app.js) hem sunucu (functions/index.js, her gece 06:00'daki rozet kesinleştirmesi)
   bu dosyayı AYNEN kullanıyor. Veritabanına kendisi erişmez: gün kayıtlarını okuyan fonksiyonu
   çağıran taraf verir.

   - Seri: bugünden (bugün henüz işaretlenmediyse dünden) geriye, arka arkaya "okudum" gün sayısı.
   - Rozet: serinin ulaştığı en yüksek eşik (BADGE_DEFS). Seri bozulunca rozet kaybolur, o rozet
     üyenin rozet geçmişine (badgeCounts) bir kez sayılır.
   - 30 günlük rozet (repeats: true) seri bozulmadan devam ettikçe her 30 günde bir yeniden
     kazanılır: 60. günde ikincisi, 90. günde üçüncüsü... Her yeni 30 gün dolunca bir önceki
     geçmişe sayılır (bankedRepeats bu seride kaç tane sayıldığını tutar). Böylece seriyi hiç
     bozmayan, bozup yeniden başlayandan daha az rozet toplamaz: biten bir serinin 30 günlük
     rozet sayısı = seri / 30 (aşağı yuvarlanmış). */

// label: kayıtlara (gönderi, bildirim) yazılan, herkesin gördüğü Türkçe ad. labelEn: sadece ekranda.
export const BADGE_DEFS = [
  {key:'b3',  days:3,  icon:'🔥', label:'3 gün aralıksız seri',             labelEn:'3-day reading streak',              color:'#CD7F32'},
  {key:'b5',  days:5,  icon:'⭐', label:'5 gün aralıksız seri',             labelEn:'5-day reading streak',              color:'#9E9E9E'},
  {key:'b7',  days:7,  icon:'🎯', label:'1 hafta aralıksız seri',           labelEn:'1-week reading streak',             color:'#FFC107'},
  {key:'b14', days:14, icon:'💎', label:'2 hafta aralıksız seri',           labelEn:'2-week reading streak',             color:'#29B6F6'},
  {key:'b21', days:21, icon:'🏆', label:'3 hafta aralıksız seri',           labelEn:'3-week reading streak',             color:'#AB47BC'},
  {key:'b30', days:30, icon:'🐺', label:'Kitap Kurdu (1 ay aralıksız seri)', labelEn:'Bookworm (1-month reading streak)', color:'#FF6F00', repeats:true}
];

export function currentTierForStreak(streak){
  let tier = null;
  BADGE_DEFS.forEach(def=>{ if(streak>=def.days) tier = def.key; });
  return tier;
}

// Bu seride, aktif rozete ek olarak geçmişe sayılmış olması gereken tekrar rozeti sayısı.
// 30 günlük rozette: 59 gün → 0, 60 → 1, 90 → 2. Diğer rozetlerde her zaman 0.
export function repeatsDue(streak){
  const def = BADGE_DEFS.find(d=>d.key===currentTierForStreak(streak));
  return def && def.repeats ? Math.floor(streak/def.days) - 1 : 0;
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

// Kayıtlı durum (lastStreak, currentTier, bankedRepeats) ile yeni seri arasındaki değişim:
// - 'rise': yeni (daha yüksek) bir rozete ulaşıldı → rozet ver, bildir.
// - 'repeat': 30 günlük rozet seri bozulmadan yeniden kazanıldı (60, 90, ... gün) → bank kadar
//   rozet geçmişe sayılır, bildirilir. 'rise' ile birlikte de gelebilir (bank > 0).
// - 'drop': seri bozuldu/kısaldı → completedTier (bozulmadan önceki rozet, varsa) geçmişe sayılır.
//   Uygulama düşüşleri yok sayar; kesinleştirme sunucuda, gün kapandıktan sonra yapılır.
// - 'none': kayda değer bir değişiklik yok.
// bank: geçmişe şimdi eklenecek tekrar rozeti sayısı; repeats: kayda yazılacak yeni bankedRepeats.
export function badgeTransition(streak, lastStreak, prevTier, bankedRepeats=0){
  const newTier = currentTierForStreak(streak);
  if(streak<lastStreak) return {kind:'drop', newTier, completedTier: prevTier||null, bank:0, repeats:0};
  const repeats = Math.max(repeatsDue(streak), bankedRepeats||0);
  const bank = repeats - (bankedRepeats||0);
  if(newTier && newTier!==prevTier) return {kind:'rise', newTier, bank, repeats};
  if(bank>0) return {kind:'repeat', newTier, bank, repeats};
  return {kind:'none', newTier, bank:0, repeats};
}

// Bir üyenin tüm geçmişini (eskiden yeniye gün durumları) baştan oynatıp rozet geçmişini hesaplar.
// Bozulmuş (tamamlanmış) serilerin rozetleri ve devam eden serideki tekrar rozetleri (60, 90, ...
// günde dolan 30 günlükler) sayılır; sona kalan serinin aktif rozeti hâlâ devam ediyor.
export function replayBadgeHistory(statusesOldestFirst){
  const badgeCounts = {};
  let streak = 0, tier = null, bankedRepeats = 0;
  for(const status of statusesOldestFirst){
    if(status==='read') streak++;
    else {
      if(tier) badgeCounts[tier] = (badgeCounts[tier]||0) + 1;
      streak = 0; tier = null; bankedRepeats = 0;
    }
    tier = currentTierForStreak(streak);
    const due = repeatsDue(streak);
    if(due>bankedRepeats){ badgeCounts[tier] = (badgeCounts[tier]||0) + (due-bankedRepeats); bankedRepeats = due; }
  }
  return {badgeCounts, streak, tier, bankedRepeats};
}
