import time
import cv2
import numpy as np
import face_recognition
import os
SCALE = 0.5  # shrink frames for faster detection (0.25 is faster still)


def encode(path):
    img = face_recognition.load_image_file(path)
    encodings = face_recognition.face_encodings(img)
    if not encodings:
        raise SystemExit(f"No face found in {path}")
    return encodings[0]



known_face_encodings = []
known_face_names = []
for filename in sorted(os.listdir("./faces")):
    if filename.lower().endswith((".jpg", ".jpeg", ".png")):
        image = face_recognition.load_image_file(os.path.join("faces", filename))
        found = face_recognition.face_encodings(image)
        if found:
            known_face_encodings.append(found[0])
            known_face_names.append(os.path.splitext(filename)[0])
        else:
            print(f"No face found in {filename}, skipping")
# Open the camera with the settings that worked in ffmpeg
cap = cv2.VideoCapture(0, cv2.CAP_V4L2)
cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

if not cap.isOpened():
    raise SystemExit("Camera failed to open")

last_result = None
try:
    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            print("Failed to read frame")
            time.sleep(0.1)
            continue

        # Shrink, then convert BGR -> RGB as a contiguous array (dlib needs this)
        small = cv2.resize(frame, (0, 0), fx=SCALE, fy=SCALE)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

        face_locations = face_recognition.face_locations(rgb)
        face_encodings = face_recognition.face_encodings(rgb, face_locations)

        names = []
        for face_encoding in face_encodings:
            matches = face_recognition.compare_faces(known_face_encodings, face_encoding)
            distances = face_recognition.face_distance(known_face_encodings, face_encoding)
            best = int(np.argmin(distances))
            names.append(known_face_names[best] if matches[best] else "Unknown")

        # Only print when the result changes, to avoid flooding the terminal
        result = tuple(names)
        if result != last_result:
            print(f"{time.strftime('%H:%M:%S')}  faces: {len(names)}  {list(names)}")
            last_result = result
except KeyboardInterrupt:
    pass
finally:
    cap.release()
