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
const PI_URL = process.env.PI_URL || 'http://raspberrypi.local:5000';

app.use(cors());
app.use(express.json({ limit: '15mb' })); // photos as base64 can be a few MB each
app.use(express.static('public'));

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

    const data = await piResponse.json();

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

// Until the Pi is ready, unlocking is simulated unless PI_URL is set
// explicitly. The response includes mock: true so the page can say so.
const MOCK_UNLOCK = !process.env.PI_URL;

// Sends one photo to the Pi's /unlock endpoint, which checks it against the
// enrolled faces and opens the lock on a match.
app.post('/api/unlock', async (req, res) => {
  const { image } = req.body;

  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ success: false, error: 'Provide a photo.' });
  }

  if (MOCK_UNLOCK) {
    const recognized = Math.random() < 0.8;
    return res.json({ success: true, recognized, name: null, mock: true });
  }

  try {
    const piResponse = await fetch(`${PI_URL}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image })
    });

    const data = await piResponse.json();

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
  console.log(`Forwarding enrollments to Pi at: ${PI_URL}`);
  if (MOCK_UNLOCK) console.log('Unlock is simulated (set PI_URL to use the real Pi).');
});
