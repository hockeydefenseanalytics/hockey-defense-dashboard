// /api/player?name=Jonas%20Brodin&season=career
module.exports.config = { runtime: "nodejs20.x" };   // ← add this line

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

async function moneyPuckPlayerId(name) {
  const csv = await (await fetch("https://moneypuck.com/data/playersByName/playersByName.csv", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "text/csv"
    }
  })).text();
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(",");
  const iName = head.findIndex(h => h.toLowerCase() === "name");
  const iId = head.findIndex(h => h.toLowerCase() === "playerid");
  const norm = s => (s || "").trim().toLowerCase();
  const target = norm(name);
  const rows = lines.map(l => l.split(",")).filter(r => r[iName]);
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
  const gbg = await (await fetch(`https://moneypuck.com/moneypuck/playerData/careerSkaterGameByGame/${pid}.csv`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/csv" }
  })).text();
  const lines = gbg.split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(",");
  const iRebAg = head.findIndex(h => h.toLowerCase() === "reboundsagainst");
  for (const line of lines) {
    const r = line.split(",");
    const ra = Number(r[iRebAg] || 0);
    counts.nfr.total += ra;
    trend.push(Math.max(0, 100 - Math.min(ra * 4, 100)));
  }
  return { counts, trend: trend.slice(-10) };
}

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
      player: name,
      team: meta.team,
      position: meta.position,
      headshot: meta.headshot,
      metrics,
      counts,
      trend,
      offense: ctx.offense,
      team_context: ctx.team_context
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
