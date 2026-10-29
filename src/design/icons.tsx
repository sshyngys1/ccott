// Owner: Designer. "Meniscus" icon set — original glyphs drawn on a 20×20 grid, 1.75px round stroke.
// API matches ModuleIconProps ({ size, className }) so module tabs can use them directly.
// Need more glyphs? Draw them here in the same style, or (decision in design-spec §12) use lucide-react with
// size={20} strokeWidth={2.1} — on a 24-unit grid that renders as the same 1.75px.
import type { ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  className?: string;
  /** Accessible name. Omit for decorative icons (aria-hidden). */
  title?: string;
}

function makeIcon(name: string, body: ReactNode) {
  function Icon({ size = 20, className, title, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        className={className ? `ig-icon ${className}` : "ig-icon"}
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        focusable="false"
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

// ── Tabs ──
export const IconHome = makeIcon(
  "Home",
  <>
    <path d="M3.5 8.6 10 3.5l6.5 5.1V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15Z" />
    <path d="M8 16.5v-4h4v4" />
  </>,
);
export const IconClipboard = makeIcon(
  "Clipboard",
  <>
    <rect x="4.25" y="4" width="11.5" height="13" rx="2.25" />
    <path d="M7.5 4V3.25c0-.4.35-.75.75-.75h3.5c.4 0 .75.35.75.75V4" />
    <path d="M7.5 9h5M7.5 12.5h3" />
  </>,
);
export const IconText = makeIcon(
  "Text",
  <>
    <path d="M4 5.5V4h9v1.5M8.5 4v12M6.75 16h3.5" />
    <path d="M12.5 10.5h4M14.5 10.5V16" />
  </>,
);
export const IconNote = makeIcon(
  "Note",
  <>
    <path d="M5.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6.5l-5 5H5.5A1.5 1.5 0 0 1 4 15V5a1.5 1.5 0 0 1 1.5-1.5Z" />
    <path d="M16 11.5h-3.5a1.5 1.5 0 0 0-1.5 1.5v3.5" />
    <path d="M7 7.5h6M7 10.5h3" />
  </>,
);
export const IconSettings = makeIcon(
  "Settings",
  <>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.75v2M10 15.25v2M17.25 10h-2M4.75 10h-2M15.13 4.87l-1.42 1.42M6.29 13.71l-1.42 1.42M15.13 15.13l-1.42-1.42M6.29 6.29 4.87 4.87" />
  </>,
);

// ── Media ──
export const IconPlay = makeIcon("Play", <path d="M6.5 4.6v10.8c0 .6.65.95 1.15.62l8.1-5.4a.75.75 0 0 0 0-1.24l-8.1-5.4A.75.75 0 0 0 6.5 4.6Z" fill="currentColor" />);
export const IconPause = makeIcon(
  "Pause",
  <>
    <rect x="5.25" y="4" width="3" height="12" rx="1" fill="currentColor" />
    <rect x="11.75" y="4" width="3" height="12" rx="1" fill="currentColor" />
  </>,
);
export const IconNext = makeIcon(
  "Next",
  <>
    <path d="M4 5.6v8.8c0 .55.6.88 1.07.6l6.8-4.4a.7.7 0 0 0 0-1.2l-6.8-4.4A.7.7 0 0 0 4 5.6Z" fill="currentColor" />
    <path d="M15.25 5v10" />
  </>,
);
export const IconPrevious = makeIcon(
  "Previous",
  <>
    <path d="M16 5.6v8.8c0 .55-.6.88-1.07.6l-6.8-4.4a.7.7 0 0 1 0-1.2l6.8-4.4A.7.7 0 0 1 16 5.6Z" fill="currentColor" />
    <path d="M4.75 5v10" />
  </>,
);
export const IconVolume = makeIcon(
  "Volume",
  <>
    <path d="M3.5 8v4h2.75L10 15V5L6.25 8Z" />
    <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.25 5.5a6.4 6.4 0 0 1 0 9" />
  </>,
);
export const IconSpeaker = makeIcon(
  "Speaker",
  <>
    <rect x="5" y="2.75" width="10" height="14.5" rx="2.25" />
    <circle cx="10" cy="11.75" r="2.5" />
    <path d="M10 6.25h.01" />
  </>,
);

// ── Quick tools ──
export const IconRegion = makeIcon(
  "Region",
  <>
    <path d="M3.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2M13 3.5h2A1.5 1.5 0 0 1 16.5 5v2M16.5 13v2a1.5 1.5 0 0 1-1.5 1.5h-2M7 16.5H5A1.5 1.5 0 0 1 3.5 15v-2" />
    <rect x="7" y="7" width="6" height="6" rx="1" strokeDasharray="2 2" />
  </>,
);
export const IconScreen = makeIcon(
  "Screen",
  <>
    <rect x="2.75" y="4" width="14.5" height="9.5" rx="1.75" />
    <path d="M7.5 16.5h5M10 13.5v3" />
  </>,
);
export const IconScanText = makeIcon(
  "ScanText",
  <>
    <path d="M3.5 6.5V5A1.5 1.5 0 0 1 5 3.5h1.5M13.5 3.5H15A1.5 1.5 0 0 1 16.5 5v1.5M16.5 13.5V15a1.5 1.5 0 0 1-1.5 1.5h-1.5M6.5 16.5H5A1.5 1.5 0 0 1 3.5 15v-1.5" />
    <path d="M7 7.5h6M10 7.5v5.5" />
  </>,
);
export const IconQr = makeIcon(
  "Qr",
  <>
    <rect x="3.5" y="3.5" width="5" height="5" rx="1" />
    <rect x="11.5" y="3.5" width="5" height="5" rx="1" />
    <rect x="3.5" y="11.5" width="5" height="5" rx="1" />
    <path d="M11.5 11.5h2v2M16.5 11.5v.01M11.5 16.5h.01M14.5 16.5h2v-2" />
  </>,
);
export const IconPipette = makeIcon(
  "Pipette",
  <>
    <path d="m11.25 5.25 3.5 3.5" />
    <path d="M13.9 2.9a1.8 1.8 0 0 1 2.55 2.55l-1.7 1.7-2.55-2.55Z" />
    <path d="m12.6 7.6-6.85 6.85-2.5.8.8-2.5L10.9 5.9" />
  </>,
);
export const IconCleanText = makeIcon(
  "CleanText",
  <>
    <path d="M3.5 5h9M3.5 9h6M3.5 13h4" />
    <path d="m14.5 9.5.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8Z" />
  </>,
);
export const IconRecord = makeIcon(
  "Record",
  <>
    <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="2.5" />
    <circle cx="10" cy="10" r="2.25" fill="currentColor" />
  </>,
);
export const IconCommand = makeIcon(
  "Command",
  <>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" />
    <path d="m6.25 8 2.25 2-2.25 2M10.5 12.5h3.25" />
  </>,
);
export const IconMore = makeIcon(
  "More",
  <>
    <circle cx="5.5" cy="10" r=".6" fill="currentColor" />
    <circle cx="10" cy="10" r=".6" fill="currentColor" />
    <circle cx="14.5" cy="10" r=".6" fill="currentColor" />
  </>,
);

// ── Dock & misc ──
export const IconFolder = makeIcon(
  "Folder",
  <path d="M2.75 6.25A1.5 1.5 0 0 1 4.25 4.75h3.1l1.6 1.75h6.8a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5Z" />,
);
export const IconTerminal = makeIcon(
  "Terminal",
  <>
    <path d="m4.5 6 3.5 4-3.5 4" />
    <path d="M10.5 14.5h5" />
  </>,
);
export const IconCode = makeIcon("Code", <path d="m7 5.5-4.25 4.5L7 14.5M13 5.5l4.25 4.5L13 14.5M11.25 4l-2.5 12" />);
export const IconGlobe = makeIcon(
  "Globe",
  <>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M2.75 10h14.5M10 2.75c2 2 3 4.4 3 7.25s-1 5.25-3 7.25c-2-2-3-4.4-3-7.25s1-5.25 3-7.25Z" />
  </>,
);
export const IconPlus = makeIcon("Plus", <path d="M10 4.5v11M4.5 10h11" />);
export const IconCheck = makeIcon("Check", <path d="m4.75 10.25 3.25 3.25 7.25-7.5" />);
export const IconChevronDown = makeIcon("ChevronDown", <path d="m5.5 8 4.5 4.5L14.5 8" />);
export const IconCloud = makeIcon(
  "Cloud",
  <path d="M6 15.5h8.25a3.25 3.25 0 0 0 .4-6.48A4.75 4.75 0 0 0 5.5 8.1 3.7 3.7 0 0 0 6 15.5Z" />,
);
export const IconSun = makeIcon(
  "Sun",
  <>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.75v1.5M10 15.75v1.5M17.25 10h-1.5M4.25 10h-1.5M15.13 4.87l-1.06 1.06M5.93 14.07l-1.06 1.06M15.13 15.13l-1.06-1.06M5.93 5.93 4.87 4.87" />
  </>,
);
export const IconMoon = makeIcon("Moon", <path d="M15.75 12.4A6.75 6.75 0 0 1 7.6 4.25a6.75 6.75 0 1 0 8.15 8.15Z" />);
export const IconCollapse = makeIcon("Collapse", <path d="m5.5 12 4.5-4.5 4.5 4.5" />);

// ── Wave 2: clipboard ──
export const IconSearch = makeIcon(
  "Search",
  <>
    <circle cx="8.75" cy="8.75" r="5.25" />
    <path d="m12.6 12.6 3.9 3.9" />
  </>,
);
/** Pin: a push-pin seen from the side. Pass className="…" + aria-pressed on the button for the "pinned" look. */
export const IconPin = makeIcon(
  "Pin",
  <>
    <path d="M7.25 3.5h5.5M8 3.5v4.25L5.75 10.5v1h8.5v-1L12 7.75V3.5" />
    <path d="M10 11.5v5" />
  </>,
);
export const IconTrash = makeIcon(
  "Trash",
  <>
    <path d="M3.75 5.5h12.5M8 5.5V4.25c0-.42.33-.75.75-.75h2.5c.42 0 .75.33.75.75V5.5" />
    <path d="m5.25 5.5.7 9.85c.06.8.72 1.4 1.5 1.4h5.1c.78 0 1.44-.6 1.5-1.4l.7-9.85M8.5 8.75v4.75M11.5 8.75v4.75" />
  </>,
);
export const IconLink = makeIcon(
  "Link",
  <>
    <path d="M8.6 11.4a3 3 0 0 0 4.24 0l2.47-2.47a3 3 0 0 0-4.24-4.24l-.9.9" />
    <path d="M11.4 8.6a3 3 0 0 0-4.24 0L4.69 11.07a3 3 0 0 0 4.24 4.24l.9-.9" />
  </>,
);
export const IconImage = makeIcon(
  "Image",
  <>
    <rect x="3" y="3.75" width="14" height="12.5" rx="2.25" />
    <circle cx="7.5" cy="8" r="1.25" />
    <path d="m3.25 14 4-3.75 3 2.75 2.5-2.25L17 14.5" />
  </>,
);
export const IconFile = makeIcon(
  "File",
  <>
    <path d="M11.25 2.75H6.5A1.75 1.75 0 0 0 4.75 4.5v11a1.75 1.75 0 0 0 1.75 1.75h7a1.75 1.75 0 0 0 1.75-1.75V6.75Z" />
    <path d="M11.25 2.75v3.5c0 .28.22.5.5.5h3.5" />
  </>,
);
export const IconCopy = makeIcon(
  "Copy",
  <>
    <rect x="7" y="7" width="9.75" height="9.75" rx="2" />
    <path d="M13 7V5.25a2 2 0 0 0-2-2H5.25a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" />
  </>,
);
export const IconClose = makeIcon("Close", <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />);
export const IconWarning = makeIcon(
  "Warning",
  <>
    <path d="M8.7 3.7a1.5 1.5 0 0 1 2.6 0l5.95 10.55a1.5 1.5 0 0 1-1.3 2.25H4.05a1.5 1.5 0 0 1-1.3-2.25Z" />
    <path d="M10 8v3.25M10 13.75v.01" />
  </>,
);

// ── Wave 2: text tools ──
export const IconSwap = makeIcon(
  "Swap",
  <>
    <path d="M4 7.25h11.5M12.75 4.5l2.75 2.75L12.75 10" />
    <path d="M16 12.75H4.5M7.25 10 4.5 12.75l2.75 2.75" />
  </>,
);
export const IconUndo = makeIcon(
  "Undo",
  <>
    <path d="M7 5.25 3.75 8.5 7 11.75" />
    <path d="M4 8.5h7.5a4.25 4.25 0 0 1 0 8.5H9" />
  </>,
);
export const IconBraces = makeIcon(
  "Braces",
  <path d="M7 3.75H6.25a1.5 1.5 0 0 0-1.5 1.5v2.5L3.5 10l1.25 2.25v2.5a1.5 1.5 0 0 0 1.5 1.5H7M13 3.75h.75a1.5 1.5 0 0 1 1.5 1.5v2.5L16.5 10l-1.25 2.25v2.5a1.5 1.5 0 0 1-1.5 1.5H13" />,
);

// ── Wave 2: notes editor & timer ──
export const IconBold = makeIcon("Bold", <path d="M6 4h4.75a3 3 0 0 1 0 6H6Zm0 6h5.5a3 3 0 0 1 0 6H6Z" strokeWidth={2} />);
export const IconItalic = makeIcon("Italic", <path d="M8.5 4h6M5.5 16h6M11.75 4l-3.5 12" />);
export const IconListBullet = makeIcon(
  "ListBullet",
  <>
    <path d="M8 5.5h8.5M8 10h8.5M8 14.5h8.5" />
    <circle cx="4.25" cy="5.5" r=".6" fill="currentColor" />
    <circle cx="4.25" cy="10" r=".6" fill="currentColor" />
    <circle cx="4.25" cy="14.5" r=".6" fill="currentColor" />
  </>,
);
export const IconChecklist = makeIcon(
  "Checklist",
  <>
    <rect x="3" y="3.5" width="5" height="5" rx="1.25" />
    <path d="m4.4 6 1 1 1.4-1.6" />
    <rect x="3" y="11.5" width="5" height="5" rx="1.25" />
    <path d="M10.75 6h6M10.75 14h6" />
  </>,
);
export const IconTimer = makeIcon(
  "Timer",
  <>
    <circle cx="10" cy="11" r="6" />
    <path d="M8.25 2.75h3.5M10 8v3l2 1.5M15 5.5l1 -1" />
  </>,
);
export const IconReset = makeIcon(
  "Reset",
  <>
    <path d="M4.25 10a5.75 5.75 0 1 0 1.7-4.07" />
    <path d="M5.75 3v3.25H9" />
  </>,
);
export const IconMusic = makeIcon(
  "Music",
  <>
    <path d="M7.75 14.25V5l8-1.75v9.25" />
    <circle cx="5.75" cy="14.25" r="2" />
    <circle cx="13.75" cy="12.5" r="2" />
  </>,
);
export const IconVolumeMute = makeIcon(
  "VolumeMute",
  <>
    <path d="M3.5 8v4h2.75L10 15V5L6.25 8Z" />
    <path d="m13 8 4 4M17 8l-4 4" />
  </>,
);

// ── Wave 2: settings ──
export const IconBack = makeIcon("Back", <path d="M12 4.75 6.75 10 12 15.25" />);
export const IconChevronRight = makeIcon("ChevronRight", <path d="M8 4.75 13.25 10 8 15.25" />);
/** Theme «Авто»: half-filled disc. */
export const IconThemeAuto = makeIcon(
  "ThemeAuto",
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
  </>,
);
export const IconPower = makeIcon(
  "Power",
  <>
    <path d="M10 3v6.5" />
    <path d="M6.25 5.6a6 6 0 1 0 7.5 0" />
  </>,
);
export const IconBellOff = makeIcon(
  "BellOff",
  <>
    <path d="M14.75 11.5V8.75a4.75 4.75 0 0 0-7.6-3.8M5.25 8.5v3l-1.5 2.25h10.5" />
    <path d="M8.25 16.25a1.9 1.9 0 0 0 3.5 0M3.25 3.25l13.5 13.5" />
  </>,
);
export const IconFullscreen = makeIcon(
  "Fullscreen",
  <path d="M3.5 7.25V4.5a1 1 0 0 1 1-1h2.75M12.75 3.5h2.75a1 1 0 0 1 1 1v2.75M16.5 12.75v2.75a1 1 0 0 1-1 1h-2.75M7.25 16.5H4.5a1 1 0 0 1-1-1v-2.75" />,
);
export const IconClock = makeIcon(
  "Clock",
  <>
    <circle cx="10" cy="10" r="6.75" />
    <path d="M10 6.25V10l2.5 1.75" />
  </>,
);


// ── v0.2.2: battery & power ──
export const IconBattery = makeIcon(
  "Battery",
  <>
    <rect x="2.5" y="6" width="13" height="8" rx="2" />
    <path d="M17 8.5v3" />
  </>,
);
export const IconBatteryCharging = makeIcon(
  "BatteryCharging",
  <>
    <rect x="2.5" y="6" width="13" height="8" rx="2" />
    <path d="M17 8.5v3" />
    <path d="m9.5 7.5-2 3h2.5l-1 2.5" />
  </>,
);
export const IconBatterySaver = makeIcon(
  "BatterySaver",
  <>
    <rect x="2.5" y="6" width="13" height="8" rx="2" />
    <path d="M17 8.5v3" />
    <path d="M9 8.25v3.5M7.25 10h3.5" />
  </>,
);