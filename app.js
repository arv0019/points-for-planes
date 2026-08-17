import { FlightStore } from "./flightStore.js";
import { HUDRenderer } from "./hudUI.js";

const CONFIG = {
  PROXY_BASE_URL: "https://adsb-proxy.arv0019.workers.dev",
  HOME_LAT: 33.03675589170987,
  HOME_LON: -97.01750419304086,
  HOME_ALT_FT: 518,
  OFFSET_BOUNDS_NM: { NORTH: 15.0, SOUTH: 4.0, EAST: 8.0, WEST: 8.0 },
  MIN_ELEVATION_DEG: 0.0, // Keep 0.0 for wide testing; set to 10.0 for backyard window
  EXIT_ELEVATION_DEG: 0.0,
  MAX_MISSED_CYCLES: 2,
  FETCH_RADIUS_NM: 20,
  POLL_INTERVAL_MS: 20000, // Relaxed to 20s to prevent HTTP 429 rate limits
  FETCH_TIMEOUT_MS: 10000, // Headroom for VPN/high-latency connections
  STORAGE_KEY: "backyard_hud_game_state_v1"
};

const store = new FlightStore(CONFIG);
let pollTimer = null;
let isPolling = false;

const statusEl = document.getElementById("board-status");
const renderer = new HUDRenderer(
  document.getElementById("flight-cards-container"),
  statusEl,
  (ac) => {
    const result = store.logAircraft(ac);
    if (!result.success) {
      renderer.showToast(result.reason, "warning");
    } else {
      renderer.updateScoreboard(store.gameState);
      const bonusMsg = result.achievements.length > 0 ? ` [${result.achievements.join(", ")}]` : "";
      renderer.showToast(`Logged ${ac.callsign} for +${result.points} PTS!${bonusMsg}`, "info");
    }
  }
);

async function fetchFlightData(signal) {
  // Single hop to our own Cloudflare Worker, which handles the
  // airplanes.live -> adsb.lol failover and edge caching server-side.
  // Keeps the browser to one request instead of two sequential ones
  // (previously including a third-party CORS proxy for the fallback),
  // which matters most on high-latency connections like a VPN.
  const pointPath = `/point/${CONFIG.HOME_LAT}/${CONFIG.HOME_LON}/${CONFIG.FETCH_RADIUS_NM}`;
  const res = await fetch(`${CONFIG.PROXY_BASE_URL}${pointPath}`, { signal });
  if (res.status === 429) throw new Error("API Rate Limited (429)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function pollTelemetry() {
  if (isPolling) return;
  isPolling = true;

  const timestamp = new Date().toLocaleTimeString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);

  try {
    const data = await fetchFlightData(controller.signal);
    clearTimeout(timeoutId);

    const valid = (data.ac || []).filter(
      ac => ac && Number.isFinite(ac.lat) && Number.isFinite(ac.lon) && ac.alt_baro !== "ground"
    );
    
    const activeFlights = store.processTelemetry(valid);
    renderer.renderBoard(activeFlights);

    if (activeFlights.length === 0 && statusEl) {
      statusEl.innerText = `API Connected: 0 in spatial box (${valid.length} raw nearby) · Updated ${timestamp}`;
      statusEl.className = "text-center py-12 text-slate-400 font-mono text-xs px-4";
    }

    const topRareContact = activeFlights.find(
      ac => ac.scoreMeta?.tier === "RARE" || ac.scoreMeta?.tier === "UNCOMMON"
    );
    if (topRareContact) {
      renderer.showRareAlertBanner(topRareContact);
    } else {
      renderer.clearRareAlertBanner();
    }
  } catch (err) {
    if (statusEl) {
      const msg = err.name === "AbortError" ? "Fetch Timeout" : err.message;
      statusEl.innerText = `Network/API Error: ${msg} · Pausing for next cycle... (${timestamp})`;
      statusEl.className = "text-center py-12 text-amber-400 font-mono text-xs px-4";
    }
  } finally {
    isPolling = false;
  }
}

function startPolling() {
  stopPolling();
  pollTelemetry();
  pollTimer = setInterval(pollTelemetry, CONFIG.POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderer.updateScoreboard(store.gameState);
  startPolling();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
    }
  });
});
