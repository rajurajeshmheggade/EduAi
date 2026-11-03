"""Unified AI proctoring for student flows: Online Tests, Virtual Labs and AI Classroom (flags only, no images).

config     modules, rules text, flag catalogue + severity, per-module thresholds
exams      what an exam is per module, its assigned teachers, roster, and what ending it means
sessions   lifecycle, append-only flags, teacher actions, notifications, interruption sweep
hub        real-time fan-out to teachers (in-process, optional Redis bridge)
retention  purge of finished sessions after the retention period
"""
