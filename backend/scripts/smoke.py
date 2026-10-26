"""End-to-end smoke test against a RUNNING stack (through the Vite proxy by default).

    python -m scripts.smoke [base_url]      # default http://127.0.0.1:5173
"""
import sys
import time

import httpx

from scripts.sample_pdf import build_sample_textbook

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173"
C = "/ICMELive/api/v1"


def login(c: httpx.Client, email: str) -> dict:
    r = c.post("/api/v1/auth/login", json={"email": email, "password": "Passw0rd!"})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


with httpx.Client(base_url=BASE, timeout=60) as c:
    print("health:", c.get("/health").json())
    t, s = login(c, "teacher@demo.edu"), login(c, "student@demo.edu")

    r = c.post(f"{C}/curriculum/upload-textbook", headers=t, data={"title": "Smoke Physics", "subject_code": "PHY101"},
               files={"file": ("b.pdf", build_sample_textbook(), "application/pdf")})
    r.raise_for_status()
    body = r.json()
    for _ in range(60):
        job = c.get(f"{C}/curriculum/jobs/{body['job_id']}", headers=t).json()
        if job["status"] in ("completed", "failed"):
            break
        time.sleep(0.5)
    print("job:", job["status"], job["detail"])
    assert job["status"] == "completed", job["error"]

    c.post(f"{C}/curriculum/textbooks/{body['textbook_id']}/publish", headers=t, json={"published": True}).raise_for_status()
    g = c.post(f"{C}/curriculum/generate-teaching-guide", headers=t,
               json={"textbook_id": body["textbook_id"], "chapter_number": 3, "duration_minutes": 45}).json()
    print("guide:", g["chapter_title"], "|", len(g["formative_questions"]), "check questions")

    with c.stream("POST", f"{C}/rag/query", headers=s,
                  json={"query": "State the universal law of gravitation", "subject_code": "PHY101"}) as resp:
        text = "".join(resp.iter_text())
    print("rag stream OK:", text.count("event: token"), "tokens;", "event: done" in text)
    print("SMOKE PASSED")
