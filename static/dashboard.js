/* Pocket Advisor — frontend dashboard logic.
 * No external chart libs: the projection chart is drawn on plain canvas.
 */

const $ = (id) => document.getElementById(id);
const fmtAUD = (v) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);
const fmtAUDCents = (v) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
const pocketBrokerage = (amount) => amount <= 0 ? 0 : amount <= 1000 ? 2 : amount * 0.002;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rangePosition = (f) => {
  const range = f.high_52w - f.low_52w;
  if (range <= 0) return 0.5;
  return Math.max(0, Math.min(1, (f.price - f.low_52w) / range));
};

let latestData = null;
let lastProjectionData = null;

const POCKET_FUND_ORDER = [
  "aussie_sustainability",
  "aussie_bonds",
  "aussie_top_200",
  "aussie_dividends",
  "diversified_equities",
  "global_100",
  "emerging_markets",
  "health_wise",
  "sustainability_leaders",
  "tech_savvy",
];

const DEFAULT_CUSTOM_WEIGHTS = {
  diversified_equities: 35,
  tech_savvy: 25,
  aussie_top_200: 20,
  global_100: 20,
};

async function refreshPrices() {
  const btn = $("refresh-btn");
  btn.disabled = true;
  btn.textContent = "Loading…";
  $("last-updated").textContent = "Fetching live prices…";

  try {
    const res = await fetch("/api/prices");
    if (!res.ok) throw new Error("HTTP " + res.status);
    latestData = await res.json();
    renderFunds(latestData.funds, latestData.errors);
    renderPortfolios(latestData.portfolios);
    renderCustomPortfolioEditor();
    renderHoldingsInput();
    renderPick();
    renderInsights(latestData);
    const stamp = new Date(latestData.fetched_at).toLocaleTimeString();
    const staleTag = latestData.stale_data ? " · ⚠ using fallback data" : "";
    $("last-updated").textContent = "Updated " + stamp + staleTag;
  } catch (e) {
    $("last-updated").textContent = "Error: " + e.message;
    $("funds").innerHTML = `<div class="muted">Failed to load — ${e.message}. Check your internet connection and click Refresh.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "↻ Refresh prices";
  }
}

function renderFunds(funds, errors) {
  const root = $("funds");
  root.innerHTML = "";
  if (!funds || Object.keys(funds).length === 0) {
    root.innerHTML = `<div class="muted">No fund prices are available right now. Click Refresh prices to try again.</div>`;
    funds = {};
  }
  Object.entries(funds).forEach(([key, f]) => {
    const upDown = f.day_change_pct >= 0 ? "up" : "down";
    const arrow = f.day_change_pct >= 0 ? "▲" : "▼";
    const sourceLabel = f.stale
      ? `<span class="fund-source stale">Fallback estimate</span>`
      : `<span class="fund-source">Delayed market price</span>`;
    const card = document.createElement("div");
    card.className = "fund-card";
    card.innerHTML = `
      <div class="fund-head">
        <div>
          <div class="fund-name">${f.name}</div>
          <div class="fund-ticker">${f.ticker} · ${f.issuer}</div>
        </div>
        <span class="fund-cat">${f.risk}</span>
      </div>
      <div style="display:flex; align-items:baseline; gap:10px;">
        <div class="fund-price">$${f.price.toFixed(2)}</div>
        <div class="fund-change ${upDown}">${arrow} ${fmtPct(f.day_change_pct)}</div>
      </div>
      <div class="fund-meta">${sourceLabel}<span>${f.as_of}</span></div>
      <div class="fund-stats">
        <div><strong>${fmtPct(f.one_year_pct)}</strong>1y return</div>
        <div><strong>${fmtPct(f.cagr_5y_pct)}</strong>5y CAGR</div>
        <div><strong>${f.vol_pct.toFixed(1)}%</strong>volatility</div>
        <div><strong>$${f.low_52w.toFixed(2)} – $${f.high_52w.toFixed(2)}</strong>52w range</div>
      </div>
      <div class="fund-desc">${f.description}</div>
    `;
    root.appendChild(card);
  });

  Object.entries(errors || {}).forEach(([k, msg]) => {
    const div = document.createElement("div");
    div.className = "fund-card";
    div.innerHTML = `<div class="fund-name">${k}</div><div class="muted">Error: ${msg}</div>`;
    root.appendChild(div);
  });
}

function renderPortfolios(portfolios) {
  if (!latestData?.funds) return;
  const root = $("portfolios");
  root.innerHTML = "";
  if (!portfolios?.length) {
    root.innerHTML = `<div class="muted">Portfolio models will appear once fund data is available.</div>`;
    return;
  }
  portfolios.forEach((p) => {
    const card = document.createElement("div");
    card.className = "portfolio-card";
    const allocsHtml = Object.entries(p.weights)
      .sort((a, b) => b[1] - a[1])
      .map(([k, w]) => {
        const fund = latestData.funds[k];
        if (!fund) return "";
        return `
          <div class="alloc-row">
            <div class="alloc-main">
              <div class="alloc-name">${fund.name} <span class="muted">${fund.ticker}</span></div>
              <div class="alloc-bar"><div class="alloc-bar-fill" style="width:${w * 100}%"></div></div>
            </div>
            <div class="alloc-pct">${(w * 100).toFixed(0)}%</div>
          </div>`;
      })
      .join("");
    card.innerHTML = `
      <h3>${p.name}</h3>
      <div class="blurb">${p.blurb}</div>
      ${allocsHtml}
      <div class="portfolio-stats">
        <div><strong>${p.expected_return_pct.toFixed(2)}%</strong>Expected return</div>
        <div><strong>${p.expected_vol_pct.toFixed(1)}%</strong>Volatility</div>
      </div>
    `;
    root.appendChild(card);
  });
  renderCustomPortfolioCard(root);
}

function renderCustomPortfolioCard(root) {
  const custom = buildCustomPortfolio();
  if (!custom) return;
  const weights = loadCustomWeights();
  const keys = [
    ...POCKET_FUND_ORDER.filter((k) => latestData.funds[k]),
    ...Object.keys(latestData.funds).filter((k) => !POCKET_FUND_ORDER.includes(k)),
  ];
  const totalPct = keys.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0);
  const totalClass = Math.abs(totalPct - 100) < 0.01 ? "ok" : "warn";
  const allocsHtml = Object.entries(custom.weights)
    .sort((a, b) => b[1] - a[1])
    .map(([key, weight]) => {
      const fund = latestData.funds[key];
      if (!fund) return "";
      return `
        <div class="alloc-row">
          <div class="alloc-main">
            <div class="alloc-name">${fund.name} <span class="muted">${fund.ticker}</span></div>
            <div class="alloc-bar"><div class="alloc-bar-fill" style="width:${weight * 100}%"></div></div>
          </div>
          <div class="alloc-pct">${(weight * 100).toFixed(0)}%</div>
        </div>`;
    })
    .join("");

  const card = document.createElement("div");
  card.className = "portfolio-card custom-model-card";
  card.innerHTML = `
    <h3>Custom Pocket Mix</h3>
    <div class="blurb">Uses your Custom Pocket Mix targets from current holdings.</div>
    ${allocsHtml || '<div class="muted">Set custom target percentages in Your current holdings.</div>'}
    <div class="model-custom-actions">
      <span class="custom-total ${totalClass}">Total ${totalPct.toFixed(0)}%</span>
      <button id="calculate-custom-model" class="btn ghost">Update</button>
    </div>
    <div class="portfolio-stats">
      <div><strong>${custom.expected_return_pct.toFixed(2)}%</strong>Expected return</div>
      <div><strong>${custom.expected_vol_pct.toFixed(1)}%</strong>Volatility</div>
    </div>
  `;
  root.appendChild(card);

  card.querySelector("#calculate-custom-model")?.addEventListener("click", () => {
    renderPortfolios(latestData.portfolios);
    renderCustomPortfolioEditor();
    renderHoldingsInput();
    renderPick();
  });
}

function renderInsights(data) {
  const ul = $("insights");
  ul.innerHTML = "";

  if (!data?.funds) return;
  const funds = Object.values(data.funds);
  if (!funds.length) return;

  // 1. Best 1-year performer
  const bestYr = [...funds].sort((a, b) => b.one_year_pct - a.one_year_pct)[0];
  const worstYr = [...funds].sort((a, b) => a.one_year_pct - b.one_year_pct)[0];

  // 2. Best risk-adjusted (Sharpe-ish: CAGR / vol, no risk-free rate)
  const sharpe = [...funds].map((f) => ({ ...f, sr: f.cagr_5y_pct / Math.max(f.vol_pct, 1) }));
  const bestSharpe = [...sharpe].sort((a, b) => b.sr - a.sr)[0];

  // 3. Find any near 52-week high or low (within 5%)
  const nearLow = funds.filter((f) => rangePosition(f) < 0.15);
  const nearHigh = funds.filter((f) => rangePosition(f) > 0.95);

  const weekly = parseFloat($("in-weekly").value) || 0;
  const target = parseFloat($("in-target").value) || 0;
  const years = parseInt($("in-years").value) || 0;
  const brokerage = pocketBrokerage(weekly);
  const brokerageRate = weekly > 0 ? (brokerage / weekly) * 100 : 0;

  const tips = [];
  tips.push(
    `<span class="key">Strongest 1-year performer:</span> <strong>${bestYr.name}</strong> (${bestYr.ticker}) at ${fmtPct(bestYr.one_year_pct)}. Strongest 5-year compounder: <strong>${[...funds].sort((a, b) => b.cagr_5y_pct - a.cagr_5y_pct)[0].name}</strong>.`
  );
  tips.push(
    `<span class="key">Best risk-adjusted return:</span> <strong>${bestSharpe.name}</strong> — ${bestSharpe.cagr_5y_pct.toFixed(1)}% CAGR for ${bestSharpe.vol_pct.toFixed(1)}% volatility. Strong candidate as a portfolio anchor.`
  );
  if (nearLow.length) {
    tips.push(
      `<span class="key">Potential value entries:</span> ${nearLow.map((f) => f.name).join(", ")} sitting in the lower 15% of their 52-week range — DCA continues to average down here.`
    );
  }
  if (nearHigh.length) {
    tips.push(
      `<span class="key">Caution — near 52w highs:</span> ${nearHigh.map((f) => f.name).join(", ")}. DCA still works, but expect mean reversion; avoid lump-summing here.`
    );
  }
  if (worstYr.one_year_pct < 0) {
    tips.push(
      `<span class="key">${worstYr.name} is down ${fmtPct(worstYr.one_year_pct)} over 1y</span>. Drawdowns are when DCA shines — you're buying more units per dollar. Don't capitulate unless your thesis has changed.`
    );
  }
  tips.push(
    `<span class="key">$${weekly.toLocaleString()}/week</span> = $${(weekly * 52).toLocaleString()}/year contributed. CommSec Pocket brokerage is <strong>${fmtAUDCents(brokerage)} per buy</strong> at this amount (${brokerageRate.toFixed(2)}%), or about <strong>${fmtAUDCents(brokerage * 52)}/year</strong> if you buy weekly.`
  );
  tips.push(
    `<span class="key">10% target reality check:</span> Long-term Australian/global equity averages are 8–10% nominal. To realistically reach 10%, you need exposure to global tech & growth — which is why the Growth portfolio is the best fit. Anything promising 10%+ with low risk is a red flag.`
  );
  tips.push(
    `<span class="key">Tax tip:</span> Pocket distributes franked dividends (Aussie funds) and unfranked (global) — held >12 months, capital gains get the 50% CGT discount. Avoid panic-selling within 12 months of buying any tranche.`
  );
  tips.push(
    `<span class="key">Consistency beats timing:</span> Set up auto-investment so the $1,000/week is debited automatically. The single biggest predictor of hitting your ${target}% target over ${years} years is <strong>not missing weeks</strong>.`
  );

  tips.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = t;
    ul.appendChild(li);
  });
}

/* ---------- Projection ---------- */

async function recalcProjection() {
  const weekly = parseFloat($("in-weekly").value) || 0;
  const target = parseFloat($("in-target").value) || 0;
  const years = parseInt($("in-years").value) || 1;

  $("proj-weekly").textContent = weekly.toLocaleString();
  $("proj-return").textContent = target;

  const url = `/api/project?weekly=${weekly}&return_pct=${target}&years=${years}`;
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (e) {
    $("m-contributed").textContent = "—";
    $("m-final").textContent = "—";
    $("m-growth").textContent = "—";
    $("m-mult").textContent = "—";
    return;
  }
  lastProjectionData = data;

  $("m-contributed").textContent = fmtAUD(data.total_contributed);
  $("m-final").textContent = fmtAUD(data.final_balance);
  $("m-growth").textContent = fmtAUD(data.investment_growth);
  const mult = data.total_contributed > 0 ? (data.final_balance / data.total_contributed).toFixed(2) + "x" : "—";
  $("m-mult").textContent = mult;

  drawProjectionChart(data);
  if (latestData) renderInsights(latestData);
}

function drawProjectionChart(data) {
  const canvas = $("proj-chart");
  if (!canvas || !data?.trajectory?.length) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 260;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = h + "px";
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padL = 60, padR = 16, padT = 16, padB = 28;
  const traj = data.trajectory;

  const balances = traj.map((t) => t.balance);
  const contributions = traj.map((t, i) => (i + 1) * 4 * data.weekly_contribution);
  const maxY = Math.max(...balances) * 1.05;

  // grid
  ctx.strokeStyle = "#243056";
  ctx.fillStyle = "#8b97c4";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padT + ((h - padT - padB) * i) / 5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    const val = maxY * (1 - i / 5);
    ctx.fillText("$" + Math.round(val / 1000) + "k", 8, y + 3);
  }

  const xAt = (i) => padL + ((w - padL - padR) * i) / (traj.length - 1);
  const yAt = (v) => padT + (h - padT - padB) * (1 - v / maxY);

  // contributions area (yellow-orange)
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  contributions.forEach((c, i) => ctx.lineTo(xAt(i), yAt(c)));
  ctx.lineTo(xAt(traj.length - 1), yAt(0));
  ctx.closePath();
  const gradC = ctx.createLinearGradient(0, padT, 0, h - padB);
  gradC.addColorStop(0, "rgba(255, 176, 0, 0.5)");
  gradC.addColorStop(1, "rgba(255, 176, 0, 0.05)");
  ctx.fillStyle = gradC;
  ctx.fill();

  // total balance area (green/yellow)
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  balances.forEach((b, i) => ctx.lineTo(xAt(i), yAt(b)));
  ctx.lineTo(xAt(traj.length - 1), yAt(0));
  ctx.closePath();
  const gradB = ctx.createLinearGradient(0, padT, 0, h - padB);
  gradB.addColorStop(0, "rgba(33, 201, 122, 0.4)");
  gradB.addColorStop(1, "rgba(33, 201, 122, 0)");
  ctx.fillStyle = gradB;
  ctx.fill();

  // balance line
  ctx.beginPath();
  balances.forEach((b, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(b)) : ctx.lineTo(xAt(i), yAt(b)));
  ctx.strokeStyle = "#21c97a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // contribution line
  ctx.beginPath();
  contributions.forEach((c, i) => i === 0 ? ctx.moveTo(xAt(i), yAt(c)) : ctx.lineTo(xAt(i), yAt(c)));
  ctx.strokeStyle = "#ffb000";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // x-axis year labels
  ctx.fillStyle = "#8b97c4";
  for (let yr = 0; yr <= data.years; yr++) {
    const targetWeek = yr * 52;
    let idx = traj.findIndex((t) => t.week >= targetWeek);
    if (idx === -1) idx = traj.length - 1;
    if (yr % Math.max(1, Math.ceil(data.years / 8)) === 0) {
      const x = xAt(idx);
      ctx.fillText("Y" + yr, x - 8, h - 8);
    }
  }

  // legend
  ctx.fillStyle = "#21c97a"; ctx.fillRect(w - 200, padT, 12, 3);
  ctx.fillStyle = "#e6ecff"; ctx.fillText("Portfolio balance", w - 184, padT + 5);
  ctx.fillStyle = "#ffb000"; ctx.fillRect(w - 200, padT + 14, 12, 3);
  ctx.fillStyle = "#e6ecff"; ctx.fillText("Cumulative contribution", w - 184, padT + 19);
}

/* ---------- Holdings, comparison, and weekly pick ---------- */

const PICK_STORAGE_KEY = "pocket_advisor_state_v2";

function loadPickState() {
  try { return JSON.parse(localStorage.getItem(PICK_STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function savePickState(s) {
  localStorage.setItem(PICK_STORAGE_KEY, JSON.stringify(s));
}
function getUnits(key) {
  return ((loadPickState().units || {})[key]) || 0;
}
function setUnits(key, units) {
  const s = loadPickState();
  s.units = s.units || {};
  s.units[key] = Math.max(0, Number(units) || 0);
  savePickState(s);
}
function getAvgCost(key) {
  return ((loadPickState().avgCost || {})[key]) || 0;
}
function setAvgCost(key, price) {
  const s = loadPickState();
  s.avgCost = s.avgCost || {};
  s.avgCost[key] = Math.max(0, Number(price) || 0);
  savePickState(s);
}
function loadCustomWeights() {
  return { ...DEFAULT_CUSTOM_WEIGHTS, ...((loadPickState().customWeights) || {}) };
}
function saveCustomWeight(key, pct) {
  const s = loadPickState();
  s.customWeights = s.customWeights || { ...DEFAULT_CUSTOM_WEIGHTS };
  s.customWeights[key] = clamp(Number(pct) || 0, 0, 100);
  savePickState(s);
}

function buildCustomPortfolio() {
  if (!latestData?.funds) return null;
  const raw = loadCustomWeights();
  const weights = {};
  Object.entries(raw).forEach(([key, pct]) => {
    if (latestData.funds[key] && pct > 0) weights[key] = pct / 100;
  });

  const expectedReturn = Object.entries(weights).reduce((sum, [key, weight]) =>
    sum + weight * (latestData.funds[key]?.cagr_5y_pct || 0), 0);
  const expectedVol = Object.entries(weights).reduce((sum, [key, weight]) =>
    sum + weight * (latestData.funds[key]?.vol_pct || 0), 0);

  return {
    name: "Custom Pocket Mix",
    weights,
    expected_return_pct: expectedReturn,
    expected_vol_pct: expectedVol,
    blurb: "Your selected Pocket ETF mix.",
  };
}

function isoWeek(d = new Date()) {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThu = new Date(target.getFullYear(), 0, 4);
  return target.getFullYear() + "-W" + Math.ceil((((target - firstThu) / 86400000) + 1) / 7).toString().padStart(2, "0");
}

function getSelectedPortfolio() {
  if (!latestData?.portfolios?.length) return null;
  const sel = $("pick-portfolio");
  if (sel?.value === "custom") return buildCustomPortfolio();
  const idx = parseInt(sel?.value ?? "2");
  return latestData.portfolios[Math.min(idx, latestData.portfolios.length - 1)];
}

function holdingsValue() {
  if (!latestData?.funds) return { perFund: {}, total: 0, cost: 0, costedValue: 0, gain: 0, dayChange: 0 };
  const state = loadPickState();
  const units = state.units || {};
  const avgCost = state.avgCost || {};
  const perFund = {};
  let total = 0;
  let cost = 0;
  let costedValue = 0;
  let dayChange = 0;
  Object.keys(latestData.funds).forEach((k) => {
    const u = units[k] || 0;
    const fund = latestData.funds[k];
    const value = u * fund.price;
    const costBasis = u * (avgCost[k] || 0);
    const gain = costBasis > 0 ? value - costBasis : 0;
    const gainPct = costBasis > 0 ? (gain / costBasis) * 100 : null;
    const dayMove = fund.day_change_pct > -100 ? value * (fund.day_change_pct / (100 + fund.day_change_pct)) : 0;
    perFund[k] = { units: u, avgCost: avgCost[k] || 0, value, cost: costBasis, gain, gainPct, dayChange: dayMove };
    total += value;
    cost += costBasis;
    if (costBasis > 0) costedValue += value;
    dayChange += dayMove;
  });
  return { perFund, total, cost, costedValue, gain: costedValue - cost, dayChange };
}

function computePick() {
  if (!latestData) return null;
  const portfolio = getSelectedPortfolio();
  if (!portfolio) return null;

  const state = loadPickState();
  const { perFund, total } = holdingsValue();

  const candidates = Object.entries(portfolio.weights).map(([key, target]) => {
    const fund = latestData.funds[key];
    if (!fund) return null;
    const value = (perFund[key] || {}).value || 0;
    const currentWeight = total > 0 ? value / total : 0;
    const underAllocation = target - currentWeight;
    const posIn52 = rangePosition(fund); // 0=at low, 1=at high
    const avgCost = (perFund[key] || {}).avgCost || 0;
    const priceVsAvg = avgCost > 0 ? (fund.price - avgCost) / avgCost : null;

    // Multi-factor score: allocation still matters, but market and entry-price
    // signals can move this week's pick when the portfolio is roughly balanced.
    const allocationScore = clamp(underAllocation, -0.20, 0.20) * 0.70;
    const rangeScore = (0.50 - posIn52) * 0.12;                         // favour lower half of 52w range
    const dayScore = clamp(-fund.day_change_pct / 100, -0.025, 0.035) * 0.80;
    const costScore = priceVsAvg === null ? 0 : clamp(-priceVsAvg, -0.12, 0.18) * 0.35;
    const momentumScore =
      fund.cagr_5y_pct >= 8 && fund.one_year_pct > 0 ? 0.015 :
      fund.cagr_5y_pct < 5 || fund.one_year_pct < -8 ? -0.025 :
      0;
    const marketScore = rangeScore + dayScore + costScore + momentumScore;
    const score = allocationScore + marketScore;

    return {
      key,
      fund,
      target,
      currentWeight,
      value,
      underAllocation,
      posIn52,
      avgCost,
      priceVsAvg,
      score,
      allocationScore,
      rangeScore,
      dayScore,
      costScore,
      momentumScore,
      marketScore,
    };
  }).filter(Boolean);

  candidates.sort((a, b) => b.score - a.score);
  const currentWeek = isoWeek();
  const weeklyBuy = (state.history || []).find((h) => {
    const date = new Date(h.date);
    return !Number.isNaN(date.valueOf()) && isoWeek(date) === currentWeek;
  });
  return { portfolio, candidates, total, perFund, weeklyBuy, alreadyBoughtThisWeek: Boolean(weeklyBuy) };
}

function renderPick() {
  const root = $("pick-card");
  if (!root) return; // panel not present in DOM (stale HTML cache)
  const result = computePick();
  if (!result) {
    root.innerHTML = `<div class="muted" style="padding:14px 0;">Refresh prices to get this week's pick.</div>`;
    return;
  }
  const { candidates, total, alreadyBoughtThisWeek, weeklyBuy } = result;
  if (!candidates.length) {
    root.innerHTML = `<div class="muted" style="padding:14px 0;">Set at least one custom target above 0% to get this week's pick.</div>`;
    return;
  }
  const pick = candidates[0];
  const runners = candidates.slice(1, 3);
  const f = pick.fund;
  const boughtFund = weeklyBuy ? latestData.funds[weeklyBuy.key] : null;
  const weeklyValue = parseFloat($("in-weekly").value);
  const weekly = Number.isFinite(weeklyValue) ? Math.max(0, weeklyValue) : 1000;

  const reasons = [];
  if (total === 0) {
    reasons.push(`No holdings entered yet — starting from a core target fund, then checking market entry signals. This fund has a <strong>${(pick.target * 100).toFixed(0)}% target</strong>.`);
  } else if (pick.underAllocation > 0.005) {
    reasons.push(`Allocation signal: <strong>${(pick.currentWeight * 100).toFixed(1)}%</strong> of your portfolio vs <strong>${(pick.target * 100).toFixed(0)}%</strong> target → <strong>${(pick.underAllocation * 100).toFixed(1)} pp underweight</strong>.`);
  } else if (Math.abs(pick.underAllocation) < 0.01) {
    reasons.push(`Allocation signal: portfolio is close to target here, so the market signal has more influence this week.`);
  } else {
    reasons.push(`Allocation signal: this fund is already overweight by <strong>${Math.abs(pick.underAllocation * 100).toFixed(1)} pp</strong>, but its market signal still ranked best among the portfolio choices.`);
  }
  if (pick.avgCost > 0 && pick.priceVsAvg !== null) {
    if (pick.priceVsAvg < -0.01) {
      reasons.push(`Your entry signal: current price is <strong>${Math.abs(pick.priceVsAvg * 100).toFixed(1)}%</strong> below your average buy price ($${pick.avgCost.toFixed(2)}) — averaging down improves your cost base.`);
    } else if (pick.priceVsAvg > 0.08) {
      reasons.push(`Your entry signal: current price is <strong>${(pick.priceVsAvg * 100).toFixed(1)}%</strong> above your average buy price ($${pick.avgCost.toFixed(2)}), so this pick needed stronger allocation/market support.`);
    } else {
      reasons.push(`Your entry signal: price is close to your average buy price ($${pick.avgCost.toFixed(2)}), so the decision leans on allocation and market movement.`);
    }
  }
  if (pick.posIn52 < 0.30) {
    reasons.push(`Market signal: price sits in lower <strong>${Math.round(pick.posIn52 * 100)}%</strong> of its 52-week range — favourable entry.`);
  } else if (pick.posIn52 > 0.85) {
    reasons.push(`Market signal: price is near its 52-week high (${Math.round(pick.posIn52 * 100)}% of range), which slightly penalises chasing unless allocation support is strong.`);
  }
  if (f.day_change_pct < -1.0) {
    reasons.push(`Market signal: down <strong>${f.day_change_pct.toFixed(2)}%</strong> today — buy-the-dip support on entry price.`);
  } else if (f.day_change_pct > 1.0) {
    reasons.push(`Market signal: up <strong>${f.day_change_pct.toFixed(2)}%</strong> today — momentum is positive, but the model avoids overpaying unless other signals agree.`);
  }
  if (f.cagr_5y_pct >= 8 && f.one_year_pct > 0) {
    reasons.push(`Momentum signal: positive 1-year return and <strong>${f.cagr_5y_pct.toFixed(1)}%</strong> 5-year CAGR support staying with the trend.`);
  }
  if (f.cagr_5y_pct < 6) {
    reasons.push(`⚠ 5-year CAGR is only ${f.cagr_5y_pct.toFixed(1)}% — fund picked because of allocation gap, not strength. Re-check fundamentals.`);
  }

  const units = (weekly / f.price).toFixed(2);

  root.innerHTML = `
    <div class="pick-fund-card">
      <div class="pick-badge">PICK · WEEK OF ${isoWeek()}</div>
      <div class="pick-head">
        <div>
          <div class="pick-name">${f.name}</div>
          <div class="pick-ticker">${f.ticker} · ${f.issuer}</div>
        </div>
        <div class="pick-price">$${f.price.toFixed(2)} <span style="font-size:13px; color:var(--${f.day_change_pct>=0?'good':'bad'})">${f.day_change_pct>=0?'+':''}${f.day_change_pct.toFixed(2)}%</span></div>
      </div>
      <ul class="pick-reasons">${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
      <div class="pick-action">
        ${alreadyBoughtThisWeek && weeklyBuy ? `
          <div class="pick-buy">
            Bought <strong>${Number(weeklyBuy.units || 0).toFixed(4)} units</strong>
            of <strong>${boughtFund?.name || weeklyBuy.key}</strong>
            @ <strong>$${Number(weeklyBuy.price || 0).toFixed(2)}</strong>
          </div>
          <button id="cancel-buy" class="btn ghost">Cancel buy</button>
        ` : `
          <div class="pick-buy">
            Suggested from $${weekly.toLocaleString()}: roughly <strong>${units} units</strong> @ $${f.price.toFixed(2)}
          </div>
          <div class="buy-entry">
            <label>
              Units bought
              <input id="buy-units" type="number" min="0" step="0.0001" value="${units}" />
            </label>
            <label>
              Price bought
              <input id="buy-price" type="number" min="0" step="0.01" value="${f.price.toFixed(2)}" />
            </label>
          </div>
          <button id="confirm-buy" class="btn primary">✓ I bought this — add to holdings</button>
        `}
      </div>
      ${runners.length ? `
        <div class="pick-runners">
          <span class="muted">Runners-up:</span>
          ${runners.map((r) => `<span class="runner-pill">${r.fund.name} <em>${r.underAllocation > 0 ? (r.underAllocation * 100).toFixed(1) + "pp under" : "market signal"}</em></span>`).join("")}
        </div>` : ""}
    </div>
  `;

  $("confirm-buy")?.addEventListener("click", () => markBought(pick.key));
  $("cancel-buy")?.addEventListener("click", cancelThisWeekBuy);
}

function markBought(key) {
  if (!latestData?.funds[key]) return;
  const unitsInput = parseFloat($("buy-units")?.value);
  const priceInput = parseFloat($("buy-price")?.value);
  const newUnits = Number.isFinite(unitsInput) ? Math.max(0, unitsInput) : 0;
  const price = Number.isFinite(priceInput) ? Math.max(0, priceInput) : 0;
  if (newUnits <= 0 || price <= 0) {
    alert("Enter the units bought and price bought first.");
    return;
  }
  const dollars = newUnits * price;
  const current = getUnits(key);
  const currentAvgCost = getAvgCost(key);
  const totalUnits = current + newUnits;
  const newAvgCost = totalUnits > 0 ? ((current * currentAvgCost) + dollars) / totalUnits : price;
  setUnits(key, current + newUnits);
  setAvgCost(key, newAvgCost);
  const state = loadPickState();
  state.history = state.history || [];
  state.history.unshift({ date: new Date().toISOString(), key, dollars, units: newUnits, price });
  state.history = state.history.slice(0, 20);
  state.lastBoughtWeek = isoWeek();
  savePickState(state);
  renderHoldingsInput();
  renderPick();
}

function cancelThisWeekBuy() {
  const state = loadPickState();
  const currentWeek = isoWeek();
  const history = state.history || [];
  const idx = history.findIndex((h) => {
    const date = new Date(h.date);
    return !Number.isNaN(date.valueOf()) && isoWeek(date) === currentWeek;
  });
  if (idx < 0) return;

  const entry = history[idx];
  const key = entry.key;
  const boughtUnits = Number(entry.units) || 0;
  const dollars = Number(entry.dollars) || 0;
  const currentUnits = ((state.units || {})[key]) || 0;
  const currentAvgCost = ((state.avgCost || {})[key]) || 0;
  const remainingUnits = Math.max(0, currentUnits - boughtUnits);
  const remainingCost = Math.max(0, (currentUnits * currentAvgCost) - dollars);

  state.units = state.units || {};
  state.avgCost = state.avgCost || {};
  state.units[key] = remainingUnits;
  state.avgCost[key] = remainingUnits > 0 ? remainingCost / remainingUnits : 0;
  history.splice(idx, 1);
  state.history = history;
  if (!history.some((h) => {
    const date = new Date(h.date);
    return !Number.isNaN(date.valueOf()) && isoWeek(date) === currentWeek;
  })) {
    delete state.lastBoughtWeek;
  }
  savePickState(state);
  renderHoldingsInput();
  renderPick();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function exportHoldingsCsv() {
  if (!latestData?.funds) {
    alert("Refresh prices first so the ETF list is loaded.");
    return;
  }
  const { perFund } = holdingsValue();
  const exportedAt = new Date().toISOString();
  const headers = ["key", "ticker", "name", "units", "purchase_price", "current_price", "cost", "value", "return", "return_pct", "exported_at"];
  const rows = Object.keys(latestData.funds).map((key) => {
    const fund = latestData.funds[key];
    const holding = perFund[key] || { units: 0, avgCost: 0, cost: 0, value: 0, gain: 0, gainPct: null };
    return [
      key,
      fund.ticker,
      fund.name,
      holding.units || 0,
      holding.avgCost || 0,
      fund.price,
      holding.cost || 0,
      holding.value || 0,
      holding.gain || 0,
      holding.gainPct ?? "",
      exportedAt,
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pocket-holdings-${exportedAt.slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importHoldingsCsv(file) {
  if (!file) return;
  if (!latestData?.funds) {
    alert("Refresh prices first so the ETF list is loaded.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result || ""));
    if (rows.length < 2) {
      alert("No holdings found in that CSV.");
      return;
    }

    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name);
    const keyIdx = idx("key");
    const tickerIdx = idx("ticker");
    const unitsIdx = idx("units");
    const costIdx = idx("purchase_price") >= 0 ? idx("purchase_price") : idx("avg_cost");
    if (unitsIdx < 0 || (keyIdx < 0 && tickerIdx < 0)) {
      alert("CSV must include units plus key or ticker columns.");
      return;
    }

    const byTicker = Object.fromEntries(
      Object.entries(latestData.funds).map(([key, fund]) => [fund.ticker.toUpperCase(), key])
    );
    const imported = {};
    const importedCost = {};
    rows.slice(1).forEach((row) => {
      const csvKey = keyIdx >= 0 ? row[keyIdx]?.trim() : "";
      const csvTicker = tickerIdx >= 0 ? row[tickerIdx]?.trim().toUpperCase() : "";
      const key = latestData.funds[csvKey] ? csvKey : byTicker[csvTicker];
      const units = Number(row[unitsIdx]);
      const avgCost = costIdx >= 0 ? Number(row[costIdx]) : 0;
      if (key && Number.isFinite(units) && units >= 0) {
        imported[key] = units;
        if (Number.isFinite(avgCost) && avgCost >= 0) importedCost[key] = avgCost;
      }
    });

    const count = Object.keys(imported).length;
    if (!count) {
      alert("No matching Pocket ETF holdings found in that CSV.");
      return;
    }

    const state = loadPickState();
    state.units = { ...(state.units || {}), ...imported };
    state.avgCost = { ...(state.avgCost || {}), ...importedCost };
    savePickState(state);
    renderHoldingsInput();
    renderPick();
    alert(`Imported ${count} holding${count === 1 ? "" : "s"} from CSV.`);
  };
  reader.readAsText(file);
}

function renderCustomPortfolioEditor() {
  const root = $("custom-portfolio-editor");
  if (!root || !latestData?.funds) return;
  const selected = $("pick-portfolio")?.value === "custom";
  if (!selected) {
    root.innerHTML = "";
    return;
  }

  const weights = loadCustomWeights();
  const keys = [
    ...POCKET_FUND_ORDER.filter((k) => latestData.funds[k]),
    ...Object.keys(latestData.funds).filter((k) => !POCKET_FUND_ORDER.includes(k)),
  ];
  const totalPct = keys.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0);
  const totalClass = Math.abs(totalPct - 100) < 0.01 ? "ok" : "warn";

  root.innerHTML = `
    <div class="custom-portfolio">
      <div class="custom-portfolio-head">
        <h3>Custom Pocket Mix</h3>
        <span class="custom-total ${totalClass}">Total target ${totalPct.toFixed(0)}%</span>
      </div>
      <div class="custom-weight-grid">
        ${keys.map((key) => {
          const fund = latestData.funds[key];
          const pct = Number(weights[key]) || 0;
          return `
            <label class="custom-weight-row">
              <span>
                <strong>${fund.ticker.replace(".AX", "")}</strong>
              </span>
              <input class="custom-weight-input" type="number" min="0" max="100" step="1" data-key="${key}" value="${pct || ""}" placeholder="0" />
            </label>
          `;
        }).join("")}
      </div>
    </div>
  `;

  root.querySelectorAll(".custom-weight-input").forEach((input) => {
    input.addEventListener("change", (e) => {
      saveCustomWeight(e.target.dataset.key, e.target.value);
      renderCustomPortfolioEditor();
      renderHoldingsInput();
      renderPick();
    });
  });
}

function renderHoldingsInput() {
  const root = $("holdings-input");
  if (!root || !latestData?.funds) {
    if (root) root.innerHTML = `<div class="muted" style="padding:14px 0;">Refresh prices to populate fund list.</div>`;
    return;
  }
  const portfolio = getSelectedPortfolio();
  const { perFund, total, cost, gain, dayChange } = holdingsValue();
  const targets = portfolio?.weights || {};

  const sortedKeys = [
    ...POCKET_FUND_ORDER.filter((k) => latestData.funds[k]),
    ...Object.keys(latestData.funds).filter((k) => !POCKET_FUND_ORDER.includes(k)),
  ];

  root.innerHTML = `
    <div class="holdings-table-head">
      <span>Fund</span><span>Units owned</span><span>Avg buy</span><span>Value</span><span>Return</span><span>Current %</span><span>Target %</span><span>Gap</span>
    </div>
    ${sortedKeys.map((k) => {
      const f = latestData.funds[k];
      const u = (perFund[k] || {}).units || 0;
      const avg = (perFund[k] || {}).avgCost || 0;
      const v = (perFund[k] || {}).value || 0;
      const rowGain = (perFund[k] || {}).gain || 0;
      const rowGainPct = (perFund[k] || {}).gainPct;
      const cur = total > 0 ? v / total : 0;
      const target = targets[k] || 0;
      const gap = target - cur;
      const gainClass = rowGain > 0 ? "good" : rowGain < 0 ? "bad" : "";
      const gainLabel = rowGainPct === null ? "—" : `${rowGain >= 0 ? "+" : "-"}$${Math.abs(rowGain).toFixed(0)} (${rowGainPct >= 0 ? "+" : ""}${rowGainPct.toFixed(1)}%)`;
      const off = gap > 0.01 ? `<span class="off-tag under">↑ ${(gap*100).toFixed(1)}pp under</span>` :
                  gap < -0.01 ? `<span class="off-tag over">↓ ${(-gap*100).toFixed(1)}pp over</span>` :
                  total === 0 ? `<span class="off-tag ok">—</span>` :
                  `<span class="off-tag ok">on target</span>`;
      return `
        <div class="hold-row-input">
          <div class="hold-fund">
            <div class="hold-fund-name">${f.name}</div>
            <div class="muted" style="font-size:11px">${f.ticker} · $${f.price.toFixed(2)}</div>
          </div>
          <input class="units-input" type="number" min="0" step="0.01" data-key="${k}" value="${u || ""}" placeholder="0" />
          <input class="avg-cost-input" type="number" min="0" step="0.01" data-key="${k}" value="${avg || ""}" placeholder="$0.00" />
          <div class="hold-num">$${v.toFixed(0)}</div>
          <div class="hold-num ${gainClass}">${gainLabel}</div>
          <div class="hold-bars">
            <div class="hold-bar">
              <div class="hold-bar-cur" style="width:${Math.min(cur,1)*100}%"></div>
              <div class="hold-bar-target" style="left:${Math.min(target,1)*100}%"></div>
            </div>
            <div class="hold-num small">${(cur*100).toFixed(1)}%</div>
          </div>
          <div class="hold-num">${(target*100).toFixed(0)}%</div>
          <div>${off}</div>
        </div>`;
    }).join("")}
  `;

  // Wire up unit inputs to persist + re-render.
  root.querySelectorAll(".units-input").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      setUnits(e.target.dataset.key, e.target.value);
      renderHoldingsInput();
      renderPick();
    });
  });
  root.querySelectorAll(".avg-cost-input").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      setAvgCost(e.target.dataset.key, e.target.value);
      renderHoldingsInput();
      renderPick();
    });
  });

  // Totals & summary.
  const tNode = $("holdings-totals");
  if (tNode) {
    if (total === 0) {
      tNode.innerHTML = `<div class="muted">No holdings entered yet — fill in any units you already own (or leave blank to start fresh).</div>`;
    } else {
      const totalGap = sortedKeys.reduce((s, k) => {
        const cur = total > 0 ? ((perFund[k] || {}).value || 0) / total : 0;
        return s + Math.abs((targets[k] || 0) - cur);
      }, 0);
      const drift = (totalGap * 100 / 2).toFixed(1); // sum of |gaps| / 2 = total drift %
      const gainPct = cost > 0 ? (gain / cost) * 100 : null;
      const gainClass = gain > 0 ? "good" : gain < 0 ? "bad" : "";
      const dayClass = dayChange > 0 ? "good" : dayChange < 0 ? "bad" : "";
      tNode.innerHTML = `
        <div class="current-portfolio-head">
          <h3>Current portfolio</h3>
          <span class="muted">Returns use your entered average purchase prices.</span>
        </div>
        <div class="totals-grid">
          <div><span class="muted">Current value</span><strong>$${total.toLocaleString(undefined,{maximumFractionDigits:0})}</strong></div>
          <div><span class="muted">Money invested</span><strong>$${cost.toLocaleString(undefined,{maximumFractionDigits:0})}</strong></div>
          <div><span class="muted">Unrealised return</span><strong class="${gainClass}">${gain >= 0 ? "+" : "-"}$${Math.abs(gain).toLocaleString(undefined,{maximumFractionDigits:0})}</strong></div>
          <div><span class="muted">Return %</span><strong class="${gainClass}">${gainPct === null ? "—" : `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(2)}%`}</strong></div>
          <div><span class="muted">Today's move</span><strong class="${dayClass}">${dayChange >= 0 ? "+" : "-"}$${Math.abs(dayChange).toLocaleString(undefined,{maximumFractionDigits:0})}</strong></div>
          <div><span class="muted">Drift from target</span><strong>${drift}%</strong></div>
          <div><span class="muted">Following</span><strong>${portfolio?.name || "—"}</strong></div>
        </div>
      `;
    }
  }
}

function clearHoldings() {
  if (!confirm("Clear all entered units? This only resets the local tracker.")) return;
  localStorage.removeItem(PICK_STORAGE_KEY);
  renderHoldingsInput();
  renderPick();
}

/* ---------- Wire up (null-safe so stale HTML can't break the page) ---------- */
const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

on("refresh-btn", "click", refreshPrices);
on("recalc-btn", "click", recalcProjection);
["in-weekly", "in-target", "in-years"].forEach((id) => on(id, "change", recalcProjection));
on("pick-portfolio", "change", () => { renderCustomPortfolioEditor(); renderHoldingsInput(); renderPick(); });
on("clear-holdings", "click", clearHoldings);
on("export-holdings", "click", exportHoldingsCsv);
on("import-holdings-btn", "click", () => $("import-holdings-file")?.click());
on("import-holdings-file", "change", (e) => {
  importHoldingsCsv(e.target.files?.[0]);
  e.target.value = "";
});
on("in-weekly", "change", renderPick);

window.addEventListener("resize", () => {
  if (lastProjectionData) drawProjectionChart(lastProjectionData);
});

// initial load
recalcProjection();
refreshPrices();
