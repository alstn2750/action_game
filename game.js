(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, FLOOR = 608;
  const $ = (s) => document.querySelector(s);
  const screens = { menu: $("#menu"), pause: $("#pause"), result: $("#result"), upgrade: $("#upgrade") };
  const keys = new Set(), pressed = new Set();
  const backgrounds = ["assets/neon-rooftop.png", "assets/neon-metro.png", "assets/neon-sky-garden.png", "assets/neon-fortress.png"];
  const bg = new Image(); bg.src = backgrounds[0];
  let state = "menu", last = performance.now(), time = 0, shake = 0, flash = 0, muted = false, focusTimer = 0, shockwaves = [];
  let player, enemies = [], projectiles = [], particles = [], texts = [], wave = 0, spawnQueue = [], spawnClock = 0;
  let score = 0, kills = 0, maxCombo = 0, waveBanner = 0, bossMode = false, ultimateMode = "nova", bossCount = 0, TOTAL_WAVES = 6;
  const bossWaves = new Set([2, 4, 6]);
  let bestWave = 0;
  try { bestWave = Number(localStorage.getItem("stickbreak-best-wave") || 0); } catch (_) { bestWave = 0; }

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const down = (...names) => names.some((n) => keys.has(n));
  const tap = (...names) => names.some((n) => pressed.has(n));

  class AudioEngine {
    constructor() { this.ctx = null; }
    init() {
      if (!this.ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        try { this.ctx = new AudioCtor(); } catch (_) { return; }
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    }
    tone(freq, duration, type = "square", volume = .035, slide = 0) {
      if (muted) return;
      this.init();
      if (!this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), this.ctx.currentTime + duration);
      g.gain.setValueAtTime(volume, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, this.ctx.currentTime + duration);
      o.connect(g).connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + duration);
    }
    hit(heavy = false) { this.tone(heavy ? 85 : 130, heavy ? .16 : .09, "sawtooth", heavy ? .07 : .035, -50); }
    jump() { this.tone(180, .12, "square", .025, 160); }
    shoot() { this.tone(540, .1, "sawtooth", .025, -270); }
    pickup() { this.tone(420, .18, "sine", .035, 440); }
  }
  const audio = new AudioEngine();

  class Player {
    constructor() {
      Object.assign(this, { x: 185, y: FLOOR - 86, w: 42, h: 86, vx: 0, vy: 0, face: 1, grounded: true, jumps: 2,
        hp: 100, energy: 100, inv: 0, dash: 0, dashCd: 0, shockCd: 0, focusCd: 0, ultimateCd: 0, attack: 0, attackStep: 0, combo: 0, comboTimer: 0, shootCd: 0, dead: false });
    }
    update(dt) {
      this.inv -= dt; this.dashCd -= dt; this.shockCd -= dt; this.focusCd -= dt; this.ultimateCd -= dt; this.shootCd -= dt; this.comboTimer -= dt; focusTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
      this.energy = Math.min(100, this.energy + 12 * dt);
      const move = (down("KeyA", "ArrowLeft") ? -1 : 0) + (down("KeyD", "ArrowRight") ? 1 : 0);
      if (move) this.face = move;
      if (tap("ShiftLeft", "ShiftRight") && this.dashCd <= 0 && move) {
        this.dash = .18; this.dashCd = .72; this.inv = Math.max(this.inv, .22); this.vx = move * 900; shake = 4;
        burst(this.x + this.w / 2, this.y + this.h * .65, "#62f5ff", 11, 280);
        audio.tone(110, .16, "sawtooth", .04, 200);
      }
      if (tap("Space", "KeyW", "ArrowUp") && this.jumps > 0) {
        this.vy = -650; this.grounded = false; this.jumps--; audio.jump();
        burst(this.x + this.w / 2, this.y + this.h, "#d8fbff", 7, 120);
      }
      if (tap("KeyJ") && this.attack <= 0) {
        this.attackStep = this.attackStep % 3 + 1; this.attack = this.attackStep === 3 ? .32 : .22;
        audio.tone(this.attackStep === 3 ? 105 : 145, .09, "sawtooth", .028, 80);
      }
      if (tap("KeyK") && this.shootCd <= 0 && this.energy >= 25) {
        this.energy -= 25; this.shootCd = .34;
        projectiles.push({ x: this.x + this.w / 2 + this.face * 32, y: this.y + 31, vx: this.face * 760, r: 11, friendly: true, life: 1.3, damage: 18 });
        burst(this.x + this.w / 2 + this.face * 30, this.y + 32, "#62f5ff", 9, 180); audio.shoot();
      }
      if (tap("KeyQ") && this.shockCd <= 0 && this.energy >= 35) this.shockwave();
      if (tap("KeyE") && this.focusCd <= 0 && this.energy >= 30) {
        this.energy -= 30; this.focusCd = 8; focusTimer = 4; burst(this.x+21,this.y+40,"#b56cff",28,420); audio.tone(280,.35,"sine",.05,500);
      }
      if (tap("KeyX") && this.ultimateCd <= 0 && this.energy >= 100) this.ultimate();
      if (this.dash > 0) this.dash -= dt;
      else this.vx += (move * 370 - this.vx) * Math.min(1, 13 * dt);
      this.vy += 1700 * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.y + this.h >= FLOOR) { this.y = FLOOR - this.h; this.vy = 0; this.grounded = true; this.jumps = 2; }
      this.x = clamp(this.x, 24, W - this.w - 24);
      if (this.attack > 0) {
        const old = this.attack; this.attack -= dt;
        const active = this.attackStep === 3 ? old < .25 && old > .08 : old < .17 && old > .05;
        if (active) this.strike();
      }
    }
    shockwave() {
      this.energy -= 35; this.shockCd = 4; shockwaves.push({x:this.x+this.w/2,y:FLOOR-34,r:30,life:.55,max:.55,color:"#62f5ff"});
      enemies.forEach(e=>{if(!e.dead && Math.abs(e.x+e.w/2-(this.x+21))<245){e.hurt(34,this.face*520);addCombo(e.x+e.w/2,e.y);}});
      burst(this.x+21,FLOOR-28,"#62f5ff",35,500);shake=16;audio.tone(72,.3,"sawtooth",.07,350);
    }
    ultimate() {
      this.energy=0; this.ultimateCd=12;
      const x=this.x+21, y=this.y+38;
      if (ultimateMode === "chain") {
        let targets=enemies.filter(e=>!e.dead).sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x)).slice(0,5);
        targets.forEach((e,i)=>{setTimeout(()=>{if(!e.dead){e.hurt(58,this.face*520);burst(e.x+e.w/2,e.y+35,"#ffcc59",18,260);}},i*100);});
        shockwaves.push({x,y,r:20,life:.75,max:.75,color:"#ffcc59"}); burst(x,y,"#ffcc59",46,580); audio.tone(260,.5,"square",.07,620);
      } else if (ultimateMode === "rewind") {
        focusTimer=5; enemies.forEach(e=>{if(!e.dead)e.hurt(64,this.face*650);});
        shockwaves.push({x,y,r:20,life:1.5,max:1.5,color:"#d794ff"}); burst(x,y,"#d794ff",64,640); audio.tone(190,.8,"sine",.09,780);
      } else {
        enemies.forEach(e=>{if(!e.dead)e.hurt(105,this.face*720);});
        shockwaves.push({x,y,r:20,life:1.1,max:1.1,color:"#ff3fa4"}); burst(x,y,"#ff3fa4",70,700); audio.tone(42,.8,"sawtooth",.1,520);
      }
      shake=24;flash=.14;
    }
    strike() {
      const reach = this.attackStep === 3 ? 102 : 78;
      const box = { x: this.face > 0 ? this.x + this.w - 4 : this.x - reach + 4, y: this.y + 8, w: reach, h: 69 };
      enemies.forEach((e) => {
        if (!e.dead && !e.hitLock && hit(box, e)) {
          e.hitLock = .13; e.hurt((this.attackStep === 3 ? 26 : 14) + Math.min(12, this.combo), this.face * (this.attackStep === 3 ? 430 : 260));
          addCombo(e.x + e.w / 2, e.y); shake = this.attackStep === 3 ? 9 : 4; audio.hit(this.attackStep === 3);
        }
      });
    }
    hurt(dmg, from) {
      if (this.inv > 0 || this.dead) return;
      this.hp -= dmg; this.inv = .8; this.vx = from * 360; this.vy = -270; shake = 12; flash = .09; audio.hit(true);
      burst(this.x + this.w / 2, this.y + 35, "#ff3fa4", 15, 310);
      texts.push({ x: this.x + 20, y: this.y, text: `-${dmg}`, color: "#ff6bad", life: .8 });
      if (this.hp <= 0) { this.dead = true; setTimeout(() => finish(false), 650); }
    }
    draw() {
      if (this.inv > 0 && Math.floor(this.inv * 18) % 2) return;
      const x = this.x + this.w / 2, y = this.y, f = this.face;
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#ddfbff"; ctx.fillStyle = "#07101b"; ctx.lineWidth = 7;
      ctx.shadowColor = this.dash > 0 ? "#62f5ff" : "#07101b"; ctx.shadowBlur = this.dash > 0 ? 25 : 4;
      if (this.dash > 0) { ctx.globalAlpha = .25; for (let i=1;i<4;i++) stickBody(x - f*i*19, y+8, f, this, true); ctx.globalAlpha = 1; }
      stickBody(x, y, f, this, false);
      if (this.attack > 0) { const reach=this.attackStep===3?108:82; ctx.globalAlpha=.7;ctx.strokeStyle=this.attackStep===3?"#ff3fa4":"#62f5ff";ctx.lineWidth=5;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=18;ctx.beginPath();ctx.arc(x+f*8,y+41,reach,.22*Math.PI, .78*Math.PI);ctx.stroke(); }
      ctx.restore();
    }
  }

  function stickBody(x, y, f, p, ghost) {
    const run = Math.sin(time * 18) * Math.min(1, Math.abs(p.vx) / 250), air = !p.grounded;
    const accent = p.dash > 0 ? "#ffffff" : "#62f5ff";
    ctx.fillStyle="#050b18";ctx.beginPath();ctx.arc(x,y+14,15,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y+14,10,Math.PI*.12,Math.PI*.88);ctx.stroke();
    ctx.fillStyle="#62f5ff";ctx.fillRect(x+f*3,y+10,7,3);
    ctx.strokeStyle="#ddfbff";ctx.lineWidth=7;ctx.beginPath(); ctx.moveTo(x, y + 29); ctx.lineTo(x, y + 60);
    let handX = x + f * 24, handY = y + 49;
    if (p.attack > 0) { const swing = Math.sin((p.attack / (p.attackStep === 3 ? .32 : .22)) * Math.PI); handX = x + f * (35 + swing * 38); handY = y + 38 - swing * 21; }
    ctx.moveTo(x, y + 37); ctx.lineTo(handX, handY);
    ctx.moveTo(x, y + 37); ctx.lineTo(x - f * 20, y + 50 + run * 4);
    ctx.moveTo(x, y + 60); ctx.lineTo(x + (air ? -f*9 : f*16*run), y + 83);
    ctx.moveTo(x, y + 60); ctx.lineTo(x + (air ? f*13 : -f*16*run), y + 83); ctx.stroke();
    ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-f*9,y+31);ctx.lineTo(x+f*9,y+31);ctx.moveTo(x-f*5,y+59);ctx.lineTo(x+f*5,y+59);ctx.stroke();
    if (!ghost) { ctx.fillStyle="#ff3fa4";ctx.beginPath();ctx.arc(x,y+43,3,0,Math.PI*2);ctx.fill(); }
  }

  class Enemy {
    constructor(type, x) {
      const data = {
        grunt: [48, 82, 45, 118, 10, "#ff4a9c"], runner: [40, 72, 30, 205, 8, "#ffbe4a"],
        brute: [68, 108, 120, 80, 18, "#a77bff"], boss: [105, 154, 520, 115, 23, "#ff255e"]
      }[type];
      Object.assign(this, { type, x, y: FLOOR-data[1], w:data[0], h:data[1], hp:data[2], maxHp:data[2], speed:data[3], damage:data[4], color:data[5], vx:0,
        cooldown:rnd(.3,1), hitLock:0, dead:false, face:-1, phase:0, shootClock:2 });
    }
    update(dt) {
      this.hitLock -= dt; this.cooldown -= dt; this.shootClock -= dt;
      if (this.dead) { this.vx *= .94; this.x += this.vx * dt; return; }
      const dx = (player.x + player.w/2) - (this.x + this.w/2), dist = Math.abs(dx); this.face = Math.sign(dx) || this.face;
      if (this.type === "boss") this.bossAI(dt, dx, dist);
      else {
        const preferred = this.type === "brute" ? 66 : 45;
        if (dist > preferred) this.vx += (this.face*this.speed-this.vx)*Math.min(1,7*dt); else this.vx *= .75;
        if (dist < this.w*.65 + 35 && this.cooldown <= 0) this.attack();
      }
      this.x += this.vx * dt; this.x = clamp(this.x, 16, W-this.w-16);
    }
    bossAI(dt, dx, dist) {
      this.phase = this.hp < this.maxHp*.5 ? 1 : 0;
      if (dist > 105) this.vx += (this.face*this.speed*(this.phase?1.45:1)-this.vx)*Math.min(1,5*dt); else this.vx *= .82;
      if (dist < 150 && this.cooldown <= 0) { this.attack(); this.cooldown = this.phase ? .62 : .9; }
      if (this.shootClock <= 0) {
        this.shootClock = this.phase ? 1.45 : 2.2;
        for (let i=-1; i<=1; i++) projectiles.push({ x:this.x+this.w/2, y:this.y+48, vx:this.face*(360+Math.abs(i)*40), vy:i*125, r:13, friendly:false, life:2.8, damage:10 });
        audio.tone(70,.35,"sawtooth",.05,180); shake=5;
      }
    }
    attack() {
      this.cooldown = this.type === "runner" ? .75 : this.type === "brute" ? 1.35 : 1;
      const reach = this.type === "brute" ? 80 : 52;
      if (Math.abs((player.x+player.w/2)-(this.x+this.w/2)) < this.w/2+reach) player.hurt(this.damage, this.face);
    }
    hurt(dmg, force) {
      this.hp -= dmg; this.vx = force; burst(this.x+this.w/2,this.y+this.h*.4,this.color,10,250);
      texts.push({x:this.x+this.w/2,y:this.y,text:`${dmg}`,color:"#fff",life:.65});
      if (this.hp <= 0) {
        this.dead=true; kills++; score += Math.round((this.type==="boss"?3000:this.maxHp*12)*(1+player.combo*.025));
        burst(this.x+this.w/2,this.y+this.h/2,this.color,this.type==="boss"?42:22,this.type==="boss"?520:360);
        if (this.type === "boss") {
          bossCount++;
          const currentFile = bg.src.split("/").pop();
          const choices = backgrounds.filter(path => !path.endsWith(currentFile));
          bg.src = choices[Math.floor(Math.random() * choices.length)];
          setTimeout(showUpgrade,700);
        }
      }
    }
    draw() {
      const x=this.x+this.w/2,y=this.y, s=this.type==="boss"?1.5:this.type==="brute"?1.2:1;
      ctx.save(); ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=this.dead?"#4a5261":this.color;ctx.lineWidth=6*s;ctx.globalAlpha=this.dead?.35:1;
      ctx.shadowColor=this.color;ctx.shadowBlur=this.type==="boss"?18:7;
      ctx.beginPath();ctx.arc(x,y+14*s,12*s,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x,y+27*s);ctx.lineTo(x,y+58*s);ctx.moveTo(x,y+36*s);ctx.lineTo(x+this.face*24*s,y+49*s);ctx.moveTo(x,y+36*s);ctx.lineTo(x-this.face*19*s,y+49*s);ctx.moveTo(x,y+58*s);ctx.lineTo(x+15*s,y+80*s);ctx.moveTo(x,y+58*s);ctx.lineTo(x-15*s,y+80*s);ctx.stroke();
      if(this.type==="brute"||this.type==="boss"){ctx.lineWidth=3;ctx.strokeStyle="#fff";ctx.beginPath();ctx.arc(x,y+14*s,18*s,Math.PI,Math.PI*2);ctx.stroke();}
      ctx.restore();
      if (!this.dead && (this.hp < this.maxHp || this.type==="boss")) {
        const bw=this.type==="boss"?110:this.w; ctx.fillStyle="#141927";ctx.fillRect(x-bw/2,y-18,bw,5);ctx.fillStyle=this.color;ctx.fillRect(x-bw/2,y-18,bw*this.hp/this.maxHp,5);
      }
    }
  }

  function addCombo(x,y) { player.combo++; player.comboTimer=2.2; maxCombo=Math.max(maxCombo,player.combo); score+=50*player.combo; texts.push({x,y:y-12,text:`${player.combo} HIT`,color:"#62f5ff",life:.7}); }
  function burst(x,y,color,count=10,power=200){ for(let i=0;i<count;i++)particles.push({x,y,vx:rnd(-power,power),vy:rnd(-power,power),life:rnd(.25,.65),max:.65,size:rnd(2,7),color}); }

  function startGame() {
    audio.init(); state="playing"; Object.values(screens).forEach(s=>s.classList.remove("active"));
    player=new Player(); enemies=[];projectiles=[];particles=[];texts=[];shockwaves=[];focusTimer=0;wave=0;score=0;kills=0;maxCombo=0;bossMode=false;bossCount=0;ultimateMode="nova";bg.src=backgrounds[0];
    nextWave(); canvas.focus();
  }

  function nextWave() {
    wave++; waveBanner=2.3; spawnClock=.2;
    if (wave > bestWave) {
      bestWave = wave;
      try { localStorage.setItem("stickbreak-best-wave", String(bestWave)); } catch (_) { /* private browsing */ }
      updateBestWave();
    }
    const plans = [[], ["grunt","grunt","runner"], ["boss"], ["grunt","runner","runner","brute"], ["boss"], ["brute","grunt","brute","runner","runner"], ["boss"]];
    spawnQueue = [...plans[wave]]; bossMode=bossWaves.has(wave);
  }

  function spawn(type) {
    // 전투가 시작되는 즉시 적의 실루엣이 보이도록 옥상 안쪽에서 등장시킵니다.
    const left = Math.random()<.5; enemies.push(new Enemy(type,left ? rnd(430, 610) : rnd(760, 1010)));
  }

  function finish(win) {
    if (state!=="playing") return; state="result";
    const rank = win ? (player.hp>70&&maxCombo>=12?"S":player.hp>35?"A":"B") : "D";
    $("#result-rank").textContent=rank; $("#result-title").textContent=win?"옥상 평정 완료":"작전 실패";
    $("#result-label").textContent=win?"MISSION // COMPLETE":"MISSION // FAILED";
    $("#final-score").textContent=score.toLocaleString();$("#final-combo").textContent=maxCombo;$("#final-kills").textContent=kills;$("#final-best-wave").textContent=bestWave;
    screens.result.classList.add("active");
  }

  function updateBestWave() {
    const el = $("#best-wave");
    if (el) el.textContent = `WAVE ${String(bestWave).padStart(2, "0")}`;
  }

  function showUpgrade() {
    if (state !== "playing") return;
    state = "upgrade";
    $("#upgrade").classList.add("active");
    document.querySelectorAll(".upgrade-card").forEach((card, i) => { card.style.animationDelay = `${i * 90}ms`; });
  }

  function chooseUltimate(mode) {
    if (state !== "upgrade") return;
    ultimateMode = mode;
    $("#upgrade").classList.remove("active");
    score += 1500;
    state = "playing";
    setTimeout(() => bossCount >= 3 ? finish(true) : nextWave(), 500);
  }

  function togglePause() {
    if(state==="playing"){state="paused";screens.pause.classList.add("active");}
    else if(state==="paused"){state="playing";screens.pause.classList.remove("active");canvas.focus();last=performance.now();}
  }

  function update(dt) {
    time+=dt; flash-=dt; if(shake>0)shake=Math.max(0,shake-34*dt); waveBanner-=dt;
    player.update(dt);
    if(spawnQueue.length){spawnClock-=dt;if(spawnClock<=0){spawn(spawnQueue.shift());spawnClock=bossMode?1.2:.75;}}
    enemies.forEach(e=>e.update(dt * (focusTimer > 0 ? .32 : 1)));
    projectiles.forEach(p=>{
      p.life-=dt;p.x+=p.vx*dt;p.y+=(p.vy||0)*dt;
      if(p.friendly){enemies.forEach(e=>{if(!e.dead&&p.life>0&&p.x>e.x&&p.x<e.x+e.w&&p.y>e.y&&p.y<e.y+e.h){e.hurt(p.damage,Math.sign(p.vx)*230);p.life=0;addCombo(p.x,p.y);audio.hit();}});}
      else if(p.life>0&&p.x>player.x&&p.x<player.x+player.w&&p.y>player.y&&p.y<player.y+player.h){player.hurt(p.damage,Math.sign(p.vx));p.life=0;}
    });
    projectiles=projectiles.filter(p=>p.life>0&&p.x>-50&&p.x<W+50&&p.y>-50&&p.y<H+50);
    particles.forEach(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.96;p.vy=p.vy*.96+500*dt;});particles=particles.filter(p=>p.life>0);
    texts.forEach(t=>{t.life-=dt;t.y-=35*dt;});texts=texts.filter(t=>t.life>0);
    shockwaves.forEach(s=>{s.life-=dt;s.r+=dt*520;});shockwaves=shockwaves.filter(s=>s.life>0);
    enemies=enemies.filter(e=>!e.dead||e.hitLock>-.65);
    if(!spawnQueue.length&&!enemies.some(e=>!e.dead)&&wave<TOTAL_WAVES) setTimeout(()=>{if(state==="playing"&&!spawnQueue.length&&!enemies.some(e=>!e.dead))nextWave();},500);
  }

  function drawBackground() {
    // 이미지가 로컬 파일/차단 환경에서 실패해도 Canvas 렌더링은 계속합니다.
    if (bg.complete && bg.naturalWidth > 0) ctx.drawImage(bg,0,0,W,H);
    else {
      const fallback = ctx.createLinearGradient(0,0,0,H); fallback.addColorStop(0,"#071838"); fallback.addColorStop(.6,"#091329"); fallback.addColorStop(1,"#03050d");
      ctx.fillStyle=fallback;ctx.fillRect(0,0,W,H);
      ctx.fillStyle="#183a5d88"; for(let i=0;i<18;i++){const bh=80+(i*37)%180;ctx.fillRect(i*82,FLOOR-bh,54,bh);}
    }
    const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,"#03081511");grad.addColorStop(.55,"#02050a22");grad.addColorStop(1,"#02040bbb");ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#62f5ff33";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,FLOOR+2);ctx.lineTo(W,FLOOR+2);ctx.stroke();
    ctx.strokeStyle="#62f5ff16";ctx.lineWidth=1;
    for(let x=-H;x<W+H;x+=64){ctx.beginPath();ctx.moveTo(W/2+(x-W/2)*.22,FLOOR);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=FLOOR+18;y<H;y+=24){ctx.globalAlpha=Math.max(.05,1-(y-FLOOR)/130);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}ctx.globalAlpha=1;
  }

  function drawHUD() {
    ctx.save();
    ctx.fillStyle="#040814cc";ctx.fillRect(28,26,310,76);ctx.strokeStyle="#455468";ctx.strokeRect(28.5,26.5,310,76);
    ctx.font="700 12px JetBrains Mono";ctx.fillStyle="#fff";ctx.fillText("PLAYER // ZERO",46,49);
    ctx.fillStyle="#202a38";ctx.fillRect(46,61,260,11);ctx.fillStyle=player.hp>30?"#ff3fa4":"#ff334d";ctx.fillRect(46,61,260*Math.max(0,player.hp)/100,11);
    ctx.fillStyle="#202a38";ctx.fillRect(46,80,220,6);ctx.fillStyle="#62f5ff";ctx.fillRect(46,80,220*player.energy/100,6);
    const skills=[['Q','충격파',player.shockCd,4,'#62f5ff'],['E','집중',player.focusCd,8,'#b56cff'],['X','필살',player.ultimateCd,12,'#ff3fa4']];
    skills.forEach((s,i)=>{const x=28+i*92,y=116;ctx.fillStyle="#050a15dd";ctx.fillRect(x,y,82,38);ctx.strokeStyle=s[4];ctx.globalAlpha=.8;ctx.strokeRect(x+.5,y+.5,81,37);ctx.globalAlpha=1;ctx.fillStyle=s[4];ctx.font="700 14px JetBrains Mono";ctx.textAlign="left";ctx.fillText(s[0],x+9,y+16);ctx.fillStyle="#d6e4ed";ctx.font="700 9px Noto Sans KR";ctx.fillText(s[1],x+30,y+15);ctx.fillStyle="#617084";ctx.font="700 8px JetBrains Mono";ctx.fillText(s[2]>0?`${s[2].toFixed(1)}s`:s[0]==='X'&&player.energy<100?'ENERGY':'READY',x+30,y+29);});
    ctx.textAlign="right";ctx.font="700 13px JetBrains Mono";ctx.fillStyle="#a7b8c8";ctx.fillText(`WAVE ${Math.min(wave,TOTAL_WAVES)} / ${TOTAL_WAVES}`,W-36,45);
    ctx.font="700 9px JetBrains Mono";ctx.fillStyle="#ffcc59";ctx.fillText(`BEST WAVE ${String(bestWave).padStart(2,"0")}`,W-36,58);
    ctx.fillStyle="#fff";ctx.font="700 25px JetBrains Mono";ctx.fillText(score.toString().padStart(7,"0"),W-36,76);
    if(player.combo>1){ctx.fillStyle="#62f5ff";ctx.font="700 42px Black Han Sans";ctx.fillText(`${player.combo} HIT`,W-37,126);ctx.fillStyle="#62f5ff55";ctx.fillRect(W-236,137,200*player.comboTimer/2.2,3);}
    if(bossMode){const boss=enemies.find(e=>e.type==="boss"&&!e.dead);if(boss){ctx.textAlign="center";ctx.font="700 12px JetBrains Mono";ctx.fillStyle="#fff";ctx.fillText("ROOFTOP TYRANT",W/2,42);ctx.fillStyle="#211522";ctx.fillRect(W/2-230,53,460,10);ctx.fillStyle="#ff255e";ctx.fillRect(W/2-230,53,460*boss.hp/boss.maxHp,10);}}
    if(waveBanner>0){const a=Math.min(1,waveBanner,2.3-waveBanner);ctx.globalAlpha=a;ctx.textAlign="center";ctx.fillStyle="#62f5ff";ctx.font="700 15px JetBrains Mono";ctx.fillText(bossMode?`BOSS ${bossCount+1} / 3`:
      "ENEMY SIGNAL DETECTED",W/2,250);ctx.fillStyle="#fff";ctx.font="400 70px Black Han Sans";ctx.fillText(bossMode?"옥상의 지배자":`WAVE 0${wave}`,W/2,318);}
    ctx.restore();
  }

  function render() {
    ctx.save(); const sx=shake?rnd(-shake,shake):0,sy=shake?rnd(-shake,shake):0;ctx.translate(sx,sy);drawBackground();
    if(state!=="menu"){
      shockwaves.forEach(s=>{ctx.save();ctx.globalAlpha=Math.max(0,s.life/s.max);ctx.strokeStyle=s.color;ctx.lineWidth=7;ctx.shadowColor=s.color;ctx.shadowBlur=28;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.stroke();ctx.restore();});
      projectiles.forEach(p=>{ctx.save();ctx.shadowColor=p.friendly?"#62f5ff":"#ff255e";ctx.shadowBlur=22;ctx.fillStyle=p.friendly?"#caffff":"#ff5b79";ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.restore();});
      enemies.forEach(e=>e.draw()); if(player)player.draw();
      particles.forEach(p=>{ctx.globalAlpha=clamp(p.life/p.max,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);});ctx.globalAlpha=1;
      texts.forEach(t=>{ctx.globalAlpha=clamp(t.life*2,0,1);ctx.textAlign="center";ctx.font="700 18px JetBrains Mono";ctx.fillStyle=t.color;ctx.fillText(t.text,t.x,t.y);});ctx.globalAlpha=1;
      drawHUD();
    }
    ctx.restore();if(flash>0){ctx.fillStyle="#ffffff77";ctx.fillRect(0,0,W,H);}
  }

  let lastUIState = null;
  function loop(now) {
    const dt=Math.min(.033,(now-last)/1000);last=now;if(state==="playing")update(dt);render();pressed.clear();
    if(state!==lastUIState){lastUIState=state;document.body.dataset.state=state;}
    requestAnimationFrame(loop);
  }

  function toggleFullscreen(){document.fullscreenElement?document.exitFullscreen():$("#game-frame").requestFullscreen();}
  function toggleMute(){muted=!muted;}

  addEventListener("keydown",e=>{
    if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code))e.preventDefault();
    if(!keys.has(e.code))pressed.add(e.code);keys.add(e.code);
    if(e.code==="Enter"&&(state==="menu"||state==="result"))startGame();
    if(e.code==="KeyP"&&(state==="playing"||state==="paused"))togglePause();
    if(e.code==="KeyR"&&state!=="menu")startGame();
    if(state==="upgrade" && ["Digit1","Digit2","Digit3"].includes(e.code)) chooseUltimate(["nova","chain","rewind"][Number(e.code.slice(-1))-1]);
    if(e.code==="KeyM")toggleMute();
    if(e.code==="KeyF")toggleFullscreen();
  });
  addEventListener("keyup",e=>keys.delete(e.code));addEventListener("blur",()=>{keys.clear();if(state==="playing")togglePause();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)keys.clear();});
  $("#start-btn").onclick=startGame;$("#retry-btn").onclick=startGame;$("#resume-btn").onclick=togglePause;$("#restart-pause-btn").onclick=startGame;
  $("#fullscreen-btn").onclick=toggleFullscreen;$("#mute-btn").onclick=toggleMute;
  document.querySelectorAll(".upgrade-card").forEach(card => card.addEventListener("click", () => chooseUltimate(card.dataset.ultimate)));

  document.querySelectorAll("#touch-controls .tbtn[data-key]").forEach(btn => {
    const code = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      btn.classList.add("active");
      audio.init();
      if (!keys.has(code)) pressed.add(code);
      keys.add(code);
      if (btn.id === "touch-pause" && (state === "playing" || state === "paused")) togglePause();
    };
    const release = (e) => { e.preventDefault(); btn.classList.remove("active"); keys.delete(code); };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  updateBestWave();
  requestAnimationFrame(loop);
})();
