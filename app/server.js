// server.js
// Serves the enrollment web app and forwards enrollment submissions to the
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Enrollment app running at http://localhost:${PORT}`);
  console.log(`Forwarding enrollments to Pi at: ${PI_URL}`);
});
