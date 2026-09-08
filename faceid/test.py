import face_recognition

for filename in ["obama.jpg", "biden.jpg"]:
    image = face_recognition.load_image_file(filename)
    locations = face_recognition.face_locations(image)

    print(f"{filename}: {len(locations)} face(s) detected")

    if not locations:
        print(f"  ERROR: No face detected in {filename}")

