// /api/player?name=Jonas%20Brodin&season=career
// Player defensive card via MoneyPuck (NRR) + placeholders for offense/context.
// Force Node 20:
module.exports.config = { runtime: "nodejs20.x" };

const UA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Accept": "text/csv,application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://moneypuck.com/"
};

const pct = (g, t) => (t ? (100 * g) / t : null);
const toDPI = (z, s, n) => {
  const parts = [z, s, n].filter(v => v != null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
};
const blankCounts = { entries: { good: 0, total: 0 }, slot: { good: 0, total: 0 }, nfr: { good: 0, total: 0 } };
const toMetrics = counts => {
  const zdr = pct(counts.entries.good, counts.entries.total);
  const sbr = pct(counts.slot.good, counts.slot.total);
  const nrr = pct(counts.nfr.good, counts.nfr.total);
  return { zdr, sbr, nrr, dpi: toDPI(zdr, sbr, nrr) };
};

// CSV line splitter that respects simple quotes
function splitCSV(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { headers: UA_HEADERS, signal: ctrl.signal });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

async function moneyPuckPlayerId(name) {
  const csv = await fetchText("https://moneypuck.com/data/playersByName/playersByName.csv");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = splitCSV(lines.shift());
  const iName = head.findIndex(h => h.toLowerCase() === "name");
  const iId   = head.findIndex(h => h.toLowerCase() === "playerid");
  const norm = s => (s || "").trim().toLowerCase();
  const target = norm(name);
  const rows = lines.map(splitCSV).filter(r => r[iName]);

  // fuzzy: exact → startsWith → includes
  const hit =
    rows.find(r => norm(r[iName]) === target) ||
    rows.find(r => norm(r[iName]).startsWith(target)) ||
    rows.find(r => norm(r[iName]).includes(target));

  return hit ? hit[iId] : null;
}

async function moneyPuckNRRCounts(name) {
  const counts = JSON.parse(JSON.stringify(blankCounts));
  const trend = [];
  const pid = await moneyPuckPlayerId(name);
  if (!pid) return { counts, trend };

  const csv = await fetchText(`https://moneypuck.com/moneypuck/playerData/careerSkaterGameByGame/${pid}.csv`);
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = splitCSV(lines.shift());
  const iRebAg = head.findIndex(h => h.toLowerCase() === "reboundsagainst");

  for (const line of lines) {
    const r = splitCSV(line);
    const ra = Number(r[iRebAg] || 0);
    counts.nfr.total += ra;
    // MVP: cannot mark recoveries without tracking → good stays 0
    trend.push(Math.max(0, 100 - Math.min(ra * 4, 100))); // simple spark proxy
  }
  return { counts, trend: trend.slice(-10) };
}

// Placeholders (fill out later if you want)
async function nhlPlayerMeta() { return { team: "", position: "", headshot: "" }; }
async function nhlOffenseAndWins() { return { offense: { g: 0, a: 0, p: 0, xgf_on: 0, goal_diff_on: 0 }, team_context: { wins: 0, win_pct: 0, avg_toi: 0 } }; }

module.exports = async function handler(req, res) {
  try {
    const name = String(req.query.name || "").trim();
    const season = String(req.query.season || "career");
    if (!name) return res.status(400).json({ error: "name required" });

    const { counts, trend } = await moneyPuckNRRCounts(name);
    const metrics = toMetrics(counts);
    const meta = await nhlPlayerMeta(name);
    const ctx = await nhlOffenseAndWins(name, season);

    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      player: name, team: meta.team, position: meta.position, headshot: meta.headshot,
      metrics, counts, trend, offense: ctx.offense, team_context: ctx.team_context
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
