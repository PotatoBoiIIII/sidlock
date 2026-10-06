// Shared MediaPipe loaders for the home (unlock) and enrollment pages.

import {
  FaceDetector,
  FilesetResolver,
  HandLandmarker
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let fileset = null;

async function loadFileset() {
  fileset ||= await FilesetResolver.forVisionTasks(WASM_URL);
  return fileset;
}

// Try the GPU first; some machines/browsers only support the CPU path.
async function createWithFallback(Task, options) {
  const files = await loadFileset();
  const withDelegate = (delegate) => ({
    ...options,
    baseOptions: { ...options.baseOptions, delegate }
  });
  try {
    return await Task.createFromOptions(files, withDelegate('GPU'));
  } catch {
    return await Task.createFromOptions(files, withDelegate('CPU'));
  }
}

export function loadFaceDetector() {
  return createWithFallback(FaceDetector, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.6
  });
}

export function loadHands() {
  return createWithFallback(HandLandmarker, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL },
    runningMode: 'VIDEO',
    numHands: 2
  });
}
