"""Test fixtures.

The database path is redirected to a temp file *before* any app module is
imported, so the cached `Settings` never sees the developer's real database.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

_TMP_DIR = Path(tempfile.mkdtemp(prefix="agentmandi-tests-"))
os.environ["DATABASE_PATH"] = str(_TMP_DIR / "test.db")
os.environ["MANDATE_JWT_SECRET"] = "test-secret-not-the-default"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ["PAYMENTS_MODE"] = "simulated"
os.environ["LLM_PROVIDER"] = "offline"
os.environ["HITL_THRESHOLD_PAISE"] = "500000"

from app import db  # noqa: E402
from app.catalog import store as catalog  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.mandate import service as mandates  # noqa: E402
from app.models import MandateIssueRequest, MandateRecord  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db() -> Iterator[None]:
    """Every test starts from an empty schema and a freshly seeded catalog."""
    db.reset_db()
    catalog.invalidate_index()
    catalog.ingest_seed_file()
    yield


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def mandate() -> MandateRecord:
    """A workaday mandate: INR 3,000 per purchase inside an INR 10,000 budget."""
    return mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_test",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=300_000,
            total_budget_paise=1_000_000,
            allowed_categories=["electronics", "office"],
            ttl_hours=24,
        )
    ).mandate


@pytest.fixture
def mandate_token() -> str:
    return mandates.issue(
        MandateIssueRequest(
            buyer_id="buyer_test",
            merchant_id=get_settings().merchant_id,
            per_txn_cap_paise=300_000,
            total_budget_paise=1_000_000,
            allowed_categories=["electronics", "office"],
            ttl_hours=24,
        )
    ).mandate_token


# Fixed product ids from seed/products.json, chosen for their price points.
MOUSE = "prod_elec_001"          # INR 1,299, in stock
SILENT_MOUSE = "prod_elec_002"   # INR   899, stock 0
KEYBOARD = "prod_elec_003"       # INR 4,499
HEADPHONES = "prod_elec_005"     # INR 7,999, above the HITL threshold
YOGA_MAT = "prod_fit_001"        # INR 1,299, category not in the default allow-list
