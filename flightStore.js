import {
  calculateFlatDistanceFt,
  calculateBearing,
  calculateElevationAngle,
  isInBackyardOffsetBox,
  calculateRarityScore,
  sanitizeText,
  getTodayDateString,
  FEET_PER_NM
} from "./spatialMath.js";

export class FlightStore {
  constructor(config) {
    this.config = config;
    this.activeFlightCache = new Map();
    this.gameState = this.loadAndSyncGameState();
  }

  loadAndSyncGameState() {
    let state = this.getDefaultState();
    try {
      const raw = localStorage.getItem(this.config.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") state = parsed;
      }
    } catch (err) {
      console.warn("Storage corruption detected; resetting state fallback.", err);
    }

    const todayStr = getTodayDateString();
    if (!state.today || state.lastActiveDate !== todayStr) {
      state.today = { points: 0, uniqueSpotted: [] };
      state.lastActiveDate = todayStr;
      this.saveState(state);
    }
    return state;
  }

  getDefaultState() {
    return {
      lastActiveDate: getTodayDateString(),
      today: { points: 0, uniqueSpotted: [] },
      lifetime: { points: 0, totalLogs: 0, seenTails: [], seenTypes: [] },
      logbook: []
    };
  }

  saveState(state = this.gameState) {
    try {
      localStorage.setItem(this.config.STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to persist state to LocalStorage:", err);
    }
  }

  processTelemetry(validRawFlights) {
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
    if (!ac || !ac.hex) return { success: false, reason: "Invalid aircraft data" };

    const todaySpotted = this.gameState.today?.uniqueSpotted || [];
    if (todaySpotted.includes(ac.hex)) {
      return { success: false, reason: `${ac.callsign} already logged today!` };
    }

    const pts = ac.scoreMeta?.points || 10;
    this.gameState.today.points += pts;
    this.gameState.today.uniqueSpotted.push(ac.hex);

    this.gameState.lifetime.points += pts;
    this.gameState.lifetime.totalLogs += 1;

    if (!this.gameState.lifetime.seenTails.includes(ac.tail)) {
      this.gameState.lifetime.seenTails.push(ac.tail);
    }
    if (!this.gameState.lifetime.seenTypes.includes(ac.type)) {
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

    this.saveState();
    return { success: true, points: pts, achievements };
  }
}