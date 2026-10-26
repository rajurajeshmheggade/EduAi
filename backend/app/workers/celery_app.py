"""Celery app (Azure Cache for Redis broker). Run: celery -A app.workers.celery_app worker -l info -P solo"""
from celery import Celery

from ..config import get_settings
from . import tasks

s = get_settings()
celery_app = Celery("eduai", broker=s.redis_url or "memory://", backend=s.redis_url or None)
celery_app.conf.update(task_acks_late=True, worker_prefetch_multiplier=1, task_track_started=True)

for _name, _fn in tasks.TASKS.items():
    celery_app.task(name=f"eduai.{_name}", autoretry_for=(ConnectionError,), retry_backoff=True, max_retries=3)(_fn)
