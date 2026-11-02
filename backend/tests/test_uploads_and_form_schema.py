"""Unit tests: the reusable upload validator (services/uploads.py) and the admission form schema / answer validation
(services/admission/forms.py)."""
import io
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from app.services import uploads
from app.services.admission import applicant_auth as auth
from app.services.admission.forms import Definition, clean_draft, core_values, default_definition, document_problems, validate_answers


def _upload(data: bytes, name="file.bin") -> UploadFile:
    return UploadFile(io.BytesIO(data), filename=name)


def _png(size=(32, 32), mode="RGBA") -> bytes:
    b = io.BytesIO()
    Image.new(mode, size, (0, 0, 0, 0) if mode == "RGBA" else 0).save(b, "PNG")
    return b.getvalue()


def test_sniff_and_size_limits():
    assert uploads.sniff(b"%PDF-1.7") == "pdf" and uploads.sniff(_png()) == "png" and uploads.sniff(b"\xff\xd8\xff\xe0") == "jpg"
    assert uploads.sniff(b"GIF89a") is None and uploads.sniff(b"PK\x03\x04") is None
    with pytest.raises(HTTPException) as e:
        uploads.validate_upload(_upload(b"x" * 2048), allowed=("pdf",), max_bytes=1024)
    assert e.value.status_code == 413
    with pytest.raises(HTTPException) as e:
        uploads.validate_upload(_upload(b""), allowed=("pdf",), max_bytes=1024)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        uploads.validate_upload(_upload(_png(), "a.pdf"), allowed=("pdf",), max_bytes=1 << 20)
    assert e.value.status_code == 415 and "PDF" in e.value.detail
    with pytest.raises(ValueError):
        uploads.validate_upload(_upload(_png()), allowed=("exe",), max_bytes=1 << 20)


def test_images_are_reencoded_and_bombs_refused():
    up = uploads.validate_upload(_upload(_png((4000, 100)), "logo.PNG"), allowed=("png",), max_bytes=1 << 20, max_image_side=512)
    img = Image.open(io.BytesIO(up.data))
    assert img.format == "PNG" and max(img.size) == 512 and img.mode == "RGBA"   # transparency kept
    assert up.filename == "logo.png" and up.mime == "image/png" and len(up.sha256) == 64
    # a PNG header followed by junk is refused, and a decompression bomb too
    with pytest.raises(HTTPException) as e:
        uploads.validate_upload(_upload(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100), allowed=("png",), max_bytes=1 << 20)
    assert e.value.status_code == 415
    bomb = io.BytesIO()
    Image.new("1", (10000, 10000)).save(bomb, "PNG")
    with pytest.raises(HTTPException) as e:
        uploads.validate_upload(_upload(bomb.getvalue()), allowed=("png",), max_bytes=1 << 20)
    assert e.value.status_code == 415


def test_safe_filenames_and_content_disposition():
    assert uploads.safe_filename("../../etc/passwd", ".pdf") == "passwd.pdf"
    assert uploads.safe_filename("C:\\Users\\me\\report card.exe", ".pdf") == "report card.pdf"
    assert uploads.safe_filename("<script>.jpg", ".jpg") == "script.jpg"
    assert uploads.safe_filename("", ".png") == "document.png"
    h = uploads.content_disposition("जन्म प्रमाणपत्र.pdf")
    assert h.startswith('attachment; filename="') and "filename*=UTF-8''" in h and "\n" not in h


def test_credentials_are_strong_and_unambiguous():
    names = {auth.new_username("DEMO-SCHOOL") for _ in range(200)}
    assert len(names) == 200 and all(n.startswith("DEMO-") and len(n) == 13 for n in names)
    pw = auth.new_password()
    assert len(pw) == 14 and pw.count("-") == 2 and not set(pw) & set("IOl01")
    assert any(c.isupper() for c in pw) and any(c.islower() for c in pw) and any(c.isdigit() for c in pw)
    assert auth.new_reference().startswith("APP-")


def _dob(years):
    return (date.today().replace(year=date.today().year - years) - timedelta(days=10)).isoformat()


def test_default_template_is_valid_and_publishable():
    d = Definition.model_validate(default_definition())
    assert d.publish_problems() == []
    kinds = [s.kind for s in d.sections]
    assert kinds == ["student", "guardian", "academic"] and {x.key for x in d.documents} >= {"birth_certificate", "photo"}


def test_definition_rules():
    base = default_definition()
    with pytest.raises(ValidationError, match="unique"):
        Definition.model_validate({**base, "sections": base["sections"] + [{**base["sections"][0], "key": "again"}]})
    with pytest.raises(ValidationError, match="options"):
        Definition.model_validate({**base, "sections": [{"key": "x1", "title": "X", "fields": [
            {"key": "pick", "label": "Pick", "type": "select", "options": []}]}]})
    with pytest.raises(ValidationError):
        Definition.model_validate({**base, "sections": [{"key": "x1", "title": "X", "fields": [
            {"key": "Bad Key", "label": "Bad", "type": "text"}]}]})
    # core fields are forced required; missing ones are reported at publication, not while drafting
    d = Definition.model_validate({**base, "sections": [{"key": "s1", "title": "S", "fields": [
        {"key": "dob", "label": "DOB", "type": "date", "core": "date_of_birth", "required": False}]}]})
    assert d.sections[0].fields[0].required is True
    assert any("student name" in p for p in d.publish_problems())


def test_answer_validation():
    defn = default_definition()
    grades = [6, 7, 8]
    good = {"student_name": "Riya", "date_of_birth": _dob(12), "grade_applying": "7", "home_address": "x", "guardian_name": "N",
            "guardian_relationship": "Mother", "guardian_phone": "+91 98450 12345", "last_percentage": "88.5", "gender": "Female"}
    clean, errors = validate_answers(defn, good, grades)
    assert errors == [] and clean["grade_applying"] == 7 and clean["last_percentage"] == 88.5
    assert core_values(defn, clean)["guardian_relationship"] == "Mother"
    bad = {**good, "date_of_birth": _dob(40), "grade_applying": 12, "guardian_phone": "call me", "guardian_email": "x@",
           "gender": "Robot", "last_percentage": 120, "student_name": "x" * 201}
    _, errors = validate_answers(defn, bad, grades)
    assert {e["field"] for e in errors} == {"date_of_birth", "grade_applying", "guardian_phone", "guardian_email", "gender",
                                            "last_percentage", "student_name"}
    _, errors = validate_answers(defn, {}, grades)
    assert {e["field"] for e in errors} == {"student_name", "date_of_birth", "grade_applying", "home_address", "guardian_name",
                                            "guardian_relationship", "guardian_phone"}
    assert clean_draft(defn, {"student_name": "  R  ", "unknown": "x", "guardian_email": ""}) == {"student_name": "R"}
    with pytest.raises(ValueError):
        clean_draft(defn, {"student_name": {"$gt": ""}})
    assert document_problems(defn, {"photo": 1}) == [{"field": "birth_certificate", "label": "Birth certificate", "message": "Upload this document"}]
    assert document_problems(defn, {"birth_certificate": 1, "photo": 2})[0]["field"] == "photo"
