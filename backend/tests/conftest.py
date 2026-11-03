import os
import sys
import tempfile
from pathlib import Path

# --- Environment must be set before the app settings are first read -------------------------
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
TEST_DB = os.environ.get("EDUAI_TEST_DB", "eduai_test")  # set per checkout to run suites side by side
os.environ["DATABASE_URL"] = f"postgresql://postgres@127.0.0.1:5433/{TEST_DB}"
os.environ["PROVIDER_MODE"] = "mock"
os.environ["STORAGE_MODE"] = "local"
os.environ["STORAGE_ROOT"] = tempfile.mkdtemp(prefix="eduai-test-storage-")
os.environ["REDIS_URL"] = ""
# Tests never reach the live search APIs (keys in backend/.env are for running the app).
os.environ["SERPAPI_API_KEY"] = ""
os.environ["YOUTUBE_API_KEY"] = ""
# Pin this independently of the repo-root .env (which a running instance may have switched on for itself): the
# licence-matrix tests assert the *default*, unapproved behaviour and flip it on with monkeypatch where they need to.
os.environ["DIKSHA_EMBED_NONCOMMERCIAL"] = "false"
os.environ["SESSION_AGENTS_CACHE_MINUTES"] = "0"
# AI avatar tutor: offline lesson + system voice, no background warm-up threads (tests swap in fakes where needed).
os.environ["AI_TUTOR_PROVIDER"] = "mock"
os.environ["TTS_MODE"] = "offline"
os.environ["READ_ALOUD_PREWARM"] = "false"

import psycopg  # noqa: E402
import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database():
    from app import devdb

    devdb.start()
    with psycopg.connect("postgresql://postgres@127.0.0.1:5433/postgres", autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{TEST_DB}"')
    from scripts import migrate, seed

    migrate.run()
    seed.run()
    yield


@pytest.fixture(scope="session")
def client(_database):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, email: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def teacher(client):
    return _login(client, "teacher@demo.edu")


@pytest.fixture(scope="session")
def student(client):
    return _login(client, "student@demo.edu")


@pytest.fixture(scope="session")
def student_phy_only(client):
    return _login(client, "meera@demo.edu")


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin@demo.edu")
