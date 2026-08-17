import {
  calculateFlatDistanceFt,
  calculateBearing,
  calculateElevationAngle,
  isInBackyardOffsetBox,
  calculateRarityScore,
  sanitizeText,
  FEET_PER_NM
} from "./spatialMath.js";

const MAX_LOGBOOK_ENTRIES = 100;

function getTodayISO() {
  // Local time, deliberately not .toISOString() — UTC would roll the date
  // over at 7PM CDT in Lewisville, hours before local midnight.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Single source of truth for date-boundary enforcement. Called from both
// the poll loop (processTelemetry) and the user-action path (logAircraft)
// so a tap right at the midnight boundary can't write into yesterday's
// bucket while waiting for the next poll cycle to catch the rollover.
export function enforceDailyRollover(state) {
  const currentDate = getTodayISO();
  if (state.lastActiveDate !== currentDate) {
    state.lastActiveDate = currentDate;
    state.today = { points: 0, uniqueSpotted: [] };
    return true; // state was mutated
  }
  return false;
}

export function loadAndSanitizeState(rawState) {
  const DEFAULT_GAME_STATE = {
    lastActiveDate: getTodayISO(),
    today: { points: 0, uniqueSpotted: [] },
    lifetime: { points: 0, totalLogs: 0, seenTails: [], seenTypes: [] },
    logbook: []
  };

  if (!rawState) return DEFAULT_GAME_STATE;

  try {
    const parsed = JSON.parse(rawState);
    if (!parsed || typeof parsed !== "object") return DEFAULT_GAME_STATE;

    const sanitized = {
      lastActiveDate: typeof parsed.lastActiveDate === "string" ? parsed.lastActiveDate : getTodayISO(),
      today: {
        points: Number.isFinite(parsed.today?.points) ? parsed.today.points : 0,
        uniqueSpotted: Array.isArray(parsed.today?.uniqueSpotted) ? parsed.today.uniqueSpotted : []
      },
      lifetime: {
        points: Number.isFinite(parsed.lifetime?.points) ? parsed.lifetime.points : 0,
        totalLogs: Number.isFinite(parsed.lifetime?.totalLogs) ? parsed.lifetime.totalLogs : 0,
        seenTails: Array.isArray(parsed.lifetime?.seenTails) ? parsed.lifetime.seenTails : [],
        seenTypes: Array.isArray(parsed.lifetime?.seenTypes) ? parsed.lifetime.seenTypes : []
      },
      logbook: Array.isArray(parsed.logbook) ? parsed.logbook.slice(0, MAX_LOGBOOK_ENTRIES) : []
    };

    enforceDailyRollover(sanitized);
    return sanitized;
  } catch (err) {
    console.warn("Corrupted localStorage detected, resetting state:", err);
    return DEFAULT_GAME_STATE;
  }
}

export class FlightStore {
  constructor(config) {
    this.config = config;
    this.activeFlightCache = new Map();
    this.gameState = loadAndSanitizeState(localStorage.getItem(config.STORAGE_KEY));
  }

  syncDailyRollover() {
    if (enforceDailyRollover(this.gameState)) {
      this.saveState();
    }
  }

  saveState(state = this.gameState) {
    try {
      localStorage.setItem(this.config.STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to persist state to LocalStorage:", err);
    }
  }

  processTelemetry(validRawFlights) {
    this.syncDailyRollover();

    const seenThisCycle = new Set();
    const rawList = Array.isArray(validRawFlights) ? validRawFlights : [];

    rawList.forEach(ac => {
      if (!ac || typeof ac !== "object" || !ac.hex) return;
      if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) return;

      const hex = String(ac.hex).toLowerCase().trim();
      const altBaro = ac.alt_baro === "ground" ? 0 : ac.alt_baro;

      const distFt = calculateFlatDistanceFt(this.config.HOME_LAT, this.config.HOME_LON, ac.lat, ac.lon);
      const distNM = distFt / FEET_PER_NM;
      const bearing = calculateBearing(this.config.HOME_LAT, this.config.HOME_LON, ac.lat, ac.lon);
      const elevation = calculateElevationAngle(distFt, altBaro, this.config.HOME_ALT_FT);

      const isTracked = this.activeFlightCache.has(hex);
      const inBox = isInBackyardOffsetBox(ac.lat, ac.lon, this.config.HOME_LAT, this.config.HOME_LON, this.config.OFFSET_BOUNDS_NM);

      // Hysteresis: entry requires MIN_ELEVATION_DEG (10.0°), exit requires
      // dropping below EXIT_ELEVATION_DEG (5.0°) — the gap between the two
      // prevents a contact hovering near the boundary from flapping on/off
      // the board every poll cycle.
      const meetsEntry = inBox && elevation >= this.config.MIN_ELEVATION_DEG;
      const meetsExit = !inBox || elevation < this.config.EXIT_ELEVATION_DEG;

      if ((!isTracked && meetsEntry) || (isTracked && !meetsExit)) {
        seenThisCycle.add(hex);
        this.activeFlightCache.set(hex, {
          hex,
          callsign: sanitizeText(ac.flight),
          tail: sanitizeText(ac.r),
          type: sanitizeText(ac.t),
          operator: sanitizeText(ac.ownOp || "Unknown Operator"),
          alt: typeof altBaro === "number" ? altBaro : 0,
          speed: typeof ac.gs === "number" ? Math.round(ac.gs) : 0,
          distNM: Number(distNM.toFixed(1)),
          bearing: Math.round(bearing),
          elevation: Number(elevation.toFixed(1)),
          scoreMeta: calculateRarityScore(ac.t),
          missedCycles: 0
        });
      }
    });

    for (const [hex, cached] of this.activeFlightCache.entries()) {
      if (!seenThisCycle.has(hex)) {
        cached.missedCycles += 1;
        if (cached.missedCycles > this.config.MAX_MISSED_CYCLES) {
          this.activeFlightCache.delete(hex);
        }
      }
    }

    return Array.from(this.activeFlightCache.values()).sort((a, b) => b.elevation - a.elevation);
  }

  logAircraft(ac) {
    // Protects against writing into yesterday's bucket if a tap lands right
    // at the midnight boundary, ahead of the next poll cycle's rollover check.
    this.syncDailyRollover();

    if (!ac || !ac.hex) return { success: false, reason: "Invalid aircraft data" };

    const todaySpotted = this.gameState.today.uniqueSpotted;
    if (todaySpotted.includes(ac.hex)) {
      return { success: false, reason: `${ac.callsign} already logged today!` };
    }

    const pts = ac.scoreMeta?.points || 10;
    this.gameState.today.points += pts;
    this.gameState.today.uniqueSpotted.push(ac.hex);

    this.gameState.lifetime.points += pts;
    this.gameState.lifetime.totalLogs += 1;

    if (ac.tail && !this.gameState.lifetime.seenTails.includes(ac.tail)) {
      this.gameState.lifetime.seenTails.push(ac.tail);
    }
    if (ac.type && !this.gameState.lifetime.seenTypes.includes(ac.type)) {
      this.gameState.lifetime.seenTypes.push(ac.type);
    }

    const achievements = [];
    if (ac.scoreMeta?.tier === "RARE") achievements.push("RARE SPOT");
    if (ac.scoreMeta?.tier === "UNCOMMON") achievements.push("UNCOMMON SPOT");

    this.gameState.logbook.unshift({
      hex: ac.hex,
      callsign: ac.callsign,
      tail: ac.tail,
      type: ac.type,
      points: pts,
      timestamp: new Date().toISOString()
    });
    if (this.gameState.logbook.length > MAX_LOGBOOK_ENTRIES) {
      this.gameState.logbook.length = MAX_LOGBOOK_ENTRIES;
    }

    this.saveState();
    return { success: true, points: pts, achievements };
  }
}
