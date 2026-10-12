"""Built-in Super Admin for a fresh installation.

On a brand-new database (no users at all) the application creates the
Super Admin below. Only the Argon2id hash of the starting password is kept
here, never the password itself. The account is flagged must_change_password,
so nothing in the application is reachable with the starting password until
it has been changed at the first sign-in.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core import clock
from app.core.db import transaction
from app.models import Role, User
from app.services import audit

DEFAULT_ADMIN_USERNAME = "admin@beko-technologies.com"
DEFAULT_ADMIN_DISPLAY_NAME = "Super Admin"
# Argon2id (64 MiB, t=3, p=4) hash of the starting password handed over with the installation.
DEFAULT_ADMIN_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$3zbbzvcfHC5sVKsELS+rWQ$FCS3DsebjRmpHBnUPSz8WTFjY/MQJVB2/5TxLjC66AU"
)


def ensure_default_admin(factory: sessionmaker[Session]) -> bool:
    """Create the built-in Super Admin if the database has no users. Returns True if created."""
    with transaction(factory) as s:
        if (s.scalar(select(func.count()).select_from(User)) or 0) > 0:
            return False
        user = User(username=DEFAULT_ADMIN_USERNAME, display_name=DEFAULT_ADMIN_DISPLAY_NAME,
                    password_hash=DEFAULT_ADMIN_PASSWORD_HASH, role=Role.SUPER_ADMIN.value, is_founder=True,
                    must_change_password=True, password_changed_at=clock.now())
        s.add(user)
        s.flush()
        audit.record(s, "default_admin_created", user=user, entity_type="user", entity_id=user.id,
                     details={"must_change_password": True})
        return True
