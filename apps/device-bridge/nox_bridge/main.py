import asyncio
import logging

from nox_bridge.client import CoreClient
from nox_bridge.config import Settings
from nox_bridge.logging import configure_logging
from nox_bridge.midea import MideaAdapter


async def main() -> None:
    settings = Settings.from_env()
    client = CoreClient(settings, MideaAdapter(settings))
    logging.getLogger("nox_bridge").info(
        "bridge_started",
        extra={"fields": {"bridgeId": settings.bridge_id, "deviceId": settings.device_id}},
    )
    try:
        await client.run_forever()
    finally:
        await client.close()


def entrypoint() -> None:
    configure_logging()
    asyncio.run(main())


if __name__ == "__main__":
    entrypoint()
