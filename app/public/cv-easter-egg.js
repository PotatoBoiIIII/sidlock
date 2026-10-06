// Watches a camera feed for the secret "CV" hand sign and opens the easter
// egg page when it's held. Add ?debug to the URL to see tracked hand points
// and why the sign isn't being recognized.

import { explainHand, isCvSign, measureHand } from './cv-gesture.js';
import { loadHands } from './vision.js';

const CV_HOLD_MS = 800;
const CHECK_EVERY = 3; // frames; hand tracking is heavier than face detection

export function createCvWatcher({ video, scanner, debugAfter }) {
  const debug = new URLSearchParams(location.search).has('debug');
  const debugEl = debug ? document.createElement('pre') : null;
  if (debugEl) {
    debugEl.className = 'debug';
    debugAfter.after(debugEl);
  }

  let hands = null;
  let frame = 0;
  let since = 0;
  let lastHands = [];
  let lastCheck = 0;

  // Loaded in the background; if it fails, the easter egg quietly doesn't work.
  loadHands()
    .then((landmarker) => {
      hands = landmarker;
    })
    .catch((err) => {
      console.warn('Hand tracking unavailable:', err);
      if (debugEl) debugEl.textContent = `Hand tracking failed to load: ${err.message}`;
    });

  function open() {
    hands = null; // stop checking while we navigate away
    try {
      sessionStorage.setItem('sidlock-cv', '1');
    } catch {}
    scanner.classList.add('unlocked');
    setTimeout(() => {
      window.location.href = 'egg.html';
    }, 600);
  }

  function showDebug(landmarks) {
    if (landmarks.length === 0) {
      debugEl.textContent = 'No hands detected — make sure both hands are in frame.';
      return;
    }
    const lines = landmarks.map((lm, i) => {
      const m = measureHand(lm);
      const why = explainHand(m);
      const j = m.joints;
      return [
        `Hand ${i + 1}: ${why.C.length === 0 ? 'C ✓' : why.V.length === 0 ? 'V ✓' : 'neither'}`,
        `  joints  index ${j.index.toFixed(0)}° middle ${j.middle.toFixed(0)}° ring ${j.ring.toFixed(0)}° pinky ${j.pinky.toFixed(0)}°`,
        `  spread ${m.vSpread.toFixed(2)}  together ${m.fingersTogether.toFixed(2)}  thumbGap ${m.thumbGap.toFixed(2)}  thumbAngle ${m.thumbAlongIndex.toFixed(0)}°`,
        `  C missing: ${why.C.join(', ') || '—'}`,
        `  V missing: ${why.V.join(', ') || '—'}`
      ].join('\n');
    });
    if (landmarks.length < 2) lines.push('Only one hand detected — need both.');
    debugEl.textContent = lines.join('\n\n');
  }

  return {
    // Call once per video frame.
    check(now) {
      if (!hands || ++frame % CHECK_EVERY !== 0) return;
      const { landmarks } = hands.detectForVideo(video, now);
      lastHands = landmarks;
      lastCheck = now;
      if (debug) showDebug(landmarks);
      if (!isCvSign(landmarks)) {
        since = 0;
        return;
      }
      since ||= now;
      if (now - since >= CV_HOLD_MS) open();
    },

    // True if hands were seen in the last half second.
    handsVisible() {
      return lastHands.length > 0 && performance.now() - lastCheck < 500;
    },

    // Call after clearing the overlay canvas; draws hand points in debug mode.
    draw(ctx) {
      if (!debug) return;
      ctx.fillStyle = '#5ab0ff';
      const { width, height } = ctx.canvas;
      for (const lm of lastHands) {
        for (const p of lm) {
          ctx.beginPath();
          ctx.arc(p.x * width, p.y * height, width / 200, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };
}
