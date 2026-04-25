#!/usr/bin/env python3
"""Fetch a price series from Yahoo Finance via yfinance and print JSON.

Usage: yf_quote.py <TICKER> <PERIOD> <INTERVAL>
"""
import json
import math
import sys

import yfinance as yf

VALID_PERIODS = {
    "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max",
}
VALID_INTERVALS = {
    "1m", "2m", "5m", "15m", "30m", "60m", "90m",
    "1h", "1d", "5d", "1wk", "1mo", "3mo",
}


def fail(msg: str, code: int = 1) -> None:
    sys.stdout.write(json.dumps({"error": msg}))
    sys.stdout.flush()
    sys.exit(code)


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: yf_quote.py <TICKER> <PERIOD> <INTERVAL>")

    ticker_raw = sys.argv[1].strip().upper()
    period = sys.argv[2].strip().lower()
    interval = sys.argv[3].strip().lower()

    if not ticker_raw:
        fail("ticker is required")
    if period not in VALID_PERIODS:
        fail(f"invalid period: {period}")
    if interval not in VALID_INTERVALS:
        fail(f"invalid interval: {interval}")

    try:
        t = yf.Ticker(ticker_raw)
        hist = t.history(period=period, interval=interval, auto_adjust=False)
    except Exception as e:  # noqa: BLE001
        fail(f"fetch failed: {e.__class__.__name__}: {e}")
        return

    if hist is None or hist.empty:
        fail(f"no data for {ticker_raw} ({period}/{interval})")
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
    previous_close = None
    if isinstance(info, dict):
        previous_close = info.get("previous_close") or info.get("previousClose")
    try:
        previous_close = float(previous_close) if previous_close is not None else points[0]["price"]
    except Exception:  # noqa: BLE001
        previous_close = points[0]["price"]

    currency = None
    long_name = None
    if isinstance(info, dict):
        currency = info.get("currency")
        long_name = info.get("longName") or info.get("long_name")

    out = {
        "symbol": ticker_raw,
        "name": long_name or ticker_raw,
        "currency": currency or "USD",
        "period": period,
        "interval": interval,
        "last": last,
        "previousClose": float(previous_close),
        "points": points,
    }
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
