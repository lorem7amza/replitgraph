#!/usr/bin/env python3
"""Fetch a price series from Yahoo Finance via yfinance and print JSON.

Usage: yf_quote.py <TICKER> <RANGE>
where RANGE is one of: 1D, 1W, 1M, 3M, 1Y, 5Y
"""
import json
import math
import sys

import yfinance as yf

RANGE_MAP = {
    "1D": ("1d", "5m"),
    "1W": ("5d", "15m"),
    "1M": ("1mo", "1d"),
    "3M": ("3mo", "1d"),
    "1Y": ("1y", "1d"),
    "5Y": ("5y", "1wk"),
}


def fail(msg: str, code: int = 1) -> None:
    sys.stdout.write(json.dumps({"error": msg}))
    sys.stdout.flush()
    sys.exit(code)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: yf_quote.py <TICKER> <RANGE>")

    ticker_raw = sys.argv[1].strip().upper()
    range_key = sys.argv[2].strip().upper()

    if not ticker_raw:
        fail("ticker is required")
    if range_key not in RANGE_MAP:
        fail(f"invalid range: {range_key}")

    period, interval = RANGE_MAP[range_key]

    try:
        t = yf.Ticker(ticker_raw)
        hist = t.history(period=period, interval=interval, auto_adjust=False)
    except Exception as e:  # noqa: BLE001
        fail(f"fetch failed: {e.__class__.__name__}: {e}")
        return

    if hist is None or hist.empty:
        fail(f"no data for {ticker_raw}")
        return

    points = []
    for ts, row in hist["Close"].dropna().items():
        try:
            value = float(row)
        except (TypeError, ValueError):
            continue
        if math.isnan(value) or math.isinf(value):
            continue
        points.append({"t": int(ts.timestamp() * 1000), "price": value})

    if not points:
        fail("no usable data points")
        return

    info = {}
    try:
        info = t.fast_info or {}
    except Exception:  # noqa: BLE001
        info = {}

    last = points[-1]["price"]
    previous_close = info.get("previous_close") if isinstance(info, dict) else None
    if previous_close is None:
        try:
            previous_close = float(info["previousClose"])  # type: ignore[index]
        except Exception:  # noqa: BLE001
            previous_close = points[0]["price"]

    currency = None
    long_name = None
    try:
        currency = info.get("currency") if isinstance(info, dict) else None
    except Exception:  # noqa: BLE001
        currency = None
    try:
        long_name = info.get("longName") if isinstance(info, dict) else None
    except Exception:  # noqa: BLE001
        long_name = None

    out = {
        "symbol": ticker_raw,
        "name": long_name or ticker_raw,
        "currency": currency or "USD",
        "range": range_key,
        "interval": interval,
        "last": last,
        "previousClose": float(previous_close),
        "points": points,
    }
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
