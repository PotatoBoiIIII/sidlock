const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const filmstrip = document.getElementById('filmstrip');
const captureBtn = document.getElementById('captureBtn');
const submitBtn = document.getElementById('submitBtn');
const form = document.getElementById('form');
const nameInput = document.getElementById('name');
const statusEl = document.getElementById('status');

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 5;
const capturedImages = [];

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function renderFilmstrip() {
  filmstrip.innerHTML = '';
  capturedImages.forEach((src) => {
    const img = document.createElement('img');
    img.src = src;
    filmstrip.appendChild(img);
  });
  for (let i = capturedImages.length; i < MAX_PHOTOS; i++) {
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.textContent = '·';
    filmstrip.appendChild(ph);
  }
  submitBtn.disabled = capturedImages.length < MIN_PHOTOS;
  captureBtn.disabled = capturedImages.length >= MAX_PHOTOS;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' }
    });
    video.srcObject = stream;
  } catch (err) {
    setStatus(
      'Could not access the camera. Check permissions, and make sure you\'re on HTTPS or localhost.',
      'err'
    );
  }
}

captureBtn.addEventListener('click', () => {
  if (capturedImages.length >= MAX_PHOTOS) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');

  // Un-mirror when drawing to canvas, since the video preview is flipped
  // for a natural "look in a mirror" feel but the saved photo shouldn't be.
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  capturedImages.push(dataUrl);
  renderFilmstrip();

  setStatus(`${capturedImages.length} of ${MIN_PHOTOS}–${MAX_PHOTOS} photos captured.`);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = nameInput.value.trim();
  if (!name) {
    setStatus('Enter a name first.', 'err');
    return;
  }
  if (capturedImages.length < MIN_PHOTOS) {
    setStatus(`Capture at least ${MIN_PHOTOS} photos.`, 'err');
    return;
  }

  submitBtn.disabled = true;
  captureBtn.disabled = true;
  setStatus('Sending to the lock controller…');

  try {
    const response = await fetch('/api/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, images: capturedImages })
    });

    const result = await response.json();

    if (result.success) {
      setStatus(`Enrolled ${name}. They can now unlock with their face.`, 'ok');
      capturedImages.length = 0;
      nameInput.value = '';
      renderFilmstrip();
    } else {
      setStatus(result.error || 'Enrollment failed.', 'err');
    }
  } catch (err) {
    setStatus('Network error reaching the server.', 'err');
  } finally {
    submitBtn.disabled = capturedImages.length < MIN_PHOTOS;
    captureBtn.disabled = capturedImages.length >= MAX_PHOTOS;
  }
});

renderFilmstrip();
startCamera();
