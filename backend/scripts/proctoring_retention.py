"""Deletes finished student proctoring sessions after the retention period.   python -m scripts.proctoring_retention [--days N]

Sessions (Online Tests, Virtual Labs, AI Classroom) that ended more than `retention_days` ago (per school and module,
default 180; Admin console -> Proctoring) are removed with their flags and teacher actions. Schedule it daily
(cron / Windows Task Scheduler).
"""
from __future__ import annotations

import argparse

from app.db import close_pool
from app.services.proctoring.retention import purge

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None, help="override every school's retention period")
    print(purge(ap.parse_args().days))
    close_pool()
