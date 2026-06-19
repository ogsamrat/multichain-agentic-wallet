#!/usr/bin/env python3
"""Prism Index agent client (Python).

Discovers verified, agent-payable services from the Prism Index using only the
standard library. To actually pay an x402 endpoint, drive the Prism wallet
(`prism fetch <url>`) or the TypeScript SDK's `x402Fetch()`.

Usage:
    python agent.py "speech to text"
    PRISM_INDEX_URL=http://localhost:8787 python agent.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

INDEX_URL = os.environ.get("PRISM_INDEX_URL", "https://prism-index.vercel.app")


def search(query: str | None = None, asset: str | None = "USDC") -> dict:
    params: dict[str, str] = {}
    if query:
        params["q"] = query
    if asset:
        params["asset"] = asset
    url = f"{INDEX_URL}/v1/search?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else None
    data = search(query=query)
    results = data.get("results", [])
    print(f"Prism Index @ {INDEX_URL}")
    print(f"{data.get('count', len(results))} verified service(s)\n")
    for r in results:
        score = round(r.get("reliabilityScore", 0))
        print(f"- {r.get('name', r['slug'])}  [{r['type']}]  reliability {score}/100")
        if r.get("description"):
            print(f"  {r['description']}")
        for opt in r.get("paymentOptions", []):
            print(
                f"  pay: {opt['network']} {opt.get('assetSymbol', '')} "
                f"${opt['priceUsd']} -> {opt['payTo']}"
            )
        hint = r.get("callHint")
        if hint:
            print(f"  call: {hint.get('method', 'GET')} {hint.get('url', '')} (x402)")
        print()


if __name__ == "__main__":
    main()
