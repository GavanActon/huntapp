import { isRain, isSnow, isThunder } from './openMeteo'

/**
 * A tiny sky glyph from the WMO weather code, as SVG markup: sun, some
 * cloud, cloud, rain, snow, bolt. The one source for the strip's SkyGlyph
 * and the map popup's weather line.
 */
export function skyGlyphSvg(code: number, size = 13): string {
  const open = (label: string) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-label="${label}">`
  if (isThunder(code)) return `${open('thunder')}<path d="M9 1 3 9h4l-1 6 6-8H8z" fill="currentColor"/></svg>`
  if (isSnow(code)) return `${open('snow')}<path d="M8 1v14M2 4.5l12 7M2 11.5l12-7" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>`
  if (isRain(code))
    return `${open('rain')}<path d="M4 8a3.5 3.5 0 0 1 0-7 4 4 0 0 1 7.6 1A3 3 0 0 1 12 8z" fill="currentColor"/><path d="M5 10v3M8 11v3M11 10v3" stroke="currentColor" stroke-width="1.5"/></svg>`
  if (code >= 3 || code === 45 || code === 48) return `${open('cloud')}<path d="M4 12a3.5 3.5 0 0 1 0-7 4 4 0 0 1 7.6 1A3 3 0 0 1 12 12z" fill="currentColor"/></svg>`
  if (code >= 1)
    return `${open('some cloud')}<circle cx="6" cy="6" r="3.5" fill="currentColor" opacity="0.7"/><path d="M6 13a2.5 2.5 0 0 1 0-5 3 3 0 0 1 5.7.8A2.2 2.2 0 0 1 12 13z" fill="currentColor"/></svg>`
  return `${open('clear')}<circle cx="8" cy="8" r="3.5" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.3"/></svg>`
}
