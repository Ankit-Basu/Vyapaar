"""Mandate endpoints: issuing and verifying agent spending authorisations."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import (
    MandateIssueRequest,
    MandateIssueResponse,
    MandateRecord,
    MandateVerifyRequest,
    MandateVerifyResponse,
)
from . import service

router = APIRouter(prefix="/mandate", tags=["mandate"])


@router.post("/issue", response_model=MandateIssueResponse, summary="Issue a signed mandate")
def issue_mandate(request: MandateIssueRequest) -> MandateIssueResponse:
    """The human consent step: grant an agent bounded, expiring spend authority.

    Returns a signed JWT carrying the scope. Spend tracking stays server-side, so
    a holder who edits the token cannot enlarge their own budget.
    """
    try:
        return service.issue(request)
    except service.MandateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/verify", response_model=MandateVerifyResponse, summary="Verify a mandate token")
def verify_mandate(request: MandateVerifyRequest) -> MandateVerifyResponse:
    """Signature, issuer, expiry, revocation and scope-vs-record agreement."""
    return service.verify(request.mandate_token)


@router.get("", response_model=list[MandateRecord], summary="List mandates")
def list_mandates(limit: int = 50) -> list[MandateRecord]:
    return service.list_mandates(limit=limit)


@router.get("/{mandate_id}", response_model=MandateRecord, summary="Mandate state and budget")
def get_mandate(mandate_id: str) -> MandateRecord:
    record = service.get_record(mandate_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No mandate with id {mandate_id}")
    return record


@router.post("/{mandate_id}/revoke", response_model=MandateRecord, summary="Revoke a mandate")
def revoke_mandate(mandate_id: str) -> MandateRecord:
    """Immediate kill switch. Every later intent under this mandate is denied."""
    record = service.revoke(mandate_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No mandate with id {mandate_id}")
    return record
