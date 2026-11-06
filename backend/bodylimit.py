"""Request body cap, enforced before the app reads a byte.

A pure ASGI middleware (no dependency; the in-browser demo runs the same
stack through backend/demo.py). Without it `POST /api/login` - reachable
without a session - parsed whatever JSON it was sent before the login
throttle ran, so a few large bodies exhausted the container's memory.

Two checks: a `Content-Length` over the limit is answered 413 without
reading anything; for a body without one (chunked) the bytes are counted in
a wrapped `receive`, which stops the moment the total passes the limit.
Either way the endpoint never runs."""

from __future__ import annotations

import json
from typing import Awaitable, Callable

MiB = 1024 * 1024
LIMIT_PUBLIC = 8 * 1024        # pre-session endpoints: a password and a name
LIMIT_DEFAULT = 8 * MiB        # any other request body (group-key lists of a
                               # very large mailbox are the biggest)
LIMIT_IMPORT = 64 * MiB        # settings backup (verdicts, replied, knowledge)

TOO_LARGE = "request_too_large"     # mailops.REQUEST_TOO_LARGE (same string)
_BODY = json.dumps({"detail": TOO_LARGE}).encode()


def limit_for(path: str, public: frozenset[str] | set[str]) -> int:
    path = path.rstrip("/") or "/"
    if path in public:
        return LIMIT_PUBLIC
    if path == "/api/import_config":
        return LIMIT_IMPORT
    return LIMIT_DEFAULT


class BodyLimit:
    def __init__(self, app, public: frozenset[str] | set[str] = frozenset()):
        self.app = app
        self.public = public

    async def __call__(self, scope, receive: Callable[[], Awaitable[dict]],
                       send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = limit_for(scope.get("path", ""), self.public)
        for name, value in scope.get("headers", ()):
            if name == b"content-length":
                try:
                    if int(value) > limit:
                        return await self._refuse(send)
                except ValueError:
                    pass            # malformed: the server rejects it itself
                break
        seen = 0
        over = False
        replaced = False

        async def counted() -> dict:
            nonlocal seen, over
            if over:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    # Stop reading. The framework turns the failed read into
                    # its own error answer (FastAPI: a 400 for any exception
                    # while parsing), so `watching` swaps that for the 413.
                    over = True
                    return {"type": "http.disconnect"}
            return message

        async def watching(message) -> None:
            nonlocal replaced
            if not over:
                return await send(message)
            if not replaced:
                replaced = True
                await self._refuse(send)

        await self.app(scope, counted, watching)

    @staticmethod
    async def _refuse(send) -> None:
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(_BODY)).encode()),
                                (b"connection", b"close")]})
        await send({"type": "http.response.body", "body": _BODY})
