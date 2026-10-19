# pi_server.py — receives one photo per person, saves it, and unlocks the
# fridge for enrolled faces.
#
# Run from inside faceid/:   python recieve.py
# To drive a real lock, set the GPIO pin the lock's relay is wired to:
#   LOCK_PIN=17 python recieve.py
import base64
import binascii
import io
import os
import threading
from pathlib import Path

import face_recognition
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # allow the website to send requests here

FACES = Path("faces")
FACES.mkdir(exist_ok=True)

# How close two faces must be to count as the same person. face_recognition's
# default is 0.6; lower is stricter (fewer strangers let in, more misses).
MATCH_THRESHOLD = 0.5

# GPIO pin wired to the lock's relay. Unset = just print instead (handy for
# testing on a laptop).
LOCK_PIN = os.environ.get("LOCK_PIN")
UNLOCK_SECONDS = 5

relay = None
if LOCK_PIN:
    from gpiozero import OutputDevice

    relay = OutputDevice(int(LOCK_PIN), initial_value=False)


def open_fridge(name):
    """Unlocks for a few seconds, then locks again."""
    print(f"Unlocking for {name}")
    if relay is None:
        return
    relay.on()
    threading.Timer(UNLOCK_SECONDS, relay.off).start()


def decode_data_url(data_url):
    """'data:image/jpeg;base64,...' -> raw JPEG bytes, or None if malformed."""
    try:
        return base64.b64decode(data_url.split(",", 1)[1])
    except (AttributeError, IndexError, binascii.Error):
        return None


def photo_from_request():
    """Returns (name, jpeg_bytes) from either a JSON body or a file upload."""
    if request.is_json:
        # What the website sends:
        # {"name": "...", "images": ["data:image/jpeg;base64,...", ...]}
        # The first image is always the straight-on "Front" photo.
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        images = body.get("images") or []
        return name, decode_data_url(images[0]) if images else None

    # A plain form upload with fields "name" and "photo".
    upload = request.files.get("photo")
    return request.form.get("name", "").strip(), upload.read() if upload else None


def face_encodings(jpeg_bytes):
    image = face_recognition.load_image_file(io.BytesIO(jpeg_bytes))
    return face_recognition.face_encodings(image)


# Encodings of enrolled photos, cached so each unlock doesn't reprocess every
# photo. Keyed by filename; refreshed when a photo file changes.
_known = {}  # filename -> (modified_time, encoding)


def known_faces():
    """Returns {display name: encoding} for every photo in faces/."""
    files = {p.name: p for p in FACES.glob("*.jpg")}
    for gone in set(_known) - set(files):
        del _known[gone]

    for filename, path in files.items():
        mtime = path.stat().st_mtime
        if filename in _known and _known[filename][0] == mtime:
            continue
        found = face_encodings(path.read_bytes())
        _known[filename] = (mtime, found[0] if found else None)

    # "Lamelo_Ball.jpg" -> "Lamelo Ball"
    return {
        Path(f).stem.replace("_", " "): enc
        for f, (_, enc) in _known.items()
        if enc is not None
    }


@app.post("/enroll")
def enroll():
    name, photo = photo_from_request()
    if not name or not photo:
        return jsonify(error="Send a name and a photo."), 400

    filename = secure_filename(name) + ".jpg"  # "Lamelo Ball" -> faces/Lamelo_Ball.jpg
    if filename == ".jpg":
        return jsonify(error="That name can't be used as a filename."), 400

    # Make sure the photo is usable before saving it.
    found = face_encodings(photo)
    if len(found) != 1:
        return jsonify(error="Couldn't find exactly one face in the photo. Try again."), 400

    (FACES / filename).write_bytes(photo)  # re-enrolling the same name replaces the photo
    return jsonify(ok=True, saved=filename)


@app.post("/unlock")
def unlock():
    body = request.get_json(silent=True) or {}
    photo = decode_data_url(body.get("image"))
    if not photo:
        return jsonify(error="Send a photo."), 400

    found = face_encodings(photo)
    known = known_faces()
    if not found or not known:
        return jsonify(recognized=False)

    names = list(known)
    distances = face_recognition.face_distance(np.array(list(known.values())), found[0])
    best = int(np.argmin(distances))
    if distances[best] > MATCH_THRESHOLD:
        return jsonify(recognized=False)

    open_fridge(names[best])
    return jsonify(recognized=True, name=names[best])


@app.get("/faces")
def list_faces():
    return jsonify(sorted(p.stem.replace("_", " ") for p in FACES.glob("*.jpg")))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
