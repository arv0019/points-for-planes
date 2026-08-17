import { FlightStore } from "./flightStore.js";
import { HUDRenderer } from "./hudUI.js";

const CONFIG = {
  HOME_LAT: 33.0441,
  HOME_LON: -96.9975,
  HOME_ALT_FT: 518,
  OFFSET_BOUNDS_NM: { NORTH: 15.0, SOUTH: 4.0, EAST: 8.0, WEST: 8.0 },
  MIN_ELEVATION_DEG: 0.0, // Set to 0.0 for wide-area testing; set to 10.0 for actual backyard filtering
  EXIT_ELEVATION_DEG: 0.0,
  MAX_MISSED_CYCLES: 2,
  FETCH_RADIUS_NM: 20,
  POLL_INTERVAL_MS: 10000,
  FETCH_TIMEOUT_MS: 5000,
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
  const pointPath = `/v2/point/${CONFIG.HOME_LAT}/${CONFIG.HOME_LON}/${CONFIG.FETCH_RADIUS_NM}`;

  // Primary: airplanes.live direct point search
  try {
    const res = await fetch(`https://api.airplanes.live${pointPath}`, { signal });
    if (res.ok) return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw err;
  }

  // Fallback: adsb.lol routed via corsproxy.io to bypass WebKit origin checks
  const targetUrl = `https://api.adsb.lol${pointPath}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  const resFallback = await fetch(proxyUrl, { signal });
  if (!resFallback.ok) throw new Error(`HTTP ${resFallback.status}`);
  return await resFallback.json();
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
      const msg = err.name === "AbortError" ? "Fetch Timeout (5s)" : err.message;
      statusEl.innerText = `Network/API Error: ${msg} · Retrying... (${timestamp})`;
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
