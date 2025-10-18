// /api/player?name=Jonas%20Brodin&season=career
// Returns player defensive card data using MoneyPuck + placeholders for offense and team context.
// No imports needed (Node 18+ has global fetch).

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

// Resolve MoneyPuck player id by name
async function moneyPuckPlayerId(name) {
  const csv = await (await fetch("https://moneypuck.com/data/playersByName/playersByName.csv")).text();
  const [headLine, ...rows] = csv.split(/\r?\n/).filter(Boolean);
  const head = headLine.split(",");
  const iName = head.findIndex(h => h.toLowerCase() === "name");
  const iId = head.findIndex(h => h.toLowerCase() === "playerid");
  const hit = rows
    .map(r => r.split(","))
    .find(r => (r[iName] || "").toLowerCase() === name.toLowerCase());
  return hit ? hit[iId] : null;
}

// Build NFR counts from MoneyPuck game-by-game (MVP: only NFR is populated)
async function moneyPuckNRRCounts(name) {
  const pid = await moneyPuckPlayerId(name);
  if (!pid) return { counts: JSON.parse(JSON.stringify(blankCounts)), trend: [] };
  const gbg = await (await fetch(`https://moneypuck.com/moneypuck/playerData/careerSkaterGameByGame/${pid}.csv`)).text();
  const [headLine, ...rows] = gbg.split(/\r?\n/).filter(Boolean);
  const head = headLine.split(",");
  const iRebAg = head.findIndex(h => h.toLowerCase() === "reboundsagainst");

  const counts = JSON.parse(JSON.stringify(blankCounts));
  const trend = [];
  for (const line of rows) {
    const r = line.split(",");
    const ra = Number(r[iRebAg] || 0);
    counts.nfr.total += ra;
    // Without tracking we can't attribute defensive recoveries reliably; keep good=0 for MVP.
    trend.push(Math.max(0, 100 - Math.min(ra * 4, 100))); // playful DPI-ish spark proxy
  }
  return { counts, trend: trend.slice(-10) };
}

// Minimal placeholders for headshot/offense/team context (fill later)
async function nhlPlayerMeta(name) {
  // You can improve this by hitting NHL's /people endpoints and team rosters.
  return { team: "", position: "", headshot: "" };
}
async function nhlOffenseAndWins(name, season) {
  // TODO: implement from NHL team+player game logs. MVP returns blanks.
  return { offense: { g: 0, a: 0, p: 0, xgf_on: 0, goal_diff_on: 0 }, team_context: { wins: 0, win_pct: 0, avg_toi: 0 } };
}

export default async function handler(req, res) {
  try {
    const name = String(req.query.name || "").trim();
    const season = String(req.query.season || "career");
    if (!name) return res.status(400).json({ error: "name required" });

    const { counts, trend } = await moneyPuckNRRCounts(name);
    const metrics = toMetrics(counts);
    const meta = await nhlPlayerMeta(name);
    const ctx = await nhlOffenseAndWins(name, season);

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({
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
    return res.status(500).json({ error: e.message || "server_error" });
  }
}
