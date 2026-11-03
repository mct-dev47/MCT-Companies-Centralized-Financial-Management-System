from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections with scoped client metadata and thread-safe dispatch."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.connection_metadata: Dict[WebSocket, Dict[str, Any]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, websocket: WebSocket, metadata: Optional[Dict[str, Any]] = None) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_metadata[websocket] = metadata or {}
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass

    def register_client(self, websocket: WebSocket, user_id: Optional[int], company_ids: Optional[List[int]] = None, role: Optional[str] = None) -> None:
        if websocket in self.active_connections:
            self.connection_metadata[websocket] = {
                "user_id": user_id,
                "company_ids": company_ids or [],
                "role": role,
            }

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_metadata.pop(websocket, None)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast JSON message to all connected clients."""
        payload = json.dumps(message)
        dead_connections: list[WebSocket] = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(payload)
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
            meta = self.connection_metadata.get(connection, {})
            client_uid = meta.get("user_id")

            # If user_id is specified and client has a registered user_id, verify match
            if recipient_user_id is not None and client_uid is not None:
                if client_uid != recipient_user_id:
                    continue

            try:
                await connection.send_text(payload)
            except Exception:
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)

    def broadcast_sync(self, message: dict[str, Any]) -> None:
        """
        Thread-safe and synchronous-friendly broadcast caller.
        """
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
