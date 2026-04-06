/**
 * AudioManager
 * Все звуки pre-render'ятся в AudioBuffer при старте через OfflineAudioContext.
 * Голоса игрока и маньяка — MP3-файлы из /sounds/.
 */
export class AudioManager {
  constructor() {
    this.ctx     = null;
    this.enabled = true;
    this.muted   = false;
    this.ambientNodes   = null;
    this._lastHeartbeat = 0;
    this._buffers       = {};
    this._ambientTimer  = null;
    this._ambientPlaying = false;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
      return;
    }

    this._preloadAll();
    this._loadMp3s();
    this._loadAmbients();
  }

  get active() { return this.enabled && !this.muted && !!this.ctx; }

  // ─── Загрузка MP3 файлов ─────────────────────────────────────
  async _loadMp3s() {
    const files = {
      maniac_1: '/sounds/maniac_1.mp3',
      maniac_2: '/sounds/maniac_2.mp3',
      maniac_3: '/sounds/maniac_3.mp3',
      player_1: '/sounds/player_1.mp3',
      player_2: '/sounds/player_2.mp3',
    };
    await Promise.all(Object.entries(files).map(async ([name, url]) => {
      try {
        const res  = await fetch(url);
        const ab   = await res.arrayBuffer();
        this._buffers[name] = await this.ctx.decodeAudioData(ab);
      } catch (_) {}
    }));
  }

  // ─── Загрузка фоновых амбиент-звуков ─────────────────────────
  async _loadAmbients() {
    const files = {
      amb_laugh: '/sounds/ambient_laugh.m4a',
      amb_rage:  '/sounds/ambient_rage.m4a',
      amb_howl:  '/sounds/ambient_howl.m4a',
      amb_steps: '/sounds/ambient_steps.m4a',
    };
    await Promise.all(Object.entries(files).map(async ([name, url]) => {
      try {
        const res  = await fetch(url);
        const ab   = await res.arrayBuffer();
        this._buffers[name] = await this.ctx.decodeAudioData(ab);
      } catch (_) {}
    }));
  }

  // Запустить случайные фоновые звуки во время игры
  startAmbientSounds() {
    this._stopAmbientSounds();
    this._ambientPlaying = false;
    this._scheduleAmbient();
  }

  _scheduleAmbient() {
    // Пауза между звуками: 15–30 секунд ПОСЛЕ окончания предыдущего
    const delay = 15000 + Math.random() * 15000;
    this._ambientTimer = setTimeout(() => {
      if (!this.muted) this._playRandomAmbient();
      // Следующий запланируем только после окончания текущего (см. onended)
    }, delay);
  }

  _playRandomAmbient() {
    // Не запускаем если предыдущий ещё играет
    if (this._ambientPlaying || !this.active) return;

    const pool = ['amb_laugh', 'amb_rage', 'amb_howl', 'amb_steps']
      .filter((k) => !!this._buffers[k]);
    if (!pool.length) return;

    const name = pool[Math.floor(Math.random() * pool.length)];
    const buf  = this._buffers[name];
    try {
      this.resume();
      const src  = this.ctx.createBufferSource();
      src.buffer = buf;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.18;

      src.connect(gain);
      gain.connect(this.ctx.destination);

      this._ambientPlaying = true;
      src.onended = () => {
        this._ambientPlaying = false;
        // Планируем следующий только после окончания этого
        if (!this.muted) this._scheduleAmbient();
      };

      src.start(this.ctx.currentTime);
    } catch (_) {
      this._ambientPlaying = false;
      this._scheduleAmbient();
    }
  }

  _stopAmbientSounds() {
    if (this._ambientTimer) {
      clearTimeout(this._ambientTimer);
      this._ambientTimer = null;
    }
    this._ambientPlaying = false;
  }

  // ─── Pre-render всех звуков ───────────────────────────────────
  async _preloadAll() {
    const jobs = [
      ['growl',     1.2 + 2.0, (ctx) => this._buildGrowl(ctx)],
      ['noise',     0.35,      (ctx) => this._buildNoise(ctx)],
      ['step',      0.09,      (ctx) => this._buildStep(ctx)],
      ['heartbeat', 0.55,      (ctx) => this._buildHeartbeat(ctx)],
      ['win',       1.4,       (ctx) => this._buildWin(ctx)],
      ['lose',      2.0 + 1.0, (ctx) => this._buildLose(ctx)],
      ['breath',    0.6 + 1.5, (ctx) => this._buildBreath(ctx)],
      ['enraged',   1.8 + 2.0, (ctx) => this._buildEnraged(ctx)],
    ];

    await Promise.all(jobs.map(async ([name, dur, fn]) => {
      try {
        const sr      = 44100;
        const frames  = Math.ceil(sr * dur);
        const offline = new OfflineAudioContext(2, frames, sr);
        fn(offline);
        this._buffers[name] = await offline.startRendering();
      } catch (_) {}
    }));
  }

  // ─── Вспомогательные — строители звуков ─────────────────────

  _buildGrowl(ctx) {
    const now = 0, dur = 1.2;
    const rev = _reverbOffline(ctx, 2.0);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.linearRampToValueAtTime(42, now + dur);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(250);
    dist.oversample = '4x';

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(dist);
    dist.connect(rev);  rev.connect(gain);
    dist.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);

    // Металлический скрежет
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(280, now + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(60, now + 0.5);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, now + 0.1);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.2);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(g2); g2.connect(ctx.destination);
    osc2.start(now + 0.1); osc2.stop(now + 0.5);
  }

  _buildNoise(ctx) {
    const now = 0, dur = 0.3;
    const size = Math.floor(44100 * dur);
    const buf  = ctx.createBuffer(1, size, 44100);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 1.2);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  }

  _buildStep(ctx) {
    const now = 0, size = Math.floor(44100 * 0.07);
    const buf  = ctx.createBuffer(1, size, 44100);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      d[i] = (Math.random() * 2 - 1) * (1 - i / size);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0.2;
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(now);
  }

  _buildHeartbeat(ctx) {
    [0, 0.2].forEach((offset) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'sine'; osc.frequency.value = 50;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, offset);
      gain.gain.linearRampToValueAtTime(0.7, offset + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, offset + 0.28);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(offset); osc.stop(offset + 0.3);
    });
  }

  _buildWin(ctx) {
    [0, 0.18, 0.36, 0.6].forEach((t, i) => {
      const osc = ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = [440, 554, 660, 880][i];
      const g   = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.6);
    });
  }

  _buildLose(ctx) {
    const now = 0, dur = 1.8;
    const rev = _reverbOffline(ctx, 1.5);

    const osc  = ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + dur);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(220);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(dist);
    dist.connect(rev); rev.connect(gain);
    dist.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);
  }

  _buildEnraged(ctx) {
    const now = 0, dur = 1.8;
    const rev = _reverbOffline(ctx, 2.2);

    // Мощный нарастающий рёв
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(60, now);
    osc1.frequency.linearRampToValueAtTime(140, now + 0.3);
    osc1.frequency.linearRampToValueAtTime(55, now + dur);

    const dist1 = ctx.createWaveShaper();
    dist1.curve = distortionCurve(400);
    dist1.oversample = '4x';

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.7, now + 0.15);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc1.connect(dist1);
    dist1.connect(rev); rev.connect(gain1);
    dist1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now); osc1.stop(now + dur);

    // Высокочастотный скрим поверх
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(320, now + 0.1);
    osc2.frequency.linearRampToValueAtTime(180, now + 0.6);
    const dist2 = ctx.createWaveShaper();
    dist2.curve = distortionCurve(300);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.35, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(dist2); dist2.connect(gain2); gain2.connect(ctx.destination);
    osc2.start(now + 0.1); osc2.stop(now + 0.8);

    // Удар (низкий бум)
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(80, now);
    osc3.frequency.exponentialRampToValueAtTime(30, now + 0.4);
    const gain3 = ctx.createGain();
    gain3.gain.setValueAtTime(0.9, now);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc3.connect(gain3); gain3.connect(ctx.destination);
    osc3.start(now); osc3.stop(now + 0.4);
  }

  _buildBreath(ctx) {
    const now = 0, dur = 0.55;
    const rev = _reverbOffline(ctx, 1.5);

    // Шум дыхания
    const size = Math.floor(44100 * dur);
    const buf  = ctx.createBuffer(1, size, 44100);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      const env = Math.pow(Math.sin(Math.PI * i / size), 0.6);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(bp); bp.connect(hp);
    hp.connect(rev); rev.connect(gain);
    hp.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    // Стон-рык
    const osc  = ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.linearRampToValueAtTime(48, now + dur);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(350); dist.oversample = '4x';

    const gOsc = ctx.createGain();
    gOsc.gain.setValueAtTime(0, now);
    gOsc.gain.linearRampToValueAtTime(0.35, now + 0.15);
    gOsc.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(dist);
    dist.connect(rev); rev.connect(gOsc);
    dist.connect(gOsc);
    gOsc.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);
  }

  // ─── Воспроизведение pre-rendered буфера ─────────────────────
  _play(name, vol = 1) {
    if (!this.active) return;
    this.resume();
    const buf = this._buffers[name];
    if (!buf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (vol !== 1) {
        const g = this.ctx.createGain();
        g.gain.value = vol;
        src.connect(g); g.connect(this.ctx.destination);
      } else {
        src.connect(this.ctx.destination);
      }
      src.start(this.ctx.currentTime);
    } catch (_) {}
  }

  // ─── Публичные методы воспроизведения ────────────────────────
  playNoise() {
    this._play('noise');
    // MP3 крик игрока — запоминаем когда закончится (+400мс паузы)
    const mp3 = Math.random() < 0.5 ? 'player_1' : 'player_2';
    const buf = this._buffers[mp3];
    if (buf) {
      this._playerVoiceEnd = Date.now() + buf.duration * 1000 + 400;
      this._play(mp3);
    }
  }

  playManiacHear() {
    // Не запускаем пока предыдущая фраза ещё звучит
    if (this._maniacSpeaking) return;

    const waitMs = Math.max(0, (this._playerVoiceEnd || 0) - Date.now());
    const run = () => {
      if (this._maniacSpeaking) return; // повторная проверка после задержки
      const names = ['maniac_1', 'maniac_2', 'maniac_3'];
      const mp3   = names[Math.floor(Math.random() * names.length)];
      const buf   = this._buffers[mp3];
      if (buf) {
        this._maniacSpeaking = true;
        // Сбрасываем флаг когда звук закончится
        setTimeout(() => { this._maniacSpeaking = false; }, buf.duration * 1000 + 600);
        this._play(mp3);
      } else {
        this._play('growl');
      }
    };
    if (waitMs > 0) setTimeout(run, waitMs);
    else run();
  }

  playEnraged() {
    // Для ярости maniac_3 + синтезированный рёв поверх
    if (this._buffers['maniac_3']) this._play('maniac_3');
    this._play('enraged');
  }

  playStep()  { this._play('step'); }
  playWin()   { this._play('win'); }
  playLose()  { this._play('lose'); }

  playHeartbeat(proximity = 1) {
    this._play('heartbeat', 0.3 + proximity * 0.5);
  }

  // ─── Атмосферный фон (нельзя pre-render — бесконечный) ───────
  startAmbient() {
    if (!this.active) return;
    this.stopAmbient();
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine'; osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine'; osc2.frequency.value = 82;

    const lfo  = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lfoG = ctx.createGain(); lfoG.gain.value = 4;
    lfo.connect(lfoG); lfoG.connect(osc1.frequency);

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.06, now + 3);

    osc1.connect(master); osc2.connect(master);
    master.connect(ctx.destination);
    osc1.start(now); osc2.start(now); lfo.start(now);

    this.ambientNodes = { osc1, osc2, lfo, master };
  }

  stopAmbient() {
    if (!this.ambientNodes) return;
    const now = this.ctx.currentTime;
    this.ambientNodes.master.gain.linearRampToValueAtTime(0, now + 1);
    const n = this.ambientNodes;
    setTimeout(() => {
      try { n.osc1.stop(); n.osc2.stop(); n.lfo.stop(); } catch (_) {}
    }, 1100);
    this.ambientNodes = null;
  }

  // ─── Сердцебиение в игровом цикле ────────────────────────────
  tickHeartbeat(maniac, myPlayer) {
    if (!myPlayer || myPlayer.escaped) return;
    const dx   = myPlayer.x - maniac.x;
    const dy   = myPlayer.y - maniac.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) return;

    const now      = Date.now();
    const prox     = 1 - dist / 5;
    const interval = Math.max(350, 1100 - prox * 700);
    if (now - this._lastHeartbeat >= interval) {
      this.playHeartbeat(prox);
      this._lastHeartbeat = now;
    }
  }

  // ─── Утилиты ──────────────────────────────────────────────────
  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopAmbient();
      this._stopAmbientSounds();
    } else {
      this.startAmbient();
      this.startAmbientSounds();
    }
    return this.muted;
  }

  stop() {
    this.stopAmbient();
    this._stopAmbientSounds();
  }
}

// ─── Вспомогательные функции ──────────────────────────────────

function distortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Реверб-конвольвер для OfflineAudioContext (нельзя шарить буфер между разными ctx)
function _reverbOffline(ctx, duration = 2) {
  const sr   = ctx.sampleRate;
  const size = Math.floor(sr * duration);
  const buf  = ctx.createBuffer(2, size, sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < size; i++)
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.5);
  }
  const conv  = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}
