"""Configuration for Code Intel Service via environment variables."""
from __future__ import annotations

import os

CODE_INTEL_DB_URL = os.getenv(
    "CODE_INTEL_DB_URL", "postgresql://clab:clab@localhost:5432/clab"
)

CGC_BINARY_PATH = os.getenv("CGC_BINARY_PATH", "cgc")

CGC_TIMEOUT_INDEX = int(os.getenv("CGC_TIMEOUT_INDEX", "300"))

CGC_TIMEOUT_QUERY = int(os.getenv("CGC_TIMEOUT_QUERY", "60"))

CODE_INTEL_PORT = int(os.getenv("CODE_INTEL_PORT", "8003"))

CLAB_CONTROL_URL = os.getenv("CLAB_CONTROL_URL", "http://localhost:8000")
