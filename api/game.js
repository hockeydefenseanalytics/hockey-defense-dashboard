// /api/game?id=2023020001
// Team defensive metrics for one game via NHL public feed.
// Force Node 20 runtime on Vercel:
module.exports.config = { runtime: "nodejs20.x" };

const UA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nhl.com/"
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

async function getJSON(url) {
  // 10s timeout
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { headers: UA_HEADERS, signal: ctrl.signal });
    if (!r.ok) throw new Error(`nhl_http_${r.status}`);
    return await r.json();
  } catch (e) {
    // http fallback in case of TLS quirk
    if (url.startsWith("https://")) {
      const r2 = await fetch(url.replace("https://", "http://"), { headers: UA_HEADERS });
      if (!r2.ok) throw new Error(`nhl_http_${r2.status}`);
      return await r2.json();
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = async function handler(req, res) {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "id required" });

    const data = await getJSON(`https://statsapi.web.nhl.com/api/v1/game/${id}/feed/live`);
    const plays = data?.liveData?.plays?.allPlays ?? [];
    const homeName = data?.gameData?.teams?.home?.name ?? "Home";
    const awayName = data?.gameData?.teams?.away?.name ?? "Away";

    const home = initCounters();
    const away = initCounters();
    const bucket = team => (team === homeName ? home : away);

    // MVP heuristics (improve later)
    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      const t = p?.result?.eventTypeId;
      const x = p?.coordinates?.x, y = p?.coordinates?.y;
      const shootTeam = p?.team?.name;
      if (!shootTeam) continue;
      const defTeam = shootTeam === homeName ? awayName : homeName;
      const B = bucket(defTeam);

      // Net-front rebound opportunity: quick opponent follow-up after a shot
      if (t === "SHOT" || t === "GOAL" || t === "MISSED_SHOT" || t === "BLOCKED_SHOT") {
        const next = plays[i + 1];
        const nextTeam = next?.team?.name;
        if (next && nextTeam && nextTeam !== shootTeam) B.nfr.t++;
      }

      // Slot-pass opportunity proxy: slot shot shortly after turnover/hit → if HIT, treat as breakup
      if (t === "SHOT" && isSlot(x, y)) {
        const prev = plays[i - 1];
        const prevT = prev?.result?.eventTypeId;
        B.slot.t++;
        if (prevT === "HIT") B.slot.g++;
      }
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({
      home: { team: homeName, metrics: toMetrics(home) },
      away: { team: awayName, metrics: toMetrics(away) }
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
