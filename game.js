(() => {
  "use strict";

  // ---------- Setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $("hud"),
    score: $("score"),
    wave: $("wave"),
    ammo: $("ammo"),
    ammoMax: $("ammo-max"),
    health: $("health-bar"),
    powerup: $("powerup-label"),
    start: $("start-screen"),
    pause: $("pause-screen"),
    over: $("gameover-screen"),
    finalScore: $("final-score"),
    finalWave: $("final-wave"),
    bestStart: $("best-start"),
    bestOver: $("best-over"),
    banner: $("wave-banner"),
  };

  let W = 0;
  let H = 0;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Helpers ----------
  const rand = (min, max) => Math.random() * (max - min) + min;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const BEST_KEY = "neon-arena-best";
  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) {
      /* storage unavailable */
    }
  }

  // ---------- Sound (Web Audio, no files) ----------
  let audioCtx = null;
  function sound(freq, duration, type = "square", volume = 0.05, slide = 0) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      if (slide) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, freq + slide),
          audioCtx.currentTime + duration
        );
      }
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      /* audio unavailable */
    }
  }
  const sfx = {
    shoot: () => sound(880, 0.08, "square", 0.03, -500),
    hit: () => sound(220, 0.06, "sawtooth", 0.04, -100),
    explode: () => sound(160, 0.3, "sawtooth", 0.06, -130),
    hurt: () => sound(120, 0.25, "triangle", 0.1, -60),
    pickup: () => sound(600, 0.2, "sine", 0.08, 600),
    reload: () => sound(300, 0.15, "triangle", 0.05, 200),
    empty: () => sound(100, 0.05, "square", 0.03),
  };

  // ---------- Input ----------
  const keys = {};
  const mouse = { x: W / 2, y: H / 2, down: false };

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === "r" && state === "playing") startReload();
    if ((k === "p" || k === "escape") && (state === "playing" || state === "paused")) {
      togglePause();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
  });
  canvas.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) mouse.down = true;
  });
  window.addEventListener("mouseup", () => {
    mouse.down = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    if (state === "playing") togglePause();
  });

  // ---------- Game state ----------
  let state = "menu"; // menu | playing | paused | over
  let player, bullets, enemyBullets, enemies, particles, powerups, floatTexts;
  let score, wave, waveToSpawn, spawnTimer, waveDelay, shake, best;
  let lastTime = 0;

  const ENEMY_TYPES = {
    chaser: { r: 14, speed: 95, hp: 2, color: "#ff2e88", score: 10, damage: 12 },
    runner: { r: 10, speed: 170, hp: 1, color: "#ffe14d", score: 15, damage: 8 },
    tank: { r: 26, speed: 55, hp: 9, color: "#a64dff", score: 40, damage: 25 },
    shooter: { r: 16, speed: 80, hp: 3, color: "#ff8c1a", score: 25, damage: 10 },
  };

  const POWERUPS = {
    health: { color: "#3dff7a", label: "+" },
    rapid: { color: "#ffe14d", label: "R" },
    spread: { color: "#00f0ff", label: "S" },
    shield: { color: "#b38cff", label: "O" },
  };

  function newPlayer() {
    return {
      x: W / 2,
      y: H / 2,
      r: 16,
      speed: 260,
      hp: 100,
      maxHp: 100,
      angle: 0,
      fireCooldown: 0,
      ammo: 30,
      maxAmmo: 30,
      reloading: 0,
      reloadTime: 1.2,
      invuln: 0,
      rapid: 0,
      spread: 0,
      shield: 0,
    };
  }

  function resetGame() {
    player = newPlayer();
    bullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    powerups = [];
    floatTexts = [];
    score = 0;
    wave = 0;
    shake = 0;
    best = loadBest();
    nextWave();
  }

  function nextWave() {
    wave++;
    waveToSpawn = 5 + wave * 3;
    spawnTimer = 0;
    waveDelay = 2;
    showBanner(`WAVE ${wave}`);
  }

  function showBanner(text) {
    ui.banner.textContent = text;
    ui.banner.classList.remove("hidden");
    // restart CSS animation
    ui.banner.style.animation = "none";
    void ui.banner.offsetWidth;
    ui.banner.style.animation = "";
  }

  function pickEnemyType() {
    const r = Math.random();
    if (wave >= 4 && r < 0.12) return "tank";
    if (wave >= 3 && r < 0.3) return "shooter";
    if (wave >= 2 && r < 0.5) return "runner";
    return "chaser";
  }

  function spawnEnemy() {
    const typeName = pickEnemyType();
    const t = ENEMY_TYPES[typeName];
    const side = Math.floor(Math.random() * 4);
    const m = 40;
    let x, y;
    if (side === 0) { x = rand(0, W); y = -m; }
    else if (side === 1) { x = W + m; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = H + m; }
    else { x = -m; y = rand(0, H); }

    const scale = 1 + (wave - 1) * 0.05; // gently harder each wave
    enemies.push({
      type: typeName,
      x,
      y,
      r: t.r,
      speed: t.speed * Math.min(scale, 1.6),
      hp: Math.ceil(t.hp * (1 + (wave - 1) * 0.1)),
      maxHp: Math.ceil(t.hp * (1 + (wave - 1) * 0.1)),
      color: t.color,
      score: t.score,
      damage: t.damage,
      flash: 0,
      shootTimer: rand(1, 2.5),
      wobble: rand(0, Math.PI * 2),
    });
  }

  // ---------- Shooting ----------
  function startReload() {
    if (player.reloading > 0 || player.ammo === player.maxAmmo) return;
    player.reloading = player.reloadTime;
    sfx.reload();
  }

  function fire() {
    if (player.reloading > 0) return;
    if (player.ammo <= 0) {
      sfx.empty();
      startReload();
      return;
    }
    const rate = player.rapid > 0 ? 0.06 : 0.13;
    player.fireCooldown = rate;
    player.ammo--;

    const angles = player.spread > 0 ? [-0.22, -0.11, 0, 0.11, 0.22] : [0];
    const tipX = player.x + Math.cos(player.angle) * (player.r + 10);
    const tipY = player.y + Math.sin(player.angle) * (player.r + 10);
    for (const a of angles) {
      const ang = player.angle + a + rand(-0.03, 0.03);
      bullets.push({
        x: tipX,
        y: tipY,
        vx: Math.cos(ang) * 750,
        vy: Math.sin(ang) * 750,
        r: 4,
        life: 1.2,
      });
    }
    // muzzle flash
    for (let i = 0; i < 4; i++) {
      particles.push(makeParticle(tipX, tipY, "#00f0ff", 120, 0.15, player.angle, 0.5));
    }
    shake = Math.max(shake, 2);
    sfx.shoot();
    if (player.ammo === 0) startReload();
  }

  // ---------- Particles ----------
  function makeParticle(x, y, color, speed, life, angle = null, spreadArc = Math.PI) {
    const a = angle === null ? rand(0, Math.PI * 2) : angle + rand(-spreadArc, spreadArc);
    const s = rand(speed * 0.3, speed);
    return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, color, size: rand(2, 4) };
  }

  function explode(x, y, color, count = 20, speed = 280) {
    for (let i = 0; i < count; i++) particles.push(makeParticle(x, y, color, speed, rand(0.3, 0.7)));
  }

  function addFloatText(x, y, text, color) {
    floatTexts.push({ x, y, text, color, life: 0.8 });
  }

  // ---------- Update ----------
  function update(dt) {
    // --- Player movement ---
    let mx = 0;
    let my = 0;
    if (keys["w"] || keys["arrowup"]) my -= 1;
    if (keys["s"] || keys["arrowdown"]) my += 1;
    if (keys["a"] || keys["arrowleft"]) mx -= 1;
    if (keys["d"] || keys["arrowright"]) mx += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      player.x += (mx / len) * player.speed * dt;
      player.y += (my / len) * player.speed * dt;
    }
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, player.r, H - player.r);
    player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);

    // --- Timers ---
    player.fireCooldown -= dt;
    player.invuln = Math.max(0, player.invuln - dt);
    player.rapid = Math.max(0, player.rapid - dt);
    player.spread = Math.max(0, player.spread - dt);
    player.shield = Math.max(0, player.shield - dt);
    if (player.reloading > 0) {
      player.reloading -= dt;
      if (player.reloading <= 0) {
        player.reloading = 0;
        player.ammo = player.maxAmmo;
      }
    }

    if (mouse.down && player.fireCooldown <= 0) fire();

    // --- Wave spawning ---
    if (waveDelay > 0) {
      waveDelay -= dt;
    } else if (waveToSpawn > 0) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy();
        waveToSpawn--;
        spawnTimer = Math.max(0.25, 1.1 - wave * 0.07);
      }
    } else if (enemies.length === 0) {
      score += wave * 50;
      addFloatText(W / 2, H / 2 + 60, `WAVE CLEAR +${wave * 50}`, "#3dff7a");
      nextWave();
    }

    // --- Bullets ---
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    bullets = bullets.filter((b) => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);

    for (const b of enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (dist(b, player) < b.r + player.r) {
        b.life = 0;
        damagePlayer(10);
      }
    }
    enemyBullets = enemyBullets.filter((b) => b.life > 0);

    // --- Enemies ---
    for (const e of enemies) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.wobble += dt * 4;

      if (e.type === "shooter") {
        // Keep a distance and shoot
        const desired = 260;
        const dir = d > desired + 30 ? 1 : d < desired - 30 ? -1 : 0;
        e.x += (dx / d) * e.speed * dir * dt + (-dy / d) * e.speed * 0.5 * dt;
        e.y += (dy / d) * e.speed * dir * dt + (dx / d) * e.speed * 0.5 * dt;
        e.shootTimer -= dt;
        if (e.shootTimer <= 0 && e.x > 0 && e.x < W && e.y > 0 && e.y < H) {
          e.shootTimer = rand(1.4, 2.4);
          const a = Math.atan2(dy, dx);
          enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, r: 6, life: 4 });
        }
      } else {
        const wob = e.type === "runner" ? Math.sin(e.wobble) * 0.6 : 0;
        const ang = Math.atan2(dy, dx) + wob;
        e.x += Math.cos(ang) * e.speed * dt;
        e.y += Math.sin(ang) * e.speed * dt;
      }
      e.flash = Math.max(0, e.flash - dt);

      // Touch damage
      if (d < e.r + player.r) {
        damagePlayer(e.damage);
        // knock enemy back
        e.x -= (dx / d) * 40;
        e.y -= (dy / d) * 40;
      }

      // Bullet hits
      for (const b of bullets) {
        if (b.life > 0 && dist(b, e) < b.r + e.r) {
          b.life = 0;
          e.hp--;
          e.flash = 0.08;
          e.x -= (dx / d) * 6;
          e.y -= (dy / d) * 6;
          particles.push(makeParticle(b.x, b.y, e.color, 180, 0.25));
          sfx.hit();
          if (e.hp <= 0) break;
        }
      }
    }

    // Separate overlapping enemies a little
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const a = enemies[i];
        const b = enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const overlap = a.r + b.r - d;
        if (overlap > 0) {
          a.x -= (dx / d) * overlap * 0.5;
          a.y -= (dy / d) * overlap * 0.5;
          b.x += (dx / d) * overlap * 0.5;
          b.y += (dy / d) * overlap * 0.5;
        }
      }
    }

    // Dead enemies
    enemies = enemies.filter((e) => {
      if (e.hp > 0) return true;
      score += e.score;
      addFloatText(e.x, e.y, `+${e.score}`, e.color);
      explode(e.x, e.y, e.color, e.type === "tank" ? 40 : 20);
      shake = Math.max(shake, e.type === "tank" ? 12 : 5);
      sfx.explode();
      if (Math.random() < 0.12) dropPowerup(e.x, e.y);
      return false;
    });

    // --- Powerups ---
    for (const p of powerups) {
      p.life -= dt;
      p.bob += dt * 4;
      if (dist(p, player) < p.r + player.r) {
        p.life = 0;
        applyPowerup(p.type);
      }
    }
    powerups = powerups.filter((p) => p.life > 0);

    // --- Particles & texts ---
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const t of floatTexts) {
      t.y -= 40 * dt;
      t.life -= dt;
    }
    floatTexts = floatTexts.filter((t) => t.life > 0);

    shake = Math.max(0, shake - dt * 30);

    if (player.hp <= 0) gameOver();
  }

  function damagePlayer(amount) {
    if (player.invuln > 0) return;
    if (player.shield > 0) {
      player.invuln = 0.3;
      explode(player.x, player.y, "#b38cff", 8, 150);
      return;
    }
    player.hp -= amount;
    player.invuln = 0.6;
    shake = 14;
    explode(player.x, player.y, "#ff2e88", 14, 200);
    sfx.hurt();
  }

  function dropPowerup(x, y) {
    const types = Object.keys(POWERUPS);
    const type = types[Math.floor(Math.random() * types.length)];
    powerups.push({ x, y, r: 12, type, life: 10, bob: 0 });
  }

  function applyPowerup(type) {
    sfx.pickup();
    const c = POWERUPS[type].color;
    explode(player.x, player.y, c, 16, 200);
    if (type === "health") {
      player.hp = Math.min(player.maxHp, player.hp + 30);
      addFloatText(player.x, player.y - 30, "+30 HP", c);
    } else if (type === "rapid") {
      player.rapid = 8;
      addFloatText(player.x, player.y - 30, "RAPID FIRE", c);
    } else if (type === "spread") {
      player.spread = 8;
      addFloatText(player.x, player.y - 30, "SPREAD SHOT", c);
    } else if (type === "shield") {
      player.shield = 6;
      addFloatText(player.x, player.y - 30, "SHIELD", c);
    }
  }

  // ---------- Draw ----------
  function drawBackground(time) {
    ctx.fillStyle = "#07070f";
    ctx.fillRect(0, 0, W, H);

    // Neon grid
    const size = 50;
    const offset = (time * 0.01) % size;
    ctx.strokeStyle = "rgba(0, 240, 255, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -offset; x < W; x += size) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = -offset; y < H; y += size) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  function glowCircle(x, y, r, color, blur = 15) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPlayer() {
    const p = player;
    if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) return; // blink

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // gun barrel
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "#9ffbff";
    ctx.fillRect(p.r - 4, -4, 18, 8);

    // body
    ctx.fillStyle = "#00f0ff";
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fill();

    // core
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#07070f";
    ctx.beginPath();
    ctx.arc(0, 0, p.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (p.shield > 0) {
      ctx.strokeStyle = `rgba(179, 140, 255, ${0.5 + Math.sin(performance.now() / 100) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#b38cff";
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // reload ring
    if (p.reloading > 0) {
      const prog = 1 - p.reloading / p.reloadTime;
      ctx.strokeStyle = "#ffe14d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 18, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawEnemy(e) {
    const color = e.flash > 0 ? "#ffffff" : e.color;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    if (e.type === "chaser") {
      ctx.rotate(e.wobble * 0.5);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
      }
      ctx.closePath();
      ctx.fill();
    } else if (e.type === "runner") {
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(e.r * 1.4, 0);
      ctx.lineTo(-e.r, -e.r);
      ctx.lineTo(-e.r * 0.4, 0);
      ctx.lineTo(-e.r, e.r);
      ctx.closePath();
      ctx.fill();
    } else if (e.type === "tank") {
      ctx.rotate(e.wobble * 0.15);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#07070f";
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === "shooter") {
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      ctx.rotate(a);
      ctx.fillRect(e.r - 4, -3, 14, 6);
      ctx.beginPath();
      ctx.moveTo(e.r, 0);
      ctx.lineTo(0, -e.r);
      ctx.lineTo(-e.r, 0);
      ctx.lineTo(0, e.r);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // HP bar for tougher enemies
    if (e.maxHp > 2 && e.hp < e.maxHp) {
      const w = e.r * 2;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 4);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * (e.hp / e.maxHp), 4);
    }
  }

  function drawPowerup(p) {
    if (p.life < 3 && Math.floor(p.life * 8) % 2 === 0) return; // blink before vanishing
    const c = POWERUPS[p.type].color;
    const y = p.y + Math.sin(p.bob) * 4;
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.shadowColor = c;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(p.x, y, p.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = c;
    ctx.font = "bold 14px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(POWERUPS[p.type].label, p.x, y + 1);
  }

  function drawCrosshair() {
    const { x, y } = mouse;
    ctx.strokeStyle = "#ff2e88";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#ff2e88";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function draw(time) {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    drawBackground(time);

    for (const p of powerups) drawPowerup(p);

    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const b of bullets) glowCircle(b.x, b.y, b.r, "#9ffbff", 12);
    for (const b of enemyBullets) glowCircle(b.x, b.y, b.r, "#ff8c1a", 14);
    for (const e of enemies) drawEnemy(e);
    if (player && state !== "over") drawPlayer();

    ctx.font = "bold 16px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    for (const t of floatTexts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
    if (state === "playing") drawCrosshair();
  }

  // ---------- HUD ----------
  function updateHud() {
    ui.score.textContent = score;
    ui.wave.textContent = wave;
    ui.ammo.textContent = player.reloading > 0 ? "--" : player.ammo;
    ui.ammoMax.textContent = player.maxAmmo;
    ui.health.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;

    const active = [];
    if (player.rapid > 0) active.push(`RAPID ${player.rapid.toFixed(0)}s`);
    if (player.spread > 0) active.push(`SPREAD ${player.spread.toFixed(0)}s`);
    if (player.shield > 0) active.push(`SHIELD ${player.shield.toFixed(0)}s`);
    ui.powerup.textContent = active.join(" · ");
  }

  // ---------- Flow ----------
  function startGame() {
    resetGame();
    state = "playing";
    ui.start.classList.add("hidden");
    ui.over.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.hud.classList.remove("hidden");
    canvas.style.cursor = "none";
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      ui.pause.classList.remove("hidden");
      canvas.style.cursor = "default";
    } else if (state === "paused") {
      state = "playing";
      ui.pause.classList.add("hidden");
      canvas.style.cursor = "none";
      lastTime = performance.now();
    }
  }

  function gameOver() {
    state = "over";
    mouse.down = false;
    explode(player.x, player.y, "#00f0ff", 60, 400);
    if (score > best) {
      best = score;
      saveBest(best);
    }
    ui.finalScore.textContent = score;
    ui.finalWave.textContent = wave;
    ui.bestOver.textContent = best;
    ui.bestStart.textContent = best;
    ui.hud.classList.add("hidden");
    ui.over.classList.remove("hidden");
    canvas.style.cursor = "default";
  }

  $("start-btn").addEventListener("click", startGame);
  $("restart-btn").addEventListener("click", startGame);
  $("resume-btn").addEventListener("click", togglePause);

  ui.bestStart.textContent = loadBest();

  // ---------- Main loop ----------
  function loop(time) {
    const dt = Math.min(0.033, (time - lastTime) / 1000 || 0);
    lastTime = time;

    if (state === "playing") {
      update(dt);
      if (state === "playing") updateHud();
    } else if (state === "over") {
      // let the final explosion play out
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.life -= dt;
      }
      particles = particles.filter((p) => p.life > 0);
    }

    if (state === "menu") {
      drawBackground(time);
    } else {
      draw(time);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
