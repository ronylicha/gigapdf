"""
Document sharing endpoints.

Provides endpoints for sharing documents, managing invitations,
notifications, and accessing shared documents.
"""

import time
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field

from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services.activity_service import ActivityAction, ActivityService
from app.services.notification_service import notification_service
from app.services.share_service import share_service
from app.utils.helpers import now_utc

router = APIRouter()


# Request schemas
class ShareDocumentRequest(BaseModel):
    """Request body for sharing a document."""

    document_id: str = Field(..., description="Document ID to share")
    invitee_email: EmailStr = Field(..., description="Email of the person to share with")
    permission: Literal["view", "edit"] = Field(
        default="edit", description="Permission level (view or edit)"
    )
    message: str | None = Field(
        default=None, max_length=500, description="Optional message for the invitation"
    )
    expires_in_days: int = Field(
        default=7, ge=1, le=30, description="Days until invitation expires"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "invitee_email": "teammate@example.com",
                "permission": "edit",
                "message": "Here is the Q1 report — feel free to edit.",
                "expires_in_days": 7,
            }
        }


class UpdatePermissionRequest(BaseModel):
    """Request body for updating share permission."""

    permission: Literal["view", "edit"] = Field(..., description="New permission level")

    class Config:
        json_schema_extra = {"example": {"permission": "view"}}


class CreatePublicLinkRequest(BaseModel):
    """Request body for creating a public link."""

    expires_in_days: int | None = Field(
        default=None, ge=1, le=365, description="Days until link expires (optional)"
    )

    class Config:
        json_schema_extra = {"example": {"expires_in_days": 30}}


# Endpoints
@router.post(
    "/share",
    response_model=APIResponse[dict],
    summary="Share a document",
    description="""
Share a document with another user by email.

If the invitee is a registered user, they will receive an in-app notification.
An email invitation will also be sent.

## Request Body
- **document_id**: Document to share (must be owned by you)
- **invitee_email**: Email address of the person to share with
- **permission**: "view" (read-only) or "edit" (can modify) - default is "edit"
- **message**: Optional personal message to include in the invitation
- **expires_in_days**: Days until invitation expires (default: 7)

## Response
Returns invitation details including the invitation ID.
""",
    response_description="Invitation details including invitation_id, document info, permission level, and expiration timestamp",
    responses={
        201: {"description": "Invitation created successfully"},
        400: {"description": "Invalid request or already shared"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/sharing/share" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "document_id": "doc-uuid-1234",
    "invitee_email": "colleague@example.com",
    "permission": "edit",
    "message": "Please review this document",
    "expires_in_days": 7
  }'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Share a document with a colleague
response = requests.post(
    "https://api.giga-pdf.com/api/v1/sharing/share",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    json={
        "document_id": "doc-uuid-1234",
        "invitee_email": "colleague@example.com",
        "permission": "edit",
        "message": "Please review this document",
        "expires_in_days": 7
    }
)
result = response.json()
invitation = result["data"]
print(f"Invitation sent: {invitation['invitation_id']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Share a document with a colleague
const response = await fetch('https://api.giga-pdf.com/api/v1/sharing/share', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    document_id: 'doc-uuid-1234',
    invitee_email: 'colleague@example.com',
    permission: 'edit',
    message: 'Please review this document',
    expires_in_days: 7
  })
});
const result = await response.json();
console.log('Invitation ID:', result.data.invitation_id);"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Share a document with a colleague
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'https://api.giga-pdf.com/api/v1/sharing/share',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'document_id' => 'doc-uuid-1234',
        'invitee_email' => 'colleague@example.com',
        'permission' => 'edit',
        'message' => 'Please review this document',
        'expires_in_days' => 7
    ])
]);
$response = curl_exec($ch);
curl_close($ch);
$result = json_decode($response, true);
$invitation = $result['data'];
echo "Invitation sent: " . $invitation['invitation_id'];"""
            }
        ]
    }
)
async def share_document(
    request: ShareDocumentRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Share a document with another user.

    This endpoint allows document owners to share their documents with other users
    by providing their email address. The recipient will receive an invitation
    that they can accept or decline.

    Args:
        request: Share document request containing document_id, invitee_email,
                 permission level, optional message, and expiration days.
        user: The authenticated user making the request.

    Returns:
        APIResponse containing invitation details including invitation_id,
        document info, and expiration timestamp.

    Raises:
        HTTPException 400: If the document is already shared with the user
                          or the request is invalid.
        HTTPException 404: If the document is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.share_document(
            document_id=request.document_id,
            inviter_id=user.user_id,
            invitee_email=request.invitee_email,
            permission=request.permission,
            message=request.message,
            expires_in_days=request.expires_in_days,
        )

        # Log activity
        await ActivityService.log_activity(
            user_id=user.user_id,
            action=ActivityAction.SHARE,
            document_id=request.document_id,
            user_email=user.email,
            extra_data={
                "invitee_email": request.invitee_email,
                "permission": request.permission,
            },
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/shared-with-me",
    response_model=APIResponse[dict],
    summary="Get documents shared with me",
    description="""
Retrieve a paginated list of documents that have been shared with the current user.

This includes both direct shares (when someone shares a document specifically with you)
and documents shared through organizations you belong to.

## Query Parameters
- **page**: Page number for pagination (default: 1)
- **per_page**: Number of items per page (default: 20, max: 100)
- **source**: Filter by share source: "direct", "organization", or "all" (default)

## Response
Returns a paginated list of shared documents with:
- Document metadata (name, type, size, created_at)
- Owner information (email, name)
- Permission level (view or edit)
- Share date and expiration (if applicable)
""",
    response_description="Paginated list of documents shared with the current user, including owner info and permission levels",
    responses={
        200: {"description": "Shared documents retrieved successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/shared-with-me?page=1&per_page=20&source=all" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get documents shared with me
response = requests.get(
    "https://api.giga-pdf.com/api/v1/sharing/shared-with-me",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    params={
        "page": 1,
        "per_page": 20,
        "source": "all"  # or "direct" or "organization"
    }
)
result = response.json()
shared_docs = result["data"]["documents"]
for doc in shared_docs:
    print(f"{doc['name']} - {doc['permission']} - from {doc['owner']['email']}")

# Pagination info
pagination = result["meta"]["pagination"]
print(f"Page {pagination['page']} of {pagination['total_pages']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get documents shared with me
const params = new URLSearchParams({
  page: '1',
  per_page: '20',
  source: 'all'
});

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/shared-with-me?${params}`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();
const sharedDocs = result.data.documents;

sharedDocs.forEach(doc => {
  console.log(`${doc.name} - ${doc.permission} - from ${doc.owner.email}`);
});"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get documents shared with me
$params = http_build_query([
    'page' => 1,
    'per_page' => 20,
    'source' => 'all'
]);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/shared-with-me?{$params}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$sharedDocs = $result['data']['documents'];

foreach ($sharedDocs as $doc) {
    echo "{$doc['name']} - {$doc['permission']} - from {$doc['owner']['email']}\\n";
}"""
            }
        ]
    }
)
async def get_shared_with_me(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
    source: Literal["direct", "organization", "all"] = Query(
        default="all", description="Filter by share source"
    ),
) -> APIResponse[dict]:
    """
    Get documents shared with the current user.

    Retrieves all documents that have been shared with the authenticated user,
    including both direct shares and organization-level shares.

    Args:
        user: The authenticated user making the request.
        page: Page number for pagination (starts at 1).
        per_page: Number of items to return per page (max 100).
        source: Filter shares by source type.

    Returns:
        APIResponse containing paginated list of shared documents with
        owner info and permission levels.
    """
    start_time = time.time()

    result = await share_service.get_shared_with_me(
        user_id=user.user_id,
        user_email=user.email,
        user_quota_id=user.quota_id if hasattr(user, 'quota_id') else None,
        page=page,
        per_page=per_page,
        source_filter=source,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=result["page"],
                page_size=result["per_page"],
                total_items=result["total"],
                total_pages=result["total_pages"],
            ),
        ),
    )


@router.get(
    "/shared-by-me",
    response_model=APIResponse[dict],
    summary="Get documents I have shared",
    description="""
Retrieve a paginated list of documents that the current user has shared with others.

## Query Parameters
- **page**: Page number for pagination (default: 1)
- **per_page**: Number of items per page (default: 20, max: 100)

## Response
Returns a paginated list of shares with:
- Document metadata (name, type, size)
- Recipient information (email, name, status)
- Permission level granted
- Share creation date
""",
    response_description="Paginated list of shares the current user has created, including document and recipient information",
    responses={
        200: {"description": "Shares retrieved successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/shared-by-me?page=1&per_page=20" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get documents I have shared with others
response = requests.get(
    "https://api.giga-pdf.com/api/v1/sharing/shared-by-me",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    params={"page": 1, "per_page": 20}
)
result = response.json()
my_shares = result["data"]["shares"]

for share in my_shares:
    doc_name = share['document']['name']
    recipient = share['shared_with']['email']
    permission = share['permission']
    print(f"{doc_name} shared with {recipient} ({permission})")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get documents I have shared with others
const response = await fetch(
  'https://api.giga-pdf.com/api/v1/sharing/shared-by-me?page=1&per_page=20',
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

result.data.shares.forEach(share => {
  console.log(`${share.document.name} shared with ${share.shared_with.email}`);
});"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get documents I have shared with others
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'https://api.giga-pdf.com/api/v1/sharing/shared-by-me?page=1&per_page=20',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$myShares = $result['data']['shares'];

foreach ($myShares as $share) {
    echo "{$share['document']['name']} shared with {$share['shared_with']['email']}\\n";
}"""
            }
        ]
    }
)
async def get_shared_by_me(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
) -> APIResponse[dict]:
    """
    Get documents the current user has shared.

    Retrieves all documents that the authenticated user has shared with others,
    including active shares and pending invitations.

    Args:
        user: The authenticated user making the request.
        page: Page number for pagination (starts at 1).
        per_page: Number of items to return per page (max 100).

    Returns:
        APIResponse containing paginated list of shares with document
        and recipient information.
    """
    start_time = time.time()

    result = await share_service.get_shared_by_me(
        user_id=user.user_id,
        page=page,
        per_page=per_page,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=result["page"],
                page_size=result["per_page"],
                total_items=result["total"],
                total_pages=result["total_pages"],
            ),
        ),
    )


@router.get(
    "/invitations/pending",
    response_model=APIResponse[dict],
    summary="Get pending share invitations",
    description="""
Retrieve all pending share invitations for the current user.

Pending invitations are share requests that have been sent to you but not yet
accepted or declined. Each invitation includes details about the document
and the person who sent the invitation.

## Response
Returns a list of pending invitations with:
- Invitation ID and token
- Document information (name, type, preview)
- Inviter information (email, name)
- Permission level being offered
- Invitation message (if any)
- Expiration date
""",
    response_description="List of pending share invitations with document, inviter info, permission level, and expiration date",
    responses={
        200: {"description": "Pending invitations retrieved successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/invitations/pending" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get my pending invitations
response = requests.get(
    "https://api.giga-pdf.com/api/v1/sharing/invitations/pending",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()
invitations = result["data"]["invitations"]

print(f"You have {len(invitations)} pending invitation(s)")
for inv in invitations:
    doc_name = inv['document']['name']
    from_user = inv['inviter']['email']
    permission = inv['permission']
    print(f"  - {doc_name} from {from_user} ({permission} access)")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get my pending invitations
const response = await fetch(
  'https://api.giga-pdf.com/api/v1/sharing/invitations/pending',
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();
const invitations = result.data.invitations;

console.log(`You have ${invitations.length} pending invitation(s)`);
invitations.forEach(inv => {
  console.log(`  - ${inv.document.name} from ${inv.inviter.email}`);
});"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get my pending invitations
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'https://api.giga-pdf.com/api/v1/sharing/invitations/pending',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$invitations = $result['data']['invitations'];

echo "You have " . count($invitations) . " pending invitation(s)\\n";
foreach ($invitations as $inv) {
    echo "  - {$inv['document']['name']} from {$inv['inviter']['email']}\\n";
}"""
            }
        ]
    }
)
async def get_pending_invitations(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Get pending share invitations for the current user.

    Retrieves all share invitations that have been sent to the user's email
    address and are still pending (not yet accepted or declined).

    Args:
        user: The authenticated user making the request.

    Returns:
        APIResponse containing a list of pending invitations with
        document and inviter information.
    """
    start_time = time.time()

    invitations = await share_service.get_pending_invitations(user_email=user.email)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"invitations": invitations, "count": len(invitations)},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/invitations/{token}",
    response_model=APIResponse[dict],
    summary="Get a share invitation by token",
    description="""
Retrieve the details of a share invitation using its unique token.

This read-only endpoint powers the invitation landing page: it lets the
invitee review the document, the inviter and the offered permission before
accepting or declining. The invitation status is **not** modified.

## Path Parameters
- **token**: The unique invitation token received in the invitation e-mail

## Response
Returns the invitation details with:
- Invitation ID and effective status (pending, accepted, declined, revoked, expired)
- Document information (name, page count, thumbnail)
- Inviter information (email)
- Permission level being offered
- Invitation message (if any)
- Creation and expiration dates
""",
    response_description="Invitation details including effective status, document, inviter, permission level and expiration date",
    responses={
        200: {"description": "Invitation retrieved successfully"},
        404: {"description": "Invitation not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/invitations/{invitation_token}" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Look up a share invitation before accepting it
invitation_token = "inv_abc123xyz"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/sharing/invitations/{invitation_token}",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

invitation = result["data"]
print(f"Document: {invitation['document']['name']}")
print(f"From: {invitation['inviter']['email']}")
print(f"Permission: {invitation['permission']}")
print(f"Status: {invitation['status']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Look up a share invitation before accepting it
const invitationToken = 'inv_abc123xyz';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/invitations/${invitationToken}`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

const invitation = result.data;
console.log(`Document: ${invitation.document.name}`);
console.log(`From: ${invitation.inviter.email} (${invitation.permission})`);"""
            }
        ]
    }
)
async def get_invitation_by_token(
    token: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Get a share invitation by its token.

    Read-only lookup used by the invitation landing page so the invitee can
    review the invitation before responding. Does not mutate the invitation.

    Args:
        token: The unique invitation token.
        user: The authenticated user making the request.

    Returns:
        APIResponse containing the invitation details.

    Raises:
        HTTPException 404: If the invitation is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.get_invitation_by_token(token=token)

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/invitations/{token}/accept",
    response_model=APIResponse[dict],
    summary="Accept a share invitation",
    description="""
Accept a share invitation and gain access to the shared document.

Once accepted, the document will appear in your "Shared with me" list and
you will be able to access it according to the granted permission level.

## Path Parameters
- **token**: The unique invitation token received in the invitation

## Response
Returns the created share with:
- Share ID
- Document information
- Permission level
- Access granted timestamp
""",
    response_description="Created share details including share_id, document information, and permission level",
    responses={
        200: {"description": "Invitation accepted successfully"},
        400: {"description": "Invalid or expired invitation"},
        404: {"description": "Invitation not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/sharing/invitations/{invitation_token}/accept" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Accept a share invitation
invitation_token = "inv_abc123xyz"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/sharing/invitations/{invitation_token}/accept",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

if result["success"]:
    share = result["data"]
    print(f"Access granted to: {share['document_name']}")
    print(f"Permission: {share['permission']}")
else:
    print(f"Error: {result['error']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Accept a share invitation
const invitationToken = 'inv_abc123xyz';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/invitations/${invitationToken}/accept`,
  {
    method: 'POST',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

if (result.success) {
  console.log('Access granted to:', result.data.document_name);
  console.log('Permission:', result.data.permission);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Accept a share invitation
$invitationToken = 'inv_abc123xyz';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/invitations/{$invitationToken}/accept",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Access granted to: " . $result['data']['document_name'] . "\\n";
    echo "Permission: " . $result['data']['permission'] . "\\n";
}"""
            }
        ]
    }
)
async def accept_invitation(
    token: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Accept a share invitation.

    Accepts a pending share invitation, creating an active share that grants
    the user access to the document with the specified permission level.

    Args:
        token: The unique invitation token.
        user: The authenticated user accepting the invitation.

    Returns:
        APIResponse containing the created share details.

    Raises:
        HTTPException 400: If the invitation is invalid or expired.
        HTTPException 404: If the invitation is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.accept_invitation(
            token=token,
            user_id=user.user_id,
            user_email=user.email,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/invitations/{token}/decline",
    response_model=APIResponse[dict],
    summary="Decline a share invitation",
    description="""
Decline a share invitation.

The invitation will be marked as declined and removed from your pending
invitations list. The document owner will be notified that you declined.

## Path Parameters
- **token**: The unique invitation token received in the invitation

## Response
Returns confirmation of the declined invitation.
""",
    response_description="Confirmation that the invitation was declined and removed from pending list",
    responses={
        200: {"description": "Invitation declined successfully"},
        400: {"description": "Invalid invitation"},
        404: {"description": "Invitation not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/sharing/invitations/{invitation_token}/decline" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Decline a share invitation
invitation_token = "inv_abc123xyz"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/sharing/invitations/{invitation_token}/decline",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

if result["success"]:
    print("Invitation declined")
else:
    print(f"Error: {result['error']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Decline a share invitation
const invitationToken = 'inv_abc123xyz';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/invitations/${invitationToken}/decline`,
  {
    method: 'POST',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

if (result.success) {
  console.log('Invitation declined');
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Decline a share invitation
$invitationToken = 'inv_abc123xyz';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/invitations/{$invitationToken}/decline",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Invitation declined\\n";
}"""
            }
        ]
    }
)
async def decline_invitation(
    token: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Decline a share invitation.

    Declines a pending share invitation. The invitation will be removed
    and the document owner will be notified.

    Args:
        token: The unique invitation token.
        user: The authenticated user declining the invitation.

    Returns:
        APIResponse confirming the invitation was declined.

    Raises:
        HTTPException 400: If the invitation is invalid.
        HTTPException 404: If the invitation is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.decline_invitation(
            token=token,
            user_id=user.user_id,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/shares/{share_id}",
    response_model=APIResponse[dict],
    summary="Revoke a document share",
    description="""
Revoke access to a shared document.

Only the document owner can revoke shares. Once revoked, the recipient will
immediately lose access to the document.

## Path Parameters
- **share_id**: The unique identifier of the share to revoke

## Response
Returns confirmation of the revoked share including:
- Revoked share ID
- Document ID
- Former recipient email
""",
    response_description="Confirmation of the revoked share including share_id and the email of the user who lost access",
    responses={
        200: {"description": "Share revoked successfully"},
        403: {"description": "Not authorized to revoke this share"},
        404: {"description": "Share not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X DELETE "https://api.giga-pdf.com/api/v1/sharing/shares/{share_id}" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Revoke a document share
share_id = "share_abc123"
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/sharing/shares/{share_id}",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

if result["success"]:
    print(f"Share revoked: {result['data']['share_id']}")
    print(f"User {result['data']['revoked_from']} no longer has access")
else:
    print(f"Error: {result['error']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Revoke a document share
const shareId = 'share_abc123';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/shares/${shareId}`,
  {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

if (result.success) {
  console.log('Share revoked:', result.data.share_id);
  console.log(`User ${result.data.revoked_from} no longer has access`);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Revoke a document share
$shareId = 'share_abc123';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/shares/{$shareId}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'DELETE',
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Share revoked: " . $result['data']['share_id'] . "\\n";
    echo "User " . $result['data']['revoked_from'] . " no longer has access\\n";
}"""
            }
        ]
    }
)
async def revoke_share(
    share_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Revoke a document share.

    Revokes an active share, immediately removing the recipient's access
    to the document. Only the document owner can revoke shares.

    Args:
        share_id: The unique identifier of the share to revoke.
        user: The authenticated user (must be document owner).

    Returns:
        APIResponse confirming the share was revoked.

    Raises:
        HTTPException 400: If the share cannot be revoked.
        HTTPException 403: If the user is not the document owner.
        HTTPException 404: If the share is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.revoke_share(
            share_id=share_id,
            revoker_id=user.user_id,
        )

        # Log activity
        await ActivityService.log_activity(
            user_id=user.user_id,
            action=ActivityAction.UNSHARE,
            extra_data={"share_id": share_id},
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch(
    "/shares/{share_id}/permission",
    response_model=APIResponse[dict],
    summary="Update share permission",
    description="""
Update the permission level for an existing share.

Only the document owner can modify permissions. This allows you to upgrade
a "view" permission to "edit" or downgrade an "edit" permission to "view".

## Path Parameters
- **share_id**: The unique identifier of the share to update

## Request Body
- **permission**: New permission level - either "view" (read-only) or "edit" (can modify)

## Response
Returns the updated share details including:
- Share ID
- Old permission level
- New permission level
- Updated timestamp
""",
    response_description="Updated share details including share_id, old permission, new permission, and updated timestamp",
    responses={
        200: {"description": "Permission updated successfully"},
        400: {"description": "Invalid permission value"},
        403: {"description": "Not authorized to modify this share"},
        404: {"description": "Share not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X PATCH "https://api.giga-pdf.com/api/v1/sharing/shares/{share_id}/permission" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"permission": "view"}'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Update share permission (e.g., downgrade from edit to view)
share_id = "share_abc123"
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/sharing/shares/{share_id}/permission",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    json={"permission": "view"}
)
result = response.json()

if result["success"]:
    data = result["data"]
    print(f"Permission changed: {data['old_permission']} -> {data['permission']}")
else:
    print(f"Error: {result['error']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Update share permission (e.g., upgrade from view to edit)
const shareId = 'share_abc123';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/shares/${shareId}/permission`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ permission: 'edit' })
  }
);
const result = await response.json();

if (result.success) {
  console.log(`Permission changed: ${result.data.old_permission} -> ${result.data.permission}`);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Update share permission
$shareId = 'share_abc123';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/shares/{$shareId}/permission",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'PATCH',
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode(['permission' => 'view'])
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    $data = $result['data'];
    echo "Permission changed: {$data['old_permission']} -> {$data['permission']}\\n";
}"""
            }
        ]
    }
)
async def update_share_permission(
    share_id: str,
    request: UpdatePermissionRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Update the permission level for a share.

    Allows the document owner to change the permission level of an existing
    share between "view" and "edit".

    Args:
        share_id: The unique identifier of the share to update.
        request: Request containing the new permission level.
        user: The authenticated user (must be document owner).

    Returns:
        APIResponse containing the updated share details.

    Raises:
        HTTPException 400: If the permission value is invalid.
        HTTPException 403: If the user is not the document owner.
        HTTPException 404: If the share is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.update_permission(
            share_id=share_id,
            owner_id=user.user_id,
            new_permission=request.permission,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/documents/{document_id}/shares",
    response_model=APIResponse[dict],
    summary="Get all shares for a document",
    description="""
Retrieve all active shares and pending invitations for a specific document.

Only the document owner can view this information. This endpoint is useful
for managing who has access to your document.

## Path Parameters
- **document_id**: The unique identifier of the document

## Response
Returns a list of all shares including:
- Active shares with recipient info and permission levels
- Pending invitations with invitee email and expiration
- Total count of shares
""",
    response_description="List of all active shares and pending invitations for the document, with recipient info and permission levels",
    responses={
        200: {"description": "Document shares retrieved successfully"},
        403: {"description": "Not authorized to view shares for this document"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/documents/{document_id}/shares" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get all shares for a document
document_id = "doc-uuid-1234"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/sharing/documents/{document_id}/shares",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()
shares = result["data"]["shares"]

print(f"Document is shared with {len(shares)} user(s):")
for share in shares:
    if 'shared_with' in share and share['shared_with']:
        email = share['shared_with']['email']
        status = "active"
    else:
        email = share.get('invitee_email', 'Unknown')
        status = "pending"
    print(f"  - {email} ({share['permission']}) - {status}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get all shares for a document
const documentId = 'doc-uuid-1234';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/documents/${documentId}/shares`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();
const shares = result.data.shares;

console.log(`Document is shared with ${shares.length} user(s):`);
shares.forEach(share => {
  const email = share.shared_with?.email || share.invitee_email;
  const status = share.shared_with ? 'active' : 'pending';
  console.log(`  - ${email} (${share.permission}) - ${status}`);
});"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get all shares for a document
$documentId = 'doc-uuid-1234';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/documents/{$documentId}/shares",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$shares = $result['data']['shares'];

echo "Document is shared with " . count($shares) . " user(s):\\n";
foreach ($shares as $share) {
    $email = $share['shared_with']['email'] ?? $share['invitee_email'] ?? 'Unknown';
    $status = isset($share['shared_with']) ? 'active' : 'pending';
    echo "  - {$email} ({$share['permission']}) - {$status}\\n";
}"""
            }
        ]
    }
)
async def get_document_shares(
    document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Get all shares for a document.

    Retrieves all active shares and pending invitations for a document.
    Only the document owner can view this information.

    Args:
        document_id: The unique identifier of the document.
        user: The authenticated user (must be document owner).

    Returns:
        APIResponse containing list of shares and pending invitations.

    Raises:
        HTTPException 400: If the request is invalid.
        HTTPException 403: If the user is not the document owner.
        HTTPException 404: If the document is not found.
    """
    start_time = time.time()

    try:
        shares = await share_service.get_document_shares(
            document_id=document_id,
            owner_id=user.user_id,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data={"shares": shares, "count": len(shares)},
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/documents/{document_id}/public-link",
    response_model=APIResponse[dict],
    summary="Create a public link for a document",
    description="""
Create a public view-only link for a document.

Public links allow anyone with the link to view the document without
needing an account or invitation. This is useful for sharing documents
with external parties or embedding previews.

## Path Parameters
- **document_id**: The unique identifier of the document

## Request Body
- **expires_in_days**: Optional expiration in days (1-365). If not provided, the link will not expire.

## Response
Returns the public link details including:
- Unique token for the public link
- Full URL to access the document
- Expiration date (if set)
- Creation timestamp
""",
    response_description="Public link details including the unique token, full shareable URL, optional expiration date, and creation timestamp",
    responses={
        201: {"description": "Public link created successfully"},
        400: {"description": "Invalid request or link already exists"},
        403: {"description": "Not authorized to create public link"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/sharing/documents/{document_id}/public-link" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"expires_in_days": 30}'"""
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Create a public link for a document
document_id = "doc-uuid-1234"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/sharing/documents/{document_id}/public-link",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    json={"expires_in_days": 30}  # Optional: link expires in 30 days
)
result = response.json()

if result["success"]:
    link_data = result["data"]
    print(f"Public link created!")
    print(f"URL: https://giga-pdf.com/share/{link_data['token']}")
    if link_data.get('expires_at'):
        print(f"Expires: {link_data['expires_at']}")
else:
    print(f"Error: {result['error']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Create a public link for a document
const documentId = 'doc-uuid-1234';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/documents/${documentId}/public-link`,
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expires_in_days: 30 })
  }
);
const result = await response.json();

if (result.success) {
  const shareUrl = `https://giga-pdf.com/share/${result.data.token}`;
  console.log('Public link created:', shareUrl);

  // Copy to clipboard
  navigator.clipboard.writeText(shareUrl);
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Create a public link for a document
$documentId = 'doc-uuid-1234';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/documents/{$documentId}/public-link",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN',
        'Content-Type: application/json'
    ],
    CURLOPT_POSTFIELDS => json_encode(['expires_in_days' => 30])
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    $token = $result['data']['token'];
    echo "Public link created!\\n";
    echo "URL: https://giga-pdf.com/share/{$token}\\n";
}"""
            }
        ]
    }
)
async def create_public_link(
    document_id: str,
    request: CreatePublicLinkRequest,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Create a public link for a document.

    Creates a public view-only link that allows anyone with the link to
    view the document. Only the document owner can create public links.

    Args:
        document_id: The unique identifier of the document.
        request: Request containing optional expiration days.
        user: The authenticated user (must be document owner).

    Returns:
        APIResponse containing the public link token and details.

    Raises:
        HTTPException 400: If the request is invalid or link exists.
        HTTPException 403: If the user is not the document owner.
        HTTPException 404: If the document is not found.
    """
    start_time = time.time()

    try:
        result = await share_service.create_public_link(
            document_id=document_id,
            owner_id=user.user_id,
            expires_in_days=request.expires_in_days,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/documents/{document_id}/public-link",
    response_model=APIResponse[dict],
    summary="Revoke a public link",
    description="""
Revoke the public link for a document.

Once revoked, the public link will no longer work and anyone trying to
access the document via the old link will receive an error.

## Path Parameters
- **document_id**: The unique identifier of the document

## Response
Returns confirmation of the revoked link including:
- Document ID
- Revoked token (for reference)
- Revocation timestamp
""",
    response_description="Confirmation that the public link was revoked, including the document_id and the revoked token",
    responses={
        200: {"description": "Public link revoked successfully"},
        404: {"description": "No public link found for this document"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X DELETE "https://api.giga-pdf.com/api/v1/sharing/documents/{document_id}/public-link" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Revoke a public link
document_id = "doc-uuid-1234"
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/sharing/documents/{document_id}/public-link",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

if result["success"]:
    print("Public link revoked successfully")
    print("The document is no longer publicly accessible")
else:
    print(f"Error: {result['error']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Revoke a public link
const documentId = 'doc-uuid-1234';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/documents/${documentId}/public-link`,
  {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

if (result.success) {
  console.log('Public link revoked successfully');
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Revoke a public link
$documentId = 'doc-uuid-1234';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/documents/{$documentId}/public-link",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'DELETE',
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Public link revoked successfully\\n";
}"""
            }
        ]
    }
)
async def revoke_public_link(
    document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Revoke the public link for a document.

    Revokes the active public link for a document, making it inaccessible
    via the previously shared URL. Only the document owner can revoke.

    Args:
        document_id: The unique identifier of the document.
        user: The authenticated user (must be document owner).

    Returns:
        APIResponse confirming the link was revoked.

    Raises:
        HTTPException 400: If the request is invalid.
        HTTPException 404: If no public link exists for the document.
    """
    start_time = time.time()

    try:
        result = await share_service.revoke_public_link(
            document_id=document_id,
            owner_id=user.user_id,
        )

        processing_time = int((time.time() - start_time) * 1000)

        return APIResponse(
            success=True,
            data=result,
            meta=MetaInfo(
                request_id=get_request_id(),
                timestamp=now_utc(),
                processing_time_ms=processing_time,
            ),
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Notification endpoints
@router.get(
    "/notifications",
    response_model=APIResponse[dict],
    summary="Get sharing notifications",
    description="""
Retrieve sharing notifications for the current user.

Notifications include events such as:
- New share invitations received
- Invitations accepted or declined
- Share permissions updated
- Shares revoked

## Query Parameters
- **page**: Page number for pagination (default: 1)
- **per_page**: Number of items per page (default: 20, max: 100)
- **unread_only**: If true, only return unread notifications (default: false)

## Response
Returns a paginated list of notifications with:
- Notification ID and type
- Related document and user information
- Read/unread status
- Timestamp
""",
    response_description="Paginated list of sharing notifications with type, message, related document/user info, and read status",
    responses={
        200: {"description": "Notifications retrieved successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/notifications?page=1&per_page=20&unread_only=true" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get my sharing notifications (unread only)
response = requests.get(
    "https://api.giga-pdf.com/api/v1/sharing/notifications",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    params={
        "page": 1,
        "per_page": 20,
        "unread_only": True
    }
)
result = response.json()
notifications = result["data"]["notifications"]

for notif in notifications:
    print(f"[{notif['type']}] {notif['message']}")
    print(f"  From: {notif['from_user']['email']}")
    print(f"  Time: {notif['created_at']}")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get my sharing notifications (unread only)
const params = new URLSearchParams({
  page: '1',
  per_page: '20',
  unread_only: 'true'
});

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/notifications?${params}`,
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();
const notifications = result.data.notifications;

notifications.forEach(notif => {
  console.log(`[${notif.type}] ${notif.message}`);
});"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get my sharing notifications (unread only)
$params = http_build_query([
    'page' => 1,
    'per_page' => 20,
    'unread_only' => 'true'
]);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/notifications?{$params}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$notifications = $result['data']['notifications'];

foreach ($notifications as $notif) {
    echo "[{$notif['type']}] {$notif['message']}\\n";
}"""
            }
        ]
    }
)
async def get_notifications(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
) -> APIResponse[dict]:
    """
    Get notifications for the current user.

    Retrieves sharing-related notifications for the authenticated user,
    with optional filtering for unread notifications only.

    Args:
        user: The authenticated user making the request.
        page: Page number for pagination (starts at 1).
        per_page: Number of items to return per page (max 100).
        unread_only: If True, only return unread notifications.

    Returns:
        APIResponse containing paginated list of notifications.
    """
    start_time = time.time()

    result = await notification_service.get_notifications(
        user_id=user.user_id,
        unread_only=unread_only,
        page=page,
        per_page=per_page,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
            pagination=PaginationInfo(
                page=result["page"],
                page_size=result["per_page"],
                total_items=result["total"],
                total_pages=result["total_pages"],
            ),
        ),
    )


@router.get(
    "/notifications/unread-count",
    response_model=APIResponse[dict],
    summary="Get unread notification count",
    description="""
Get the count of unread sharing notifications.

This is a lightweight endpoint useful for displaying notification badges
in the UI without fetching the full notification list.

## Response
Returns the unread notification count.
""",
    response_description="Unread notification count as an integer, suitable for badge display in the UI",
    responses={
        200: {"description": "Unread count retrieved successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X GET "https://api.giga-pdf.com/api/v1/sharing/notifications/unread-count" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Get unread notification count
response = requests.get(
    "https://api.giga-pdf.com/api/v1/sharing/notifications/unread-count",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()
count = result["data"]["unread_count"]

if count > 0:
    print(f"You have {count} unread notification(s)")
else:
    print("No unread notifications")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Get unread notification count (e.g., for badge display)
const response = await fetch(
  'https://api.giga-pdf.com/api/v1/sharing/notifications/unread-count',
  {
    method: 'GET',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();
const count = result.data.unread_count;

// Update notification badge
const badge = document.getElementById('notification-badge');
badge.textContent = count > 0 ? count : '';
badge.style.display = count > 0 ? 'block' : 'none';"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Get unread notification count
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'https://api.giga-pdf.com/api/v1/sharing/notifications/unread-count',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
$count = $result['data']['unread_count'];

if ($count > 0) {
    echo "You have {$count} unread notification(s)\\n";
}"""
            }
        ]
    }
)
async def get_unread_count(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Get count of unread notifications.

    Returns the number of unread sharing notifications for the user.
    This is a lightweight call ideal for updating notification badges.

    Args:
        user: The authenticated user making the request.

    Returns:
        APIResponse containing the unread notification count.
    """
    start_time = time.time()

    count = await notification_service.get_unread_count(user_id=user.user_id)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"unread_count": count},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/notifications/{notification_id}/read",
    response_model=APIResponse[dict],
    summary="Mark notification as read",
    description="""
Mark a specific notification as read.

## Path Parameters
- **notification_id**: The unique identifier of the notification

## Response
Returns confirmation that the notification was marked as read.
""",
    response_description="Confirmation that the notification was marked as read",
    responses={
        200: {"description": "Notification marked as read successfully"},
        404: {"description": "Notification not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/sharing/notifications/{notification_id}/read" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Mark a specific notification as read
notification_id = "notif_abc123"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/sharing/notifications/{notification_id}/read",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

if result["success"]:
    print("Notification marked as read")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Mark a specific notification as read
const notificationId = 'notif_abc123';
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/sharing/notifications/${notificationId}/read`,
  {
    method: 'POST',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

if (result.success) {
  console.log('Notification marked as read');
  // Update UI to reflect read state
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Mark a specific notification as read
$notificationId = 'notif_abc123';

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => "https://api.giga-pdf.com/api/v1/sharing/notifications/{$notificationId}/read",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    echo "Notification marked as read\\n";
}"""
            }
        ]
    }
)
async def mark_notification_read(
    notification_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Mark a notification as read.

    Marks a specific notification as read for the authenticated user.

    Args:
        notification_id: The unique identifier of the notification.
        user: The authenticated user making the request.

    Returns:
        APIResponse confirming the notification was marked as read.

    Raises:
        HTTPException 404: If the notification is not found or doesn't
                          belong to the user.
    """
    start_time = time.time()

    success = await notification_service.mark_as_read(
        notification_id=notification_id,
        user_id=user.user_id,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"marked_as_read": True},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/notifications/read-all",
    response_model=APIResponse[dict],
    summary="Mark all notifications as read",
    description="""
Mark all sharing notifications as read for the current user.

This is useful for a "Mark all as read" button in the UI.

## Response
Returns the count of notifications that were marked as read.
""",
    response_description="Count of notifications that were marked as read in this operation",
    responses={
        200: {"description": "All notifications marked as read successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": """curl -X POST "https://api.giga-pdf.com/api/v1/sharing/notifications/read-all" \\
  -H "Authorization: Bearer $TOKEN" """
            },
            {
                "lang": "python",
                "label": "Python",
                "source": """import requests

# Mark all notifications as read
response = requests.post(
    "https://api.giga-pdf.com/api/v1/sharing/notifications/read-all",
    headers={"Authorization": "Bearer YOUR_TOKEN"}
)
result = response.json()

if result["success"]:
    count = result["data"]["marked_count"]
    print(f"Marked {count} notification(s) as read")"""
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": """// Mark all notifications as read
const response = await fetch(
  'https://api.giga-pdf.com/api/v1/sharing/notifications/read-all',
  {
    method: 'POST',
    headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
  }
);
const result = await response.json();

if (result.success) {
  console.log(`Marked ${result.data.marked_count} notification(s) as read`);
  // Clear notification badge
  document.getElementById('notification-badge').style.display = 'none';
}"""
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": """<?php
// Mark all notifications as read
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => 'https://api.giga-pdf.com/api/v1/sharing/notifications/read-all',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer YOUR_TOKEN'
    ]
]);
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if ($result['success']) {
    $count = $result['data']['marked_count'];
    echo "Marked {$count} notification(s) as read\\n";
}"""
            }
        ]
    }
)
async def mark_all_notifications_read(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """
    Mark all notifications as read.

    Marks all sharing notifications as read for the authenticated user.

    Args:
        user: The authenticated user making the request.

    Returns:
        APIResponse containing the count of notifications marked as read.
    """
    start_time = time.time()

    count = await notification_service.mark_all_as_read(user_id=user.user_id)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"marked_count": count},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


# ---------------------------------------------------------------------------
# Public link resolution (UNAUTHENTICATED)
#
# These two routes intentionally have NO ``AuthenticatedUser`` dependency:
# auth in this backend is enforced exclusively at route level (the JWT
# middleware is best-effort and never blocks), so omitting the dependency is
# what makes them public. The capability is the token itself.
#
# Security invariants:
#   - The token is a secret: it must NEVER appear in our log statements or in
#     error messages (only share/document ids are ever logged).
#   - Responses carry ``X-Robots-Tag: noindex`` and are never cached long
#     (``Cache-Control: private, no-store``) — a revoked link must die
#     immediately, and token-bearing URLs must not be indexed.
# ---------------------------------------------------------------------------

_PUBLIC_LINK_404_DETAIL = "Public link not found or expired"


def _public_no_store_headers() -> dict[str, str]:
    """Common headers for public-link responses (no indexing, no caching)."""
    return {
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "private, no-store",
    }


def _content_disposition(document_name: str, inline: bool) -> str:
    """
    Build a header-injection-safe ``Content-Disposition`` value.

    Uses the RFC 5987 ``filename*`` form for non-ASCII names with a sanitized
    ASCII fallback (quotes and control characters stripped).
    """
    sanitized = "".join(
        c for c in (document_name or "") if c not in '"\\\r\n' and c.isprintable()
    ).strip()
    ascii_fallback = (
        sanitized.encode("ascii", "ignore").decode("ascii").strip() or "document.pdf"
    )
    disposition = "inline" if inline else "attachment"
    utf8_name = quote(sanitized or "document.pdf", safe="")
    return (
        f'{disposition}; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{utf8_name}"
    )


@router.get(
    "/public/{token}",
    response_model=APIResponse[dict],
    summary="Resolve a public link (no authentication)",
    description="""
Resolve a public share link token into document display metadata.

This endpoint is **public** — no authentication is required. Anyone holding
the link can see the document name, page count and size before viewing it.

## Path Parameters
- **token**: The public link token (from the shared URL)

## Response
Returns the document name, page count, file size and the (always ``view``)
permission. Unknown, revoked or expired tokens return **404** without
distinguishing the cause (anti-enumeration).
""",
    response_description="Display metadata for the publicly shared document",
    responses={
        200: {"description": "Public link resolved successfully"},
        404: {"description": "Public link not found, revoked, or expired"},
    },
)
async def get_public_link_document(
    token: str,
    response: Response,
) -> APIResponse[dict]:
    """
    Resolve a public link token (unauthenticated).

    Args:
        token: The public link token from the shared URL.
        response: FastAPI response (used to attach noindex/no-store headers).

    Returns:
        APIResponse with ``{document_name, page_count, file_size_bytes,
        permission}``.

    Raises:
        HTTPException 404: If the link is unknown, revoked, or expired.
    """
    start_time = time.time()

    for header, value in _public_no_store_headers().items():
        response.headers[header] = value

    try:
        result = await share_service.resolve_public_link(token=token)
    except ValueError:
        # Generic 404 — never echo the token or the precise failure cause.
        raise HTTPException(status_code=404, detail=_PUBLIC_LINK_404_DETAIL)

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data=result,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/public/{token}/download",
    summary="Download a publicly shared document (no authentication)",
    description="""
Stream the PDF behind a public share link.

This endpoint is **public** — no authentication is required. The PDF served
is the current version of the owner's document (decrypted server-side).

## Path Parameters
- **token**: The public link token (from the shared URL)

## Query Parameters
- **dl**: If true, serve as an attachment (forces a download) instead of
  inline (browser viewer)

## Response
The raw PDF bytes with `Content-Disposition: inline` (or `attachment`),
`X-Robots-Tag: noindex` and no caching. Unknown, revoked or expired tokens
return **404**.
""",
    response_description="The PDF file bytes",
    response_class=Response,
    responses={
        200: {
            "description": "PDF streamed successfully",
            "content": {"application/pdf": {}},
        },
        404: {"description": "Public link not found, revoked, or expired"},
    },
)
async def download_public_link_document(
    token: str,
    dl: bool = Query(default=False, description="Force attachment download"),
) -> Response:
    """
    Stream the PDF behind a public link (unauthenticated).

    The bytes are loaded through the standard storage path with the OWNER
    identity (required for at-rest decryption) — see
    :meth:`ShareCrudService.download_public_document`.

    Args:
        token: The public link token from the shared URL.
        dl: If True, serve with ``Content-Disposition: attachment``.

    Returns:
        Response: The PDF bytes.

    Raises:
        HTTPException 404: If the link is unknown, revoked, or expired, or
            the stored file is unavailable.
    """
    try:
        pdf_bytes, document_name = await share_service.download_public_document(
            token=token
        )
    except ValueError:
        # Generic 404 — never echo the token or the precise failure cause.
        raise HTTPException(status_code=404, detail=_PUBLIC_LINK_404_DETAIL)

    headers = {
        "Content-Disposition": _content_disposition(document_name, inline=not dl),
        "Content-Length": str(len(pdf_bytes)),
        **_public_no_store_headers(),
    }

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers=headers,
    )
