// Audio for the easter egg page: an "unlocked" jingle followed by a looping
// lo-fi beat. Everything is synthesized with the Web Audio API, so there are
// no audio files to download or license.
//
// Browsers only allow sound after a user gesture, so nothing plays until the
// visitor taps the "tap to enter" screen.

const gate = document.getElementById('eggGate');
const toggle = document.getElementById('soundToggle');

const BPM = 74;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// Fmaj7 → Em7 → Dm7 → Cmaj7, one bar each (MIDI note numbers).
const CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59]
];

let ctx = null;
let master = null;
let music = null;
let noise = null;
let muted = false;
let nextBar = 0;
let barIndex = 0;

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

// ---------- Instruments ----------

function tone({ midi, type = 'sine', start, dur, gain = 0.2, attack = 0.01, out = master }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq(midi);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function noiseBurst({ start, dur, gain, filter, frequency }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = frequency;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(env).connect(music);
  src.start(start, Math.random() * 1.5);
  src.stop(start + dur);
}

function kick(start) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.setValueAtTime(120, start);
  osc.frequency.exponentialRampToValueAtTime(45, start + 0.15);
  env.gain.setValueAtTime(0.5, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
  osc.connect(env).connect(music);
  osc.start(start);
  osc.stop(start + 0.4);
}

function makeNoise() {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Quiet looping hiss with occasional pops, for that worn-record feel.
function startVinyl() {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.015;
    if (Math.random() < 0.0004) data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2500;
  src.connect(f).connect(music);
  src.start();
}

// ---------- Jingle ----------

function playJingle(t) {
  // Rising sparkle: C major arpeggio with a bell-like octave on top.
  [72, 76, 79, 84].forEach((midi, i) => {
    tone({ midi, type: 'triangle', start: t + i * 0.11, dur: 1.4, gain: 0.18 });
    tone({ midi: midi + 12, start: t + i * 0.11, dur: 0.9, gain: 0.05 });
  });
  // Final shimmer chord.
  [84, 88, 91].forEach((midi) => tone({ midi, start: t + 0.5, dur: 2.2, gain: 0.07, attack: 0.05 }));
}

// ---------- Lo-fi loop ----------

function scheduleBar(t, chord) {
  // Soft pad through a low-pass filter so it sits in the background.
  const pad = ctx.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 900;
  pad.connect(music);
  chord.forEach((midi) =>
    tone({ midi, type: 'triangle', start: t, dur: BAR * 1.05, gain: 0.05, attack: 0.25, out: pad })
  );

  // Bass on beats 1 and 3.
  tone({ midi: chord[0] - 12, start: t, dur: BEAT * 1.8, gain: 0.22, out: music });
  tone({ midi: chord[0] - 12, start: t + BEAT * 2, dur: BEAT * 1.8, gain: 0.18, out: music });

  // A lazy melody note now and then.
  if (Math.random() < 0.6) {
    const midi = chord[1 + Math.floor(Math.random() * 3)] + 12;
    tone({ midi, start: t + BEAT * (1.5 + Math.floor(Math.random() * 2)), dur: 1.2, gain: 0.05, out: music });
  }

  // Drums: kick on 1 and the "and" of 3, snare on 2 and 4, swung hi-hats.
  kick(t);
  kick(t + BEAT * 2.5);
  noiseBurst({ start: t + BEAT, dur: 0.18, gain: 0.12, filter: 'bandpass', frequency: 1800 });
  noiseBurst({ start: t + BEAT * 3, dur: 0.18, gain: 0.12, filter: 'bandpass', frequency: 1800 });
  for (let i = 0; i < 8; i++) {
    const swing = i % 2 ? BEAT * 0.08 : 0;
    noiseBurst({ start: t + (i * BEAT) / 2 + swing, dur: 0.04, gain: 0.03, filter: 'highpass', frequency: 7000 });
  }
}

// Schedule a little ahead of time so playback stays smooth.
function scheduler() {
  while (nextBar < ctx.currentTime + 0.3) {
    scheduleBar(nextBar, CHORDS[barIndex % CHORDS.length]);
    nextBar += BAR;
    barIndex++;
  }
}

// ---------- Controls ----------

function start() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;

  ctx = new AudioCtx();
  master = ctx.createDynamicsCompressor();
  master.connect(ctx.destination);
  music = ctx.createGain();
  music.connect(master);
  noise = makeNoise();

  const now = ctx.currentTime + 0.05;
  playJingle(now);

  // Fade the beat in once the jingle has rung out.
  music.gain.setValueAtTime(0, now);
  music.gain.linearRampToValueAtTime(0, now + 1.6);
  music.gain.linearRampToValueAtTime(0.8, now + 5);
  nextBar = now + 1.6;
  startVinyl();
  setInterval(scheduler, 50);
  return true;
}

function setMuted(value) {
  muted = value;
  toggle.setAttribute('aria-pressed', String(!muted));
  toggle.textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
  if (muted) ctx.suspend();
  else ctx.resume();
}

function enter() {
  if (document.body.classList.contains('entered')) return;
  document.body.classList.add('entered');
  if (start()) toggle.hidden = false;
}

gate.addEventListener('click', enter);
gate.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    enter();
  }
});
gate.focus();

toggle.addEventListener('click', () => setMuted(!muted));

// Don't keep playing in a background tab.
document.addEventListener('visibilitychange', () => {
  if (!ctx || muted) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});
