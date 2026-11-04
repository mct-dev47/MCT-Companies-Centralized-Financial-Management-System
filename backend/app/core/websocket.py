from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


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
        parsed_cids = set()
        for c in all_cids:
            if c is not None and str(c).strip().isdigit():
                try:
                    parsed_cids.add(int(c))
                except (ValueError, TypeError):
                    pass
        self.company_ids = parsed_cids

        # Resolve user_id if present in claims
        uid = claims.get("user_id") or app_meta.get("user_id") or claims.get("sub")
        try:
            self.user_id = int(uid) if uid is not None and str(uid).isdigit() else None
        except (ValueError, TypeError):
            self.user_id = None

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
    """Manages active WebSocket connections with JWT authentication, company tenant isolation, and scoped dispatch."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.connection_map: Dict[WebSocket, ConnectionInfo] = {}
        self.connection_metadata: Dict[WebSocket, Dict[str, Any]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    async def connect(
        self,
        websocket: WebSocket,
        claims: dict[str, Any] | None = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        merged_data = dict(claims or {})
        if metadata:
            merged_data.update(metadata)
        self.connection_map[websocket] = ConnectionInfo(websocket, merged_data)
        self.connection_metadata[websocket] = merged_data
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

    def register_client(
        self,
        websocket: WebSocket,
        user_id: Optional[int],
        company_ids: Optional[List[int]] = None,
        role: Optional[str] = None,
    ) -> None:
        if websocket in self.active_connections:
            meta = {
                "user_id": user_id,
                "company_ids": company_ids or [],
                "role": role,
            }
            self.connection_metadata[websocket] = meta
            # Also update ConnectionInfo if exists
            info = self.connection_map.get(websocket)
            if info:
                info.user_id = user_id
                if company_ids:
                    info.company_ids.update(int(c) for c in company_ids if c is not None)
                if role:
                    info.role = role.lower()
                    info.is_privileged = info.is_admin or info.role in ("admin", "finance", "audit", "auditor")

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_map.pop(websocket, None)
        self.connection_metadata.pop(websocket, None)

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

    async def broadcast_scoped(
        self,
        message: dict[str, Any],
        recipient_user_id: Optional[int] = None,
        company_id: Optional[int] = None,
    ) -> None:
        """
        Sends JSON message strictly to eligible clients.
        If recipient_user_id is provided, only targets sockets for that user_id
        (or clients whose user_id is not yet registered).
        """
        payload = json.dumps(message)
        dead_connections: list[WebSocket] = []

        for connection in list(self.active_connections):
            info = self.connection_map.get(connection)
            meta = self.connection_metadata.get(connection, {})
            client_uid = meta.get("user_id") or (info.user_id if info else None)

            # If user_id is specified and client has a registered user_id, verify match
            if recipient_user_id is not None and client_uid is not None:
                if client_uid != recipient_user_id:
                    continue

            # Verify company isolation if specified
            if company_id is not None and info is not None and not info.can_receive(company_id):
                continue

            try:
                await connection.send_text(payload)
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
