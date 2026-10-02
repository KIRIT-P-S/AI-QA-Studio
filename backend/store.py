import os
import json
import uuid
import datetime
import time
from contextlib import contextmanager
from urllib.parse import urlparse
from typing import Callable, TypeVar, Any

from models import Studio, Project, Activity

T = TypeVar('T')

DATA_DIR = os.environ.get("STUDIO_DATA_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web", "data", "studio")))
FILE_PATH = os.path.join(DATA_DIR, "studio.json")
LOCK_PATH = os.path.join(DATA_DIR, ".write-lock")

os.makedirs(DATA_DIR, exist_ok=True)

def generate_id(prefix: str) -> str:
    return f"{prefix}-{str(uuid.uuid4())[:8]}"

def read_store() -> Studio:
    try:
        with open(FILE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return Studio(**data)
    except FileNotFoundError:
        return Studio(version=1, projects=[])

@contextmanager
def write_lock():
    deadline = time.monotonic() + 120
    while True:
        try:
            os.mkdir(LOCK_PATH)
            break
        except FileExistsError:
            if time.monotonic() > deadline:
                raise ValueError("Storage is busy. Retry or inspect .write-lock after stopping all services.")
            time.sleep(0.05)
    try:
        yield
    finally:
        os.rmdir(LOCK_PATH)

def mutate(fn: Callable[[Studio], T]) -> T:
    os.makedirs(DATA_DIR, exist_ok=True)
    with write_lock():
        state = read_store()
        result = fn(state)

        temp_path = f"{FILE_PATH}.{uuid.uuid4()}.tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(state.model_dump(exclude_none=True), f, indent=2)
            for attempt in range(11):
                try:
                    os.replace(temp_path, FILE_PATH)
                    break
                except PermissionError:
                    if attempt == 10:
                        raise
                    time.sleep(0.05)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
        return result

def project_by_id(s: Studio, project_id: str) -> Project:
    for p in s.projects:
        if p.id == project_id:
            return p
    raise Exception("Project not found.")

def add_activity(p: Project, message: str):
    p.updatedAt = datetime.datetime.utcnow().isoformat() + "Z"
    new_activity = Activity(at=p.updatedAt, message=message)
    p.activity.insert(0, new_activity)
    p.activity = p.activity[:200]

def validate_url(value: str) -> str:
    try:
        parsed = urlparse(value)
        if parsed.scheme not in ["http", "https"] or not parsed.hostname or parsed.username or parsed.password:
            raise Exception("Use an HTTP(S) URL without embedded credentials.")
        _ = parsed.port
        return value
    except Exception:
        raise Exception("Enter a valid http:// or https:// application URL.")

def migrate_legacy_projects():
    """Preserve user projects from the API's former cwd-dependent store."""
    if os.environ.get("STUDIO_DATA_DIR"):
        return
    legacy_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "studio"))
    legacy_file = os.path.join(legacy_dir, "studio.json")
    if not os.path.exists(legacy_file) or os.path.abspath(DATA_DIR) == legacy_dir:
        return
    import shutil
    with open(legacy_file, encoding="utf8") as f:
        legacy = Studio(**json.load(f))
    def merge(state):
        existing = {p.id for p in state.projects}
        missing = [p for p in legacy.projects if p.id.startswith("PRJ-") and p.id not in existing]
        if not missing:
            return
        if os.path.exists(FILE_PATH) and not os.path.exists(FILE_PATH + ".before-storage-migration"):
            shutil.copy2(FILE_PATH, FILE_PATH + ".before-storage-migration")
        for p in missing:
            for result in p.results:
                for name in (result.screenshot, result.trace, result.video):
                    if name and os.path.basename(name) == name:
                        source = os.path.join(legacy_dir, "evidence", name)
                        destination = os.path.join(DATA_DIR, "evidence", name)
                        if os.path.isfile(source) and not os.path.exists(destination):
                            os.makedirs(os.path.dirname(destination), exist_ok=True)
                            shutil.copy2(source, destination)
            state.projects.append(p)
    mutate(merge)
