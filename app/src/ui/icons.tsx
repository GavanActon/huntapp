interface IconProps {
  size?: number
}

const S = (p: IconProps) => p.size ?? 22

export const IconLocate = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" strokeLinecap="round" />
  </svg>
)

export const IconCompass = (p: IconProps & { rotation?: number }) => (
  <svg
    width={S(p)}
    height={S(p)}
    viewBox="0 0 24 24"
    style={{ transform: `rotate(${p.rotation ?? 0}deg)`, transition: 'transform 0.2s' }}
  >
    <path d="M12 2 L15.5 12 L12 22 L8.5 12 Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 2 L15.5 12 L8.5 12 Z" fill="#ff6b6b" stroke="none" />
  </svg>
)

export const IconLayers = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M12 3 L21 8 L12 13 L3 8 Z" />
    <path d="M4.5 12.5 L12 16.5 L19.5 12.5" strokeLinecap="round" />
    <path d="M4.5 16.5 L12 20.5 L19.5 16.5" strokeLinecap="round" opacity="0.55" />
  </svg>
)

export const IconWind = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M3 8h9.5a2.8 2.8 0 1 0-2.6-3.8" />
    <path d="M3 13h14.5a2.8 2.8 0 1 1-2.6 3.8" />
    <path d="M3 18h7" opacity="0.6" />
  </svg>
)

export const IconTrack = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="5" cy="19" r="2.2" />
    <circle cx="19" cy="5" r="2.2" />
    <path d="M6.5 17.5 C 10 14, 9 10, 12 8.5 C 14.5 7.2, 15.5 8, 17.3 6.6" strokeDasharray="0.1 3.2" />
  </svg>
)

export const IconRoute = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="19" r="2.2" />
    <path d="M7 17.5 C 11 14.5, 8 10, 12.5 8 L 15 6.9" strokeDasharray="0.1 3.2" />
    <path d="M17.5 2.5 v9" />
    <path d="M17.5 3 h4 l-1.4 2 1.4 2 h-4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStar = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 2.5 L14.8 8.9 L21.5 9.6 L16.5 14.2 L18 21 L12 17.5 L6 21 L7.5 14.2 L2.5 9.6 L9.2 8.9 Z" />
  </svg>
)

export const IconMinus = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M5 12h14" />
  </svg>
)

export const IconPlus = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconPlaces = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M3 6.5 L9 4 L15 6.5 L21 4 V17.5 L15 20 L9 17.5 L3 20 Z" />
    <path d="M9 4v13.5M15 6.5V20" opacity="0.55" strokeLinecap="round" />
  </svg>
)

export const IconSwap = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8.5h14l-3.4-3.4M20 15.5H6l3.4 3.4" />
  </svg>
)

export const IconPin = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21.5 C 12 21.5, 5 14.8, 5 9.8 A 7 7 0 0 1 19 9.8 C 19 14.8, 12 21.5, 12 21.5 Z" />
    <circle cx="12" cy="9.8" r="2.6" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" />
    <path d="M4 19.5h16" />
  </svg>
)

export const IconDownloadDone = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 10.5 11 15l7-8" />
    <path d="M4 19.5h16" />
  </svg>
)

export const IconShare = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" />
    <path d="M8 6.5 12 3l4 3.5" />
    <path d="M6 11H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 21h14a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 19 11h-1" />
  </svg>
)

export const IconTrash = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 6.5h16M9.5 6V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V6M6.5 6.5l1 13A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-13" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.5 10 18 19.5 7" />
  </svg>
)

/** Arrow pointing where the wind blows toward (pass Open-Meteo "from" dir + 180). */
export const IconWindArrow = (p: IconProps & { deg: number }) => (
  <svg
    width={S(p)}
    height={S(p)}
    viewBox="0 0 14 14"
    style={{ transform: `rotate(${p.deg}deg)`, flexShrink: 0 }}
  >
    <path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor" />
  </svg>
)

// cloud outline shared by the sky glyphs; the raised variant leaves room for precipitation
const CLOUD = 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'
const CLOUD_HI = 'M18 7.5h-1.1A7 7 0 1 0 9.1 16.3H18a4.4 4.4 0 0 0 0-8.8z'

/** Sky glyph for an Open-Meteo weather code — pairs with skyLabel(). */
export const IconSky = (p: IconProps & { code: number }) => {
  const c = p.code
  const kind =
    c >= 95
      ? 'thunder'
      : (c >= 71 && c <= 77) || c === 85 || c === 86
        ? 'snow'
        : (c >= 51 && c <= 67) || (c >= 80 && c <= 82)
          ? 'rain'
          : c === 45 || c === 48
            ? 'fog'
            : c === 3
              ? 'cloud'
              : c === 2
                ? 'suncloud'
                : 'sun'
  return (
    <svg
      width={S(p)}
      height={S(p)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {kind === 'sun' && (
        <>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
        </>
      )}
      {kind === 'suncloud' && (
        <>
          <circle cx="7.5" cy="7.5" r="3" />
          <path d="M7.5 1.8v1.7M1.8 7.5h1.7M3.5 3.5l1.2 1.2M11.5 3.5l-1.2 1.2" />
          <path d="M18.5 20.5a3.8 3.8 0 0 0 0-7.6h-.95A6 6 0 1 0 11 20.5z" />
        </>
      )}
      {kind === 'cloud' && <path d={CLOUD} />}
      {kind === 'fog' && <path d="M4 8.5h16M4 13h16M7 17.5h10" />}
      {kind === 'rain' && (
        <>
          <path d={CLOUD_HI} />
          <path d="M8.7 19.3l-1 2.4M13 19.3l-1 2.4M17.3 19.3l-1 2.4" />
        </>
      )}
      {kind === 'snow' && (
        <>
          <path d={CLOUD_HI} />
          <path d="M8.5 20.3h.01M12.7 20.3h.01M16.9 20.3h.01" strokeWidth="2.6" />
        </>
      )}
      {kind === 'thunder' && (
        <>
          <path d={CLOUD_HI} />
          <path d="M13.4 16.2l-2.4 4h2.1l-1.2 3.6 3.9-5h-2.2z" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  )
}

export const IconRefresh = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 3v4h-4" />
  </svg>
)

export const IconUndo = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9h11a5 5 0 0 1 0 10h-6" />
    <path d="M8 5 4 9l4 4" />
  </svg>
)

/** Diagonal ruler — the range-and-bearing tool. */
export const IconRuler = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <g transform="rotate(-45 12 12)">
      <rect x="1.6" y="8.5" width="20.8" height="7" rx="1.6" />
      <path d="M6 8.5v3M10 8.5v4M14 8.5v3M18 8.5v4" />
    </g>
  </svg>
)

export const IconEdit = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20l1-4.3L16.4 4.3a1.9 1.9 0 0 1 2.7 0l.6.6a1.9 1.9 0 0 1 0 2.7L8.3 19 4 20Z" />
    <path d="M14.5 6.2l3.3 3.3" />
  </svg>
)

export const IconEditRoute = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 19 11 11l8-4" />
    <circle cx="11" cy="11" r="2.8" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="19" r="1.7" />
    <circle cx="19" cy="7" r="1.7" />
  </svg>
)

/** Helm view — the chart tilted into perspective, the vessel low and looking up-screen. */
export const IconHelm = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M8.2 4.5 H15.8 L20.5 19.5 H3.5 Z" />
    <path d="M12 8.5 L14.2 14.6 L12 13.3 L9.8 14.6 Z" fill="currentColor" stroke="none" />
  </svg>
)

/** Heading-up — the flat chart rotated to the course, the vessel up-screen. */
export const IconHeadingUp = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.5 L17 17 L12 14.2 L7 17 Z" fill="currentColor" stroke="none" />
    <path d="M12 17.5v3" />
  </svg>
)

/** The crew: two people, the second a step behind. */
export const IconCrew = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <circle cx="16.5" cy="9" r="2.6" opacity="0.6" />
    <path d="M17.5 14.2c2.2.5 3.7 2.3 3.7 5.3" opacity="0.6" />
  </svg>
)

/** The log: a notebook, lines on the page. */
export const IconLog = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.5 3.5h11A1.5 1.5 0 0 1 18 5v15.5H7A1.5 1.5 0 0 1 5.5 19Z" />
    <path d="M5.5 17.5A1.5 1.5 0 0 1 7 16h11" opacity="0.6" />
    <path d="M9 8h5.5M9 11.5h4" opacity="0.6" />
  </svg>
)

export const IconSliders = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M3 7h4M11 7h10" />
    <circle cx="9" cy="7" r="2" />
    <path d="M3 12h9.5M17.5 12H21" />
    <circle cx="15.5" cy="12" r="2" />
    <path d="M3 17h2.5M9.5 17H21" />
    <circle cx="7.5" cy="17" r="2" />
  </svg>
)

export const IconTarget = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
  </svg>
)

/** Scent rising off you: the cone's button out hunting. */
export const IconScent = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M7 20c-2-2.5 2-4.5 0-7s2-4.5 0-7" />
    <path d="M12 21c-2-2.5 2-4.5 0-7s2-4.5 0-7" opacity="0.8" />
    <path d="M17 20c-2-2.5 2-4.5 0-7s2-4.5 0-7" opacity="0.6" />
  </svg>
)

/** An ear: a moose heard. */
export const IconEar = (p: IconProps) => (
  <svg width={S(p)} height={S(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 3-2.2 4.2-3.2 5.6-.9 1.3-.8 3-2.1 4.3a3 3 0 0 1-4.7-1.4" />
    <path d="M9.5 9.3a2.5 2.5 0 0 1 5 0c0 1.3-1.2 1.8-1.7 2.7" />
  </svg>
)

/* ---------- the one-screen chrome: hot buttons, menus, chevrons ----------
   These default to 20 px, the inline size for a menu row or a strip line;
   inside a .fab theme.css sizes every svg to 22 px whatever is asked. */

const S20 = (p: IconProps) => p.size ?? 20

/** The heat map: a small grid of cells, hot in the middle. */
export const IconHeat = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="3.5" width="5" height="5" rx="1" fill="currentColor" opacity=".25" stroke="none" />
    <rect x="9.5" y="3.5" width="5" height="5" rx="1" fill="currentColor" opacity=".55" stroke="none" />
    <rect x="15.5" y="3.5" width="5" height="5" rx="1" fill="currentColor" opacity=".3" stroke="none" />
    <rect x="3.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" opacity=".55" stroke="none" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" opacity="1" stroke="none" />
    <rect x="15.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" opacity=".6" stroke="none" />
    <rect x="3.5" y="15.5" width="5" height="5" rx="1" fill="currentColor" opacity=".2" stroke="none" />
    <rect x="9.5" y="15.5" width="5" height="5" rx="1" fill="currentColor" opacity=".5" stroke="none" />
    <rect x="15.5" y="15.5" width="5" height="5" rx="1" fill="currentColor" opacity=".25" stroke="none" />
  </svg>
)

export const IconChevronDown = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

export const IconChevronUp = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 15l6-6 6 6" />
  </svg>
)

export const IconChevronLeft = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 6l-6 6 6 6" />
  </svg>
)

export const IconChevronRight = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

/** ⋯ — the more menu. */
export const IconDots = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
)

/** A wind check: the powder bottle, a puff drifting off its tip. */
export const IconPowder = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="10" width="6.5" height="11" rx="1.6" />
    <path d="M9.5 10V8h3.5v2" />
    <path d="M11.25 8V5" />
    <circle cx="15" cy="4.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="18.2" cy="3" r="1.1" fill="currentColor" stroke="none" opacity=".7" />
    <circle cx="19.8" cy="6.5" r="1.1" fill="currentColor" stroke="none" opacity=".45" />
  </svg>
)

/** Bush thickness: three shrubs, the front one over the two behind. */
export const IconBush = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 18v-3a4 4 0 0 1 7.5-2" opacity=".55" />
    <path d="M21.5 18v-3a4 4 0 0 0-7.5-2" opacity=".55" />
    <path d="M6.5 18v-4.5a5.5 5.5 0 0 1 11 0V18" />
    <path d="M2 18h20" />
  </svg>
)

/** Shooting lanes: a wedge of clear ground opening from where you sit. */
export const IconLanes = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20L5 6M12 20l7-14" />
    <path d="M5 6a15.5 15.5 0 0 1 14 0" />
    <path d="M12 20V6" opacity=".4" strokeDasharray="0.1 3" />
    <circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)

/** Lake depths: nested contours, the deep hole in the middle. */
export const IconDepth = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 12c0-3.6 4.5-6.5 9.5-6.5s9.5 2.9 9.5 6.5-4.5 6.5-9.5 6.5S2.5 15.6 2.5 12z" />
    <path d="M6.5 12.3c0-2.1 2.7-3.8 6-3.8s6 1.7 6 3.8-2.7 3.8-6 3.8-6-1.7-6-3.8z" opacity=".75" />
    <path d="M10.2 12.5c0-.8 1.1-1.5 2.6-1.5s2.6.7 2.6 1.5-1.1 1.5-2.6 1.5-2.6-.7-2.6-1.5z" fill="currentColor" stroke="none" opacity=".6" />
  </svg>
)

/** Radar: the sweep, and an echo. */
export const IconRadar = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" opacity=".45" />
    <path d="M12 3.5A8.5 8.5 0 0 1 18 6L12 12z" fill="currentColor" stroke="none" opacity=".28" />
    <path d="M12 12l6-6" />
    <circle cx="8.3" cy="14.6" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

/** Low power: a battery down to its last bar. */
export const IconBattery = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="7" width="17" height="10" rx="2" />
    <path d="M21.5 10.5v3" />
    <rect x="5" y="9.5" width="4" height="5" rx=".8" fill="currentColor" stroke="none" />
  </svg>
)

/** Settings. */
export const IconGear = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </svg>
)

/** The hunt log: a clock turning back. */
export const IconClock = (p: IconProps) => (
  <svg width={S20(p)} height={S20(p)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4v4.5H8" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)
