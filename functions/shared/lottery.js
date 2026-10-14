/*
 * Weekly gift-draw rules shared by the app and server. This module does not access the database.
 *
 * Members missing two or more days give a book. Receivers who read every day come first, then members
 * with one missed day. Within each group, members who have never won are ordered by join date; previous
 * winners enter a weighted draw. Refill the receiver pools if gifts outnumber recipients.
 *
 * The input contains member IDs, reading totals, and join dates. miss is days missed, read is days
 * read, and marked is the number of recorded days; zero excludes a member from the draw. joinedAt
 * breaks ties between members who joined on the same day.
 */

export const LOTTERY_ALGO = 'hic-kazanmayan-oncelikli-v2';

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

/*
 * Picks one entry by weight and removes it from the pool. An entry with a low weight is still picked
 * when it's the only one left.
 */
function weightedPickWithoutReplacement(pool){
  const totalWeight = pool.reduce((sum,r)=>sum+r.weight,0);
  let rnd = Math.random()*totalWeight;
  for(let i=0;i<pool.length;i++){
    rnd -= pool[i].weight;
    if(rnd<=1e-9) return pool.splice(i,1)[0];
  }
  return pool.splice(pool.length-1,1)[0]; // fallback for floating-point rounding
}

/*
 * Receiving weight of a member who has won before. It drops by twice their share of all gifts given so
 * far (4 of 12 = 33% -> 66% lower), and by another 0.8 if they also won last week. Members who never
 * won don't use weights; they are queued (see buildTierPools).
 */
export function computeReceiverWeight(uid, winCounts, totalGiftsGivenSoFar, previousWinners){
  const myWins = (winCounts && winCounts[uid]) || 0;
  const share = totalGiftsGivenSoFar>0 ? myWins/totalGiftsGivenSoFar : 0;
  const reduction = Math.round(share*100*2)/100;
  let weight = 1 - reduction;
  if(previousWinners && previousWinners.has(uid)) weight -= 0.80;
  return Math.max(weight, 0.05); // lower bound so the weight never reaches zero or below
}

// Queue order for members who never won: join day first, then exact sign-up time.
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

/*
 * Runs the draw. previousWinners: last week's receivers (Set); winCounts and totalGiftsGivenSoFar: wins
 * per member and total gifts in earlier draws (see drawHistory).
 */
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

/*
 * Win history from earlier draws: how many times each member won, and who won last week. draws: [{id
 * (the week's Monday), pairs}]. excludeWeekId: skipped so a week that is drawn again doesn't count its
 * own previous result. prevWeekId: the previous week's id.
 */
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

/*
 * Rule check for the draw explanation ("Why?") 0: read every day + never won, 1: read every day + won
 * before, 2: one miss + never won, 3: one miss + won before, null: not a receiver candidate (giver, or
 * no records that week).
 */
export function lotteryRank(s, wins){
  if(!s || !(s.marked>0) || s.miss>=2) return null;
  return (s.miss===1?2:0) + (wins>0?1:0);
}
/*
 * Checks a draw result against the rules. Returns no UI text; for every member who never won and wasn't
 * picked it returns a reason code: 'no-records' | 'cezali' (giver) | 'should-have' | 'pasli' (one miss)
 * | 'not-enough'
 */
export function checkDrawRules(draw, stats, winCounts){
  const byUid = new Map(stats.map(s=>[s.uid,s]));
  const receivers = new Set((draw.pairs||[]).map(p=>p.receiverUid).filter(Boolean));
  const rankOf = uid=> lotteryRank(byUid.get(uid), winCounts[uid]||0);
  const eligible = stats.filter(s=> rankOf(s.uid)!==null);
  const violations = [];
  // If every candidate received a gift (more givers than receivers), the order can't be violated.
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

