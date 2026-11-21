#!/usr/bin/env python3
"""
Relativistic City — Local Testing & Development Backend Server.

Serves the browser-based WebGL2 relativistic engine from ./public along with
lightweight JSON endpoints for physics/scenario presets and health checks.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / "public"

PRESETS = [
    {
        "id": "boulevard_default",
        "name": "Relativistic Boulevard — Afternoon (c = 25 m/s)",
        "description": "Balanced afternoon sun: driving speeds reach 0.90c+, cars cruise at 0.35c–0.55c.",
        "speedOfLight": 25.0,
        "maxBeta": 0.992,
        "trafficSpeedScale": 1.0,
        "timeOfDayHours": 15.2,
    },
    {
        "id": "crimson_sunset",
        "name": "Crimson Sunset Starbow (c = 20 m/s)",
        "description": "Fiery horizon sunset with warm streetlamps, café neon, and strong headlight beaming.",
        "speedOfLight": 20.0,
        "maxBeta": 0.992,
        "trafficSpeedScale": 1.05,
        "timeOfDayHours": 18.15,
    },
    {
        "id": "midnight_neon",
        "name": "Starry Night & Bullet Train (c = 22 m/s)",
        "description": "Night sky starfield + moonlight + glowing windows, streetlamps & relativistic Starbow.",
        "speedOfLight": 22.0,
        "maxBeta": 0.992,
        "trafficSpeedScale": 1.1,
        "timeOfDayHours": 22.5,
    },
    {
        "id": "walking_light",
        "name": "Ultra-Slow Light (c = 10 m/s)",
        "description": "Even slow cruising triggers dramatic Terrell rotation and Doppler shifts.",
        "speedOfLight": 10.0,
        "maxBeta": 0.994,
        "trafficSpeedScale": 0.85,
        "timeOfDayHours": 8.0,
    },
    {
        "id": "classical_limit",
        "name": "Near-Newtonian Reference (c = 400 m/s)",
        "description": "High speed of light to inspect the exact same city without relativistic warping.",
        "speedOfLight": 400.0,
        "maxBeta": 0.95,
        "trafficSpeedScale": 1.0,
        "timeOfDayHours": 14.5,
    },
]

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/plain", ".glsl")


class RelativityRequestHandler(SimpleHTTPRequestHandler):
    """Serves static frontend assets and lightweight JSON API routes."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json({"status": "ok", "engine": "relativistic-city", "metric": "minkowski"})
            return
        if parsed.path == "/api/presets":
            self._send_json({"presets": PRESETS})
            return
        super().do_GET()

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        if os.environ.get("QUIET_SERVER") == "1":
            return
        super().log_message(fmt, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Relativistic City visualization.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")
    args = parser.parse_args()

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), RelativityRequestHandler)
    print(f"Relativistic City server listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
