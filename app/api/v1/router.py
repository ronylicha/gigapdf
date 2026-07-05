"""
Main API router for v1 endpoints.

Aggregates all sub-routers for the v1 API.
"""

from fastapi import APIRouter

from app.api.v1 import (
    activity,
    api_keys,
    billing,
    documents,
    elements,
    embed,
    jobs,
    logs,
    plans,
    public_billing,
    quota,
    search,
    sharing,
    storage,
    tenant_documents,
)
from app.api.v1.admin import admin_router

api_router = APIRouter()

# Include sub-routers
api_router.include_router(
    documents.router,
    prefix="/documents",
    tags=["Documents"],
)

api_router.include_router(
    elements.router,
    prefix="/documents/{document_id}",
    tags=["Elements"],
)

api_router.include_router(
    jobs.router,
    prefix="/jobs",
    tags=["Jobs"],
)

api_router.include_router(
    logs.router,
    prefix="/logs",
    tags=["Logs"],
)

api_router.include_router(
    storage.router,
    prefix="/storage",
    tags=["Storage"],
)

api_router.include_router(
    search.router,
    prefix="/search",
    tags=["Search"],
)

api_router.include_router(
    quota.router,
    prefix="/quota",
    tags=["Quota"],
)

api_router.include_router(
    plans.router,
    prefix="/plans",
    tags=["Plans"],
)

api_router.include_router(
    billing.router,
    prefix="/billing",
    tags=["Billing"],
)

api_router.include_router(
    public_billing.router,
    prefix="/public/billing",
    tags=["Public Billing"],
)

api_router.include_router(
    tenant_documents.router,
    prefix="/tenant-documents",
    tags=["Tenant Documents"],
)

api_router.include_router(
    activity.router,
    prefix="/activity",
    tags=["Activity"],
)

api_router.include_router(
    sharing.router,
    prefix="/sharing",
    tags=["Sharing"],
)

api_router.include_router(
    api_keys.router,
    prefix="/api-keys",
    tags=["API Keys"],
)

api_router.include_router(
    embed.router,
    prefix="/embed",
    tags=["Embed"],
)

# Admin endpoints
api_router.include_router(
    admin_router,
    prefix="/admin",
    tags=["Admin"],
)
