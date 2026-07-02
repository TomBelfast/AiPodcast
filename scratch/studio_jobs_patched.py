"""
Job persistence and background execution for the Podcast Studio API.

This module adds a thin job queue on top of the existing podcast pipeline
without replacing the current CLI/skill flow.
"""

from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .speak import generate_audio
from .utils import get_data_dir, load_config, load_env, setup_logging

JOB_STATUSES = {
    "queued",
    "running_script",
    "running_tts",
    "running_video",
    "burning_subtitles",
    "done",
    "failed",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_jobs_dir() -> Path:
    jobs_dir = get_data_dir() / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    return jobs_dir


def get_job_dir(job_id: str) -> Path:
    return get_jobs_dir() / job_id


def get_job_file(job_id: str) -> Path:
    return get_job_dir(job_id) / "job.json"


def build_job_urls(job_id: str) -> dict[str, str]:
    return {
        "status_url": f"/api/v1/jobs/{job_id}",
        "result_url": f"/api/v1/jobs/{job_id}/result",
    }


def create_job(payload: dict[str, Any]) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    now = _utc_now()
    job_dir = get_job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)

    job = {
        "job_id": job_id,
        "status": "queued",
        "created_at": now,
        "updated_at": now,
        "callback_url": payload.get("callback_url"),
        "provider_override": payload.get("provider_override"),
        "text": payload.get("text"),
        "artifacts": {},
        "error": None,
        **build_job_urls(job_id),
    }
    save_job(job)
    return job


def save_job(job: dict[str, Any]) -> None:
    job["updated_at"] = _utc_now()
    job_dir = get_job_dir(job["job_id"])
    job_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = job_dir / "job.json.tmp"
    tmp_path.write_text(json.dumps(job, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(get_job_file(job["job_id"]))


def load_job(job_id: str) -> dict[str, Any]:
    job_file = get_job_file(job_id)
    if not job_file.exists():
        raise FileNotFoundError(job_id)
    return json.loads(job_file.read_text(encoding="utf-8"))


def update_job(job_id: str, **changes: Any) -> dict[str, Any]:
    job = load_job(job_id)
    job.update(changes)
    save_job(job)
    # Push callback on every status change — not just at the end.
    # This lets the Matrix status card react instantly instead of waiting for polling.
    if "status" in changes:
        _notify_callback(job)
    return job


def artifact_path(job_id: str, artifact_name: str) -> Path:
    return get_job_dir(job_id) / artifact_name


def _notify_callback(job: dict[str, Any]) -> None:
    callback_url = job.get("callback_url")
    if not callback_url:
        return

    payload = {
        "job_id": job["job_id"],
        "status": job["status"],
        "result_url": job["result_url"],
        "status_url": job["status_url"],
        "error": job.get("error"),
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            client.post(callback_url, json=payload)
    except Exception:
        logger = setup_logging()
        logger.warning("Callback failed for job %s", job["job_id"])


def _apply_provider_override(config: dict[str, Any], provider_override: str | None) -> dict[str, Any]:
    if not provider_override:
        return config

    if provider_override not in {"omnivoice", "elevenlabs"}:
        raise RuntimeError(f"Unsupported provider override: {provider_override}")

    config = dict(config)
    tts = dict(config.get("tts") or {})
    tts["provider"] = provider_override
    config["tts"] = tts
    return config


def process_job(job_id: str, payload: dict[str, Any]) -> None:
    logger = setup_logging()
    try:
        load_env()
    except FileNotFoundError:
        # OmniVoice-only setups may not need .env; ElevenLabs will fail later with a clear error.
        pass

    script_segments = payload.get("script_segments")
    text = str(payload.get("text") or "").strip()

    try:
        update_job(job_id, status="running_script")

        if script_segments:
            script_path = artifact_path(job_id, "script.json")
            script_path.write_text(
                json.dumps(script_segments, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            update_job(
                job_id,
                artifacts={**load_job(job_id)["artifacts"], "script.json": str(script_path)},
            )
            script_segments = json.loads(script_path.read_text(encoding="utf-8"))
        else:
            script_request_path = artifact_path(job_id, "request_text.txt")
            script_request_path.write_text(text, encoding="utf-8")
            update_job(
                job_id,
                artifacts={**load_job(job_id)["artifacts"], "request_text.txt": str(script_request_path)},
            )
            raise RuntimeError(
                "Brak backendu text->dialog w serwerze. Na tym etapie API dziala, ale do pelnego joba trzeba dodac generator script_segments."
            )

        update_job(job_id, status="running_tts")
        config = _apply_provider_override(load_config(), payload.get("provider_override"))
        audio_path = Path(generate_audio(script_segments, config, logger))
        saved_audio_path = artifact_path(job_id, "audio.mp3")
        shutil.copy2(audio_path, saved_audio_path)

        update_job(
            job_id,
            status="done",
            artifacts={**load_job(job_id)["artifacts"], "audio.mp3": str(saved_audio_path)},
        )
    except Exception as exc:
        update_job(job_id, status="failed", error=str(exc))
    finally:
        # Final callback — always fires regardless of status (covers edge cases
        # where status did not change but we still want to ensure delivery).
        _notify_callback(load_job(job_id))


def enqueue_job(payload: dict[str, Any]) -> dict[str, Any]:
    job = create_job(payload)
    thread = threading.Thread(
        target=process_job,
        args=(job["job_id"], payload),
        daemon=True,
        name=f"podcast-job-{job['job_id']}",
    )
    thread.start()
    return job
