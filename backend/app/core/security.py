"""Password hashing (Argon2id), password policy and session tokens.

Plain-text passwords exist only in request memory: they are never stored,
logged, audited or returned.
"""

from __future__ import annotations

import hashlib
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

# OWASP-recommended Argon2id parameters (64 MiB, t=3, p=4).
_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4, hash_len=32, salt_len=16,
                         type=Type.ID)
# Used to spend the same time when the username does not exist (no user enumeration by timing).
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))

MIN_LENGTH = 10
MAX_LENGTH = 128
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problems(password: str, username: str = "") -> list[str]:
    """Human-readable list of policy violations; empty means the password is acceptable."""
    problems = []
    if len(password) < MIN_LENGTH:
        problems.append(f"at least {MIN_LENGTH} characters")
    if len(password) > MAX_LENGTH:
        problems.append(f"at most {MAX_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        problems.append("an upper-case letter")
    if not re.search(r"[a-z]", password):
        problems.append("a lower-case letter")
    if not re.search(r"\d", password):
        problems.append("a digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        problems.append("a symbol")
    if username and len(username) >= 3 and username.lower() in password.lower():
        problems.append("not containing the username")
    return problems


def username_problem(username: str) -> str | None:
    if not USERNAME_RE.match(username):
        return "Username must be 3-64 characters: letters, digits, dot, underscore or hyphen."
    return None


_TEMP_SETS = ("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?")


def temporary_password(length: int = 14) -> str:
    """Random password that satisfies the policy; ambiguous characters (O/0, l/1) left out."""
    rng = secrets.SystemRandom()
    chars = [rng.choice(s) for s in _TEMP_SETS]
    pool = "".join(_TEMP_SETS)
    chars += [rng.choice(pool) for _ in range(length - len(chars))]
    rng.shuffle(chars)
    return "".join(chars)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)  # 256 bits


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
