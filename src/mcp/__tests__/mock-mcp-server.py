#!/usr/bin/env python3
"""
Mock MCP Server for tests.

Implements a minimal subset of the MCP JSON-RPC 2.0 protocol over stdio:
- initialize
- notifications/initialized (no response)
- tools/list
- tools/call (echo/add/fail/slow)

This file intentionally uses Python because some sandboxed CI environments
disallow spawning `node` subprocesses with a writable stdin pipe.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any, Dict, Optional


SERVER_INFO = {"name": "mock-mcp-server", "version": "1.0.0"}

TOOLS = [
    {
        "name": "echo",
        "description": "Echoes the input message back",
        "inputSchema": {
            "type": "object",
            "properties": {"message": {"type": "string", "description": "Message to echo"}},
            "required": ["message"],
        },
    },
    {
        "name": "add",
        "description": "Adds two numbers together",
        "inputSchema": {
            "type": "object",
            "properties": {
                "a": {"type": "number", "description": "First number"},
                "b": {"type": "number", "description": "Second number"},
            },
            "required": ["a", "b"],
        },
    },
    {
        "name": "fail",
        "description": "Always fails with an error",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "slow",
        "description": "Responds after a delay",
        "inputSchema": {
            "type": "object",
            "properties": {"delayMs": {"type": "number", "description": "Delay in milliseconds"}},
        },
    },
]


def send(msg: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def tool_result_text(req_id: Any, text: str, is_error: bool) -> Dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {"content": [{"type": "text", "text": text}], "isError": is_error},
    }


def handle_request(req: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params") or {}

    if method == "initialize":
        proto = (params.get("protocolVersion") if isinstance(params, dict) else None) or "2024-11-05"
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": proto,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            },
        }

    if method == "notifications/initialized":
        return None

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        name = params.get("name") if isinstance(params, dict) else None
        args = params.get("arguments") if isinstance(params, dict) else None
        if not isinstance(args, dict):
            args = {}

        if name == "echo":
            return tool_result_text(req_id, str(args.get("message") or ""), False)
        if name == "add":
            a = args.get("a") or 0
            b = args.get("b") or 0
            try:
                return tool_result_text(req_id, str(float(a) + float(b)).rstrip("0").rstrip("."), False)
            except Exception:
                return tool_result_text(req_id, "0", False)
        if name == "fail":
            return tool_result_text(req_id, "Intentional failure for testing", True)
        if name == "slow":
            delay_ms = args.get("delayMs") or 1000
            try:
                delay_ms = int(delay_ms)
            except Exception:
                delay_ms = 1000
            time.sleep(delay_ms / 1000.0)
            return tool_result_text(req_id, f"Responded after {delay_ms}ms", False)

        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Tool not found: {name}"}}

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main() -> int:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            if not isinstance(req, dict):
                raise ValueError("request must be object")
            resp = handle_request(req)
            if resp is not None:
                send(resp)
        except Exception as e:
            send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"Parse error: {e}"}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

