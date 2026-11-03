from __future__ import annotations
import asyncio
import json
from typing import Any, List, Dict
from fastapi import WebSocket, WebSocketDisconnect


class ConnectionInfo:
    def __init__(self, websocket: WebSocket, claims: dict[str, Any]):
        self.websocket = websocket
        self.claims = claims
        app_meta = claims.get("app_metadata") if isinstance(claims.get("app_metadata"), dict) else {}
        role = str(claims.get("role") or app_meta.get("role") or "").lower()
        is_admin = bool(app_meta.get("is_admin") or claims.get("is_admin") or role == "admin")
        self.is_admin = is_admin
        self.role = role
        # Privileged roles: admin, finance, audit, auditor have cross-company visibility
        self.is_privileged = is_admin or role in ("admin", "finance", "audit", "auditor")

        cid = app_meta.get("company_id") or claims.get("company_id")
        raw_cids = claims.get("company_ids") or []
        all_cids = list(raw_cids)
        if cid is not None and cid not in all_cids:
            all_cids.append(cid)
        self.company_ids = {int(c) for c in all_cids if c is not None}

    def can_receive(self, target_company_id: int | None) -> bool:
        if target_company_id is None:
            return True
        if self.is_privileged:
            return True
        try:
            return int(target_company_id) in self.company_ids
        except (ValueError, TypeError):
            return False


class ConnectionManager:
    """Manages active WebSocket connections with JWT authentication and company tenant isolation."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.connection_map: Dict[WebSocket, ConnectionInfo] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, websocket: WebSocket, claims: dict[str, Any] | None = None) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_map[websocket] = ConnectionInfo(websocket, claims or {})
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_map.pop(websocket, None)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast JSON message to authorized connected clients based on company isolation."""
        payload_str = json.dumps(message)
        dead_connections: list[WebSocket] = []

        target_cid = message.get("company_id")
        if target_cid is None and isinstance(message.get("payload"), dict):
            target_cid = message["payload"].get("company_id")

        for connection in list(self.active_connections):
            info = self.connection_map.get(connection)
            if info is not None and not info.can_receive(target_cid):
                continue
            try:
                await connection.send_text(payload_str)
            except Exception:
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)

    def broadcast_sync(self, message: dict[str, Any]) -> None:
        """Thread-safe and synchronous-friendly broadcast caller."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(message))
            return
        except RuntimeError:
            pass

        server_loop = self._loop
        if server_loop is not None and server_loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self.broadcast(message), server_loop)
                return
            except Exception:
                pass

        if not self.active_connections:
            return
        try:
            asyncio.run(self.broadcast(message))
        except Exception:
            pass


ws_manager = ConnectionManager()
