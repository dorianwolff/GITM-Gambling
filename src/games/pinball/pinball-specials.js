const TAU = Math.PI * 2;
const BALL_BASE_R = 0.013;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function choose(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function ballRadius(ball) {
  return BALL_BASE_R * (ball?.radiusScale ?? 1);
}

function spawnBurst(bursts, x, y, color, count = 14, speed = 0.12, life = 0.7, size = 0.02) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * TAU;
    bursts.push({
      x,
      y,
      vx: Math.cos(ang) * rand(speed * 0.4, speed),
      vy: Math.sin(ang) * rand(speed * 0.4, speed),
      r: rand(size * 0.35, size),
      life,
      maxLife: life,
      color,
    });
  }
}

function stepBursts(bursts, dt) {
  for (const p of bursts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy -= 0.05 * dt;
    p.life -= dt;
  }
  return bursts.filter((p) => p.life > 0);
}

function drawBursts(c, bursts, toX, toY, toR) {
  for (const p of bursts) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    c.save();
    c.globalAlpha = a;
    c.shadowColor = p.color;
    c.shadowBlur = 12;
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(toX(p.x), toY(p.y), toR(p.r) * (0.5 + (1 - a) * 0.6), 0, TAU);
    c.fill();
    c.restore();
  }
}

function bounceBallAway(ball, cx, cy, radius, restitution = 0.78) {
  const d = dist(ball.x, ball.y, cx, cy) || 0.0001;
  const nx = (ball.x - cx) / d;
  const ny = (ball.y - cy) / d;
  ball.x = cx + nx * radius;
  ball.y = cy + ny * radius;
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot < 0) {
    ball.vx -= (1 + restitution) * dot * nx;
    ball.vy -= (1 + restitution) * dot * ny;
  }
}

function drawCircle(c, toX, toY, x, y, r, fill, glow, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  c.shadowColor = glow || fill;
  c.shadowBlur = 20;
  c.fillStyle = fill;
  c.beginPath();
  c.arc(toX(x), toY(y), r, 0, TAU);
  c.fill();
  c.restore();
}

function drawLine(c, toX, toY, ax, ay, bx, by, color, width, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(toX(ax), toY(ay));
  c.lineTo(toX(bx), toY(by));
  c.stroke();
  c.restore();
}

function drawStarShape(c, x, y, outer, inner, spikes, fill, glow) {
  c.save();
  c.shadowColor = glow || fill;
  c.shadowBlur = 24;
  c.fillStyle = fill;
  c.beginPath();
  let rot = Math.PI / 2 * 3;
  let px = x;
  let py = y;
  const step = Math.PI / spikes;
  c.moveTo(x, y - outer);
  for (let i = 0; i < spikes; i++) {
    px = x + Math.cos(rot) * outer;
    py = y + Math.sin(rot) * outer;
    c.lineTo(px, py);
    rot += step;
    px = x + Math.cos(rot) * inner;
    py = y + Math.sin(rot) * inner;
    c.lineTo(px, py);
    rot += step;
  }
  c.closePath();
  c.fill();
  c.restore();
}

function createEmptyScript() {
  return {
    reset() {},
    step() {},
    draw() {},
  };
}

function createGalaxyDriftScript() {
  let nextSpawnAt = 0;
  let star = null;
  let pulses = [];
  let streaks = [];
  let uid = 1;

  const spots = [
    { x: 0.22, y: 0.18 },
    { x: 0.35, y: 0.28 },
    { x: 0.50, y: 0.20 },
    { x: 0.66, y: 0.30 },
    { x: 0.78, y: 0.18 },
    { x: 0.28, y: 0.50 },
    { x: 0.50, y: 0.48 },
    { x: 0.72, y: 0.50 },
    { x: 0.18, y: 0.34 },
    { x: 0.42, y: 0.34 },
    { x: 0.58, y: 0.34 },
    { x: 0.82, y: 0.34 },
    { x: 0.24, y: 0.60 },
    { x: 0.50, y: 0.60 },
    { x: 0.76, y: 0.60 },
  ];

  const weightedRarities = [
    { type: 'speed', weight: 28 },
    { type: 'points', weight: 30 },
    { type: 'grow', weight: 24 },
    { type: 'split', weight: 17 },
    { type: 'jackpot', weight: 1 },
  ];

  function pickRarity() {
    const total = weightedRarities.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    for (const r of weightedRarities) {
      roll -= r.weight;
      if (roll <= 0) return r.type;
    }
    return 'points';
  }

  function spawnStar(now) {
    const spot = choose(spots);
    star = {
      id: uid++,
      x: spot.x + rand(-0.03, 0.03),
      y: spot.y + rand(-0.02, 0.02),
      r: 0.026,
      type: pickRarity(),
      bornAt: now,
      expiresAt: now + rand(4200, 6500),
      spin: rand(0, TAU),
      pulse: rand(0.8, 1.2),
      hue: rand(0, TAU),
    };
  }

  function applyStarEffect(ball, ctx, now) {
    const color = ctx.map?.accent2 || ctx.map?.accent || '#8bf';
    switch (star.type) {
      case 'speed':
        ctx.registerHit(ball, 180, 'QUASAR', color, 'special');
        ctx.applyBallEffect(ball, {
          pointsMultiplier: 2,
          speedMultiplier: 2,
          duration: 8000,
          color,
        });
        ctx.showPop('2X POWER', color, ball.x, ball.y - 0.03, 1.25);
        pulses.push({ x: ball.x, y: ball.y, r: 0.03, life: 0.9, maxLife: 0.9, color });
        streaks.push({ ballId: ball.id, until: now + 8000, color });
        break;
      case 'points':
        ctx.registerHit(ball, 300, 'STAR CACHE', color, 'special');
        ctx.showPop('+300', color, ball.x, ball.y - 0.03, 1.15);
        break;
      case 'grow':
        ctx.registerHit(ball, 120, 'GIANT STAR', color, 'special');
        ctx.applyBallEffect(ball, {
          radiusScale: 3,
          duration: 10000,
          color,
        });
        ctx.showPop('x3 SIZE', color, ball.x, ball.y - 0.03, 1.25);
        pulses.push({ x: ball.x, y: ball.y, r: 0.04, life: 1.0, maxLife: 1.0, color });
        break;
      case 'split':
        ctx.registerHit(ball, 220, 'DUPLICATE STAR', color, 'special');
        ctx.spawnBallAt({
          x: ball.x + rand(-0.03, 0.03),
          y: ball.y + rand(-0.02, 0.02),
          vx: -ball.vx * 0.55 + rand(-0.22, 0.22),
          vy: ball.vy * 0.55 + rand(-0.18, 0.18),
          radiusScale: ball.radiusScale ?? 1,
          staged: false,
          consumeReserve: false,
        });
        ctx.showPop('EXTRA BALL', color, ball.x, ball.y - 0.03, 1.2);
        pulses.push({ x: ball.x, y: ball.y, r: 0.04, life: 1.0, maxLife: 1.0, color });
        break;
      case 'jackpot':
      default:
        ctx.registerHit(ball, 10000, 'JACKPOT STAR', '#ffd86b', 'special');
        ctx.showPop('JACKPOT 10K', '#ffd86b', ball.x, ball.y - 0.03, 1.35);
        pulses.push({ x: ball.x, y: ball.y, r: 0.05, life: 1.2, maxLife: 1.2, color: '#ffd86b' });
        break;
    }
    star = null;
    nextSpawnAt = now + rand(3000, 5200);
  }

  return {
    reset() {
      star = null;
      pulses = [];
      streaks = [];
      nextSpawnAt = 0;
    },
    step(ctx) {
      pulses = stepBursts(pulses, ctx.dt);
      streaks = streaks.filter((s) => s.until > ctx.now);

      if (!star && ctx.now >= nextSpawnAt) {
        spawnStar(ctx.now);
      }
      if (star && ctx.now > star.expiresAt) {
        star = null;
        nextSpawnAt = ctx.now + rand(2200, 4200);
      }
      if (!star) return;

      for (const ball of ctx.balls) {
        if (!ball.alive || ball.staged) continue;
        const d = dist(ball.x, ball.y, star.x, star.y);
        if (d < ballRadius(ball) + star.r) {
          applyStarEffect(ball, ctx, ctx.now);
          break;
        }
      }
    },
    draw(c, ctx) {
      drawBursts(c, pulses, ctx.toX, ctx.toY, ctx.toR);
      if (!star) {
        for (const s of streaks) {
          const ball = ctx.balls.find((b) => b.id === s.ballId && b.alive);
          if (!ball) continue;
          const bx = ctx.toX(ball.x);
          const by = ctx.toY(ball.y);
          c.save();
          c.globalAlpha = 0.35;
          c.strokeStyle = s.color;
          c.lineWidth = 4;
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx - Math.cos(ctx.now * 0.02) * 18, by + 24);
          c.stroke();
          c.restore();
        }
        return;
      }

      const bx = ctx.toX(star.x);
      const by = ctx.toY(star.y);
      const base = ctx.toR(star.r);
      const pulse = 0.82 + Math.sin(ctx.now * 0.008 + star.hue) * 0.12;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.shadowColor = star.type === 'jackpot' ? '#ffd86b' : (ctx.map?.accent2 || ctx.map?.accent || '#9cf');
      c.shadowBlur = star.type === 'jackpot' ? 36 : 28;
      c.translate(bx, by);
      c.rotate(star.spin + ctx.now * 0.0012);
      drawStarShape(c, 0, 0, base * 1.55 * pulse, base * 0.70, 5, star.type === 'jackpot' ? '#ffd86b' : (ctx.map?.accent2 || '#b6d7ff'), star.type === 'jackpot' ? '#fff' : (ctx.map?.accent || '#67f'));
      c.globalAlpha = 0.55;
      c.strokeStyle = star.type === 'jackpot' ? '#fff1a8' : '#ffffff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, base * (2.0 + Math.sin(ctx.now * 0.01) * 0.2), 0, TAU);
      c.stroke();
      c.restore();
    },
  };
}

function createForestScript() {
  let trees = [];
  let nextSpawnAt = 0;
  let bursts = [];
  let uid = 1;
  let waitingForLaunch = true;

  const spots = [
    { x: 0.22, y: 0.26 },
    { x: 0.36, y: 0.33 },
    { x: 0.50, y: 0.25 },
    { x: 0.64, y: 0.34 },
    { x: 0.78, y: 0.27 },
    { x: 0.30, y: 0.52 },
    { x: 0.50, y: 0.56 },
    { x: 0.70, y: 0.52 },
  ];

  function spawnTree(now) {
    if (trees.length >= 4) return;
    const spot = choose(spots);
    const rewardType = Math.random() < 0.58 ? 'tree' : 'mushroom';
    trees.push({
      id: uid++,
      x: spot.x + rand(-0.025, 0.025),
      y: spot.y + rand(-0.02, 0.02),
      r: 0.030,
      hp: 3,
      sway: rand(0, TAU),
      growth: 0,
      rewardType,
      emoji: rewardType === 'mushroom'
        ? '🍄'
        : (Math.random() < 0.5 ? '🌲' : '🌳'),
      color: rewardType === 'mushroom' ? '#f59e0b' : (Math.random() < 0.5 ? '#22c55e' : '#4ade80'),
      bornAt: now,
      cracks: 0,
      crackSeed: rand(0, TAU),
    });
  }

  function cutTree(tree, ctx, ball, now) {
    spawnBurst(bursts, tree.x, tree.y, tree.color, 16, 0.11, 0.8, 0.018);
    if (tree.rewardType === 'mushroom') {
      ctx.registerHit(ball, 180, 'MUSHROOM', tree.color, 'special');
      ctx.addReserveBall(1);
      ctx.showPop('+1 BALL', tree.color, tree.x, tree.y - 0.02, 1.12);
    } else {
      ctx.registerHit(ball, 320, 'TREE CUT', tree.color, 'special');
      ctx.showPop('+320', tree.color, tree.x, tree.y - 0.02, 1.10);
    }
    tree.dead = true;
    nextSpawnAt = now + rand(1800, 3200);
  }

  return {
    reset() {
      trees = [];
      bursts = [];
      nextSpawnAt = 0;
      waitingForLaunch = true;
    },
    step(ctx) {
      bursts = stepBursts(bursts, ctx.dt);
      const hasLiveBall = ctx.balls.some((ball) => ball.alive && !ball.staged);
      if (!hasLiveBall) {
        if (trees.length) trees = [];
        waitingForLaunch = true;
        return;
      }

      if (waitingForLaunch) {
        nextSpawnAt = ctx.now + rand(1200, 2400);
        waitingForLaunch = false;
      }

      if (ctx.now >= nextSpawnAt && trees.length < 4) {
        spawnTree(ctx.now);
        nextSpawnAt = ctx.now + rand(2400, 4200);
      }

      for (const tree of trees) {
        tree.growth = Math.min(1, tree.growth + ctx.dt * 1.6);
        for (const ball of ctx.balls) {
          if (!ball.alive || ball.staged) continue;
          const r = ballRadius(ball) + tree.r * 1.3;
          const d = dist(ball.x, ball.y, tree.x, tree.y);
          if (d < r) {
            bounceBallAway(ball, tree.x, tree.y, r, 0.72);
            tree.hp -= 1;
            tree.cracks = 3 - tree.hp;
            spawnBurst(bursts, ball.x, ball.y, tree.color, 8, 0.08, 0.5, 0.014);
            if (tree.hp <= 0) {
              cutTree(tree, ctx, ball, ctx.now);
            } else {
              const base = tree.rewardType === 'mushroom' ? 110 : 70;
              ctx.registerHit(ball, base, tree.rewardType === 'mushroom' ? 'MUSHROOM' : 'TREE', tree.color, 'special');
              ctx.showPop(tree.rewardType === 'mushroom' ? 'SPROUT!' : 'CHOP!', tree.color, tree.x, tree.y - 0.025, 1.0);
            }
            break;
          }
        }
      }
      trees = trees.filter((t) => !t.dead);
    },
    draw(c, ctx) {
      drawBursts(c, bursts, ctx.toX, ctx.toY, ctx.toR);
      for (const tree of trees) {
        const bx = ctx.toX(tree.x);
        const by = ctx.toY(tree.y);
        const crown = ctx.toR(tree.r * (1.7 + tree.growth * 0.1));
        c.save();
        c.shadowColor = tree.color;
        c.shadowBlur = 18;
        c.font = `${Math.round(crown * 1.25)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(tree.emoji, bx, by);

        c.strokeStyle = 'rgba(20,10,0,0.60)';
        c.lineWidth = 2;
        c.lineCap = 'round';
        c.beginPath();
        const crackCount = tree.cracks || 0;
        for (let i = 0; i < crackCount; i++) {
          const seed = tree.crackSeed + i * 1.7;
          const dx = Math.cos(seed) * crown * 0.45;
          const dy = Math.sin(seed * 1.3) * crown * 0.35;
          c.moveTo(bx, by);
          c.lineTo(bx + dx * 0.55, by + dy * 0.55);
          c.lineTo(bx + dx * 0.8 + Math.sin(seed * 2.2) * crown * 0.12, by + dy * 0.8);
        }
        c.stroke();
        c.restore();
      }
    },
  };
}

function createDeepSeaScript() {
  let wave = null;
  let nextWaveAt = 0;
  let bursts = [];
  let boat = null;
  let cycle = 1;

  function spawnWave(now) {
    const dir = cycle;
    cycle *= -1;
    wave = {
      bornAt: now,
      warningUntil: now + 1000,
      endAt: now + 3800,
      dir,
      amplitude: rand(0.06, 0.09),
      boatCooldownUntil: 0,
    };
    boat = {
      x: dir > 0 ? 0.18 : 0.82,
      y: 0.47,
      w: 0.14,
      h: 0.045,
      bob: rand(0, TAU),
      hitCooldownUntil: 0,
    };
    nextWaveAt = now + 10000;
  }

  function boatHit(ctx, ball, now) {
    if (now < boat.hitCooldownUntil) return;
    boat.hitCooldownUntil = now + 900;
    ctx.addReserveBall(5);
    ctx.registerHit(ball, 500, 'RESCUE BOAT', '#67e8f9', 'special');
    ctx.showPop('+5 BALLS', '#67e8f9', boat.x, boat.y - 0.03, 1.25);
    spawnBurst(bursts, boat.x, boat.y, '#67e8f9', 20, 0.12, 0.9, 0.016);
  }

  return {
    reset() {
      wave = null;
      boat = null;
      bursts = [];
      nextWaveAt = 2500;
      cycle = 1;
    },
    step(ctx) {
      bursts = stepBursts(bursts, ctx.dt);
      if (!wave && ctx.now >= nextWaveAt) {
        spawnWave(ctx.now);
      }
      if (!wave) return;

      const progress = clamp((ctx.now - wave.bornAt) / (wave.endAt - wave.bornAt), 0, 1);
      const strength = progress < 0.18 ? progress / 0.18 : progress > 0.82 ? (1 - progress) / 0.18 : 1;
      const dragDir = wave.dir;
      for (const ball of ctx.balls) {
        if (!ball.alive || ball.staged) continue;
        ball.vx += dragDir * 0.35 * strength * ctx.dt;
        ball.vy += Math.sin((ctx.now * 0.005) + ball.x * 4) * 0.012 * ctx.dt;
        if (boat && dist(ball.x, ball.y, boat.x, boat.y) < ballRadius(ball) + 0.028 && ctx.now >= wave.warningUntil) {
          boatHit(ctx, ball, ctx.now);
        }
      }

      if (ctx.now > wave.endAt) {
        wave = null;
      }

      if (boat) {
        const travel = clamp((ctx.now - (nextWaveAt - 10000)) / 3800, 0, 1);
        boat.x = dragDir > 0 ? 0.14 + 0.64 * travel : 0.86 - 0.64 * travel;
        boat.y = 0.47 + Math.sin(ctx.now * 0.01 + boat.bob) * 0.01;
      }
    },
    draw(c, ctx) {
      drawBursts(c, bursts, ctx.toX, ctx.toY, ctx.toR);
      if (!wave) return;
      const progress = clamp((ctx.now - wave.bornAt) / (wave.endAt - wave.bornAt), 0, 1);
      const warn = ctx.now < wave.warningUntil;
      const fillA = warn ? 0.10 : 0.22;
      const baseY = 0.44;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = warn ? 'rgba(34,211,238,0.10)' : 'rgba(56,189,248,0.14)';
      c.beginPath();
      c.moveTo(ctx.toX(0), ctx.toY(1));
      for (let i = 0; i <= 48; i++) {
        const x = i / 48;
        const waveY = baseY + Math.sin((x * 6.4) + ctx.now * 0.004 + wave.dir * 1.2) * 0.03 * (warn ? 0.5 : 1);
        c.lineTo(ctx.toX(x), ctx.toY(waveY));
      }
      c.lineTo(ctx.toX(1), ctx.toY(1));
      c.closePath();
      c.fill();
      c.restore();

      for (let i = 0; i < 5; i++) {
        const a = (ctx.now * 0.0015 + i) % 1;
        const x = wave.dir > 0 ? 0.12 + a * 0.76 : 0.88 - a * 0.76;
        const y = baseY + Math.sin((a * 5.5) + ctx.now * 0.006) * 0.025;
        drawCircle(c, ctx.toX, ctx.toY, x, y, ctx.toR(0.012), 'rgba(255,255,255,0.55)', '#fff', warn ? 0.25 : 0.55);
      }

      if (boat) {
        const bx = ctx.toX(boat.x);
        const by = ctx.toY(boat.y);
        const bw = ctx.toX(boat.x + boat.w) - ctx.toX(boat.x);
        const bh = ctx.toY(boat.y + boat.h) - ctx.toY(boat.y);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.shadowColor = '#67e8f9';
        c.shadowBlur = 26;
        const hull = c.createLinearGradient(bx, by - bh, bx, by + bh);
        hull.addColorStop(0, 'rgba(255,255,255,0.95)');
        hull.addColorStop(0.35, 'rgba(45, 212, 191, 0.95)');
        hull.addColorStop(1, 'rgba(20, 31, 48, 0.98)');
        c.fillStyle = hull;
        c.beginPath();
        c.moveTo(bx - bw * 0.58, by + bh * 0.14);
        c.lineTo(bx - bw * 0.32, by - bh * 0.42);
        c.lineTo(bx + bw * 0.34, by - bh * 0.46);
        c.lineTo(bx + bw * 0.58, by + bh * 0.08);
        c.lineTo(bx + bw * 0.34, by + bh * 0.42);
        c.lineTo(bx - bw * 0.46, by + bh * 0.42);
        c.closePath();
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.9)';
        c.lineWidth = 1.5;
        c.stroke();

        c.fillStyle = 'rgba(8, 14, 28, 0.9)';
        c.beginPath();
        c.roundRect?.(bx - bw * 0.10, by - bh * 0.92, bw * 0.20, bh * 0.80, 3);
        if (!c.roundRect) {
          c.rect(bx - bw * 0.10, by - bh * 0.92, bw * 0.20, bh * 0.80);
        }
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.78)';
        c.beginPath();
        c.arc(bx - bw * 0.16, by - bh * 0.18, bh * 0.12, 0, TAU);
        c.arc(bx + bw * 0.02, by - bh * 0.18, bh * 0.12, 0, TAU);
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(bx - bw * 0.12, by + bh * 0.22);
        c.lineTo(bx + bw * 0.18, by + bh * 0.22);
        c.stroke();
        c.fillStyle = 'rgba(103,232,249,0.85)';
        c.beginPath();
        c.moveTo(bx + bw * 0.01, by - bh * 1.00);
        c.lineTo(bx + bw * 0.01, by - bh * 1.32);
        c.lineTo(bx + bw * 0.16, by - bh * 1.08);
        c.closePath();
        c.fill();

        c.globalCompositeOperation = 'source-over';
        c.restore();
      }

      if (warn) {
        c.save();
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.font = '800 12px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('WAVE INCOMING', ctx.toX(0.5), ctx.toY(0.20));
        c.restore();
      }
    },
  };
}

// Fragment count → visual radius scale (1/10 = half size, 10/10 = full size)
const METEOR_FRAG_SCALE = [0, 0.5, 0.75, 0.80, 0.85, 0.875, 0.90, 0.925, 0.95, 0.975, 1.0];
function fScale(n) { return METEOR_FRAG_SCALE[Math.min(Math.max(Math.round(n), 1), 10)]; }

function createInfernoScript() {
  let meteors = [];
  let nextBurstAt = 0;
  let bursts = [];
  let splitGroupSeq = 1;

  function spawnBurstWave(now) {
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const x = rand(0.12, 0.88);
      const y = rand(0.16, 0.60);
      meteors.push({
        id: `${now}-${i}-${Math.random().toString(16).slice(2, 7)}`,
        x,
        y,
        r: rand(0.018, 0.028),
        targetX: x + rand(-0.08, 0.08),
        targetY: y + rand(0.02, 0.12),
        warnUntil: now + 1000,
        impactAt: now + 1100 + rand(0, 650),
        exploded: false,
      });
    }
    nextBurstAt = now + 8000;
  }

  function splitBall(ball, ctx, meteor) {
    ctx.registerHit(ball, 150, 'METEOR', '#ff944d', 'special');
    // Regular (unsplit) balls default to 10 fragments; fragment balls carry their count.
    const nFrag = ball._meteorFragments ?? 10;

    if (nFrag <= 1) {
      // Single fragment hit by meteor → vaporised
      ball.alive = false;
      spawnBurst(bursts, ball.x, ball.y, '#ffd86b', 12, 0.10, 0.55, 0.016);
      ctx.showPop('ASHED', '#ffd86b', ball.x, ball.y - 0.02, 0.9);
      if (meteor) meteor.exploded = true;
      return;
    }

    // Cap spawns so total live balls stays ≤ 10
    const liveCount = ctx.balls.filter((b) => b.alive && !b.staged && b !== ball).length;
    const spawnCount = Math.min(nFrag, 10 - liveCount);

    if (spawnCount <= 0) {
      ball.alive = false;
      spawnBurst(bursts, ball.x, ball.y, '#ffd86b', 8, 0.08, 0.4, 0.012);
      if (meteor) meteor.exploded = true;
      return;
    }

    const groupId = splitGroupSeq++;
    const baseSpeed = Math.max(0.30, Math.hypot(ball.vx, ball.vy) * 0.55 + 0.16);

    for (let i = 0; i < spawnCount; i++) {
      const ang = (i / spawnCount) * TAU + rand(-0.12, 0.12);
      ctx.spawnBallAt({
        x: ball.x + Math.cos(ang) * 0.005,
        y: ball.y + Math.sin(ang) * 0.005,
        vx: Math.cos(ang) * baseSpeed + rand(-0.04, 0.04),
        vy: Math.sin(ang) * baseSpeed + rand(-0.04, 0.04),
        radiusScale: fScale(1),        // 0.5 — visually half-size
        staged: false,
        consumeReserve: false,
        splitGroupId: groupId,
        splitAnchorX: ball.x,
        splitAnchorY: ball.y,
        regroupUntil: ctx.now + 120000, // effectively permanent; cleared by merge
        meteorShieldUntil: ctx.now + 1800,
        mergeCooldownUntil: ctx.now + 1200, // don't merge immediately after spawn
        _meteorFragments: 1,
      });
    }
    ball.alive = false;
    ctx.showPop(`${spawnCount}✕ SPLIT`, '#ff944d', ball.x, ball.y - 0.02, 1.1);
    spawnBurst(bursts, ball.x, ball.y, '#ff944d', 28, 0.14, 0.9, 0.018);
    if (meteor) meteor.exploded = true;
  }

  return {
    reset() {
      meteors = [];
      bursts = [];
      nextBurstAt = 1800;
      splitGroupSeq = 1;
    },
    step(ctx) {
      bursts = stepBursts(bursts, ctx.dt);
      if (ctx.now >= nextBurstAt) {
        spawnBurstWave(ctx.now);
      }

      for (const meteor of meteors) {
        if (meteor.exploded) continue;
        if (ctx.now < meteor.warnUntil) continue;

        for (const ball of ctx.balls) {
          if (!ball.alive || ball.staged) continue;
          if ((ball.meteorShieldUntil ?? 0) > ctx.now) continue;
          const d = dist(ball.x, ball.y, meteor.targetX, meteor.targetY);
          if (d < ballRadius(ball) + meteor.r * 1.35) {
            splitBall(ball, ctx, meteor);
            spawnBurst(bursts, meteor.targetX, meteor.targetY, '#ffd86b', 22, 0.16, 0.75, 0.018);
            break;
          }
        }

        if (ctx.now >= meteor.impactAt && !meteor.exploded) {
          const nearest = ctx.balls.find((ball) => ball.alive && !ball.staged && (ball.meteorShieldUntil ?? 0) <= ctx.now && dist(ball.x, ball.y, meteor.targetX, meteor.targetY) < ballRadius(ball) + meteor.r * 1.6);
          if (nearest) {
            splitBall(nearest, ctx, meteor);
          } else {
            spawnBurst(bursts, meteor.targetX, meteor.targetY, '#ff6b6b', 18, 0.18, 0.75, 0.02);
          }
          meteor.exploded = true;
        }
      }

      meteors = meteors.filter((m) => !m.exploded || ctx.now < m.warnUntil + 1500);

      // ── Merge touching fragment balls of the same group ────────────────────
      // Runs before engine's resolveBallBallCollisions so dead balls are filtered.
      const liveFrag = ctx.balls.filter((b) => b.alive && !b.staged && b._meteorFragments != null);
      for (let i = 0; i < liveFrag.length; i++) {
        const a = liveFrag[i];
        if (!a.alive || (a.mergeCooldownUntil ?? 0) > ctx.now) continue;
        const ar = BALL_BASE_R * (a.radiusScale ?? 1);
        for (let j = i + 1; j < liveFrag.length; j++) {
          const b = liveFrag[j];
          if (!b.alive || b.splitGroupId !== a.splitGroupId) continue;
          if ((b.mergeCooldownUntil ?? 0) > ctx.now) continue;
          const br = BALL_BASE_R * (b.radiusScale ?? 1);
          if (dist(a.x, a.y, b.x, b.y) >= ar + br) continue;

          // Merge b into a (weighted by fragment count)
          const fa = a._meteorFragments ?? 1;
          const fb = b._meteorFragments ?? 1;
          const total = Math.min(fa + fb, 10);
          const tw = fa + fb;
          a.x = (a.x * fa + b.x * fb) / tw;
          a.y = (a.y * fa + b.y * fb) / tw;
          a.vx = (a.vx * fa + b.vx * fb) / tw;
          a.vy = (a.vy * fa + b.vy * fb) / tw;
          a.radiusScale = fScale(total);
          a.mergeCooldownUntil = ctx.now + 300;

          if (total >= 10) {
            // Fully reformed — treat as a normal ball again
            a._meteorFragments = null;
            a.splitGroupId = null;
            ctx.showPop('REFORMED!', '#ffd86b', a.x, a.y - 0.03, 1.2);
            spawnBurst(bursts, a.x, a.y, '#ffd86b', 22, 0.13, 0.8, 0.018);
          } else {
            a._meteorFragments = total;
            spawnBurst(bursts, a.x, a.y, '#ff944d', 6, 0.06, 0.30, 0.009);
          }

          b.alive = false;
          break; // one merge per ball per frame
        }
      }

      // Anchor pull — only for NON-meteor split balls (galaxy star, etc.)
      for (const ball of ctx.balls) {
        if (!ball.alive || ball.staged) continue;
        if (!ball.splitGroupId || ctx.now > (ball.regroupUntil ?? 0)) continue;
        if (ball._meteorFragments != null) continue; // meteor fragments merge on contact, no anchor
        const ax = ball.splitAnchorX ?? ball.x;
        const ay = ball.splitAnchorY ?? ball.y;
        ball.vx += (ax - ball.x) * 0.20 * ctx.dt;
        ball.vy += (ay - ball.y) * 0.20 * ctx.dt;
      }
    },
    draw(c, ctx) {
      drawBursts(c, bursts, ctx.toX, ctx.toY, ctx.toR);
      for (const meteor of meteors) {
        if (ctx.now < meteor.warnUntil) {
          const warnAlpha = 0.18 + Math.sin(ctx.now * 0.01) * 0.05;
          c.save();
          c.fillStyle = `rgba(255, 106, 58, ${warnAlpha})`;
          c.strokeStyle = 'rgba(255, 230, 150, 0.8)';
          c.shadowColor = '#ff6b3a';
          c.shadowBlur = 24;
          c.lineWidth = 2;
          c.beginPath();
          c.arc(ctx.toX(meteor.targetX), ctx.toY(meteor.targetY), ctx.toR(meteor.r * 2.1), 0, TAU);
          c.fill();
          c.stroke();
          c.restore();
          continue;
        }

        const p = clamp((ctx.now - meteor.warnUntil) / Math.max(1, meteor.impactAt - meteor.warnUntil), 0, 1);
        const x = meteor.targetX + Math.sin(p * TAU) * 0.01;
        const y = meteor.targetY - 0.12 + p * 0.12;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.shadowColor = '#ff944d';
        c.shadowBlur = 24;
        c.fillStyle = '#ff6b3a';
        c.beginPath();
        c.arc(ctx.toX(x), ctx.toY(y), ctx.toR(meteor.r * (1.0 + p * 0.4)), 0, TAU);
        c.fill();
        c.strokeStyle = 'rgba(255, 240, 180, 0.85)';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(ctx.toX(x), ctx.toY(y));
        c.lineTo(ctx.toX(x - 0.02), ctx.toY(y - 0.06));
        c.stroke();
        c.restore();
      }
    },
  };
}

function createCyberScript() {
  let bursts = [];
  let arms = [];
  let mills = [];
  let fans = [];
  let nextSpawnAt = 0;
  let uid = 1;

  function makeArm(now, side) {
    const x = side < 0 ? rand(0.14, 0.28) : rand(0.72, 0.86);
    const y = rand(0.30, 0.58);
    return {
      id: uid++,
      type: 'arm',
      x,
      y,
      baseAngle: side < 0 ? -0.7 : 2.45,
      angle: rand(-0.3, 0.3),
      spin: side < 0 ? 0.8 : -0.8,
      length: rand(0.10, 0.14),
      tip: rand(0.018, 0.024),
      pulse: rand(0, TAU),
      nextShockAt: now + rand(1000, 3000),
      color: side < 0 ? '#22e1ff' : '#ff2bd6',
    };
  }

  function makeMill(now) {
    const x = rand(0.35, 0.65);
    const y = rand(0.20, 0.46);
    return {
      id: uid++,
      type: 'mill',
      x,
      y,
      r: rand(0.030, 0.040),
      spin: rand(0, TAU),
      rate: rand(3.0, 6.0),
      power: rand(0.12, 0.18),
      nextPulseAt: now + rand(1200, 2800),
      color: Math.random() < 0.5 ? '#22e1ff' : '#ff2bd6',
    };
  }

  function makeFan(now, side) {
    const x = side < 0 ? rand(0.20, 0.30) : rand(0.70, 0.80);
    const y = rand(0.22, 0.46);
    return {
      id: uid++,
      type: 'fan',
      x,
      y,
      r: rand(0.026, 0.034),
      spin: rand(0, TAU),
      rate: rand(5.0, 7.5),
      power: rand(0.11, 0.16),
      color: Math.random() < 0.5 ? '#22e1ff' : '#ff2bd6',
      nextPulseAt: now + rand(700, 2200),
    };
  }

  function maybeSpawn(now) {
    if (arms.length < 2) {
      arms.push(makeArm(now, arms.length === 0 ? -1 : 1));
    }
    if (mills.length < 2) {
      mills.push(makeMill(now));
    }
    if (fans.length < 2) {
      fans.push(makeFan(now, fans.length === 0 ? -1 : 1));
    }
    nextSpawnAt = now + 12000;
  }

  function boostBall(ball, ctx, strength, pts, label, color) {
    ctx.registerHit(ball, pts, label, color, 'special');
    ctx.applyBallEffect(ball, {
      speedMultiplier: 1.25 + strength * 0.4,
      duration: 5500,
      color,
    });
    const speed = Math.max(0.35, Math.hypot(ball.vx, ball.vy));
    ball.vx += (Math.random() - 0.5) * strength + Math.sign(ball.vx || 1) * strength * 0.18;
    ball.vy -= strength * 0.08;
    ball.vx = clamp(ball.vx, -2.2, 2.2);
    ball.vy = clamp(ball.vy, -2.2, 2.2);
    spawnBurst(bursts, ball.x, ball.y, color, 16, 0.12, 0.6, 0.016);
    ctx.showPop(label, color, ball.x, ball.y - 0.02, 1.0 + strength * 0.35);
    return speed;
  }

  return {
    reset() {
      bursts = [];
      arms = [makeArm(0, -1), makeArm(0, 1)];
      mills = [makeMill(0), makeMill(0)];
      fans = [makeFan(0, -1), makeFan(0, 1)];
      nextSpawnAt = 4000;
    },
    step(ctx) {
      bursts = stepBursts(bursts, ctx.dt);
      if (ctx.now >= nextSpawnAt) {
        maybeSpawn(ctx.now);
      }

      for (const arm of arms) {
        arm.angle += arm.spin * ctx.dt;
        if (Math.abs(arm.angle) > 0.8) arm.spin *= -1;
        if (ctx.now >= arm.nextShockAt) {
          arm.spin *= -1;
          arm.nextShockAt = ctx.now + rand(1600, 3200);
        }
      }
      for (const mill of mills) {
        mill.spin += mill.rate * ctx.dt;
        if (ctx.now >= mill.nextPulseAt) {
          mill.power = rand(0.14, 0.2);
          mill.nextPulseAt = ctx.now + rand(1800, 3500);
        } else {
          mill.power *= 0.995;
        }
      }

      for (const fan of fans) {
        fan.spin += fan.rate * ctx.dt;
        if (ctx.now >= fan.nextPulseAt) {
          fan.power = rand(0.12, 0.22);
          fan.nextPulseAt = ctx.now + rand(1100, 2500);
        } else {
          fan.power *= 0.994;
        }
      }

      for (const ball of ctx.balls) {
        if (!ball.alive || ball.staged) continue;

        for (const arm of arms) {
          const px = arm.x + Math.cos(arm.baseAngle + arm.angle) * arm.length;
          const py = arm.y + Math.sin(arm.baseAngle + arm.angle) * arm.length;
          const d = dist(ball.x, ball.y, px, py);
          if (d < ballRadius(ball) + arm.tip) {
            bounceBallAway(ball, px, py, ballRadius(ball) + arm.tip, 0.72);
            boostBall(ball, ctx, 0.12, 70, 'ARM BOOST', arm.color);
          }
        }

        for (const mill of mills) {
          const d = dist(ball.x, ball.y, mill.x, mill.y);
          const minD = ballRadius(ball) + mill.r;
          if (d < minD) {
            bounceBallAway(ball, mill.x, mill.y, minD, 0.84);
            boostBall(ball, ctx, mill.power, 120, 'WINDMILL', mill.color);
            ball.vx += Math.cos(mill.spin) * 0.30;
            ball.vy += Math.sin(mill.spin) * 0.12;
          }
        }

        for (const fan of fans) {
          const d = dist(ball.x, ball.y, fan.x, fan.y);
          const minD = ballRadius(ball) + fan.r;
          if (d < minD) {
            bounceBallAway(ball, fan.x, fan.y, minD, 0.8);
            boostBall(ball, ctx, fan.power, 95, 'FAN BLAST', fan.color);
            ball.vx += Math.cos(fan.spin) * fan.power * 1.8;
            ball.vy += Math.sin(fan.spin) * fan.power * 0.8;
          }
        }
      }
    },
    draw(c, ctx) {
      drawBursts(c, bursts, ctx.toX, ctx.toY, ctx.toR);
      for (const arm of arms) {
        const ax = ctx.toX(arm.x);
        const ay = ctx.toY(arm.y);
        const bx = ctx.toX(arm.x + Math.cos(arm.baseAngle + arm.angle) * arm.length);
        const by = ctx.toY(arm.y + Math.sin(arm.baseAngle + arm.angle) * arm.length);
        c.save();
        c.shadowColor = arm.color;
        c.shadowBlur = 16;
        c.strokeStyle = arm.color;
        c.lineWidth = 5;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
        c.stroke();
        c.fillStyle = '#0f172a';
        c.beginPath();
        c.arc(ax, ay, ctx.toR(arm.tip * 1.3), 0, TAU);
        c.fill();
        c.fillStyle = arm.color;
        c.beginPath();
        c.arc(bx, by, ctx.toR(arm.tip), 0, TAU);
        c.fill();
        c.restore();
      }

      for (const mill of mills) {
        const x = ctx.toX(mill.x);
        const y = ctx.toY(mill.y);
        const r = ctx.toR(mill.r);
        c.save();
        c.shadowColor = mill.color;
        c.shadowBlur = 22;
        c.strokeStyle = mill.color;
        c.fillStyle = 'rgba(10, 14, 30, 0.92)';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.fill();
        c.stroke();
        for (let i = 0; i < 6; i++) {
          const ang = mill.spin + (i / 6) * TAU;
          const lx = x + Math.cos(ang) * r * 0.95;
          const ly = y + Math.sin(ang) * r * 0.95;
          const tx = x + Math.cos(ang) * r * 0.22;
          const ty = y + Math.sin(ang) * r * 0.22;
          c.strokeStyle = i % 2 === 0 ? mill.color : 'rgba(255,255,255,0.35)';
          c.lineWidth = i % 2 === 0 ? 4 : 2;
          c.beginPath();
          c.moveTo(tx, ty);
          c.lineTo(lx, ly);
          c.stroke();
        }
        c.fillStyle = 'rgba(255,255,255,0.75)';
        c.beginPath();
        c.arc(x, y, r * 0.18, 0, TAU);
        c.fill();
        c.restore();
      }
    },
  };
}

export function createPinballSpecials(mapKey) {
  switch (mapKey) {
    case 'galaxy_drift':
      return createGalaxyDriftScript();
    case 'enchanted_forest':
      return createForestScript();
    case 'deep_sea':
      return createDeepSeaScript();
    case 'inferno_volcano':
      return createInfernoScript();
    case 'cyber_circuit':
      return createCyberScript();
    default:
      return createEmptyScript();
  }
}

export { ballRadius };
