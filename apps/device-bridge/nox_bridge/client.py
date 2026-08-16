from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import quote

import httpx

from nox_bridge.config import Settings
from nox_bridge.midea import MideaAdapter

LOGGER = logging.getLogger("nox_bridge")


class BridgeAuthenticationError(RuntimeError):
    pass


class CoreClient:
    def __init__(
        self,
        settings: Settings,
        adapter: MideaAdapter,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._adapter = adapter
        self._client = httpx.AsyncClient(
            base_url=settings.core_url,
            headers={"Authorization": f"Bearer {settings.bridge_token}"},
            timeout=httpx.Timeout(settings.long_poll_seconds + 10),
            transport=transport,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def run_forever(self) -> None:
        backoff = 1.0
        while True:
            try:
                await self.run_once()
                backoff = 1.0
            except BridgeAuthenticationError:
                raise
            except (httpx.HTTPError, ValueError) as error:
                LOGGER.warning(
                    "core_unavailable",
                    extra={"fields": {"errorType": type(error).__name__, "retryInSeconds": backoff}},
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def run_once(self) -> bool:
        bridge_id = quote(self._settings.bridge_id, safe="")
        response = await self._client.get(f"/bridge/v1/bridges/{bridge_id}/commands/next")
        if response.status_code in {401, 403}:
            raise BridgeAuthenticationError("Core rejected bridge credentials")
        response.raise_for_status()
        if response.status_code == 204:
            return False
        command = response.json()
        if not isinstance(command, dict) or not isinstance(command.get("id"), str):
            raise ValueError("Core returned an invalid command")
        started = asyncio.get_running_loop().time()
        result = await self._adapter.execute(command)
        await self._submit_result(command["id"], result)
        LOGGER.info(
            "command_completed",
            extra={
                "fields": {
                    "commandId": command["id"],
                    "deviceId": command.get("deviceId"),
                    "action": command.get("operation", {}).get("action"),
                    "success": result.get("success") is True,
                    "confirmed": result.get("confirmed") is True,
                    "durationMs": round((asyncio.get_running_loop().time() - started) * 1000),
                }
            },
        )
        return True

    async def _submit_result(self, command_id: str, result: dict[str, Any]) -> None:
        bridge_id = quote(self._settings.bridge_id, safe="")
        encoded_command_id = quote(command_id, safe="")
        path = f"/bridge/v1/bridges/{bridge_id}/commands/{encoded_command_id}/result"
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = await self._client.post(path, json=result)
                if response.status_code in {401, 403}:
                    raise BridgeAuthenticationError("Core rejected bridge credentials")
                response.raise_for_status()
                return
            except BridgeAuthenticationError:
                raise
            except httpx.HTTPError as error:
                last_error = error
                if attempt < 2:
                    await asyncio.sleep(2**attempt)
        assert last_error is not None
        raise last_error
