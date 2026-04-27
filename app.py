"""CommBank Pocket investment advisory dashboard.

Educational tool only. Not personal financial advice.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests
from flask import Flask, jsonify, render_template, request

YAHOO_CHART_URL = "https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}

_SESSION = requests.Session()
_SESSION.headers.update(YAHOO_HEADERS)

# In-memory price cache. Successful fetches: short TTL (60s). On rate-limit
# we serve the last-known good data for up to STALE_TTL (1h) and tag it.
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 60
_STALE_TTL_SECONDS = 3600

# Public-record long-run baselines for each Pocket fund — used as fallback when
# Yahoo rate-limits us so the dashboard always renders sensible analytics.
# Numbers approximate trailing-5y CAGR & annualised vol from ETF factsheets.
_BASELINES = {
    "IOZ.AX":  {"price": 35.30, "cagr_5y_pct": 8.5,  "vol_pct": 14.0, "one_year_pct": 9.0},
    "SYI.AX":  {"price": 33.20, "cagr_5y_pct": 7.5,  "vol_pct": 13.0, "one_year_pct": 8.5},
    "GRNV.AX": {"price": 38.50, "cagr_5y_pct": 8.0,  "vol_pct": 15.0, "one_year_pct": 9.0},
    "CRED.AX": {"price": 24.30, "cagr_5y_pct": 2.5,  "vol_pct":  5.0, "one_year_pct": 5.0},
    "IOO.AX":  {"price": 132.0, "cagr_5y_pct": 12.5, "vol_pct": 13.5, "one_year_pct": 14.0},
    "DHHF.AX": {"price": 36.50, "cagr_5y_pct": 11.0, "vol_pct": 14.0, "one_year_pct": 13.0},
    "NDQ.AX":  {"price": 53.20, "cagr_5y_pct": 17.0, "vol_pct": 22.0, "one_year_pct": 18.0},
    "IXJ.AX":  {"price": 142.0, "cagr_5y_pct": 9.5,  "vol_pct": 13.0, "one_year_pct": 5.0},
    "ETHI.AX": {"price": 16.70, "cagr_5y_pct": 13.0, "vol_pct": 18.0, "one_year_pct": 12.0},
    "IEM.AX":  {"price": 60.00, "cagr_5y_pct": 5.5,  "vol_pct": 16.0, "one_year_pct": 7.0},
}


app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.jinja_env.auto_reload = True

# All 10 CommSec Pocket themes mapped to their underlying ASX-listed ETFs.
# Source: commbank.com.au/investing/commsec-pocket-etfs.html
POCKET_THEMES = {
    "aussie_top_200": {
        "name": "ASX 200",
        "ticker": "IOZ.AX",
        "issuer": "iShares Core S&P/ASX 200",
        "description": "Australia's 200 largest listed companies. Core domestic exposure.",
        "risk": "Medium",
        "category": "Australian Equity",
    },
    "aussie_dividends": {
        "name": "Aussie Dividends",
        "ticker": "SYI.AX",
        "issuer": "SPDR MSCI Australia Select High Dividend Yield",
        "description": "~30 ASX-listed companies known for paying strong dividends.",
        "risk": "Medium",
        "category": "Australian Income",
    },
    "aussie_sustainability": {
        "name": "Aussie Sustainability",
        "ticker": "GRNV.AX",
        "issuer": "VanEck MSCI Australian Sustainable Equity",
        "description": "Australian companies screened for values-based and ESG criteria.",
        "risk": "Medium",
        "category": "Australian ESG",
    },
    "aussie_bonds": {
        "name": "Aussie Corporate Bonds",
        "ticker": "CRED.AX",
        "issuer": "BetaShares Australian Investment Grade Corporate Bond",
        "description": "~50 investment-grade Aussie corporate bonds. Defensive ballast for the portfolio.",
        "risk": "Low",
        "category": "Fixed Income",
    },
    "global_100": {
        "name": "Global 100",
        "ticker": "IOO.AX",
        "issuer": "iShares Global 100",
        "description": "100 of the world's largest multinational blue-chips.",
        "risk": "Medium",
        "category": "Global Equity",
    },
    "diversified_equities": {
        "name": "Diversified Equities",
        "ticker": "DHHF.AX",
        "issuer": "BetaShares Diversified All Growth",
        "description": "~8,000 companies across 60+ global exchanges. One-fund global core.",
        "risk": "Medium",
        "category": "Global Equity",
    },
    "tech_savvy": {
        "name": "Tech Savvy",
        "ticker": "NDQ.AX",
        "issuer": "BetaShares NASDAQ 100",
        "description": "Top 100 non-financial companies on the NASDAQ. High growth, high volatility.",
        "risk": "High",
        "category": "Global Tech",
    },
    "health_wise": {
        "name": "Global Healthcare",
        "ticker": "IXJ.AX",
        "issuer": "iShares Global Healthcare",
        "description": "Global healthcare giants — pharma, biotech, medical devices.",
        "risk": "Medium",
        "category": "Sector — Healthcare",
    },
    "sustainability_leaders": {
        "name": "Climate Leaders",
        "ticker": "ETHI.AX",
        "issuer": "BetaShares Global Sustainability Leaders",
        "description": "Climate-screened global stocks. ESG-tilted growth.",
        "risk": "High",
        "category": "Global ESG",
    },
    "emerging_markets": {
        "name": "Emerging Markets",
        "ticker": "IEM.AX",
        "issuer": "iShares MSCI Emerging Markets",
        "description": "Emerging-market equities — China, India, Taiwan, Brazil etc.",
        "risk": "High",
        "category": "Emerging Markets",
    },
}


def _baseline(ticker: str, *, stale: bool = False) -> dict:
    """Return a synthetic record from public-record baselines."""
    b = _BASELINES.get(ticker, {"price": 0, "cagr_5y_pct": 8, "vol_pct": 15, "one_year_pct": 8})
    price = b["price"]
    return {
        "ticker": ticker,
        "price": round(price, 2),
        "day_change_pct": 0.0,
        "cagr_5y_pct": b["cagr_5y_pct"],
        "vol_pct": b["vol_pct"],
        "one_year_pct": b["one_year_pct"],
        "high_52w": round(price * 1.12, 2),
        "low_52w": round(price * 0.88, 2),
        "as_of": "live unavailable",
        "stale": True,
        "source": "fallback estimate" if not stale else "fallback estimate (live quote unavailable)",
    }


def _fetch_one(ticker: str) -> dict:
    """Fetch live + historical data for a single ticker via Yahoo Finance chart API.

    Falls back to a stale cache or hardcoded baseline if Yahoo rate-limits us.
    """
    now = time.time()
    cached = _CACHE.get(ticker)
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    url = YAHOO_CHART_URL.format(ticker=ticker)
    try:
        r = _SESSION.get(url, params={"range": "5y", "interval": "1d"}, timeout=15)
        if r.status_code == 429:
            raise requests.HTTPError("Yahoo rate-limited (429)")
        r.raise_for_status()
        payload = r.json()
    except Exception as e:
        # Fall back: stale cache (<1h) → baseline.
        if cached and now - cached[0] < _STALE_TTL_SECONDS:
            stale = {**cached[1], "stale": True, "source": f"cached ({int(now - cached[0])}s old)"}
            return stale
        b = _baseline(ticker, stale=True)
        b["error_note"] = str(e)
        return b

    chart = (payload.get("chart") or {}).get("result")
    if not chart:
        err = (payload.get("chart") or {}).get("error", "unknown")
        return {"error": f"No data for {ticker}: {err}"}

    res = chart[0]
    meta = res.get("meta") or {}
    timestamps = res.get("timestamp") or []
    closes_raw = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    adj_raw = (
        ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
        if (res.get("indicators") or {}).get("adjclose")
        else closes_raw
    )

    quote_pairs = [
        (ts, c)
        for ts, c in zip(timestamps, closes_raw)
        if c is not None
    ]
    adj_pairs = [
        (ts, c)
        for ts, c in zip(timestamps, adj_raw)
        if c is not None
    ]
    if len(quote_pairs) < 2:
        return {"error": f"Insufficient data for {ticker}"}
    if len(adj_pairs) < 2:
        adj_pairs = quote_pairs

    quote_idx = pd.to_datetime([p[0] for p in quote_pairs], unit="s")
    quote_closes = pd.Series([float(p[1]) for p in quote_pairs], index=quote_idx)
    adj_idx = pd.to_datetime([p[0] for p in adj_pairs], unit="s")
    adj_closes = pd.Series([float(p[1]) for p in adj_pairs], index=adj_idx)

    last = float(meta.get("regularMarketPrice") or quote_closes.iloc[-1])
    prev = float(quote_closes.iloc[-2])
    day_change_pct = (last - prev) / prev * 100 if prev else 0.0

    years = (adj_closes.index[-1] - adj_closes.index[0]).days / 365.25
    adj_last = float(adj_closes.iloc[-1])
    cagr = ((adj_last / float(adj_closes.iloc[0])) ** (1 / years) - 1) * 100 if years > 0 else 0.0

    daily_ret = np.log(adj_closes / adj_closes.shift(1)).dropna()
    vol = float(daily_ret.std() * math.sqrt(252) * 100)

    one_year_ago = adj_closes.index[-1] - pd.Timedelta(days=365)
    yr_adj_slice = adj_closes[adj_closes.index >= one_year_ago]
    one_year_ret = (
        (adj_last / float(yr_adj_slice.iloc[0]) - 1) * 100 if len(yr_adj_slice) > 1 else 0.0
    )

    yr_slice = quote_closes[quote_closes.index >= one_year_ago]
    high_52w = float(yr_slice.max()) if len(yr_slice) else last
    low_52w = float(yr_slice.min()) if len(yr_slice) else last

    regular_market_time = meta.get("regularMarketTime")
    if regular_market_time:
        as_of = datetime.fromtimestamp(regular_market_time).strftime("%Y-%m-%d %H:%M")
    else:
        as_of = quote_closes.index[-1].strftime("%Y-%m-%d")

    out = {
        "ticker": ticker,
        "price": round(last, 2),
        "day_change_pct": round(day_change_pct, 2),
        "cagr_5y_pct": round(cagr, 2),
        "vol_pct": round(vol, 2),
        "one_year_pct": round(one_year_ret, 2),
        "high_52w": round(high_52w, 2),
        "low_52w": round(low_52w, 2),
        "as_of": as_of,
        "source": "Yahoo Finance delayed market quote",
        "stale": False,
    }
    _CACHE[ticker] = (time.time(), out)
    return out


def _build_portfolios(stats: dict) -> list[dict]:
    """Suggest model portfolios calibrated toward different return targets.

    Uses fetched CAGR and volatility to compute the *expected* portfolio return
    and volatility for each preset.
    """
    presets = [
        {
            "name": "Conservative (~7%)",
            "fit_target_pct": 7,
            "weights": {
                "aussie_top_200": 0.30,
                "aussie_dividends": 0.20,
                "global_100": 0.20,
                "aussie_bonds": 0.20,
                "health_wise": 0.10,
            },
            "blurb": "Defensive tilt — Aussie blue-chips & dividends, with corporate bonds as ballast. Lower vol, lower upside.",
        },
        {
            "name": "Balanced (~9%)",
            "fit_target_pct": 9,
            "weights": {
                "aussie_top_200": 0.20,
                "global_100": 0.20,
                "diversified_equities": 0.20,
                "tech_savvy": 0.15,
                "sustainability_leaders": 0.15,
                "health_wise": 0.10,
            },
            "blurb": "Diversified core/satellite. Diversified Equities anchors a global core; growth/healthcare add upside.",
        },
        {
            "name": "Growth (~11%)",
            "fit_target_pct": 10,
            "weights": {
                "tech_savvy": 0.25,
                "global_100": 0.20,
                "sustainability_leaders": 0.20,
                "diversified_equities": 0.15,
                "aussie_top_200": 0.10,
                "health_wise": 0.10,
            },
            "blurb": "Tilt toward global growth & tech with a diversified all-world core. Expect 25–35% peak-to-trough drawdowns.",
        },
        {
            "name": "Aggressive (~13%)",
            "fit_target_pct": 13,
            "weights": {
                "tech_savvy": 0.45,
                "sustainability_leaders": 0.20,
                "global_100": 0.15,
                "emerging_markets": 0.15,
                "aussie_sustainability": 0.05,
            },
            "blurb": "Concentrated growth bet. Big upside, big swings — only suitable if you can tolerate 40%+ drawdowns.",
        },
    ]

    out = []
    for p in presets:
        weights = p["weights"]
        exp_return = sum(
            w * stats[k]["cagr_5y_pct"] for k, w in weights.items() if k in stats
        )
        # Naive volatility (assumes correlation = 1 — overstates risk slightly).
        exp_vol = sum(
            w * stats[k]["vol_pct"] for k, w in weights.items() if k in stats
        )
        out.append(
            {
                **p,
                "expected_return_pct": round(exp_return, 2),
                "expected_vol_pct": round(exp_vol, 2),
            }
        )
    return out


def _project_dca(weekly: float, annual_return_pct: float, years: int) -> dict:
    """Project a weekly dollar-cost-average plan as a future-value annuity.

    Returns balance trajectory and key milestones.
    """
    weekly_rate = (1 + annual_return_pct / 100) ** (1 / 52) - 1
    weeks = years * 52

    balances = []
    bal = 0.0
    for w in range(1, weeks + 1):
        bal = bal * (1 + weekly_rate) + weekly
        if w % 4 == 0 or w == weeks:  # monthly snapshots
            balances.append({"week": w, "balance": round(bal, 2)})

    contributed = weekly * weeks
    final = bal
    growth = final - contributed

    return {
        "years": years,
        "weekly_contribution": weekly,
        "annual_return_assumed_pct": annual_return_pct,
        "total_contributed": round(contributed, 2),
        "final_balance": round(final, 2),
        "investment_growth": round(growth, 2),
        "trajectory": balances,
    }


def _float_param(name: str, default: float, *, min_value: float, max_value: float) -> float:
    try:
        value = float(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    if not math.isfinite(value):
        value = default
    return max(min_value, min(max_value, value))


def _int_param(name: str, default: int, *, min_value: int, max_value: int) -> int:
    try:
        value = int(float(request.args.get(name, default)))
    except (TypeError, ValueError):
        value = default
    return max(min_value, min(max_value, value))


@app.route("/")
def index():
    return render_template("index.html", themes=POCKET_THEMES)


@app.route("/api/prices")
def api_prices():
    """Live prices + analytics for every Pocket theme."""
    results = {}
    errors = {}
    any_stale = False
    for i, (key, meta) in enumerate(POCKET_THEMES.items()):
        try:
            data = _fetch_one(meta["ticker"])
            if "error" in data:
                errors[key] = data["error"]
                continue
            if data.get("stale"):
                any_stale = True
            results[key] = {**meta, **data}
        except Exception as e:  # network hiccup — surface but don't crash
            errors[key] = str(e)
        # Polite spacing between requests to avoid Yahoo's anti-scrape throttle.
        if i < len(POCKET_THEMES) - 1:
            time.sleep(0.4)

    portfolios = _build_portfolios(results) if results else []

    return jsonify(
        {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "funds": results,
            "errors": errors,
            "portfolios": portfolios,
            "stale_data": any_stale,
        }
    )


@app.route("/api/project")
def api_project():
    """DCA projection. Query params: weekly, return_pct, years."""
    weekly = _float_param("weekly", 1000, min_value=0, max_value=1_000_000)
    return_pct = _float_param("return_pct", 10, min_value=-99, max_value=100)
    years = _int_param("years", 10, min_value=1, max_value=40)
    return jsonify(_project_dca(weekly, return_pct, years))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
