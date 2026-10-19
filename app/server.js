// server.js
// Serves the web app and forwards enrollment and unlock requests to the
// Raspberry Pi lock controller. Proxying through here (instead of calling
// the Pi directly from the browser) avoids CORS headaches and means only
// this server needs to know the Pi's address.

const express = require('express');
const cors = require('cors');

const app = express();

// Where the Raspberry Pi's Flask server is listening.
// Override with: PI_URL=http://192.168.1.42:5000 npm start
const PI_URL = process.env.PI_URL || 'http://10.101.156.251:5000';

app.use(cors());
app.use(express.json({ limit: '15mb' })); // photos as base64 can be a few MB each
app.use(express.static('public'));

// Reads the Pi's reply. A reply that isn't JSON (e.g. Flask's HTML 404 page
// when the Pi is running older code without that route) gets a clear message
// instead of being mistaken for the Pi being unreachable.
async function readPiReply(piResponse, route) {
  try {
    return await piResponse.json();
  } catch {
    if (piResponse.status === 404) {
      return { error: `The Pi doesn't have a ${route} route. Update the code on the Pi and restart it.` };
    }
    return { error: `The Pi sent an unexpected reply (HTTP ${piResponse.status}).` };
  }
}

// Health check so you can quickly confirm the server is up.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', piUrl: PI_URL });
});

// Forwards enrollment data (name + photos) to the Pi's /enroll endpoint.
app.post('/api/enroll', async (req, res) => {
  const { name, images } = req.body;

  if (!name || !Array.isArray(images) || images.length < 3) {
    return res.status(400).json({
      success: false,
      error: 'Provide a name and at least 3 photos.'
    });
  }

  try {
    const piResponse = await fetch(`${PI_URL}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, images })
    });

    const data = await readPiReply(piResponse, '/enroll');

    if (!piResponse.ok) {
      return res.status(piResponse.status).json({
        success: false,
        error: data.error || 'Pi rejected the enrollment.'
      });
    }

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Could not reach the Pi:', err.message);
    res.status(502).json({
      success: false,
      error: `Could not reach the lock controller at ${PI_URL}. Is it running and on the same network?`
    });
  }
});

// Sends one photo to the Pi's /unlock endpoint, which checks it against the
// enrolled faces and opens the lock on a match.
app.post('/api/unlock', async (req, res) => {
  const { image } = req.body;

  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ success: false, error: 'Provide a photo.' });
  }

  try {
    const piResponse = await fetch(`${PI_URL}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      // Face matching on the Pi can take a few seconds; don't hang forever.
      signal: AbortSignal.timeout(20000)
    });

    const data = await readPiReply(piResponse, '/unlock');

    if (!piResponse.ok) {
      return res.status(piResponse.status).json({
        success: false,
        error: data.error || 'Pi rejected the unlock request.'
      });
    }

    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Could not reach the Pi:', err.message);
    res.status(502).json({
      success: false,
      error: `Could not reach the lock controller at ${PI_URL}.`
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Enrollment app running at http://localhost:${PORT}`);
  console.log(`Forwarding enrollments and unlocks to Pi at: ${PI_URL}`);
});
