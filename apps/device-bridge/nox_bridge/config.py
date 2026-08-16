from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address
import os
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    core_url: str
    bridge_token: str
    bridge_id: str
    device_id: str
    long_poll_seconds: float
    device_timeout_seconds: float
    midea_ip: str
    midea_port: int
    midea_device_id: int
    midea_token: str | None
    midea_key: str | None

    @classmethod
    def from_env(cls) -> "Settings":
        core_url = required("NOX_CORE_URL").rstrip("/")
        parsed = urlparse(core_url)
        if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("NOX_CORE_URL must use HTTPS outside local development")
        bridge_token = required("NOX_DEVICE_BRIDGE_TOKEN")
        if len(bridge_token) < 32:
            raise ValueError("NOX_DEVICE_BRIDGE_TOKEN must contain at least 32 characters")
        midea_ip = required("MIDEA_DEVICE_IP")
        ip_address(midea_ip)
        token = optional("MIDEA_DEVICE_TOKEN")
        key = optional("MIDEA_DEVICE_KEY")
        if bool(token) != bool(key):
            raise ValueError("MIDEA_DEVICE_TOKEN and MIDEA_DEVICE_KEY must be configured together")
        return cls(
            core_url=core_url,
            bridge_token=bridge_token,
            bridge_id=required("NOX_DEVICE_BRIDGE_ID"),
            device_id=required("NOX_DEVICE_ID"),
            long_poll_seconds=positive_float("NOX_BRIDGE_LONG_POLL_SECONDS", 25),
            device_timeout_seconds=positive_float("NOX_BRIDGE_DEVICE_TIMEOUT_SECONDS", 20),
            midea_ip=midea_ip,
            midea_port=positive_int("MIDEA_DEVICE_PORT", 6444),
            midea_device_id=positive_int("MIDEA_DEVICE_ID"),
            midea_token=token,
            midea_key=key,
        )


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def optional(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def positive_int(name: str, default: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None and default is not None:
        return default
    try:
        value = int(raw or "")
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def positive_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value
