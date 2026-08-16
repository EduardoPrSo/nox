import asyncio
import json
import os

from nox_bridge.config import Settings
from nox_bridge.midea import MideaAdapter


async def main() -> None:
    os.environ.setdefault("NOX_CORE_URL", "http://localhost")
    os.environ.setdefault("NOX_DEVICE_BRIDGE_TOKEN", "local-read-only-verifier-token-000")
    os.environ.setdefault("NOX_DEVICE_BRIDGE_ID", "local-verifier")
    os.environ.setdefault("NOX_DEVICE_ID", "local-midea")
    settings = Settings.from_env()
    state = await MideaAdapter(settings).read_state()
    print(json.dumps({"deviceId": settings.device_id, "state": state}, ensure_ascii=False, indent=2))


def entrypoint() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    entrypoint()
