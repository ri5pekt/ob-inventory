"""
Shared VPS SSH credentials loader for scripts/*.py.

Reads VPS_HOST / VPS_USER / VPS_PASSWORD from the environment, falling back to
the project root .env file (gitignored). Never hardcode these values directly
in a script — import them from here instead:

    from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD
"""
import os
from pathlib import Path


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

VPS_HOST     = os.environ.get("VPS_HOST")
VPS_USER     = os.environ.get("VPS_USER", "root")
VPS_PASSWORD = os.environ.get("VPS_PASSWORD")

if not VPS_HOST or not VPS_PASSWORD:
    raise RuntimeError(
        "Missing VPS_HOST / VPS_PASSWORD.\n"
        "Add them to your .env file (see .env.example) or set them as "
        "environment variables before running this script."
    )
