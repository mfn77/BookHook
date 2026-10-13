/* ============ HAFTALIK HEDİYE KURASI — ORTAK KURALLAR ============
   Bu dosya hem uygulamada (app.js, tarayıcıda) hem sunucuda (functions/index.js, pazartesi
   otomatik kurası) AYNEN kullanılıyor; kuralı değiştirmek için sadece burayı değiştir.
   Veritabanına erişmez, ekrana yazı üretmez: sadece verilen verilerle hesap yapar.

   Bir üyenin haftalık durumu (stat): {uid, name, miss, read, marked, joinDate, joinedAt}
   - miss: okumadığı gün, read: okuduğu gün, marked: miss+read (0 ise kuraya girmez)
   - joinDate: üyelik günü (YYYY-MM-DD), joinedAt: tam kayıt anı (ISO), sıra eşitliğini bozar

   Kural:
   - 2+ gün okumayan cezalıdır, hediye verir.
   - Alıcılar önce tam okuyanlardan (0 gün kaçıran), onlar tükenince paslılardan (1 gün) seçilir.
   - Her grubun içinde önce HİÇ kazanmamışlar alır, ağırlığa girmeden, en uzun süredir üye olan
     önce. Onlar tükenince daha önce kazanmışlar arasında ağırlıklı kura çekilir.
   - Cezalı sayısı alıcı havuzundan fazlaysa havuz aynı kurallarla yeniden doldurulur. */

export const LOTTERY_ALGO = 'hic-kazanmayan-oncelikli-v2';

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

// Ağırlıklı havuzdan birini seçip havuzdan çıkarır. Ağırlığı düşük olan da havuzda tek kaldığında
// yine seçilir; yani "başka biri yoksa mecbur çıkar".
function weightedPickWithoutReplacement(pool){
  const totalWeight = pool.reduce((sum,r)=>sum+r.weight,0);
  let rnd = Math.random()*totalWeight;
  for(let i=0;i<pool.length;i++){
    rnd -= pool[i].weight;
    if(rnd<=1e-9) return pool.splice(i,1)[0];
  }
  return pool.splice(pool.length-1,1)[0]; // yuvarlama hatasına karşı güvenlik ağı
}

// Daha önce kazanmış birinin alıcı olma ağırlığı. Şansı, (kazandığı / dağıtılan toplam hediye)
// oranının 2 katı kadar düşer (4/12 = %33 → %66 düşüş); geçen hafta da kazandıysa ayrıca %80 düşer.
// Hiç kazanmamışlar buraya hiç gelmez, kuyruktan çıkarlar (bkz. buildTierPools).
export function computeReceiverWeight(uid, winCounts, totalGiftsGivenSoFar, previousWinners){
  const myWins = (winCounts && winCounts[uid]) || 0;
  const share = totalGiftsGivenSoFar>0 ? myWins/totalGiftsGivenSoFar : 0;
  const reduction = Math.round(share*100*2)/100;
  let weight = 1 - reduction;
  if(previousWinners && previousWinners.has(uid)) weight -= 0.80;
  return Math.max(weight, 0.05); // sıfıra/negatife düşmesin diye güvenlik tabanı
}

// Hiç kazanmamışların sırası: önce üyelik günü, aynı gün katılanlarda tam kayıt anı.
export function lotteryJoinKey(s){ return (s.joinDate||'9999-99-99')+'|'+(s.joinedAt||''); }

function buildTierPools(base, previousWinners, winCounts, totalGiftsGivenSoFar){
  const neverWon = base.filter(s=>!((winCounts||{})[s.uid]));
  const everWon = base.filter(s=>(winCounts||{})[s.uid]);
  neverWon.sort((a,b)=> lotteryJoinKey(a).localeCompare(lotteryJoinKey(b)));
  const everWonPool = everWon.map(s=>({...s, weight: computeReceiverWeight(s.uid, winCounts, totalGiftsGivenSoFar, previousWinners)}));
  return { neverWonQueue: neverWon, everWonPool };
}
function pickFromTierPools(tier){
  if(tier.neverWonQueue.length>0) return tier.neverWonQueue.shift();
  if(tier.everWonPool.length>0) return weightedPickWithoutReplacement(tier.everWonPool);
  return null;
}
function tierPoolsEmpty(tier){ return tier.neverWonQueue.length===0 && tier.everWonPool.length===0; }

// Kurayı çeker. previousWinners: geçen haftanın alıcıları (Set); winCounts/totalGiftsGivenSoFar:
// geçmiş kuralardan kimin kaç kez kazandığı ve toplam hediye sayısı (bkz. drawHistory).
export function runLottery(statsArr, previousWinners, winCounts, totalGiftsGivenSoFar){
  const eligible = statsArr.filter(s=>s.marked>0);
  const givers = shuffle(eligible.filter(s=>s.miss>=2));
  const tier1Base = shuffle(eligible.filter(s=>s.miss===0));
  const tier2Base = shuffle(eligible.filter(s=>s.miss===1));
  const safeCount = tier1Base.length + tier2Base.length;
  let tier1 = buildTierPools(tier1Base, previousWinners, winCounts, totalGiftsGivenSoFar);
  let tier2 = buildTierPools(tier2Base, previousWinners, winCounts, totalGiftsGivenSoFar);
  const pairs = [];
  givers.forEach((g)=>{
    if(safeCount===0){
      pairs.push({giverUid:g.uid||null, giverName:g.name, receiverUid:null, receiverName:null});
      return;
    }
    if(tierPoolsEmpty(tier1) && tierPoolsEmpty(tier2)){
      tier1 = buildTierPools(tier1Base, previousWinners, winCounts, totalGiftsGivenSoFar);
      tier2 = buildTierPools(tier2Base, previousWinners, winCounts, totalGiftsGivenSoFar);
    }
    const r = !tierPoolsEmpty(tier1) ? pickFromTierPools(tier1) : pickFromTierPools(tier2);
    pairs.push({giverUid:g.uid||null, giverName:g.name, receiverUid:r.uid||null, receiverName:r.name});
  });
  return { giverCount: givers.length, safeCount, pairs };
}

// Geçmiş kuralardan "kim kaç kez kazandı" ve "geçen hafta kim kazandı".
// draws: [{id (haftanın pazartesisi), pairs}]. excludeWeekId: yeniden çekilen haftanın kendi eski
// sonucu sayılmasın diye hariç tutulur. prevWeekId: bir önceki haftanın id'si.
export function drawHistory(draws, excludeWeekId, prevWeekId){
  const winCounts = {}, previousWinners = new Set();
  let totalGiftsGivenSoFar = 0;
  for(const d of draws){
    if(d.id===excludeWeekId) continue;
    for(const p of d.pairs||[]){
      if(!p.receiverUid) continue;
      winCounts[p.receiverUid] = (winCounts[p.receiverUid]||0) + 1;
      totalGiftsGivenSoFar++;
      if(d.id===prevWeekId) previousWinners.add(p.receiverUid);
    }
  }
  return { winCounts, totalGiftsGivenSoFar, previousWinners };
}

/* ---- Kura açıklaması ("Neden?") için kural kontrolü ---- */
// 0: tam okuyan + hiç kazanmamış, 1: tam okuyan + kazanmış, 2: paslı + hiç kazanmamış,
// 3: paslı + kazanmış, null: alıcı adayı değil (cezalı ya da o hafta kaydı yok).
export function lotteryRank(s, wins){
  if(!s || !(s.marked>0) || s.miss>=2) return null;
  return (s.miss===1?2:0) + (wins>0?1:0);
}
// Bir kura sonucunu kurallara göre değerlendirir. Ekran metni üretmez; hiç kazanmamış ama
// seçilmemiş herkes için bir sebep kodu döner:
// 'no-records' | 'cezali' | 'should-have' | 'pasli' | 'not-enough'
export function checkDrawRules(draw, stats, winCounts){
  const byUid = new Map(stats.map(s=>[s.uid,s]));
  const receivers = new Set((draw.pairs||[]).map(p=>p.receiverUid).filter(Boolean));
  const rankOf = uid=> lotteryRank(byUid.get(uid), winCounts[uid]||0);
  const eligible = stats.filter(s=> rankOf(s.uid)!==null);
  const violations = [];
  // Herkes en az bir kez aldıysa (cezalı sayısı havuzdan büyükse) sıra ihlali olamaz.
  if(receivers.size < eligible.length){
    for(const x of eligible){
      if(receivers.has(x.uid)) continue;
      const rx = rankOf(x.uid);
      for(const yUid of receivers){
        const y = byUid.get(yUid), ry = rankOf(yUid);
        if(ry===null) continue;
        const outranked = ry>rx || (ry===rx && rx%2===0 && lotteryJoinKey(y) > lotteryJoinKey(x));
        if(outranked) violations.push({shouldHave:x.uid, gotInstead:yUid});
      }
    }
  }
  const receiverInfo = [...receivers].map(uid=>({uid, stat:byUid.get(uid), wins:winCounts[uid]||0}));
  const skippedNeverWon = stats.filter(s=> !(winCounts[s.uid]>0) && !receivers.has(s.uid)).map(s=>{
    const reason = !(s.marked>0) ? 'no-records'
      : s.miss>=2 ? 'cezali'
      : violations.some(v=>v.shouldHave===s.uid) ? 'should-have'
      : s.miss===1 ? 'pasli'
      : 'not-enough';
    return {uid:s.uid, reason, miss:s.miss};
  });
  return {receiverInfo, skippedNeverWon, violations};
}
