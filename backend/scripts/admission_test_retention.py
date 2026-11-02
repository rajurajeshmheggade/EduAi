"""Deletes admission-test evidence after the retention period.   python -m scripts.admission_test_retention [--days N]

Evidence snapshots, ID photos and raw proctoring-event details older than EVIDENCE_RETENTION_DAYS (default 90) are
removed from storage and the database; event codes, times and the reports' aggregate numbers are kept. Schedule it
daily (cron / Windows Task Scheduler).
"""
from __future__ import annotations

import argparse

from app.db import close_pool
from app.services.admission_test.retention import purge

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None, help="override the retention period")
    print(purge(ap.parse_args().days))
    close_pool()
