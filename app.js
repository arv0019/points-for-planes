import { FlightStore } from "./flightStore.js";
import { HUDRenderer } from "./hudUI.js";

const CONFIG = {
  HOME_LAT: 33.0441,
  HOME_LON: -96.9975,
  HOME_ALT_FT: 518,
  OFFSET_BOUNDS_NM: { NORTH: 15.0, SOUTH: 4.0, EAST: 8.0, WEST: 8.0 },
  MIN_ELEVATION_DEG: 0.0, // Set to 0.0 for wide-area testing
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

async function pollTelemetry() {
  if (isPolling) return;
  isPolling = true;

  const timestamp = new Date().toLocaleTimeString();
  // Replace the adsb.lol URL line in app.js:
  const url = `https://api.airplanes.live/v2/point/${CONFIG.HOME_LAT}/${CONFIG.HOME_LON}/${CONFIG.FETCH_RADIUS_NM}`;
// this API did not work -  const url = `https://api.adsb.lol/v2/lat/${CONFIG.HOME_LAT}/lon/${CONFIG.HOME_LON}/${CONFIG.FETCH_RADIUS_NM}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    const valid = (data.ac || []).filter(ac => ac && Number.isFinite(ac.lat) && Number.isFinite(ac.lon) && ac.alt_baro !== "ground");
    
    const activeFlights = store.processTelemetry(valid);
    renderer.renderBoard(activeFlights);

    if (activeFlights.length === 0 && statusEl) {
      statusEl.innerText = `API Connected: 0 planes in spatial box (${valid.length} raw nearby) · ${timestamp}`;
      statusEl.className = "text-center py-12 text-slate-400 font-mono text-xs px-4";
    }

    const topRareContact = activeFlights.find(ac => ac.scoreMeta?.tier === "RARE" || ac.scoreMeta?.tier === "UNCOMMON");
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
