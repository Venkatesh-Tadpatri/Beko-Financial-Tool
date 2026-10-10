"""Per-launch shared secret between Electron and the sidecar.

The sidecar listens on 127.0.0.1, which any local program can reach. Electron
generates a random key at every launch, passes it to the sidecar in the
environment and attaches it to every request. Requests without it are refused
before any routing happens.
"""

from __future__ import annotations

import hmac

from starlette.types import ASGIApp, Receive, Scope, Send

HEADER = b"x-app-key"


class AppKeyMiddleware:
    def __init__(self, app: ASGIApp, key: str) -> None:
        self.app = app
        self.key = key.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":  # CORS preflight carries no custom headers
            await self.app(scope, receive, send)
            return
        supplied = dict(scope["headers"]).get(HEADER, b"")
        if not hmac.compare_digest(supplied, self.key):
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"detail":"forbidden"}'})
            return
        await self.app(scope, receive, send)
