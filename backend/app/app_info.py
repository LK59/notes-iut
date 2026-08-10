"""Version et build id de l'app, utilisés par /api/health(/deep) et /api/admin/status."""
from __future__ import annotations

import os

from .build_info import APP_BUILD_ID as GENERATED_APP_BUILD_ID

APP_VERSION = "0.1.0"
APP_BUILD_ID = os.environ.get("APP_BUILD_ID", GENERATED_APP_BUILD_ID)
