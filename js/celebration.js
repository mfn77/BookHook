/*
 * Full-screen celebration for the daily check-in: a wave and a soft glow spread from the button, confetti
 * bursts out of it, and a light shower falls from the top of the screen.
 *
 * It is purely decorative: it never receives taps, removes everything it adds, and is skipped when the
 * device asks for reduced motion. The wave and glow are two or three elements animated by the
 * compositor; the confetti is drawn on one canvas, so the cost doesn't grow with the page's content.
 */

const COLORS = ['#F2B84B', '#EF8A62', '#9FD8A8', '#B9A8E8', '#7CC4E8'];
const CONFETTI_MS = 2300;
const GRAVITY = 1500; // px/s^2
const DRAG = 1.6;     // share of speed lost per second (exponential)

const random = (min, max)=> min + Math.random() * (max - min);

// (x, y) is where the celebration starts, in viewport coordinates.
export function playCheckInCelebration(x, y){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try{ navigator.vibrate?.([14, 60, 24]); }catch(_){}
  playWave(x, y);
  // Set the canvas up one frame later, so the tap's own feedback is on screen first.
  requestAnimationFrame(()=> playConfetti(x, y));
}

function playWave(x, y){
  // Far enough to pass the farthest corner of the screen.
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const glow = document.createElement('div');
  glow.className = 'checkin-glow';
  glow.style.background = `radial-gradient(circle at ${x}px ${y}px, color-mix(in srgb, var(--gold) 36%, transparent) 0, transparent ${Math.round(reach * 0.9)}px)`;
  document.body.appendChild(glow);
  glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.22 }, { opacity: 0 }], { duration: 950, easing: 'ease-out' })
    .onfinish = ()=> glow.remove();

  // The rings are drawn small and scaled up, which keeps them cheap; the softening this causes suits a wave.
  const size = 160;
  [[0, 3], [150, 2]].forEach(([delay, border])=>{
    const ring = document.createElement('div');
    ring.className = 'checkin-wave';
    ring.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-width:${border}px`;
    document.body.appendChild(ring);
    ring.animate(
      [{ transform: 'scale(.15)', opacity: 0.8 }, { transform: `scale(${(reach * 2 / size).toFixed(2)})`, opacity: 0 }],
      { duration: 900, delay, easing: 'cubic-bezier(.05,.7,.1,1)', fill: 'both' }
    ).onfinish = ()=> ring.remove();
  });
}

function confettiPiece(extra){
  return {
    w: random(6, 11), h: random(8, 15),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    round: Math.random() < 0.2,
    rot: random(0, 6.28), spin: random(-9, 9),
    flip: random(0, 6.28), flipSpeed: random(6, 14),
    sway: random(20, 70), swaySpeed: random(2, 5),
    ...extra
  };
}

function playConfetti(x, y){
  const width = innerWidth, height = innerHeight;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.className = 'checkin-confetti';
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  ctx.scale(scale, scale);
  document.body.appendChild(canvas);

  // Fewer pieces on modest devices.
  const modest = (navigator.hardwareConcurrency || 4) <= 4;
  const pieces = [];
  // A fan thrown up and out of the button...
  for(let i = 0; i < (modest ? 50 : 80); i++){
    const angle = random(-Math.PI * 0.95, -Math.PI * 0.05), speed = random(380, 1050);
    pieces.push(confettiPiece({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: 0, weight: 1 }));
  }
  // ...and a slower shower from the top edge, so the whole screen takes part.
  for(let i = 0; i < (modest ? 24 : 40); i++){
    pieces.push(confettiPiece({ x: random(0, width), y: random(-60, -10), vx: random(-40, 40), vy: random(120, 320), born: random(150, 800), weight: 0.3 }));
  }

  const start = performance.now();
  let last = start, done = false;
  const finish = ()=>{ if(!done){ done = true; canvas.remove(); } };
  // The frame loop pauses while the page is hidden; this makes sure the canvas still goes away.
  setTimeout(finish, CONFETTI_MS + 1500);

  function frame(now){
    if(done) return;
    const elapsed = now - start;
    if(elapsed >= CONFETTI_MS){ finish(); return; }
    const dt = Math.min(0.034, (now - last) / 1000);
    last = now;
    const slow = Math.exp(-DRAG * dt);
    const fade = elapsed > CONFETTI_MS - 500 ? (CONFETTI_MS - elapsed) / 500 : 1;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = fade;
    for(const p of pieces){
      if(elapsed < p.born) continue;
      p.vx *= slow;
      p.vy = p.vy * slow + GRAVITY * p.weight * dt;
      p.x += (p.vx + Math.sin(elapsed / 1000 * p.swaySpeed + p.flip) * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      if(p.y > height + 30) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip)); // a flat piece of paper tumbling
      ctx.fillStyle = p.color;
      if(p.round){ ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.2832); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
