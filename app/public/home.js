// Home page: tap "Open fridge", the camera finds your face, and one photo is
// sent to the lock to check. The camera only turns on after the tap and turns
// off again once there's a result.

import { createCvWatcher } from './cv-easter-egg.js';
import { createHint, createSmoothBox, flash } from './scan-ui.js';
import { loadFaceDetector } from './vision.js';

const main = document.querySelector('.home-main');
const scanner = document.querySelector('.scanner');
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const canvas = document.getElementById('canvas');
const scanStatus = document.getElementById('scanStatus');
const openBtn = document.getElementById('openBtn');
const cancelBtn = document.getElementById('cancelBtn');
const againBtn = document.getElementById('againBtn');
const resultIcon = document.getElementById('resultIcon');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const demoNote = document.getElementById('demoNote');

const HOLD_MS = 900; // face must be steady this long; the outline fills meanwhile
const SCAN_TIMEOUT_MS = 20000;
const MIN_CHECK_MS = 700; // keep "Checking…" up briefly so the result doesn't snap in
const RESET_AFTER_SUCCESS_MS = 6000;
const MAX_WIDTH = 640;

const ICONS = {
  success: '<svg viewBox="0 0 52 52"><path d="M14 27 l8 8 l16 -18" /></svg>',
  fail: '<svg viewBox="0 0 52 52"><path d="M17 17 l18 18 M35 17 l-18 18" /></svg>'
};

// Start downloading the face model right away so the scan starts quickly.
const detectorReady = loadFaceDetector().catch((err) => {
  console.error('Face detector failed to load:', err);
  return null;
});

const box = createSmoothBox(overlay);
const hint = createHint(document.getElementById('hint'));

let detector = null;
let cv = null;
let stream = null;
let scanning = false;
let steadySince = 0;
let scanStarted = 0;
let resetTimer = null;

function setState(state) {
  main.dataset.state = state;
}

function setStatus(text) {
  if (scanStatus.textContent === text) return;
  scanStatus.classList.add('fading');
  setTimeout(() => {
    scanStatus.textContent = text;
    scanStatus.classList.remove('fading');
  }, 150);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Camera ----------

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
}

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  video.classList.remove('live');
  scanner.classList.remove('scanning', 'checking');
  box.reset();
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

video.addEventListener('playing', () => video.classList.add('live'));

function grabFrame() {
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- Scanning ----------

// Is this a usable face: exactly one, close enough, roughly centered?
function checkFace(detections) {
  if (detections.length === 0) return { ok: false, hint: 'Look at the camera' };
  if (detections.length > 1) return { ok: false, hint: 'One person at a time' };
  const face = detections[0].boundingBox;
  const size = face.width / video.videoWidth;
  const cx = (face.originX + face.width / 2) / video.videoWidth;
  const cy = (face.originY + face.height / 2) / video.videoHeight;
  if (size < 0.18) return { ok: false, hint: 'Move a little closer', box: face };
  if (Math.abs(cx - 0.5) > 0.25 || Math.abs(cy - 0.5) > 0.25) {
    return { ok: false, hint: 'Center your face', box: face };
  }
  return { ok: true, hint: 'Hold still…', box: face };
}

function scanLoop() {
  if (!scanning) return;
  const now = performance.now();

  if (now - scanStarted > SCAN_TIMEOUT_MS) {
    stopCamera();
    showResult('fail', "Didn't catch your face", 'Make sure your face is well lit and try again.');
    return;
  }

  if (video.readyState >= 2) {
    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    cv?.check(now);

    if (detector) {
      const result = checkFace(detector.detectForVideo(video, now).detections);
      // Wait while hands are up, so making the secret sign doesn't trigger an unlock.
      const ready = result.ok && !cv?.handsVisible();
      steadySince = ready ? steadySince || now : 0;
      const hold = ready ? Math.min(1, (now - steadySince) / HOLD_MS) : 0;

      box.draw(result.box, { hold, ready, before: (ctx) => cv?.draw(ctx) });
      hint.set(result.hint, ready, now);

      if (hold >= 1) {
        verify(grabFrame());
        return;
      }
    } else if (now - scanStarted > 2500) {
      // No face detector (offline?) — just send a frame and let the lock decide.
      verify(grabFrame());
      return;
    }
  }
  requestAnimationFrame(scanLoop);
}

async function startScan() {
  clearTimeout(resetTimer);
  scanStatus.textContent = 'Starting camera…';
  hint.now('');
  setState('scan');

  try {
    await startCamera();
  } catch {
    showResult(
      'fail',
      'Camera unavailable',
      "Allow camera access, and make sure you're on HTTPS or localhost."
    );
    return;
  }

  setStatus('Getting ready…');
  detector = await detectorReady;
  cv ||= createCvWatcher({ video, scanner, debugAfter: scanStatus });
  setStatus('Looking for your face…');

  scanner.classList.add('scanning');
  scanning = true;
  steadySince = 0;
  scanStarted = performance.now();
  requestAnimationFrame(scanLoop);
}

// ---------- Unlock ----------

async function verify(image) {
  scanning = false;
  flash(scanner);
  video.pause(); // freeze on the photo that was taken
  scanner.classList.replace('scanning', 'checking');
  hint.now('');
  setStatus('Checking…');

  let result;
  try {
    const [response] = await Promise.all([
      fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image })
      }),
      wait(MIN_CHECK_MS)
    ]);
    result = await response.json();
  } catch {
    stopCamera();
    showResult('fail', 'Network error', "Couldn't reach the server. Try again.");
    return;
  }

  stopCamera();
  demoNote.hidden = !result.mock;

  if (result.success && result.recognized) {
    showResult('success', result.name ? `Welcome, ${result.name}` : 'Welcome', 'Fridge unlocked. Enjoy your snack.');
    resetTimer = setTimeout(() => setState('idle'), RESET_AFTER_SUCCESS_MS);
  } else if (result.success) {
    showResult('fail', 'Face not recognized', 'Try again, or enroll your face first.');
  } else {
    showResult('fail', "Couldn't reach the lock", result.error || 'Try again in a moment.');
  }
}

function showResult(kind, title, text) {
  resultIcon.className = 'result-icon';
  void resultIcon.offsetWidth; // restart the icon animation on every result
  resultIcon.className = `result-icon ${kind}`;
  resultIcon.innerHTML = ICONS[kind];
  resultTitle.textContent = title;
  resultText.textContent = text;
  againBtn.textContent = kind === 'success' ? 'Done' : 'Try again';
  againBtn.dataset.kind = kind;
  setState(`result-${kind}`);
  againBtn.focus({ preventScroll: true });
}

// ---------- Buttons ----------

openBtn.addEventListener('click', startScan);

cancelBtn.addEventListener('click', () => {
  stopCamera();
  setState('idle');
});

againBtn.addEventListener('click', () => {
  clearTimeout(resetTimer);
  if (againBtn.dataset.kind === 'success') setState('idle');
  else startScan();
});
