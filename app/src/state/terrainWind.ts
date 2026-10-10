/**
 * Which terrain wind the ground model reads (config.ts microFile): HD, the
 * momentum solve WindNinja ran for the area (micro-<area>.hab), or SD, the
 * net trained to stand in for it (micro-sd-<area>.hab, the same bands). Kept
 * on the phone and read once at start: switching reloads the app
 * (ui/sheets/SettingsSheet.tsx). No imports, so config.ts can read it.
 * The page's head script (index.html) reads the same key for its early
 * fetch of the wind grid.
 */
export type TerrainWind = 'hd' | 'sd'

export const TERRAIN_WIND_KEY = 'huntapp-terrain-wind'

/** The setting on this phone, HD until it is set (or when storage is shut). */
export function terrainWind(): TerrainWind {
  try {
    return localStorage.getItem(TERRAIN_WIND_KEY) === 'sd' ? 'sd' : 'hd'
  } catch {
    return 'hd'
  }
}

export function setTerrainWind(v: TerrainWind): void {
  try {
    localStorage.setItem(TERRAIN_WIND_KEY, v)
  } catch {
    /* private mode: HD on the next open */
  }
}
