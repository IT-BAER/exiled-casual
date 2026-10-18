/** 16px line icons on a 16-unit grid, 1.5 stroke, currentColor (releash's icon vocabulary). */
const PATHS = {
  dashboard: <><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></>,
  live: <><circle cx="8" cy="8" r="1.8" /><path d="M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10" /></>,
  sessions: <><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></>,
  retention: <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v2.5h-2.5" /></>,
  atlas: <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" /></>,
  gameplay: <><path d="M3 13 11.5 4.5M10 3h3v3M5 9.5l1.5 1.5M2.5 11.5l2 2" /></>,
  performance: <><path d="M2.5 11a5.5 5.5 0 1 1 11 0" /><path d="M8 11 10.5 6.5" /></>,
  errors: <><path d="M8 2 14.5 13.5h-13Z" /><path d="M8 6.5v3M8 11.5v.01" /></>,
  health: <><path d="M1.5 8.5h3l1.5-4 3 8 1.5-4h4" /></>,
  logs: <><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" /></>,
  traffic: <><path d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5" /></>,
  builds: <><path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8Z" /><path d="M2.5 4.8 8 7.8l5.5-3M8 7.8v6.4" /></>,
  liveops: <><path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h7M12.5 11.5h1" /><circle cx="8" cy="4.5" r="1.5" /><circle cx="11" cy="11.5" r="1.5" /></>,
  audit: <><path d="M4 2h6l2.5 2.5V14H4Z" /><path d="M6.5 7h4M6.5 9.5h4M6.5 12h2.5" /></>,
  overview: <><path d="M8 2 13.5 5v6L8 14 2.5 11V5Z" /><circle cx="8" cy="8" r="2" /></>,
  exiles: <><circle cx="6" cy="5.5" r="2.5" /><path d="M1.8 13.5c.6-2.4 2.2-3.6 4.2-3.6s3.6 1.2 4.2 3.6M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 10.2c1.1.5 1.9 1.6 2.2 3.3" /></>,
  game: <><path d="M8 1.8 13 3.8v4c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4v-4Z" /><path d="M8 5v6M5.5 7.5h5" /></>,
  operations: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" /></>,
  chevron: <path d="m6 4 4 4-4 4" />,
  signout: <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 5l3 3-3 3M13.5 8H6" />,
  clock: <><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.5" /></>,
  peak: <path d="M2 13 6 6l3 4 2-3 3 6" />,
  hourglass: <path d="M4 2h8M4 14h8M5 2v2.5L8 8l3-3.5V2M5 14v-2.5L8 8l3 3.5V14" />,
  trophy: <><path d="M5 2.5h6v3a3 3 0 0 1-6 0Z" /><path d="M5 3.5H3a2 2 0 0 0 2 3M11 3.5h2a2 2 0 0 1-2 3M8 8.5v3M5.5 13.5h5" /></>,
  globe: <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" /></>,
  chart: <path d="M2.5 13.5h11M3.5 10l3-3 2.5 2 4-4.5" />,
  refresh: <><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v2.5h-2.5" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>,
  loot: <><path d="M3 6h10v7.5H3Z" /><path d="M3 6 4.5 3h7L13 6M8 6v7.5" /></>,
  skull: <><path d="M3.5 8a4.5 4.5 0 1 1 9 0v2.5h-2v2.5h-5v-2.5h-2Z" /><circle cx="6.3" cy="8" r="1" /><circle cx="9.7" cy="8" r="1" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function IconBox({ name }: { name: IconName }) {
  return (
    <span className="icon-box" aria-hidden="true">
      <Icon name={name} />
    </span>
  );
}

/** The console's wordmark glyph: the game's own app icon, the favicon's art. */
export function Mark() {
  return <img className="mark" src="icon-192.png" alt="" width={28} height={28} />;
}
