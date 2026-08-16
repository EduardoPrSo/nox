from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from nox_bridge.config import Settings

DeviceFactory = Callable[[], Awaitable[Any]]


class MideaAdapter:
    def __init__(self, settings: Settings, device_factory: DeviceFactory | None = None) -> None:
        self._settings = settings
        self._device_factory = device_factory or self._create_device
        self._device: Any | None = None

    async def execute(self, command: dict[str, Any]) -> dict[str, Any]:
        command_id = str(command.get("id", ""))
        if command.get("deviceId") != self._settings.device_id:
            return failure(command_id, "COMMAND_REJECTED", "Command targets a different device.")
        operation = command.get("operation")
        if not isinstance(operation, dict) or not isinstance(operation.get("action"), str):
            return failure(command_id, "INVALID_RESPONSE", "Command operation is invalid.")
        try:
            return await asyncio.wait_for(
                self._execute(command_id, operation),
                timeout=self._settings.device_timeout_seconds,
            )
        except (asyncio.TimeoutError, TimeoutError):
            self._device = None
            return failure(command_id, "TIMEOUT", "Midea device operation timed out.")
        except Exception as error:  # Protocol errors vary between msmart-ng versions.
            self._device = None
            error_name = type(error).__name__.lower()
            code = "AUTHENTICATION_FAILED" if "auth" in error_name else "DEVICE_OFFLINE"
            return failure(command_id, code, f"Midea operation failed ({type(error).__name__}).")

    async def read_state(self) -> dict[str, Any]:
        device = await self._get_device()
        await device.refresh()
        return state_from_device(device)

    async def _execute(self, command_id: str, operation: dict[str, Any]) -> dict[str, Any]:
        device = await self._get_device()
        await device.refresh()
        if not bool(device.online):
            return failure(command_id, "DEVICE_OFFLINE", "Midea device reported offline.")
        action = operation["action"]
        if action == "get_state":
            return success(command_id, state_from_device(device))
        if action == "turn_on":
            device.power_state = True
        elif action == "turn_off":
            device.power_state = False
        elif action == "set_temperature":
            temperature = operation.get("temperatureCelsius")
            if not isinstance(temperature, (int, float)) or isinstance(temperature, bool):
                return failure(command_id, "COMMAND_REJECTED", "Temperature is invalid.")
            device.power_state = True
            device.target_temperature = float(temperature)
        elif action == "set_mode":
            mode = operation.get("mode")
            mode_map = {
                "auto": device.OperationalMode.AUTO,
                "cool": device.OperationalMode.COOL,
                "dry": device.OperationalMode.DRY,
                "heat": device.OperationalMode.HEAT,
                "fan": device.OperationalMode.FAN_ONLY,
            }
            if not isinstance(mode, str) or mode not in mode_map:
                return failure(command_id, "COMMAND_REJECTED", "Climate mode is invalid.")
            device.power_state = True
            device.operational_mode = mode_map[mode]
        else:
            return failure(command_id, "COMMAND_REJECTED", "Climate action is not supported.")

        await device.apply()
        await device.refresh()
        state = state_from_device(device)
        if not confirms(operation, state):
            return failure(
                command_id,
                "STATE_NOT_CONFIRMED",
                "Device readback did not confirm the requested state.",
                state,
            )
        return success(command_id, state)

    async def _get_device(self) -> Any:
        if self._device is None:
            self._device = await self._device_factory()
        return self._device

    async def _create_device(self) -> Any:
        from msmart.device import AirConditioner

        device = AirConditioner(
            ip=self._settings.midea_ip,
            port=self._settings.midea_port,
            device_id=self._settings.midea_device_id,
        )
        if self._settings.midea_token and self._settings.midea_key:
            await device.authenticate(self._settings.midea_token, self._settings.midea_key)
        await device.get_capabilities()
        return device


def state_from_device(device: Any) -> dict[str, Any]:
    mode_name = getattr(device.operational_mode, "name", "").lower()
    modes = {
        "auto": "auto",
        "cool": "cool",
        "dry": "dry",
        "heat": "heat",
        "fan_only": "fan",
    }
    mode = modes.get(mode_name)
    if mode is None:
        raise ValueError(f"Unsupported Midea operational mode: {mode_name}")
    state: dict[str, Any] = {
        "power": bool(device.power_state),
        "targetTemperatureCelsius": float(device.target_temperature),
        "mode": mode,
        "online": bool(device.online),
    }
    if isinstance(device.indoor_temperature, (int, float)):
        state["indoorTemperatureCelsius"] = float(device.indoor_temperature)
    if isinstance(device.outdoor_temperature, (int, float)):
        state["outdoorTemperatureCelsius"] = float(device.outdoor_temperature)
    return state


def confirms(operation: dict[str, Any], state: dict[str, Any]) -> bool:
    action = operation["action"]
    if action == "turn_on":
        return state["power"] is True
    if action == "turn_off":
        return state["power"] is False
    if action == "set_temperature":
        return state["power"] is True and abs(
            float(state["targetTemperatureCelsius"]) - float(operation["temperatureCelsius"])
        ) <= 0.25
    if action == "set_mode":
        return state["power"] is True and state["mode"] == operation["mode"]
    return action == "get_state"


def success(command_id: str, state: dict[str, Any]) -> dict[str, Any]:
    return {"commandId": command_id, "success": True, "confirmed": True, "state": state}


def failure(
    command_id: str,
    code: str,
    error: str,
    state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "commandId": command_id,
        "success": False,
        "confirmed": False,
        "code": code,
        "error": error,
        **({"state": state} if state else {}),
    }
