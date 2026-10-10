"""Permission catalogue. Every protected route names one of these; the backend is the authority."""

from __future__ import annotations

import enum

from app.models.security import Role


class Perm(str, enum.Enum):
    VIEW_REPORTS = "view_reports"
    EXPORT_REPORTS = "export_reports"
    UPLOAD_DATA = "upload_data"
    SAVE_DRAFTS = "save_drafts"
    APPROVE_DATA = "approve_data"
    OVERRIDE_DATA = "override_data"
    MANAGE_MASTER_DATA = "manage_master_data"
    MANAGE_MAPPINGS = "manage_mappings"
    CONFIGURE_APPROVALS = "configure_approvals"
    MANAGE_USERS = "manage_users"
    MANAGE_BACKUPS = "manage_backups"
    VIEW_AUDIT_LOG = "view_audit_log"
    ADMIN_DATA = "admin_data"  # export-all, demo data


# Minimum role for each permission. Roles are cumulative (each includes the ones below it).
MIN_ROLE: dict[Perm, Role] = {
    Perm.VIEW_REPORTS: Role.VIEWER,
    Perm.EXPORT_REPORTS: Role.VIEWER,
    Perm.UPLOAD_DATA: Role.EDITOR,
    Perm.SAVE_DRAFTS: Role.EDITOR,
    Perm.APPROVE_DATA: Role.APPROVER,
    Perm.OVERRIDE_DATA: Role.APPROVER,
    Perm.MANAGE_MASTER_DATA: Role.ADMIN,
    Perm.MANAGE_MAPPINGS: Role.ADMIN,
    Perm.CONFIGURE_APPROVALS: Role.ADMIN,
    Perm.MANAGE_USERS: Role.SUPER_ADMIN,
    Perm.MANAGE_BACKUPS: Role.SUPER_ADMIN,
    Perm.VIEW_AUDIT_LOG: Role.SUPER_ADMIN,
    Perm.ADMIN_DATA: Role.SUPER_ADMIN,
}


def has_perm(role: str, perm: Perm) -> bool:
    return Role(role).at_least(MIN_ROLE[perm])


def perms_for(role: str) -> list[str]:
    return sorted(p.value for p in Perm if has_perm(role, p))
