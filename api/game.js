// api/game.js
// Fetch NHL EDGE play-by-play + boxscore for a given game ID (ex: 2023020001)
module.exports.config = { runtime: "nodejs20.x" };

const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json",
  "Referer": "https://www.nhl.com/"
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.json();
}

function calcMetrics(plays) {
  let defensiveEvents = { slot: 0, rebounds: 0, totalShots: 0 };
  for (const p of plays || []) {
    if (!p.details) continue;
    const x = p.details.xCoord, y = p.details.yCoord;
    if (Math.abs(x) < 25 && Math.abs(y) < 20) defensiveEvents.slot++;
    if (p.typeDescKey?.includes("rebound")) defensiveEvents.rebounds++;
    if (p.typeDescKey?.includes("shot") || p.typeDescKey?.includes("goal"))
      defensiveEvents.totalShots++;
  }
  const { slot, rebounds, totalShots } = defensiveEvents;
  return {
    slotDefenses: slot,
    reboundsDefended: rebounds,
    totalShots,
    slotPct: totalShots ? (slot / totalShots) * 100 : 0,
    reboundPct: totalShots ? (rebounds / totalShots) * 100 : 0
  };
}

module.exports = async function handler(req, res) {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing ?id=" });

    const playURL = `https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`;
    const boxURL = `https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`;

    const [plays, box] = await Promise.all([fetchJSON(playURL), fetchJSON(boxURL)]);
    const metrics = calcMetrics(plays.plays || []);

    res.status(200).json({
      ok: true,
      gameId: id,
      gameDate: plays.gameDate,
      homeTeam: box.homeTeam?.abbrev,
      awayTeam: box.awayTeam?.abbrev,
      metrics
    });
  } catch (err) {
    console.error("GAME API ERROR", err);
    res.status(502).json({ ok: false, error: err.message });
  }
};
