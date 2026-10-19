# pi_server.py — receives one photo per person and saves it
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # allow the website (on the laptop) to send requests here

FACES = Path("faces")
FACES.mkdir(exist_ok=True)

@app.post("/enroll")
def enroll():
    name = request.form.get("name", "").strip()
    photo = request.files.get("photo")
    if not name or not photo:
        return jsonify(error="Send a name and a photo."), 400

    filename = secure_filename(name) + ".jpg"  # "Raffi" -> faces/Raffi.jpg
    if not filename or filename == ".jpg":
        return jsonify(error="That name can't be used as a filename."), 400

    photo.save(FACES / filename)  # re-enrolling the same name replaces the photo
    return jsonify(ok=True, saved=filename)

@app.get("/faces")
def list_faces():
    return jsonify(sorted(p.stem for p in FACES.glob("*.jpg")))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)  # accept requests from other devices