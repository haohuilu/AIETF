# Pocket Advisor

A self-hosted investment advisory dashboard for [CommBank Pocket / CommSec Pocket](https://www.commbank.com.au/investing/commsec-pocket-etfs.html) — the 10 themed ETFs available in the CommBank app.

Designed around a **dollar-cost-average (DCA) investor** putting ~$1,000/week into Pocket and targeting ~10% p.a. long-term returns.

> **Educational tool only.** Not personal financial advice. See disclaimer below.

---

## What it does

- **Live prices** for all 10 Pocket ETFs (IOZ, SYI, GRNV, CRED, IOO, DHHF, NDQ, IXJ, ETHI, IEM) via Yahoo Finance, with a hardcoded baseline fallback when Yahoo rate-limits the request.
- **Wealth projection chart** — future-value annuity that compounds your weekly contribution at your chosen target return over up to 40 years.
- **Current holdings tracker** — enter units owned + average purchase price per fund; the dashboard tracks live value, P/L, drift from target weights, and saves to localStorage.
- **Four model portfolios** — Conservative (~7%), Balanced (~9%), Growth (~11%, fits a 10% target), Aggressive (~13%) — calibrated using fetched 5-year CAGR & volatility.
- **Custom Pocket Mix** — build your own target allocation across the 10 funds.
- **"This week's buy" recommender** — picks one fund per week using a multi-factor score:
  - `gapScore` — under-allocation vs your target weights (primary)
  - `valueScore` — bonus for being closer to 52-week low
  - `dipScore` — bonus for being down today
  - `fundamentalsPenalty` — demotes weak 5-year compounders
- **CSV import / export** of holdings.
- **Smart insights** panel — risk-adjusted leaders, value entries, mean-reversion warnings, brokerage cost analysis, CGT tips.

---

## Tech stack

- **Backend:** Flask + gunicorn, Yahoo Finance chart API, pandas/numpy for return & volatility calculations
- **Frontend:** Vanilla JS, hand-drawn `<canvas>` projection chart (no chart library), localStorage for state
- **Data:** Public delayed market quotes from Yahoo Finance with public-record baseline estimates as fallback
- **Deployment:** Render-ready (gunicorn, `runtime.txt`)

---

## Run locally

```bash
git clone git@github.com:haohuilu/AIETF.git
cd AIETF
./run.sh
```

The script creates a `.venv` with `uv`, installs deps, and launches Flask on `http://127.0.0.1:5000`.

Manual setup:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

---

## Deploy to Render

This repo is preconfigured for [Render](https://render.com).

1. Create a new **Web Service** pointing at this repo
2. Configure:

| Field | Value |
|---|---|
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 60` |
| **Environment** | Python 3 |

`runtime.txt` pins Python 3.12.7 automatically.

> Free-tier services sleep after 15 min of inactivity. First wake-up may take ~10–15s while gunicorn boots pandas/numpy. Set **Health Check Path** to `/api/project?weekly=1000&return_pct=10&years=10` for a smoother experience.

---

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Dashboard HTML |
| `GET /api/prices` | All 10 funds with live price, day change, 1y return, 5y CAGR, volatility, 52w range. Includes 4 model portfolios calibrated from current data. |
| `GET /api/project?weekly=1000&return_pct=10&years=10` | Future-value annuity trajectory for a DCA plan. |

---

## Pocket fund mapping

| Pocket theme | ASX ETF | Issuer |
|---|---|---|
| ASX 200 | `IOZ.AX` | iShares Core S&P/ASX 200 |
| Aussie Dividends | `SYI.AX` | SPDR MSCI Australia Select High Dividend Yield |
| Aussie Sustainability | `GRNV.AX` | VanEck MSCI Australian Sustainable Equity |
| Aussie Corporate Bonds | `CRED.AX` | BetaShares Australian Investment Grade Corporate Bond |
| Global 100 | `IOO.AX` | iShares Global 100 |
| Diversified Equities | `DHHF.AX` | BetaShares Diversified All Growth |
| Tech Savvy | `NDQ.AX` | BetaShares NASDAQ 100 |
| Global Healthcare | `IXJ.AX` | iShares Global Healthcare |
| Climate Leaders | `ETHI.AX` | BetaShares Global Sustainability Leaders |
| Emerging Markets | `IEM.AX` | iShares MSCI Emerging Markets |

---

## Disclaimer

This dashboard is for **educational use only** and does **not** constitute personal financial advice. The author is not a licensed financial adviser. Data is sourced from public markets via Yahoo Finance and may be delayed by 15–20 minutes; baseline estimates are used when live data is unavailable. Past performance does not predict future returns. Consult a licensed financial adviser before making investment decisions.

---

## Licence

Personal project — all rights reserved by the repo owner. If you'd like to reuse, please open an issue.
