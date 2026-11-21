/**
 * Relativistic Web Audio Engine: City-Frame Environment vs. Observer Cockpit Frame
 * ================================================================================
 *
 * Synthesizes two physically distinct acoustic reference frames in real time via Web Audio API:
 *
 *   1. OBSERVER REST FRAME (Co-Moving Cockpit Bus — Invariant D = 1.0, Proper Time τ):
 *      - "Lightcone Overdrive" (128 BPM, 32-Bar Cosmic Sci-Fi Racing Soundtrack):
 *        Sample-accurate lookahead sequencer clocked strictly to `observer.properTime` (τ)
 *        with Stereo Hall Convolver Reverb, Dotted-8th Stereo Ping-Pong Delay, lush sweeping
 *        analog poly-pads, Interstellar/Tron crystalline arpeggiator, punchy Moog bassline,
 *        crisp electronic drums, and soaring portamento sci-fi lead melody!
 *        Emitted in the driver's own rest frame -> pitch & tempo stay 100% invariant at 0.99c!
 *      - Subtle, warm, muffled GT exhaust purr + gentle thruster shimmer + tire/surface FX
 *        balanced softly underneath the soundtrack (~-15 dB below music).
 *
 *   2. EXTERNAL ENVIRONMENT FRAME (Relativistic Past-Light-Cone Bus — Doppler D, Beaming & t_emit):
 *      - Clock Tower Westminster Bronze Bells at (-35.5, 29.8, -55) clocked to retarded `t_emit`.
 *      - Clock Plaza Café Street-Organ Waltz at (-15.5, 1.8, -34) clocked to retarded `t_emit`.
 *      - Roadside 0.75 Hz Synchronized Beacon crystalline pings phase-locked to optical beacons.
 *      - 3D Spatialized AI Supercar V10 / Truck engines & Shinkansen Bullet Train flybys with
 *        exact 2-body relativistic Doppler D = [γ_o (1 - β_o·n)] / [γ_s (1 - β_s·n)] * D_Rindler
 *        and aberrated stereo panning!
 */

const MIDI_TO_HZ = (m) => 440.0 * Math.pow(2.0, (m - 69.0) / 12.0);

// 32-Bar Cosmic Sci-Fi Progression ("Lightcone Overdrive" in D Minor / Bb Lydian, 1 bar per entry)
// Each entry: { root: bassMidi, chord: [padMidis...], arp: [arpMidis...] }
const PROG_A = [
  { root: 38, chord: [50, 57, 60, 64, 65], arp: [62, 65, 69, 72, 76, 72, 69, 65] }, // Dm9
  { root: 38, chord: [50, 57, 60, 65, 69], arp: [62, 67, 69, 74, 77, 74, 69, 67] }, // Dm11
  { root: 34, chord: [46, 53, 57, 60, 64], arp: [62, 65, 69, 72, 76, 72, 69, 65] }, // Bbmaj9(#11)
  { root: 34, chord: [46, 53, 58, 62, 65], arp: [62, 65, 70, 74, 77, 74, 70, 65] }, // Bbmaj7
  { root: 31, chord: [43, 50, 53, 58, 62], arp: [58, 62, 65, 69, 74, 69, 65, 62] }, // Gm9
  { root: 36, chord: [48, 55, 58, 60, 64], arp: [60, 64, 67, 72, 76, 72, 67, 64] }, // C9sus4 -> C
  { root: 33, chord: [45, 52, 57, 62, 64], arp: [62, 64, 69, 74, 76, 74, 69, 64] }, // A7sus4
  { root: 33, chord: [45, 52, 55, 61, 64], arp: [61, 64, 67, 73, 76, 73, 67, 64] }, // A7(b9)
];

const PROG_C = [
  { root: 34, chord: [46, 53, 57, 62, 64], arp: [65, 69, 72, 76, 77, 76, 72, 69] }, // Bbmaj9#11
  { root: 36, chord: [48, 55, 60, 64, 67], arp: [67, 72, 76, 79, 81, 79, 76, 72] }, // C6/9
  { root: 38, chord: [50, 57, 60, 65, 69], arp: [69, 72, 76, 77, 81, 77, 76, 72] }, // Dm9
  { root: 41, chord: [53, 57, 60, 64, 69], arp: [69, 72, 76, 79, 81, 79, 76, 72] }, // Fmaj9
  { root: 31, chord: [43, 50, 55, 58, 62], arp: [62, 67, 70, 74, 77, 74, 70, 67] }, // Gm9
  { root: 38, chord: [45, 50, 57, 62, 65], arp: [65, 69, 74, 77, 81, 77, 74, 69] }, // Dm/A
  { root: 34, chord: [46, 53, 58, 62, 67], arp: [67, 70, 74, 77, 79, 77, 74, 70] }, // Bb6/9
  { root: 33, chord: [45, 52, 57, 61, 67], arp: [67, 69, 73, 76, 81, 76, 73, 69] }, // A7
];

// Soaring Sci-Fi Lead Melody Events [stepOffsetIn8Bars (0..127), midiNote, durationSteps]
const LEAD_THEME_B = [
  [0, 74, 6], [6, 76, 2], [8, 77, 6], [14, 76, 2],
  [16, 74, 4], [20, 69, 8], [28, 72, 4],
  [32, 74, 6], [38, 77, 2], [40, 81, 6], [46, 79, 2],
  [48, 77, 6], [54, 76, 4], [58, 72, 6],
  [64, 70, 6], [70, 72, 2], [72, 74, 6], [78, 77, 2],
  [80, 79, 6], [86, 76, 4], [90, 72, 6],
  [96, 74, 8], [104, 76, 4], [108, 77, 4],
  [112, 76, 12],
];

const LEAD_THEME_C = [
  [0, 77, 6], [6, 79, 2], [8, 81, 8],
  [16, 84, 6], [22, 81, 2], [24, 79, 8],
  [32, 81, 6], [38, 77, 2], [40, 76, 6], [46, 74, 2],
  [48, 76, 8], [56, 72, 8],
  [64, 74, 6], [70, 77, 2], [72, 82, 6], [78, 81, 2],
  [80, 77, 6], [86, 74, 4], [90, 69, 6],
  [96, 70, 6], [102, 74, 4], [106, 79, 6],
  [112, 81, 14],
];

const LEAD_MAP_B = new Map(LEAD_THEME_B.map(([st, m, d]) => [st, { midi: m, durSteps: d }]));
const LEAD_MAP_C = new Map(LEAD_THEME_C.map(([st, m, d]) => [st, { midi: m, durSteps: d }]));

// Westminster Clock Tower Bell notes (E4, G#4, B4, E5)
const TOWER_BELL_MIDI = [64, 68, 71, 76, 64, 71, 68, 64];

// Parisian Plaza Street-Organ motif (3/4 waltz in E minor / G major)
const PLAZA_WALTZ_MIDI = [64, 67, 71, 76, 74, 71, 69, 72, 76, 74, 71, 67];

export class RelativisticAudioEngine {
  constructor(metric, cityWorld) {
    this.metric = metric;
    this.cityWorld = cityWorld;

    this.ctx = null;
    this.isInitialized = false;
    this.masterEnabled = true;
    this.musicEnabled = true;
    this.envEnabled = true;

    // Balanced mix: Lush cosmic music in front, gentle purring engine underneath!
    this.cockpitVolume = 0.34;
    this.musicVolume = 0.84;
    this.envVolume = 0.72;

    this.onStateChange = null;

    // 128 BPM in Observer Proper Time τ -> 16th-note step = 60 / (128 * 4) = 0.1171875s
    this.stepDurProper = 60.0 / (128.0 * 4.0);
    this.nextScheduledStep = -1;
    this.lastLeadFreq = MIDI_TO_HZ(74);

    // Cockpit gearbox state
    this.currentGear = 1;
    this.shiftCutTimer = 0.0;

    // Environment retarded-time phase trackers
    this.lastTowerIndex = null;
    this.lastPlazaIndex = null;
    this.lastPylonIndex = null;

    this._bindUnlockListeners();
  }

  _bindUnlockListeners() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      if (!this.isInitialized && this.masterEnabled) {
        this.ensureStarted();
      } else if (this.ctx && this.ctx.state === 'suspended' && this.masterEnabled) {
        this.ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('pointerdown', unlock, { passive: true });
  }

  ensureStarted() {
    if (typeof window === 'undefined') return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this._buildGraph();
      this.isInitialized = true;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.onStateChange) this.onStateChange(this.getStatus());
    return true;
  }

  getStatus() {
    return {
      running: Boolean(this.ctx && this.ctx.state === 'running' && this.masterEnabled),
      masterEnabled: this.masterEnabled,
      musicEnabled: this.musicEnabled,
      envEnabled: this.envEnabled,
    };
  }

  setMasterEnabled(enabled) {
    this.masterEnabled = Boolean(enabled);
    if (this.masterEnabled) {
      this.ensureStarted();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterEnabled ? 0.86 : 0.0, this.ctx.currentTime, 0.04);
    }
    if (this.onStateChange) this.onStateChange(this.getStatus());
  }

  toggleMaster() {
    this.setMasterEnabled(!this.masterEnabled);
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = Boolean(enabled);
    if (this.musicEnabled) this.ensureStarted();
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(
        this.musicEnabled ? this.musicVolume : 0.0,
        this.ctx.currentTime,
        0.06
      );
    }
    if (this.onStateChange) this.onStateChange(this.getStatus());
  }

  toggleMusic() {
    this.setMusicEnabled(!this.musicEnabled);
  }

  setEnvEnabled(enabled) {
    this.envEnabled = Boolean(enabled);
    if (this.envBus && this.ctx) {
      this.envBus.gain.setTargetAtTime(
        this.envEnabled ? this.envVolume : 0.0,
        this.ctx.currentTime,
        0.05
      );
    }
    if (this.onStateChange) this.onStateChange(this.getStatus());
  }

  _buildGraph() {
    const ctx = this.ctx;

    // Master Mastering Compressor / Limiter
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -9.0;
    this.compressor.knee.value = 12.0;
    this.compressor.ratio.value = 5.0;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterEnabled ? 0.86 : 0.0;
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // 1. Sub-Buses
    this.cockpitBus = ctx.createGain();
    this.cockpitBus.gain.value = this.cockpitVolume;
    this.cockpitBus.connect(this.compressor);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicEnabled ? this.musicVolume : 0.0;
    this.musicBus.connect(this.compressor);

    this.envBus = ctx.createGain();
    this.envBus.gain.value = this.envEnabled ? this.envVolume : 0.0;
    this.envBus.connect(this.compressor);

    // --- Studio Stereo Space Reverb (`ConvolverNode`) + Ping-Pong Dotted-8th Delay for Music! ---
    const irSeconds = 2.4;
    const irLen = Math.floor(ctx.sampleRate * irSeconds);
    const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const chData = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / ctx.sampleRate;
        const env = Math.pow(1.0 - i / irLen, 2.6) * (t < 0.025 ? t / 0.025 : 1.0);
        chData[i] = (Math.random() * 2.0 - 1.0) * env * 0.52;
      }
    }
    this.musicReverb = ctx.createConvolver();
    this.musicReverb.buffer = irBuf;
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.36;
    this.musicReverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.musicBus);

    // Stereo Dotted-8th Ping-Pong Delay (3 * stepDurProper = 0.35156s)
    this.delayL = ctx.createDelay(1.0);
    this.delayR = ctx.createDelay(1.0);
    this.delayL.delayTime.value = this.stepDurProper * 3.0;
    this.delayR.delayTime.value = this.stepDurProper * 3.0;

    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'bandpass';
    this.delayFilter.frequency.value = 1650.0;
    this.delayFilter.Q.value = 0.75;

    this.delayFbL = ctx.createGain();
    this.delayFbR = ctx.createGain();
    this.delayFbL.gain.value = 0.36;
    this.delayFbR.gain.value = 0.36;

    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.68;
    panR.pan.value = 0.68;

    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.30;

    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 1.0;
    this.delaySend.connect(this.delayFilter);
    this.delayFilter.connect(this.delayL);
    this.delayL.connect(panL);
    panL.connect(this.delayReturn);
    this.delayL.connect(this.delayFbL);
    this.delayFbL.connect(this.delayR);
    this.delayR.connect(panR);
    panR.connect(this.delayReturn);
    this.delayR.connect(this.delayFbR);
    this.delayFbR.connect(this.delayL);
    this.delayReturn.connect(this.musicBus);
    this.delayReturn.connect(this.musicReverb);

    // Shared Pink/White Noise Buffer
    const bufLen = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufLen; i++) {
      const white = Math.random() * 2.0 - 1.0;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = Math.max(-1.0, Math.min(1.0, (b0 + b1 + b2 + white * 0.22) * 1.35));
    }

    // --- Soft, Warm, Muffled Cockpit Exhaust Purr (Sits gently under music!) ---
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 280.0;
    this.engFilter.Q.value = 1.1;

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.cockpitBus);

    // Smooth triangle + sine sub-octave + soft harmonic (no harsh square buzz!)
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'triangle';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'sine';
    this.engOsc3 = ctx.createOscillator();
    this.engOsc3.type = 'sawtooth';

    this.engSubGain = ctx.createGain();
    this.engSubGain.gain.value = 0.45;
    this.engHarmGain = ctx.createGain();
    this.engHarmGain.gain.value = 0.14;

    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engSubGain);
    this.engSubGain.connect(this.engFilter);
    this.engOsc3.connect(this.engHarmGain);
    this.engHarmGain.connect(this.engFilter);

    this.engOsc1.start();
    this.engOsc2.start();
    this.engOsc3.start();

    // Subtle Photon Thruster Shimmer (Cockpit Frame)
    this.boostOsc = ctx.createOscillator();
    this.boostOsc.type = 'sine';
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0.0;
    this.boostOsc.connect(this.boostGain);
    this.boostGain.connect(this.cockpitBus);
    this.boostOsc.start();

    const makeNoiseLoop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = filterType;
      flt.frequency.value = freq;
      flt.Q.value = q;
      const gn = ctx.createGain();
      gn.gain.value = 0.0;
      src.connect(flt);
      flt.connect(gn);
      gn.connect(this.cockpitBus);
      src.start();
      return { src, flt, gn };
    };

    this.tireNoise = makeNoiseLoop('bandpass', 1480.0, 6.0);
    this.surfaceNoise = makeNoiseLoop('bandpass', 480.0, 1.4);

    // --- Continuous Relativistic Environment Voices (2 Nearest Opponent Cars + Bullet Train) ---
    this.oppVoices = [0, 1].map(() => this._createContinuousEnvVoice('triangle', 150.0));
    this.trainVoice = this._createContinuousEnvVoice('sine', 115.0);
  }

  _createContinuousEnvVoice(waveType, baseHz) {
    const ctx = this.ctx;
    const oscA = ctx.createOscillator();
    oscA.type = waveType;
    oscA.frequency.value = baseHz;

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = baseHz * 1.5;

    const subG = ctx.createGain();
    subG.gain.value = 0.30;

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 780.0;
    flt.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.value = 0.0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = 0.0;

    oscA.connect(flt);
    oscB.connect(subG);
    subG.connect(flt);
    flt.connect(gain);
    gain.connect(panner);
    panner.connect(this.envBus);

    oscA.start();
    oscB.start();
    return { oscA, oscB, flt, gain, panner };
  }

  /**
   * Computes exact relativistic Doppler factor D, aberrated stereo pan, distance attenuation,
   * and retarded emission time t_emit for a city-frame environmental source!
   */
  _evalEnvSource(sx, sy, sz, vx, vy, vz, observer, vehicle, settings, refDist = 18.0) {
    const c = this.metric.c;
    const c2 = c * c;
    const ox = observer.event[1];
    const oy = observer.event[2];
    const oz = observer.event[3];

    let dx = sx - ox;
    let dy = sy - oy;
    let dz = sz - oz;
    const dNow = Math.max(0.5, Math.hypot(dx, dy, dz));

    const retScale = settings.enableRetardation ? dNow / c : 0.0;
    dx -= vx * retScale;
    dy -= vy * retScale;
    dz -= vz * retScale;
    const dist = Math.max(0.6, Math.hypot(dx, dy, dz));

    const dirToObsX = -dx / dist;
    const dirToObsY = -dy / dist;
    const dirToObsZ = -dz / dist;

    const bOx = observer.beta[0], bOy = observer.beta[1], bOz = observer.beta[2];
    const gO = settings.enableLorentz ? observer.gamma : 1.0;

    const bSx = vx / c, bSy = vy / c, bSz = vz / c;
    const bS2 = Math.min(0.96, bSx * bSx + bSy * bSy + bSz * bSz);
    const gS = settings.enableLorentz ? 1.0 / Math.sqrt(1.0 - bS2) : 1.0;

    let doppler = 1.0;
    if (settings.enableDoppler) {
      const num = gO * (1.0 - (bOx * dirToObsX + bOy * dirToObsY + bOz * dirToObsZ));
      const den = Math.max(0.06, gS * (1.0 - (bSx * dirToObsX + bSy * dirToObsY + bSz * dirToObsZ)));
      doppler = num / den;

      if (settings.enableAccelEquiv ?? true) {
        const ax = observer.properAcceleration[0];
        const ay = observer.properAcceleration[1];
        const az = observer.properAcceleration[2];
        const effScale = dist > 65.0 ? 65.0 / dist : 1.0;
        const pot = (ax * dx + ay * dy + az * dz) * effScale / Math.max(4.0, c2);
        doppler *= Math.max(0.35, Math.min(2.8, 1.0 + 0.68 * pot));
      }
      doppler = Math.max(0.18, Math.min(5.5, doppler));
    }

    let appX = dx;
    let appZ = dz;
    if (settings.enableAberration && gO > 1.0005) {
      const kBoost = (gO * gO) / (gO + 1.0);
      const bDotD = bOx * dx + bOy * dy + bOz * dz;
      appX = dx + (kBoost * bDotD + gO * dist) * bOx;
      appZ = dz + (kBoost * bDotD + gO * dist) * bOz;
    }
    const appHoriz = Math.max(1e-4, Math.hypot(appX, appZ));
    const camRightX = Math.cos(vehicle.camYaw);
    const camRightZ = Math.sin(vehicle.camYaw);
    const pan = Math.max(-0.95, Math.min(0.95, (appX * camRightX + appZ * camRightZ) / appHoriz));

    const beamBoost = settings.enableBeaming ? Math.pow(Math.max(0.35, Math.min(3.0, doppler)), 0.72) : 1.0;
    const atten = (1.0 / (1.0 + Math.pow(dist / refDist, 1.75))) * beamBoost;
    const tEmit = observer.event[0] - (settings.enableRetardation ? dist / c : 0.0);

    return { doppler, dist, pan, atten, tEmit };
  }

  triggerCollision(severity = 0.6) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterEnabled) return;
    const now = this.ctx.currentTime;
    const s = Math.max(0.15, Math.min(1.0, severity));

    const osc = this.ctx.createOscillator();
    const gn = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115.0 + 40.0 * s, now);
    osc.frequency.exponentialRampToValueAtTime(34.0, now + 0.18);
    gn.gain.setValueAtTime(0.48 * s, now);
    gn.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gn);
    gn.connect(this.cockpitBus);
    osc.start(now);
    osc.stop(now + 0.24);

    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 920.0 + 650.0 * s;
    flt.Q.value = 2.0;
    const nGn = this.ctx.createGain();
    nGn.gain.setValueAtTime(0.26 * s, now);
    nGn.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    nSrc.connect(flt);
    flt.connect(nGn);
    nGn.connect(this.cockpitBus);
    nSrc.start(now);
    nSrc.stop(now + 0.17);
  }

  _triggerTowerBell(midiNote, doppler, pan, gainLevel) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const baseFreq = MIDI_TO_HZ(midiNote) * doppler;
    if (baseFreq < 24.0 || baseFreq > 15000.0 || gainLevel < 0.004) return;

    const dur = Math.max(0.22, Math.min(2.6, 1.35 / Math.sqrt(doppler)));
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.envBus);

    for (const [ratio, amp] of [[1.0, 0.17], [2.0, 0.08], [2.42, 0.06]]) {
      const f = baseFreq * ratio;
      if (f > 16500.0) continue;
      const osc = ctx.createOscillator();
      const gn = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      gn.gain.setValueAtTime(amp * gainLevel, now);
      gn.gain.exponentialRampToValueAtTime(0.0008, now + dur);
      osc.connect(gn);
      gn.connect(panner);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    }
  }

  _triggerPlazaNote(midiNote, doppler, pan, gainLevel) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freq = MIDI_TO_HZ(midiNote) * doppler;
    if (freq < 35.0 || freq > 14000.0 || gainLevel < 0.004) return;

    const dur = Math.max(0.08, Math.min(0.85, 0.24 / doppler));
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, now);
    osc2.frequency.setValueAtTime(freq * 1.004, now);

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = Math.min(12000.0, freq * 3.0);

    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.001, now);
    gn.gain.linearRampToValueAtTime(0.11 * gainLevel, now + 0.015);
    gn.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    osc1.connect(flt);
    osc2.connect(flt);
    flt.connect(gn);
    gn.connect(panner);
    panner.connect(this.envBus);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + dur + 0.02);
    osc2.stop(now + dur + 0.02);
  }

  _triggerSyncPing(doppler, pan, gainLevel) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freq = 784.0 * doppler;
    if (freq < 45.0 || freq > 15500.0 || gainLevel < 0.005) return;

    const dur = Math.max(0.07, Math.min(0.45, 0.18 / Math.sqrt(doppler)));
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.075 * gainLevel, now);
    gn.gain.exponentialRampToValueAtTime(0.0008, now + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    osc.connect(gn);
    gn.connect(panner);
    panner.connect(this.envBus);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /**
   * Sample-accurate Web Audio scheduling of one 16th-note step (`when` in AudioContext seconds)
   * of "Lightcone Overdrive" — our 32-bar Cosmic Sci-Fi Relativistic Racing Soundtrack!
   */
  _scheduleMusicStep(stepIndex, when) {
    if (!this.musicEnabled) return;
    const ctx = this.ctx;
    const s = this.stepDurProper;

    const totalStep = ((stepIndex % 512) + 512) % 512; // 32 bars * 16 steps
    const section = Math.floor(totalStep / 128);        // 0: Intro/Build, 1: Main Lead, 2: Apex Modulation, 3: Cosmic Breakdown
    const stepInSection = totalStep % 128;
    const barInSec = Math.floor(stepInSection / 16);
    const stepInBar = totalStep % 16;

    const barData = section === 2 ? PROG_C[barInSec] : PROG_A[barInSec];
    const isBreakdown = section === 3 && barInSec < 6;
    const isBuildRiser = section === 3 && barInSec >= 6;

    // 1. Lush Sweeping Stereo Poly-Synth Pad Chords (every bar on step 0)
    if (stepInBar === 0) {
      const barDur = s * 16.0;
      const padCutoff = isBreakdown ? 950.0 : section === 2 ? 1950.0 : 1450.0;
      barData.chord.forEach((midi, idx) => {
        for (const detuneCents of [-7, 7]) {
          const osc = ctx.createOscillator();
          osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
          osc.frequency.setValueAtTime(MIDI_TO_HZ(midi), when);
          osc.detune.setValueAtTime(detuneCents + (idx - 2) * 2.5, when);

          const flt = ctx.createBiquadFilter();
          flt.type = 'lowpass';
          flt.Q.value = 1.4;
          flt.frequency.setValueAtTime(padCutoff * 0.65, when);
          flt.frequency.exponentialRampToValueAtTime(padCutoff, when + barDur * 0.55);
          flt.frequency.exponentialRampToValueAtTime(padCutoff * 0.72, when + barDur);

          const gn = ctx.createGain();
          gn.gain.setValueAtTime(0.0005, when);
          gn.gain.linearRampToValueAtTime(0.026, when + 0.24);
          gn.gain.setValueAtTime(0.024, when + barDur - 0.25);
          gn.gain.exponentialRampToValueAtTime(0.0005, when + barDur + 0.15);

          const pan = ctx.createStereoPanner();
          pan.pan.value = Math.max(-0.85, Math.min(0.85, (detuneCents < 0 ? -0.45 : 0.45) + (idx - 2) * 0.14));

          osc.connect(flt);
          flt.connect(gn);
          gn.connect(pan);
          pan.connect(this.musicBus);
          pan.connect(this.musicReverb);

          osc.start(when);
          osc.stop(when + barDur + 0.18);
        }
      });
    }

    // 2. Hypnotic Cosmic 16th-Note Arpeggiator (feeds Stereo Dotted-8th Delay + Hall Reverb!)
    {
      const arpMidi = barData.arp[stepInBar % 8] + (section === 2 && stepInBar % 4 === 2 ? 12 : 0);
      const aOsc = ctx.createOscillator();
      aOsc.type = isBreakdown ? 'sine' : 'triangle';
      aOsc.frequency.setValueAtTime(MIDI_TO_HZ(arpMidi), when);

      const aOsc2 = ctx.createOscillator();
      aOsc2.type = 'sawtooth';
      aOsc2.frequency.setValueAtTime(MIDI_TO_HZ(arpMidi) * 2.0, when);
      const subA = ctx.createGain();
      subA.gain.value = 0.18;

      const aFlt = ctx.createBiquadFilter();
      aFlt.type = 'lowpass';
      const accent = (stepInBar % 3 === 0) ? 1.35 : 0.85; // 3-against-4 polyrhythmic sci-fi pulse!
      aFlt.frequency.setValueAtTime(2800.0 * accent, when);
      aFlt.frequency.exponentialRampToValueAtTime(520.0, when + s * 1.3);

      const aGn = ctx.createGain();
      const peakA = (isBreakdown ? 0.055 : 0.068) * accent;
      aGn.gain.setValueAtTime(0.001, when);
      aGn.gain.linearRampToValueAtTime(peakA, when + 0.006);
      aGn.gain.exponentialRampToValueAtTime(0.0008, when + s * 1.45);

      const aPan = ctx.createStereoPanner();
      aPan.pan.value = Math.sin(totalStep * 0.65) * 0.52;

      aOsc.connect(aFlt);
      aOsc2.connect(subA);
      subA.connect(aFlt);
      aFlt.connect(aGn);
      aGn.connect(aPan);
      aPan.connect(this.musicBus);
      aPan.connect(this.delaySend);

      aOsc.start(when);
      aOsc2.start(when);
      aOsc.stop(when + s * 1.5);
      aOsc2.stop(when + s * 1.5);
    }

    // 3. Driving Sidechained Moog Octave Bassline (Rolling 16th/8th Synthwave Pulse)
    if (!isBreakdown || stepInBar === 0) {
      const isKickBeat = stepInBar % 4 === 0;
      const octJump = (stepInBar % 4 === 2 || stepInBar === 15) ? 12 : 0;
      const bassMidi = barData.root + octJump;
      const bassDur = isBreakdown ? s * 12.0 : s * 0.92;

      const bOsc1 = ctx.createOscillator();
      const bOsc2 = ctx.createOscillator();
      bOsc1.type = 'sawtooth';
      bOsc2.type = 'sine';
      bOsc1.frequency.setValueAtTime(MIDI_TO_HZ(bassMidi), when);
      bOsc2.frequency.setValueAtTime(MIDI_TO_HZ(barData.root), when); // solid sub foundation

      const bFlt = ctx.createBiquadFilter();
      bFlt.type = 'lowpass';
      bFlt.Q.value = 2.4;
      bFlt.frequency.setValueAtTime(isBreakdown ? 260.0 : 880.0, when);
      bFlt.frequency.exponentialRampToValueAtTime(145.0, when + bassDur);

      const bGn = ctx.createGain();
      // Duck slightly on kick beats for authentic electronic sidechain pump!
      const bassAmp = isBreakdown ? 0.15 : isKickBeat ? 0.095 : 0.165;
      bGn.gain.setValueAtTime(0.002, when);
      bGn.gain.linearRampToValueAtTime(bassAmp, when + (isKickBeat ? 0.032 : 0.008));
      bGn.gain.exponentialRampToValueAtTime(0.0015, when + bassDur + 0.02);

      bOsc1.connect(bFlt);
      bOsc2.connect(bFlt);
      bFlt.connect(bGn);
      bGn.connect(this.musicBus);

      bOsc1.start(when);
      bOsc2.start(when);
      bOsc1.stop(when + bassDur + 0.03);
      bOsc2.stop(when + bassDur + 0.03);
    }

    // 4. Electronic Sci-Fi Drum Kit (Punchy 909 Kick + Gated Reverb Snare + Crisp Stereo Hats)
    const playFullDrums = section === 1 || section === 2 || (section === 0 && barInSec >= 2);
    if ((playFullDrums && stepInBar % 4 === 0) || (isBreakdown && stepInBar === 0) || (isBuildRiser && stepInBar % 2 === 0)) {
      const kOsc = ctx.createOscillator();
      const kGn = ctx.createGain();
      kOsc.type = 'sine';
      kOsc.frequency.setValueAtTime(142.0, when);
      kOsc.frequency.exponentialRampToValueAtTime(41.0, when + 0.085);
      const kAmp = isBuildRiser ? 0.16 + 0.08 * ((stepInSection - 96) / 32) : 0.24;
      kGn.gain.setValueAtTime(kAmp, when);
      kGn.gain.exponentialRampToValueAtTime(0.001, when + 0.19);
      kOsc.connect(kGn);
      kGn.connect(this.musicBus);
      kOsc.start(when);
      kOsc.stop(when + 0.20);
    }

    if (playFullDrums && (stepInBar === 4 || stepInBar === 12)) {
      // Layered Synth Snare body + Gated Reverb Clap tail
      const sOsc = ctx.createOscillator();
      const sOscGn = ctx.createGain();
      sOsc.type = 'triangle';
      sOsc.frequency.setValueAtTime(210.0, when);
      sOsc.frequency.exponentialRampToValueAtTime(105.0, when + 0.07);
      sOscGn.gain.setValueAtTime(0.12, when);
      sOscGn.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
      sOsc.connect(sOscGn);
      sOscGn.connect(this.musicBus);
      sOsc.start(when);
      sOsc.stop(when + 0.10);

      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.noiseBuffer;
      const nFlt = ctx.createBiquadFilter();
      nFlt.type = 'bandpass';
      nFlt.frequency.value = 2150.0;
      nFlt.Q.value = 0.95;
      const nGn = ctx.createGain();
      nGn.gain.setValueAtTime(0.12, when);
      nGn.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
      nSrc.connect(nFlt);
      nFlt.connect(nGn);
      nGn.connect(this.musicBus);
      nGn.connect(this.musicReverb);
      nSrc.start(when);
      nSrc.stop(when + 0.18);
    }

    if (!isBreakdown) {
      const hSrc = ctx.createBufferSource();
      hSrc.buffer = this.noiseBuffer;
      const hFlt = ctx.createBiquadFilter();
      hFlt.type = 'highpass';
      hFlt.frequency.value = 7600.0;
      const isOffbeatOpen = stepInBar % 4 === 2;
      const hDur = isOffbeatOpen ? 0.095 : 0.036;
      const hGn = ctx.createGain();
      hGn.gain.setValueAtTime(isOffbeatOpen ? 0.048 : 0.020, when);
      hGn.gain.exponentialRampToValueAtTime(0.0006, when + hDur);
      const hPan = ctx.createStereoPanner();
      hPan.pan.value = (stepInBar % 2 === 0) ? -0.22 : 0.22;
      hSrc.connect(hFlt);
      hFlt.connect(hGn);
      hGn.connect(hPan);
      hPan.connect(this.musicBus);
      hSrc.start(when);
      hSrc.stop(when + hDur + 0.01);
    }

    // 5. Soaring Portamento Sci-Fi Lead Synth Theme (Sections 1 & 2)
    if (section === 1 || section === 2) {
      const leadEntry = (section === 1 ? LEAD_MAP_B : LEAD_MAP_C).get(stepInSection);
      if (leadEntry) {
        const targetHz = MIDI_TO_HZ(leadEntry.midi);
        const dur = leadEntry.durSteps * s;

        const lOsc1 = ctx.createOscillator();
        const lOsc2 = ctx.createOscillator();
        lOsc1.type = 'sawtooth';
        lOsc2.type = 'sawtooth';
        lOsc2.detune.setValueAtTime(9.0, when);

        // Smooth analog glide (portamento) from previous lead note!
        lOsc1.frequency.setValueAtTime(this.lastLeadFreq, when);
        lOsc1.frequency.exponentialRampToValueAtTime(targetHz, when + 0.042);
        lOsc2.frequency.setValueAtTime(this.lastLeadFreq, when);
        lOsc2.frequency.exponentialRampToValueAtTime(targetHz, when + 0.042);
        this.lastLeadFreq = targetHz;

        // Subtle expressive vibrato on sustained notes
        if (dur > 0.35) {
          const vib = ctx.createOscillator();
          const vibGn = ctx.createGain();
          vib.frequency.value = 5.6;
          vibGn.gain.setValueAtTime(0.0, when);
          vibGn.gain.linearRampToValueAtTime(targetHz * 0.007, when + 0.22);
          vib.connect(vibGn);
          vibGn.connect(lOsc1.frequency);
          vibGn.connect(lOsc2.frequency);
          vib.start(when);
          vib.stop(when + dur + 0.05);
        }

        const lFlt = ctx.createBiquadFilter();
        lFlt.type = 'lowpass';
        lFlt.Q.value = 2.2;
        lFlt.frequency.setValueAtTime(3400.0, when);
        lFlt.frequency.exponentialRampToValueAtTime(1350.0, when + dur);

        const lGn = ctx.createGain();
        lGn.gain.setValueAtTime(0.001, when);
        lGn.gain.linearRampToValueAtTime(0.068, when + 0.024);
        lGn.gain.setValueAtTime(0.058, when + Math.max(0.03, dur - 0.06));
        lGn.gain.exponentialRampToValueAtTime(0.0008, when + dur + 0.04);

        lOsc1.connect(lFlt);
        lOsc2.connect(lFlt);
        lFlt.connect(lGn);
        lGn.connect(this.musicBus);
        lGn.connect(this.delaySend);
        lGn.connect(this.musicReverb);

        lOsc1.start(when);
        lOsc2.start(when);
        lOsc1.stop(when + dur + 0.06);
        lOsc2.stop(when + dur + 0.06);
      }
    }
  }

  /**
   * Main per-frame audio update called from the game loop.
   */
  update(dtReal, observer, vehicle, entities, settings) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterEnabled) return;
    const now = this.ctx.currentTime;
    const c = this.metric.c;
    const betaMag = Math.hypot(observer.beta[0], observer.beta[1], observer.beta[2]);

    // =========================================================================
    // 1. OBSERVER COCKPIT FRAME (D = 1.0, Proper Time τ!)
    // =========================================================================
    // Sample-accurate lookahead scheduling (110ms window) locked to `observer.properTime`!
    // Because d(properTime)/d(realTime) == 1.0 in the driver's own rest frame, lookahead offset
    // maps 1:1 onto Web Audio `ctx.currentTime` with zero frame jitter!
    const lookaheadWindow = 0.11;
    const curStepFloat = observer.properTime / this.stepDurProper;
    if (this.nextScheduledStep < 0 || Math.abs(this.nextScheduledStep - curStepFloat) > 8.0) {
      this.nextScheduledStep = Math.ceil(curStepFloat);
    }
    while (this.nextScheduledStep * this.stepDurProper <= observer.properTime + lookaheadWindow) {
      const offsetSec = Math.max(0.0, this.nextScheduledStep * this.stepDurProper - observer.properTime);
      this._scheduleMusicStep(this.nextScheduledStep, now + offsetSec);
      this.nextScheduledStep++;
    }

    // Soft, Warm, Low-Passed 6-Speed GT Exhaust Purr (sits gently underneath the music!)
    const gearThresholds = [0.16, 0.33, 0.50, 0.68, 0.84];
    let targetGear = 1;
    for (let g = 0; g < gearThresholds.length; g++) {
      if (betaMag > gearThresholds[g]) targetGear = g + 2;
    }
    if (targetGear !== this.currentGear) {
      this.currentGear = targetGear;
      this.shiftCutTimer = 0.07;
    }
    this.shiftCutTimer = Math.max(0.0, this.shiftCutTimer - dtReal);

    const lowBeta = targetGear === 1 ? 0.0 : gearThresholds[targetGear - 2] * 0.78;
    const highBeta = targetGear <= gearThresholds.length ? gearThresholds[targetGear - 1] : 0.99;
    const gearFrac = Math.max(0.0, Math.min(1.0, (betaMag - lowBeta) / Math.max(0.08, highBeta - lowBeta)));
    const throttleLoad = vehicle.isThrottling ? 1.0 : 0.25;
    const rpm = 950.0 + gearFrac * 5200.0 + (vehicle.isThrottling ? 260.0 : 0.0);

    const f0 = (rpm / 60.0) * 3.0;
    this.engOsc1.frequency.setTargetAtTime(f0, now, 0.035);
    this.engOsc2.frequency.setTargetAtTime(f0 * 0.5, now, 0.035);
    this.engOsc3.frequency.setTargetAtTime(f0 * 1.5, now, 0.035);

    const cutoff = 220.0 + gearFrac * 420.0 + throttleLoad * 180.0;
    this.engFilter.frequency.setTargetAtTime(cutoff, now, 0.04);

    const shiftDuck = this.shiftCutTimer > 0.0 ? 0.35 : 1.0;
    const targetEngGain = (0.014 + 0.026 * throttleLoad * (0.4 + 0.6 * betaMag)) * shiftDuck;
    this.engGain.gain.setTargetAtTime(targetEngGain, now, 0.04);

    // Subtle Photon Thruster Harmonic Shimmer
    const boostTarget = vehicle.isBoosting ? 0.024 : 0.0;
    this.boostOsc.frequency.setTargetAtTime(280.0 + betaMag * 440.0, now, 0.05);
    this.boostGain.gain.setTargetAtTime(boostTarget, now, 0.05);

    // Tire Screech on hard drift / collision skid
    const latSlip = Math.max(
      vehicle.impactSlip,
      Math.max(0.0, (Math.abs(vehicle.properLatG) - 1.85) / 1.1),
      vehicle.keys.has('Space') && betaMag > 0.14 ? 0.75 : 0.0
    );
    this.tireNoise.gn.gain.setTargetAtTime(Math.min(0.08, latSlip * 0.08), now, 0.03);

    // Off-road Turf / Sand / Water Lagoon Spray Sound
    let surfGain = 0.0;
    let surfFreq = 450.0;
    if (betaMag > 0.03) {
      if (vehicle.currentTerrain === 'grass') {
        surfGain = Math.min(0.07, betaMag * 0.14);
        surfFreq = 320.0;
      } else if (vehicle.currentTerrain === 'sand') {
        surfGain = Math.min(0.09, betaMag * 0.20);
        surfFreq = 760.0;
      } else if (vehicle.currentTerrain === 'water') {
        surfGain = Math.min(0.15, betaMag * 0.40);
        surfFreq = 1320.0;
      }
    }
    this.surfaceNoise.flt.frequency.setTargetAtTime(surfFreq, now, 0.04);
    this.surfaceNoise.gn.gain.setTargetAtTime(surfGain, now, 0.04);

    // =========================================================================
    // 2. RELATIVISTIC CITY ENVIRONMENT FRAME (Doppler D & Retarded t_emit!)
    // =========================================================================
    if (!this.envEnabled) return;

    // A. Clock Tower Westminster Bronze Bells at (-35.5, 29.8, -55.0)
    {
      const envTower = this._evalEnvSource(-35.5, 29.8, -55.0, 0, 0, 0, observer, vehicle, settings, 48.0);
      const bellIdx = Math.floor(envTower.tEmit / 1.45);
      if (this.lastTowerIndex === null) {
        this.lastTowerIndex = bellIdx;
      } else if (bellIdx > this.lastTowerIndex) {
        this.lastTowerIndex = bellIdx;
        const note = TOWER_BELL_MIDI[((bellIdx % TOWER_BELL_MIDI.length) + TOWER_BELL_MIDI.length) % TOWER_BELL_MIDI.length];
        this._triggerTowerBell(note, envTower.doppler, envTower.pan, Math.min(1.15, envTower.atten * 1.3));
      }
    }

    // B. Clock Plaza Café Street-Organ Waltz at (-15.5, 1.8, -34.0)
    {
      const envPlaza = this._evalEnvSource(-15.5, 1.8, -34.0, 0, 0, 0, observer, vehicle, settings, 26.0);
      const waltzIdx = Math.floor(envPlaza.tEmit / 0.28);
      if (this.lastPlazaIndex === null) {
        this.lastPlazaIndex = waltzIdx;
      } else if (waltzIdx > this.lastPlazaIndex) {
        this.lastPlazaIndex = waltzIdx;
        if (envPlaza.atten > 0.03) {
          const note = PLAZA_WALTZ_MIDI[((waltzIdx % PLAZA_WALTZ_MIDI.length) + PLAZA_WALTZ_MIDI.length) % PLAZA_WALTZ_MIDI.length];
          this._triggerPlazaNote(note, envPlaza.doppler, envPlaza.pan, Math.min(1.1, envPlaza.atten * 1.2));
        }
      }
    }

    // C. Nearest Roadside 0.75 Hz Synchronized Clock Pylon Crystalline Ping
    if (this.cityWorld.syncPylons && this.cityWorld.syncPylons.length > 0) {
      let bestPylon = null;
      let bestD2 = Infinity;
      for (let i = 0; i < this.cityWorld.syncPylons.length; i++) {
        const p = this.cityWorld.syncPylons[i];
        const d2 = (p.x - vehicle.carX) ** 2 + (p.z - vehicle.carZ) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestPylon = p;
        }
      }
      if (bestPylon && bestD2 < 54.0 * 54.0) {
        const envPylon = this._evalEnvSource(bestPylon.x, bestPylon.y, bestPylon.z, 0, 0, 0, observer, vehicle, settings, 18.0);
        const pingIdx = Math.floor(envPylon.tEmit * 0.75);
        if (this.lastPylonIndex === null) {
          this.lastPylonIndex = pingIdx;
        } else if (pingIdx > this.lastPylonIndex) {
          this.lastPylonIndex = pingIdx;
          this._triggerSyncPing(envPylon.doppler, envPylon.pan, Math.min(1.0, envPylon.atten));
        }
      }
    }

    // D. 2 Nearest AI Supercars / Trucks — Full 2-Body Relativistic Doppler Flybys!
    if (entities && entities.cars && entities.cars.length > 0) {
      let c0 = null, c1 = null;
      let d0 = Infinity, d1 = Infinity;
      for (let i = 0; i < entities.cars.length; i++) {
        const car = entities.cars[i];
        const d2 = (car.x - vehicle.carX) ** 2 + (car.y - vehicle.footY) ** 2 + (car.z - vehicle.carZ) ** 2;
        if (d2 < d0) {
          d1 = d0; c1 = c0;
          d0 = d2; c0 = car;
        } else if (d2 < d1) {
          d1 = d2; c1 = car;
        }
      }

      const nearest = [c0, c1];
      for (let vIdx = 0; vIdx < 2; vIdx++) {
        const voice = this.oppVoices[vIdx];
        const car = nearest[vIdx];
        if (!car) {
          voice.gain.gain.setTargetAtTime(0.0, now, 0.05);
          continue;
        }
        const gCar = Math.sqrt(1.0 + (car.px * car.px + car.pz * car.pz) / (c * c));
        const vx = car.px / gCar;
        const vz = car.pz / gCar;
        const envCar = this._evalEnvSource(car.x, car.y + 0.6, car.z, vx, 0, vz, observer, vehicle, settings, 15.0);

        const restBaseHz = car.isOpponent ? (125.0 + car.curBeta * 220.0) : (72.0 + car.curBeta * 85.0);
        const obsHz = Math.max(30.0, Math.min(5500.0, restBaseHz * envCar.doppler));
        voice.oscA.frequency.setTargetAtTime(obsHz, now, 0.03);
        voice.oscB.frequency.setTargetAtTime(obsHz * 1.498, now, 0.03);
        voice.flt.frequency.setTargetAtTime(Math.min(6500.0, obsHz * 3.5), now, 0.03);
        voice.panner.pan.setTargetAtTime(envCar.pan, now, 0.03);
        voice.gain.gain.setTargetAtTime(Math.min(0.095, envCar.atten * 0.085), now, 0.03);
      }
    }

    // E. Elevated Shinkansen Bullet Train Relativistic Flyby Chord
    if (entities && entities.train) {
      const tr = entities.train;
      const trVx = tr.dir * Math.min(0.88, tr.baseBeta * entities.trafficSpeedScale) * c;
      const envTrain = this._evalEnvSource(tr.x, tr.y + 1.5, tr.z, trVx, 0, 0, observer, vehicle, settings, 26.0);
      const trObsHz = Math.max(35.0, Math.min(4800.0, 146.8 * envTrain.doppler));
      this.trainVoice.oscA.frequency.setTargetAtTime(trObsHz, now, 0.03);
      this.trainVoice.oscB.frequency.setTargetAtTime(trObsHz * 1.335, now, 0.03);
      this.trainVoice.flt.frequency.setTargetAtTime(Math.min(5500.0, trObsHz * 3.0), now, 0.03);
      this.trainVoice.panner.pan.setTargetAtTime(envTrain.pan, now, 0.03);
      this.trainVoice.gain.gain.setTargetAtTime(Math.min(0.08, envTrain.atten * 0.07), now, 0.04);
    }
  }
}
