from __future__ import annotations

from pydantic import BaseModel, Field


class SetupRequest(BaseModel):
    username: str = Field(max_length=64)
    display_name: str = Field(default="", max_length=128)
    password: str = Field(max_length=256)
    confirm_password: str = Field(max_length=256)


class LoginRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)
    confirm_password: str = Field(max_length=256)


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    must_change_password: bool
    permissions: list[str]


class LoginResponse(BaseModel):
    token: str
    user: UserOut
    idle_timeout_seconds: int


class SystemStatus(BaseModel):
    mode: str
    needs_setup: bool
    version: str
    recovery: dict | None = None
    password_policy: str
