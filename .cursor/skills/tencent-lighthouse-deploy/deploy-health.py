#!/usr/bin/env python3
"""Summarize lighthouse /health JSON. Reads ssh probe output from stdin. No secrets."""
from __future__ import annotations

import json
import sys


def main() -> int:
    text = sys.stdin.read()
    parts = text.split("---", 1)
    units = parts[0].split()
    print("units", " ".join(units))
    if len(parts) < 2:
        return 1
    seen: set[str] = set()
    for line in parts[1].splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if data.get("ok") is not True:
            continue
        svc = str(data.get("service") or "?")
        bits = [f"ok=true", f"service={svc}"]
        if svc == "control-plane":
            slots = data.get("vmSlots") or {}
            bits += [
                f"runtime={data.get('workerRuntime')}",
                f"kernel={data.get('agentKernel')}",
                f"slots={slots.get('total')}",
                f"store={data.get('metadataStore')}",
                f"bus={data.get('eventBus')}",
                f"llm={data.get('llmConfigured')}",
            ]
        if svc == "llm-gateway":
            bits += [f"upstream={data.get('upstream')}", f"configured={data.get('configured')}"]
        if svc == "neo-loop":
            bits += ["required=1"]
        print(" ".join(str(bit) for bit in bits))
        seen.add(svc)
    needed = {"control-plane", "llm-gateway", "admin-api", "neo-loop"}
    return 0 if needed <= seen else 1


if __name__ == "__main__":
    raise SystemExit(main())
