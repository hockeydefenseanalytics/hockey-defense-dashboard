// /api/game?id=2023020001
// Team-level defensive metrics for a single game via NHL public feed (Node 18 on Vercel).

const UA = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "application/json"
  },
  // 10s timeout via AbortController
  signal: (() => {
    const c = new AbortController();
    setTimeout(() => c.abort(), 10000);
    return c.signal;
  })()
};

const isSlot = (x, y) => x != null && y != null && Math.abs(x) < 25 && Math.abs(y) < 20;
const pct = (g, t) => (t ? (100 * g) / t : null);
const toDPI = (z, s, n) => {
  const parts = [z, s, n].filter(v => v != null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
};
const initCounters = () => ({ entry: { g: 0, t: 0 }, slot: { g: 0, t: 0 }, nfr: { g: 0, t: 0 } });
const toMetrics = c => {
  const zdr = pct(c.entry.g, c.entry.t);
  const sbr = pct(c.slot.g, c.slot.t);
  const nrr = pct(c.nfr.g, c.nfr.t);
  return { zdr, sbr, nrr, dpi: toDPI(zdr, sbr, nrr) };
};

async function fetchNHLFeed(gameId) {
  const url = `https://statsapi.web.nhl.com/api/v1/game/${gameId}/feed/live`;
  try {
    const r = await fetch(url, UA);
    if (!r.ok) throw new Error(`nhl_http_${r.status}`);
    return await r.json();
  } catch (e) {
    // Fallback to http if https has TLS oddities
    try {
      const r2 = await fetch(`http://statsapi.web.nhl.com/api/v1/game/${gameId}/feed/live`, UA);
      if (!r2.ok) throw new Error(`nhl_http_${r2.status}`);
      return await r2.json();
    } catch (e2) {
      throw new Error(`nhl_fetch_failed:${e2.message}`);
    }
  }
}

module.exports = async function handler(req, res) {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });

    const data = await fetchNHLFeed(id);
    const plays = data?.liveData?.plays?.allPlays ?? [];
    const homeName = data?.gameData?.teams?.home?.name ?? "Home";
    const awayName = data?.gameData?.teams?.away?.name ?? "Away";

    const home = initCounters();
    const away = initCounters();
    const bucket = team => (team === homeName ? home : away);

    // MVP heuristics
    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      const t = p?.result?.eventTypeId;
      const x = p?.coordinates?.x, y = p?.coordinates?.y;
      const shootTeam = p?.team?.name;
      if (!shootTeam) continue;
      const defTeam = shootTeam === homeName ? awayName : homeName;
      const B = bucket(defTeam);

      // Net-front rebound opportunity (opponent follows with a quick shot)
      if (t === "SHOT" || t === "GOAL" || t === "MISSED_SHOT" || t === "BLOCKED_SHOT") {
        const next = plays[i + 1];
        const nextTeam = next?.team?.name;
        if (next && nextTeam && nextTeam !== shootTeam) {
          B.nfr.t++;
        }
      }

      // Slot-pass opportunity proxy (slot shot shortly after turnover/hit)
      if (t === "SHOT" && isSlot(x, y)) {
        const prev = plays[i - 1];
        const prevT = prev?.result?.eventTypeId;
        B.slot.t++;
        if (prevT === "HIT") B.slot.g++; // treat HIT as break-up
      }
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      home: { team: homeName, metrics: toMetrics(home) },
      away: { team: awayName, metrics: toMetrics(away) }
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
