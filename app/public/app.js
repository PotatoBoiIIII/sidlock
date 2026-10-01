import {
  FaceDetector,
  FilesetResolver,
  HandLandmarker
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';
import { isCvSign } from './cv-gesture.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const canvas = document.getElementById('canvas');
const filmstrip = document.getElementById('filmstrip');
const stepLabel = document.getElementById('step');
const hintEl = document.getElementById('hint');
const captureBtn = document.getElementById('captureBtn');
const submitBtn = document.getElementById('submitBtn');
const form = document.getElementById('form');
const nameInput = document.getElementById('name');
const statusEl = document.getElementById('status');

const MIN_PHOTOS = 3;
const MAX_WIDTH = 640; // downscale before sending; plenty for face encodings

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Secret: hold the "CV" hand sign this long to open the easter egg page.
const CV_HOLD_MS = 800;
const HAND_CHECK_EVERY = 3; // frames; hand tracking is heavier than face detection

// Each step asks for a different angle. Turn/tilt checks compare against the
// pose recorded in the front-facing shot, so they adapt to each person's face.
// yaw > 0 means the person turned to *their* left; pitch < 0 means chin up.
const STEPS = [
  {
    label: 'Front',
    prompt: 'Look straight at the camera',
    check: (p) => Math.abs(p.yaw) < 0.12,
    hint: 'Face the camera straight on'
  },
  {
    label: 'Left',
    prompt: 'Turn your head slightly to your left',
    check: (p, base) => p.yaw - base.yaw > 0.18,
    hint: 'Turn a little more to your left'
  },
  {
    label: 'Right',
    prompt: 'Turn your head slightly to your right',
    check: (p, base) => p.yaw - base.yaw < -0.18,
    hint: 'Turn a little more to your right'
  },
  {
    label: 'Up',
    prompt: 'Tilt your chin up a little',
    check: (p, base) => p.pitch - base.pitch < -0.1,
    hint: 'Tilt your chin up a bit more'
  },
  {
    label: 'Down',
    prompt: 'Tilt your chin down a little',
    check: (p, base) => p.pitch - base.pitch > 0.1,
    hint: 'Tilt your chin down a bit more'
  }
];

// One slot per step: null, or { dataUrl, pose }.
const shots = STEPS.map(() => null);

let detector = null;
let latest = { ok: false, pose: null };
let brightness = 255;
let lastBrightnessCheck = 0;
let busy = false;

let vision = null;
let hands = null;
let frameCount = 0;
let cvSince = 0;

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function currentStep() {
  return shots.findIndex((s) => s === null);
}

function capturedCount() {
  return shots.filter(Boolean).length;
}

// ---------- Rendering ----------

function renderFilmstrip() {
  filmstrip.innerHTML = '';
  const active = currentStep();

  STEPS.forEach((step, i) => {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'slot';
    if (i === active) slot.classList.add('active');

    if (shots[i]) {
      slot.classList.add('filled');
      slot.title = `Retake ${step.label.toLowerCase()} photo`;
      const img = document.createElement('img');
      img.src = shots[i].dataUrl;
      img.alt = `${step.label} photo`;
      slot.appendChild(img);
      slot.addEventListener('click', () => retake(i));
    } else {
      slot.disabled = true;
    }

    const label = document.createElement('span');
    label.textContent = step.label;
    slot.appendChild(label);
    filmstrip.appendChild(slot);
  });

  const step = active === -1 ? null : STEPS[active];
  stepLabel.textContent = step
    ? `Step ${active + 1} of ${STEPS.length} · ${step.prompt}`
    : 'All angles captured — enter a name and enroll.';

  submitBtn.disabled = busy || capturedCount() < MIN_PHOTOS || !shots[0];
  updateCaptureButton();
}

function updateCaptureButton() {
  const done = currentStep() === -1;
  // Without a detector we can't validate, so fall back to manual capture.
  captureBtn.disabled = busy || done || (detector && !latest.ok);
}

function setHint(text, ready) {
  hintEl.textContent = text;
  hintEl.classList.toggle('ready', ready);
  hintEl.hidden = !text;
}

function drawBox(box, ready) {
  const ctx = overlay.getContext('2d');
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!box) return;

  ctx.strokeStyle = ready ? '#7fbf7f' : '#e0a63a';
  ctx.lineWidth = Math.max(2, overlay.width / 240);
  ctx.beginPath();
  ctx.roundRect(box.originX, box.originY, box.width, box.height, 12);
  ctx.stroke();
}

// ---------- Face checks ----------

// Rough head pose from the detector's keypoints: where the nose sits relative
// to the midpoint between the eyes, scaled by the distance between the eyes.
function estimatePose(keypoints) {
  const [eyeA, eyeB, nose] = keypoints;
  const midX = (eyeA.x + eyeB.x) / 2;
  const midY = (eyeA.y + eyeB.y) / 2;
  const eyeDist = Math.hypot(eyeA.x - eyeB.x, eyeA.y - eyeB.y) || 1;
  return {
    yaw: (nose.x - midX) / eyeDist,
    pitch: (nose.y - midY) / eyeDist
  };
}

// Average luminance of a tiny downscaled frame. Cheap enough to run twice a second.
function measureBrightness() {
  const w = 32;
  const h = 24;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (w * h);
}

function evaluate(detections, now) {
  const stepIndex = currentStep();
  if (stepIndex === -1) return { ok: false, hint: '', box: null };

  if (detections.length === 0) {
    return { ok: false, hint: 'No face found — move into the frame', box: null };
  }
  if (detections.length > 1) {
    return { ok: false, hint: 'Only one person at a time', box: null };
  }

  const face = detections[0];
  const box = face.boundingBox;
  const size = box.width / video.videoWidth;
  const cx = (box.originX + box.width / 2) / video.videoWidth;
  const cy = (box.originY + box.height / 2) / video.videoHeight;

  if (now - lastBrightnessCheck > 500) {
    brightness = measureBrightness();
    lastBrightnessCheck = now;
  }

  if (brightness < 60) return { ok: false, hint: 'Too dark — find more light', box };
  if (size < 0.22) return { ok: false, hint: 'Move a little closer', box };
  if (size > 0.7) return { ok: false, hint: 'Move back a little', box };
  if (Math.abs(cx - 0.5) > 0.2 || Math.abs(cy - 0.5) > 0.22) {
    return { ok: false, hint: 'Center your face in the frame', box };
  }

  const pose = estimatePose(face.keypoints);
  const step = STEPS[stepIndex];
  const base = shots[0]?.pose ?? { yaw: 0, pitch: 0 };
  if (!step.check(pose, base)) return { ok: false, hint: step.hint, box, pose };

  return { ok: true, hint: 'Looks good — hold still and capture', box, pose };
}

function checkCvSign(now) {
  const { landmarks } = hands.detectForVideo(video, now);
  if (!isCvSign(landmarks)) {
    cvSince = 0;
    return;
  }
  cvSince ||= now;
  if (now - cvSince >= CV_HOLD_MS) openEasterEgg();
}

function openEasterEgg() {
  hands = null; // stop checking while we navigate away
  try {
    sessionStorage.setItem('sidlock-cv', '1');
  } catch {}
  document.querySelector('.scanner').classList.add('unlocked');
  setTimeout(() => {
    window.location.href = 'egg.html';
  }, 600);
}

function detectLoop() {
  if (video.readyState >= 2) {
    const now = performance.now();
    frameCount++;

    if (detector) {
      const { detections } = detector.detectForVideo(video, now);
      const result = evaluate(detections, now);
      latest = result;
      drawBox(result.box, result.ok);
      setHint(result.hint, result.ok);
      updateCaptureButton();
    }

    if (hands && frameCount % HAND_CHECK_EVERY === 0) checkCvSign(now);
  }
  requestAnimationFrame(detectLoop);
}

async function loadVision() {
  vision ||= await FilesetResolver.forVisionTasks(WASM_URL);
  return vision;
}

// Loaded separately from the face detector so a failure here never breaks
// enrollment — the easter egg just quietly doesn't work.
async function loadHands() {
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 2
  });
  const fileset = await loadVision();
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

async function loadDetector() {
  const fileset = await loadVision();
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.6
  });
  try {
    return await FaceDetector.createFromOptions(fileset, options('GPU'));
  } catch {
    return await FaceDetector.createFromOptions(fileset, options('CPU'));
  }
}

// ---------- Capture ----------

function grabFrame() {
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  // The preview is mirrored via CSS; the raw video frame isn't, which is what
  // we want to save.
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function retake(i) {
  if (busy) return;
  shots[i] = null;
  setStatus(`Retaking the ${STEPS[i].label.toLowerCase()} photo.`);
  renderFilmstrip();
}

captureBtn.addEventListener('click', () => {
  const i = currentStep();
  if (i === -1) return;
  if (detector && !latest.ok) return;

  shots[i] = { dataUrl: grabFrame(), pose: latest.pose ?? null };
  latest = { ok: false, pose: null };
  renderFilmstrip();

  const count = capturedCount();
  if (count < MIN_PHOTOS) {
    setStatus(`${count} of ${STEPS.length} photos — at least ${MIN_PHOTOS} needed.`);
  } else if (count < STEPS.length) {
    setStatus(`${count} of ${STEPS.length} photos — you can enroll now, but more angles help.`);
  } else {
    setStatus('All photos captured.');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = nameInput.value.trim();
  if (!name) {
    setStatus('Enter a name first.', 'err');
    return;
  }
  if (!shots[0] || capturedCount() < MIN_PHOTOS) {
    setStatus(`Capture at least ${MIN_PHOTOS} photos, including the front one.`, 'err');
    return;
  }

  busy = true;
  renderFilmstrip();
  setStatus('Sending to the lock controller…');

  try {
    const response = await fetch('/api/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, images: shots.filter(Boolean).map((s) => s.dataUrl) })
    });

    const result = await response.json();

    if (result.success) {
      setStatus(`Enrolled ${name}. They can now unlock with their face.`, 'ok');
      shots.fill(null);
      nameInput.value = '';
    } else {
      setStatus(result.error || 'Enrollment failed.', 'err');
    }
  } catch (err) {
    setStatus('Network error reaching the server.', 'err');
  } finally {
    busy = false;
    renderFilmstrip();
  }
});

// ---------- Startup ----------

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    return true;
  } catch (err) {
    setStatus(
      'Could not access the camera. Check permissions, and make sure you\'re on HTTPS or localhost.',
      'err'
    );
    return false;
  }
}

renderFilmstrip();
setHint('Starting camera…', false);

if (await startCamera()) {
  setHint('Loading face detection…', false);
  try {
    detector = await loadDetector();
  } catch (err) {
    console.error('Face detector failed to load:', err);
    setHint('', false);
    setStatus('Face checks unavailable (offline?). You can still capture manually.', 'err');
  }
  renderFilmstrip();
  requestAnimationFrame(detectLoop);

  loadHands()
    .then((landmarker) => {
      hands = landmarker;
    })
    .catch((err) => console.warn('Hand tracking unavailable:', err));
}
