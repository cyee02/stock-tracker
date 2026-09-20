from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import require_admin

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


class NewLink(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


@router.get("/links")
def list_links(request: Request):
    return request.app.state.db.list_links()


@router.post("/links", status_code=201)
def create_link(body: NewLink, request: Request):
    link, token = request.app.state.db.create_link(body.name.strip())
    return {**link, "token": token}


@router.delete("/links/{link_id}", status_code=204)
def revoke_link(link_id: int, request: Request):
    if not request.app.state.db.revoke_link(link_id):
        raise HTTPException(404, "Link not found or already revoked")
