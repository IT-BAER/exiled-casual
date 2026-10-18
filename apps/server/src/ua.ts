/** A small user-agent reader: only browser family + major, OS and a mobile flag are kept. */
export interface ParsedUa { family: string; browser: string; os: string; mobile: boolean }

const BROWSERS: [string, RegExp][] = [
  ["Samsung", /SamsungBrowser\/(\d+)/],
  ["Opera", /(?:OPR|Opera)\/(\d+)/],
  ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//],
];

function osOf(ua: string): string {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/Linux|X11/.test(ua)) return "Linux";
  return "other";
}

export function parseUserAgent(ua: string): ParsedUa {
  let family = "other", browser = "other";
  for (const [name, re] of BROWSERS) {
    const m = re.exec(ua);
    if (m) { family = name; browser = `${name} ${m[1]}`; break; }
  }
  return { family, browser, os: osOf(ua), mobile: /Mobi|iPhone|iPod/.test(ua) };
}
