const EARTH_RADIUS_FEET = 20925672;
export const FEET_PER_NM = 6076.12;

export function calculateFlatDistanceFt(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  
  const x = Δλ * Math.cos((φ1 + φ2) / 2);
  const y = φ2 - φ1;
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_FEET;
}

export function calculateBearing(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function calculateElevationAngle(distFt, altBaroFt, homeAltFt = 518) {
  const numericAlt = typeof altBaroFt === "number" && Number.isFinite(altBaroFt) ? altBaroFt : 0;
  const altAglFt = Math.max(0, numericAlt - homeAltFt);
  if (!Number.isFinite(distFt) || distFt <= 0) return 90.0;
  return (Math.atan2(altAglFt, distFt) * 180) / Math.PI;
}

export function isInBackyardOffsetBox(acLat, acLon, homeLat, homeLon, bounds) {
  if (![acLat, acLon, homeLat, homeLon].every(Number.isFinite) || !bounds) return false;
  const deltaLatNM = (acLat - homeLat) * 60;
  const cosLat = Math.cos((homeLat * Math.PI) / 180);
  const deltaLonNM = (acLon - homeLon) * 60 * cosLat;

  return deltaLatNM <= bounds.NORTH &&
         deltaLatNM >= -bounds.SOUTH &&
         deltaLonNM <= bounds.EAST &&
         deltaLonNM >= -bounds.WEST;
}

export function calculateRarityScore(type = "") {
  const safeType = typeof type === "string" ? type.trim().toUpperCase() : "";
  const rareTypes = ["A388", "AN124", "B748", "B744", "C17", "C5", "V22", "E3TF"];
  if (rareTypes.includes(safeType)) {
    return { points: 50, tier: "RARE", badge: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  }

  const uncommonTypes = ["A359", "B789", "B78X", "B77W", "E135", "CRJ2"];
  if (uncommonTypes.includes(safeType)) {
    return { points: 25, tier: "UNCOMMON", badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" };
  }

  return { points: 10, tier: "COMMON", badge: "bg-slate-800 text-slate-300 border-slate-700" };
}

export function sanitizeText(str) {
  if (str === null || str === undefined) return "N/A";
  const cleaned = String(str).trim().replace(/[&<>"']/g, "");
  return cleaned.length > 0 ? cleaned : "N/A";
}

export function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}