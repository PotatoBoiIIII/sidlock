// Home page: tap "Open fridge", the camera finds your face, and one photo is
// sent to the lock to check. The camera only turns on after the tap and turns
// off again once there's a result.

import { createCvWatcher } from './cv-easter-egg.js';
import { loadFaceDetector } from './vision.js';

const main = document.querySelector('.home-main');
const scanner = document.querySelector('.scanner');
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const canvas = document.getElementById('canvas');
const hintEl = document.getElementById('hint');
const scanStatus = document.getElementById('scanStatus');
const openBtn = document.getElementById('openBtn');
const cancelBtn = document.getElementById('cancelBtn');
const againBtn = document.getElementById('againBtn');
const resultIcon = document.getElementById('resultIcon');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const demoNote = document.getElementById('demoNote');

const HOLD_MS = 500; // face must be steady this long before we take the photo
const SCAN_TIMEOUT_MS = 20000;
const RESET_AFTER_SUCCESS_MS = 6000;
const MAX_WIDTH = 640;

// Start downloading the face model right away so the scan starts quickly.
const detectorReady = loadFaceDetector().catch((err) => {
  console.error('Face detector failed to load:', err);
  return null;
});

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

function setHint(text, ready = false) {
  hintEl.textContent = text;
  hintEl.classList.toggle('ready', ready);
  hintEl.hidden = !text;
}

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
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

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
  const box = detections[0].boundingBox;
  const size = box.width / video.videoWidth;
  const cx = (box.originX + box.width / 2) / video.videoWidth;
  const cy = (box.originY + box.height / 2) / video.videoHeight;
  if (size < 0.18) return { ok: false, hint: 'Move a little closer', box };
  if (Math.abs(cx - 0.5) > 0.25 || Math.abs(cy - 0.5) > 0.25) {
    return { ok: false, hint: 'Center your face', box };
  }
  return { ok: true, hint: 'Hold still…', box };
}

function drawBox(box, ready) {
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  cv?.draw(ctx);
  if (!box) return;
  ctx.strokeStyle = ready ? '#7fbf7f' : '#e0a63a';
  ctx.lineWidth = Math.max(2, overlay.width / 240);
  ctx.beginPath();
  ctx.roundRect(box.originX, box.originY, box.width, box.height, 12);
  ctx.stroke();
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
    cv?.check(now);

    if (detector) {
      const result = checkFace(detector.detectForVideo(video, now).detections);
      // Wait while hands are up, so making the secret sign doesn't trigger an unlock.
      const ready = result.ok && !cv?.handsVisible();
      drawBox(result.box, ready);
      setHint(result.hint, ready);
      steadySince = ready ? steadySince || now : 0;
      if (ready && now - steadySince >= HOLD_MS) {
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
  setState('scan');
  setHint('');
  scanStatus.textContent = 'Starting camera…';
  scanStatus.className = 'status';

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

  scanStatus.textContent = 'Getting ready…';
  detector = await detectorReady;
  cv ||= createCvWatcher({ video, scanner, debugAfter: scanStatus });
  scanStatus.textContent = 'Looking for your face…';

  scanning = true;
  steadySince = 0;
  scanStarted = performance.now();
  requestAnimationFrame(scanLoop);
}

// ---------- Unlock ----------

async function verify(image) {
  scanning = false;
  setHint('');
  scanStatus.textContent = 'Checking…';

  try {
    const response = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image })
    });
    const result = await response.json();
    stopCamera();
    demoNote.hidden = !result.mock;

    if (result.success && result.recognized) {
      showResult('success', `Welcome, ${result.name}`, 'Fridge unlocked. Enjoy your snack.');
      resetTimer = setTimeout(() => setState('idle'), RESET_AFTER_SUCCESS_MS);
    } else if (result.success) {
      showResult('fail', 'Face not recognized', 'Try again, or enroll your face first.');
    } else {
      showResult('fail', "Couldn't reach the lock", result.error || 'Try again in a moment.');
    }
  } catch {
    stopCamera();
    showResult('fail', 'Network error', "Couldn't reach the server. Try again.");
  }
}

function showResult(kind, title, text) {
  resultIcon.className = `result-icon ${kind}`;
  resultIcon.textContent = kind === 'success' ? '✓' : '✕';
  resultTitle.textContent = title;
  resultText.textContent = text;
  againBtn.textContent = kind === 'success' ? 'Done' : 'Try again';
  againBtn.dataset.kind = kind;
  setState(`result-${kind}`);
  againBtn.focus();
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
