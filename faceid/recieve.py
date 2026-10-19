# pi_server.py — receives one photo per person and saves it
import base64
import binascii
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # allow the website to send requests here

FACES = Path("faces")
FACES.mkdir(exist_ok=True)


def photo_from_request():
    """Returns (name, jpeg_bytes) from either a JSON body or a file upload."""
    if request.is_json:
        # What the website sends today:
        # {"name": "...", "images": ["data:image/jpeg;base64,...", ...]}
        # The first image is always the straight-on "Front" photo.
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        images = body.get("images") or []
        if not images:
            return name, None
        try:
            return name, base64.b64decode(images[0].split(",", 1)[1])
        except (IndexError, binascii.Error):
            return name, None

    # A plain form upload with fields "name" and "photo".
    upload = request.files.get("photo")
    return request.form.get("name", "").strip(), upload.read() if upload else None


@app.post("/enroll")
def enroll():
    name, photo = photo_from_request()
    if not name or not photo:
        return jsonify(error="Send a name and a photo."), 400

    filename = secure_filename(name) + ".jpg"  # "Lamelo Ball" -> faces/Lamelo_Ball.jpg
    if filename == ".jpg":
        return jsonify(error="That name can't be used as a filename."), 400

    (FACES / filename).write_bytes(photo)  # re-enrolling the same name replaces the photo
    return jsonify(ok=True, saved=filename)


@app.get("/faces")
def list_faces():
    return jsonify(sorted(p.stem for p in FACES.glob("*.jpg")))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)