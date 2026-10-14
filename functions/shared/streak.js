/*
 * Reading streak and badge rules shared by the app and server. The caller supplies daily reading
 * records.
 *
 * Count consecutive read days backward from today, or yesterday if today is unmarked. The active badge
 * is the highest threshold reached; when the streak ends, it moves into badge history.
 *
 * The 30-day badge repeats every 30 days without a break. bankedRepeats tracks repeats already added to
 * history, preventing duplicate awards.
 */

/*
 * label: Turkish name used in stored records seen by everyone (posts, notifications). labelEn: shown on
 * screen in English only.
 */
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

/*
 * Number of extra badges (beyond the active one) this streak should already have added to the history.
 * For the 30-day badge: 59 days -> 0, 60 -> 1, 90 -> 2. Always 0 for other badges.
 */
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

/*
 * Counts the streak back from startDateStr (YYYY-MM-DD) in chunks of 31 days until the first day not
 * read; there is no upper limit. readStatus(dateStr) returns that day's status ('read' | 'skip' | null)
 * and must throw if the read fails; treating a failed read as "not read" would break the streak by
 * mistake. startMayBeUnmarked: if the start day (today) isn't marked yet, start counting from the day
 * before.
 */
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

/*
 * Compares the stored state (lastStreak, currentTier, bankedRepeats) with the new streak:
 * - 'rise': a new, higher badge was reached -> award it and notify.
 * - 'repeat': the 30-day badge was earned again without a break (day 60, 90, ...) -> add `bank`
 *   badges to the history and notify. A 'rise' can also carry bank > 0.
 * - 'drop': the streak broke or got shorter -> completedTier (the badge held before, if any) goes to
 *   the history. The app ignores drops; the server settles them after the day closes.
 * - 'none': nothing to record.
 * bank: badges to add to the history now; repeats: the new bankedRepeats to store.
 */
export function badgeTransition(streak, lastStreak, prevTier, bankedRepeats=0){
  const newTier = currentTierForStreak(streak);
  if(streak<lastStreak) return {kind:'drop', newTier, completedTier: prevTier||null, bank:0, repeats:0};
  const repeats = Math.max(repeatsDue(streak), bankedRepeats||0);
  const bank = repeats - (bankedRepeats||0);
  if(newTier && newTier!==prevTier) return {kind:'rise', newTier, bank, repeats};
  if(bank>0) return {kind:'repeat', newTier, bank, repeats};
  return {kind:'none', newTier, bank:0, repeats};
}

/*
 * Replays a member's whole history (day statuses, oldest first) and computes the badge history: badges
 * of finished streaks plus the repeated 30-day badges of the current streak. The current streak's
 * active badge is not counted yet.
 */
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

