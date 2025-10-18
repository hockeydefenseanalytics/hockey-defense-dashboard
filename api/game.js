// /api/game?id=2023020001
module.exports.config = { runtime: "nodejs20.x" };   // ← add this line

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

// optional headers+timeout (kept simple here)
module.exports = async function handler(req, res) {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "id required" });

    const r = await fetch(`https://statsapi.web.nhl.com/api/v1/game/${id}/feed/live`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "application/json"
      }
    });
    if (!r.ok) return res.status(502).json({ error: `nhl_http_${r.status}` });
    const data = await r.json();

    const plays = data?.liveData?.plays?.allPlays ?? [];
    const homeName = data?.gameData?.teams?.home?.name ?? "Home";
    const awayName = data?.gameData?.teams?.away?.name ?? "Away";

    const home = initCounters();
    const away = initCounters();
    const bucket = team => (team === homeName ? home : away);

    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      const t = p?.result?.eventTypeId;
      const x = p?.coordinates?.x, y = p?.coordinates?.y;
      const shootTeam = p?.team?.name;
      if (!shootTeam) continue;
      const defTeam = shootTeam === homeName ? awayName : homeName;
      const B = bucket(defTeam);

      if (t === "SHOT" || t === "GOAL" || t === "MISSED_SHOT" || t === "BLOCKED_SHOT") {
        const next = plays[i + 1];
        const nextTeam = next?.team?.name;
        if (next && nextTeam && nextTeam !== shootTeam) B.nfr.t++;
      }
      if (t === "SHOT" && isSlot(x, y)) {
        const prev = plays[i - 1];
        const prevT = prev?.result?.eventTypeId;
        B.slot.t++;
        if (prevT === "HIT") B.slot.g++;
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
