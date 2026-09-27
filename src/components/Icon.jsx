const PATHS = {
  dashboard: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z',
  building: 'M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M4 21h16M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M15 21v-4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v4',
  matrix: 'M3 3h7v7H3V3zm0 11h7v7H3v-7zM14 3h7v7h-7V3zm0 11h7v7h-7v-7z',
  upload: 'M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  audit: 'M9 12h6M9 16h6M9 8h6M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 9v4m0 4h.01M10.29 3.86l-8.18 14.14A1 1 0 0 0 3 19.5h18a1 1 0 0 0 .89-1.5L13.71 3.86a1 1 0 0 0-1.72 0z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.35-4.35',
  file: 'M14 3v5a1 1 0 0 0 1 1h5M6 3h8l6 6v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
  play: 'M8 5v14l11-7z',
  clock: 'M12 8v4l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  refresh: 'M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0 1 14.7-3.7M20 15a8 8 0 0 1-14.7 3.7',
  filter: 'M4 5h16M7 12h10M11 19h2',
  external: 'M14 5h5v5M9 15L19 5M6 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1',
  layers: 'M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5',
  question: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1 1.2-1 1.7M12 17h.01',
  lock: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  cloud: 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17.4 8.5 4 4 0 0 1 17 18H7z',
  sparkle: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  smartphone: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
}

export default function Icon({ name, size = 16, strokeWidth = 2, className = '' }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  )
}
