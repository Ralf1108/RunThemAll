// Logos and colours for the demo platforms. The logo files are in img/platforms/
// (sources and licences: THIRD_PARTY_NOTICES.md). The line drawings below are the
// fallback for platforms without a logo.

const svg = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  // Application window with title bar and two panes
  win32: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18M10 8.5V20"/><path d="M6 6.3h.01M8 6.3h.01"/>'),
  // Window of the 3.x era: control box on the left, filled title bar
  win16: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18"/><rect x="3" y="4" width="5" height="5" rx="1" fill="currentColor" stroke="none" opacity=".35"/><path d="M5 6.5h1"/><path d="M7 13h10M7 16h6"/>'),
  // Monitor with a command prompt
  dos: svg('<rect x="2.5" y="3.5" width="19" height="13" rx="1.5"/><path d="M9 20.5h6M12 16.5v4"/><path d="M6 8l2.5 2L6 12"/><path d="M10.5 12h4"/>'),
  // Home computer: keyboard in one case
  c64: svg('<path d="M2.5 16.5L4.5 9h15l2 7.5z"/><path d="M2.5 16.5v2h19v-2"/><path d="M7 12h.01M9.5 12h.01M12 12h.01M14.5 12h.01M17 12h.01M8 14.3h8"/>'),
  // Rectangular game pad
  nes: svg('<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 10v4M5 12h4"/><circle cx="15" cy="13" r="1.2"/><circle cx="18" cy="11" r="1.2"/>'),
  // Handheld console
  gameboy: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><rect x="8" y="4.5" width="8" height="6.5" rx=".8"/><path d="M10 14v3M8.5 15.5h3"/><circle cx="15.2" cy="16.2" r=".9"/><circle cx="13.8" cy="18.3" r=".9"/>'),
  // Boot CD
  os: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>'),
  // Anything else: chip
  other: svg('<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>'),
};

const PLATFORMS = [
  { test: /windows\s*3|16\s*bit/i, icon: 'win16', logo: 'windows3.svg', color: '#14a38b' },
  { test: /windows/i, icon: 'win32', logo: 'windows.svg', color: '#3b82f6' },
  { test: /\bdos\b/i, icon: 'dos', logo: 'dos.svg', color: '#d49a12' },
  { test: /commodore|c64|amiga/i, icon: 'c64', logo: 'commodore.svg', color: '#8b5cf6' },
  { test: /game\s*boy/i, icon: 'gameboy', logo: 'gameboy.svg', color: '#22a35a' },
  { test: /nes|nintendo|sega|konsole/i, icon: 'nes', logo: 'nes.svg', color: '#e5484d' },
  { test: /betriebssystem|linux|\bos\b/i, icon: 'os', logo: 'cd.svg', color: '#f07b1e' },
];

/**
 * Logo, fallback icon (SVG markup) and colour for a platform name from demos.json.
 * @param {string} platform
 * @returns {{ logo: string|null, icon: string, color: string }}
 */
export function platformStyle(platform) {
  const match = PLATFORMS.find((p) => p.test.test(platform));
  return {
    logo: match?.logo ? `img/platforms/${match.logo}` : null,
    icon: ICONS[match?.icon ?? 'other'],
    color: match?.color ?? '#7d8697',
  };
}
