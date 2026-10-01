// Recognizes the secret "CV" hand sign: one hand curved into a C, the other
// making a V (peace sign). Works on MediaPipe HandLandmarker output, where each
// hand is 21 normalized points:
//   0 wrist · 1–4 thumb · 5–8 index · 9–12 middle · 13–16 ring · 17–20 pinky
// (each finger is MCP knuckle, PIP joint, DIP joint, TIP).
//
// Thresholds were tuned on a reference photo of the sign; adjust if real
// cameras are too strict or too loose.

const FINGER_BASES = { index: 5, middle: 9, ring: 13, pinky: 17 };

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function vec(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function angleBetween(u, v) {
  const dot = u.x * v.x + u.y * v.y;
  const mag = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

// Measurements for one hand. Distances are divided by palm length (wrist to
// middle knuckle) so they don't depend on how close the hand is.
export function measureHand(lm) {
  const palm = dist(lm[0], lm[9]) || 1;

  // Angle at each finger's middle joint: ~180° straight, ~130° slightly
  // curled, under ~90° folded into the palm.
  const joints = {};
  for (const [name, mcp] of Object.entries(FINGER_BASES)) {
    joints[name] = 180 - angleBetween(vec(lm[mcp], lm[mcp + 1]), vec(lm[mcp + 1], lm[mcp + 3]));
  }

  return {
    joints,
    vSpread: dist(lm[8], lm[12]) / palm, // index tip ↔ middle tip
    fingersTogether: dist(lm[8], lm[20]) / palm, // index tip ↔ pinky tip
    thumbGap: dist(lm[4], lm[8]) / palm, // thumb tip ↔ index tip
    thumbAlongIndex: angleBetween(vec(lm[2], lm[4]), vec(lm[5], lm[8])) // 0° = parallel
  };
}

// V: index and middle straight and spread apart, ring and pinky folded.
export function isV(m) {
  const { index, middle, ring, pinky } = m.joints;
  return index > 155 && middle > 155 && ring < 120 && pinky < 120 && m.vSpread > 0.3;
}

// C: all four fingers gently curled and held together, thumb running roughly
// alongside them with a gap — the opening of the C.
export function isC(m) {
  const curled = Object.values(m.joints).filter((a) => a > 95 && a < 165).length;
  return (
    curled >= 3 &&
    m.fingersTogether < 0.9 &&
    m.thumbAlongIndex < 60 &&
    m.thumbGap > 0.3 &&
    m.thumbGap < 1.4
  );
}

// True when one hand is a C and the other is a V.
export function isCvSign(hands) {
  if (hands.length < 2) return false;
  const [a, b] = hands.slice(0, 2).map(measureHand);
  return (isC(a) && isV(b)) || (isV(a) && isC(b));
}
