"""Sidecar entry point (also the PyInstaller entry script).

Binds 127.0.0.1 on an OS-assigned free port and prints one line
    FVT_READY port=<n>
to stdout once the socket is listening, so Electron never races for a port.
"""

from __future__ import annotations

import socket
import sys

import uvicorn


def main() -> None:
    from app.main import create_app

    app = create_app()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", app.state.fvt.settings.port))
    sock.listen(64)
    port = sock.getsockname()[1]

    config = uvicorn.Config(app, log_level="warning", access_log=False, lifespan="on")
    server = uvicorn.Server(config)

    original_startup = server.startup

    async def startup_and_announce(sockets=None):
        await original_startup(sockets=sockets)
        if server.started:
            print(f"FVT_READY port={port}", flush=True)

    server.startup = startup_and_announce  # type: ignore[method-assign]
    server.run(sockets=[sock])
    sys.exit(0 if server.started else 1)


if __name__ == "__main__":
    main()
