from enum import Enum

import httpx
import pytest

from nox_bridge.client import BridgeAuthenticationError, CoreClient
from nox_bridge.config import Settings
from nox_bridge.midea import MideaAdapter


class Mode(Enum):
    AUTO = 1
    COOL = 2
    DRY = 3
    HEAT = 4
    FAN_ONLY = 5


class FakeDevice:
    OperationalMode = Mode

    def __init__(self) -> None:
        self.power_state = True
        self.target_temperature = 24.0
        self.operational_mode = Mode.COOL
        self.online = True
        self.indoor_temperature = 25.0
        self.outdoor_temperature = 30.0
        self.apply_calls = 0
        self.ignore_apply = False

    async def refresh(self) -> None:
        pass

    async def apply(self) -> None:
        self.apply_calls += 1
        if self.ignore_apply:
            self.target_temperature = 24.0


def settings() -> Settings:
    return Settings(
        core_url="https://core.example",
        bridge_token="b" * 32,
        bridge_id="home",
        device_id="home-ac",
        long_poll_seconds=1,
        device_timeout_seconds=1,
        midea_ip="192.168.1.10",
        midea_port=6444,
        midea_device_id=123,
        midea_token=None,
        midea_key=None,
    )


@pytest.mark.asyncio
async def test_midea_applies_and_confirms_real_readback() -> None:
    device = FakeDevice()
    adapter = MideaAdapter(settings(), device_factory=lambda: async_value(device))
    result = await adapter.execute(
        {
            "id": "command-1",
            "deviceId": "home-ac",
            "operation": {"action": "set_temperature", "temperatureCelsius": 23},
        }
    )
    assert result["success"] is True
    assert result["confirmed"] is True
    assert result["state"]["targetTemperatureCelsius"] == 23
    assert device.apply_calls == 1


@pytest.mark.asyncio
async def test_midea_never_reports_success_when_readback_differs() -> None:
    device = FakeDevice()
    device.ignore_apply = True
    adapter = MideaAdapter(settings(), device_factory=lambda: async_value(device))
    result = await adapter.execute(
        {
            "id": "command-2",
            "deviceId": "home-ac",
            "operation": {"action": "set_temperature", "temperatureCelsius": 23},
        }
    )
    assert result["success"] is False
    assert result["confirmed"] is False
    assert result["code"] == "STATE_NOT_CONFIRMED"


@pytest.mark.asyncio
async def test_client_polls_executes_and_submits_result_without_secrets() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "id": "command-3",
                    "deviceId": "home-ac",
                    "operation": {"action": "get_state"},
                },
            )
        return httpx.Response(202, json={"accepted": True})

    device = FakeDevice()
    adapter = MideaAdapter(settings(), device_factory=lambda: async_value(device))
    client = CoreClient(settings(), adapter, transport=httpx.MockTransport(handler))
    try:
        assert await client.run_once() is True
    finally:
        await client.close()
    assert [request.method for request in requests] == ["GET", "POST"]
    submitted = requests[1].content.decode()
    assert '"confirmed":true' in submitted
    assert settings().bridge_token not in submitted


@pytest.mark.asyncio
async def test_client_stops_on_rejected_bridge_credentials() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    client = CoreClient(
        settings(),
        MideaAdapter(settings(), device_factory=lambda: async_value(FakeDevice())),
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(BridgeAuthenticationError):
            await client.run_once()
    finally:
        await client.close()


async def async_value(value):
    return value
