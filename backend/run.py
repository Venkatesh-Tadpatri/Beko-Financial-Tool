"""Sidecar entry point (also the PyInstaller entry script).

Binds 127.0.0.1 on an OS-assigned free port and prints one line
    FVT_READY port=<n>
to stdout once the socket is listening, so Electron never races for a port.

If FVT_PARENT_PID is set, the sidecar exits on its own when that process
(Electron) disappears, so a crashed shell never leaves an orphan backend.
"""

from __future__ import annotations

import os
import socket
import sys
import threading

import uvicorn


def _watch_parent(pid: int, server: uvicorn.Server) -> None:
    if sys.platform != "win32":
        return
    import ctypes

    synchronize = 0x00100000
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(synchronize, False, pid)
    if not handle:
        server.should_exit = True
        return
    kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)  # INFINITE: returns when the parent exits
    kernel32.CloseHandle(handle)
    server.should_exit = True


def main() -> None:
    from app.core.config import Settings
    from app.core.logging_setup import configure as configure_logging
    from app.main import create_app

    settings = Settings.from_env()
    configure_logging(settings.paths.logs_dir)
    app = create_app(settings)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", settings.port))
    sock.listen(64)
    port = sock.getsockname()[1]

    config = uvicorn.Config(app, log_level="warning", access_log=False, lifespan="on")
    server = uvicorn.Server(config)
    app.state.request_shutdown = lambda: setattr(server, "should_exit", True)

    parent = os.environ.get("FVT_PARENT_PID")
    if parent and parent.isdigit():
        threading.Thread(target=_watch_parent, args=(int(parent), server), daemon=True, name="parent-watch").start()

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
