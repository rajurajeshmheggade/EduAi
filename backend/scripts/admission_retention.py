"""Applies each school's admissions retention timers.   python -m scripts.admission_retention [--dry-run]

Runs as the database owner (the application role cannot delete evidence such as the audit log). Schedule it nightly
(cron / Windows Task Scheduler / a CI job). Data classes whose tables arrive in later milestones report "not yet
applicable" instead of pretending to purge.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from app import db

DEFAULTS = {"proctor_snapshots": 30, "proctor_events": 180, "unsuccessful_applicants": 180, "withdrawn_enquiries": 90,
            "audit_log": 365}
MINIMUM = {"audit_log": 365}
PENDING = {"proctor_snapshots": "Milestone 5", "proctor_events": "Milestone 5", "unsuccessful_applicants": "Milestone 2",
           "withdrawn_enquiries": "Milestone 2"}


def _purge_audit_log(conn, org: str, cutoff: datetime, dry: bool) -> int:
    if dry:
        return conn.execute("SELECT COUNT(*) AS n FROM admission.audit_log WHERE org_code = %s AND created_at < %s",
                            (org, cutoff)).fetchone()["n"]
    return conn.execute("DELETE FROM admission.audit_log WHERE org_code = %s AND created_at < %s", (org, cutoff)).rowcount


PURGERS = {"audit_log": _purge_audit_log}


def run(dry_run: bool = False, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    orgs = [r["org_code"] for r in db.fetch_all("SELECT DISTINCT org_code FROM admission.audit_log "
                                                 "UNION SELECT DISTINCT org_code FROM admission.retention_policies")]
    report = []
    with db.connection() as conn:
        for org in sorted(orgs):
            custom = {r["data_class"]: r["retain_days"] for r in conn.execute(
                "SELECT data_class, retain_days FROM admission.retention_policies WHERE org_code = %s", (org,)).fetchall()}
            for data_class, default in DEFAULTS.items():
                days = max(custom.get(data_class, default), MINIMUM.get(data_class, 1))
                purge = PURGERS.get(data_class)
                if not purge:
                    report.append({"org": org, "data_class": data_class, "days": days, "deleted": 0,
                                   "note": f"not yet applicable ({PENDING[data_class]})"})
                    continue
                n = purge(conn, org, now - timedelta(days=days), dry_run)
                report.append({"org": org, "data_class": data_class, "days": days, "deleted": n, "note": "dry run" if dry_run else ""})
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="count what would be deleted")
    args = ap.parse_args()
    for r in run(args.dry_run):
        print(f"{r['org']:<14} {r['data_class']:<24} keep {r['days']:>4} days  deleted {r['deleted']:>5}  {r['note']}")
