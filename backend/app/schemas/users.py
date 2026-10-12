from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RoleName = Literal["viewer", "editor", "approver", "admin", "super_admin"]


class UserRow(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    is_active: bool
    is_founder: bool
    must_change_password: bool
    locked: bool
    last_login_at: datetime | None
    created_at: datetime


class CreateUserRequest(BaseModel):
    username: str = Field(max_length=64)
    display_name: str = Field(default="", max_length=128)
    role: RoleName
    password: str = Field(max_length=256)
    confirm_password: str = Field(max_length=256)


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=128)
    role: RoleName | None = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(max_length=256)
    confirm_password: str = Field(max_length=256)
