import { useId, type ReactNode, type SVGProps } from "react";

/**
 * The app's icon set: inline stroke icons on a 24×24 grid.
 *
 * Hand-rolled rather than pulled from a package so the bundle stays at the
 * handful of glyphs actually used, and so every icon inherits `currentColor`
 * and the same stroke weight — the thing that makes a UI read as one system.
 */
interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function Glyph({
  size = 20,
  children,
  strokeWidth = 1.75,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconChat = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  </Glyph>
);

export const IconLink = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </Glyph>
);

export const IconInbox = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Glyph>
);

export const IconSettings = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </Glyph>
);

export const IconSearch = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Glyph>
);

export const IconCompose = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
    <path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 14.6l-4 1 1-4z" />
  </Glyph>
);

export const IconPhone = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </Glyph>
);

export const IconPhoneOff = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91" />
    <path d="m2 2 20 20" />
  </Glyph>
);

export const IconVideo = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m22 8-6 4 6 4z" />
    <rect x="2" y="6" width="14" height="12" rx="2.5" />
  </Glyph>
);

export const IconVideoOff = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M16 10.5V8a2 2 0 0 0-2-2H6.5" />
    <path d="M2 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8.5" />
    <path d="m16 13 6 4V7l-2.4 1.6" />
    <path d="m2 2 20 20" />
  </Glyph>
);

export const IconMic = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </Glyph>
);

export const IconMicOff = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
    <path d="M15 9.34V5a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2" />
    <path d="M19 10v2a7 7 0 0 1-.11 1.23" />
    <path d="M12 19v3" />
    <path d="m2 2 20 20" />
  </Glyph>
);

export const IconSend = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </Glyph>
);

export const IconX = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Glyph>
);

export const IconCheck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Glyph>
);

export const IconCheckCheck = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M18 6 7 17l-5-5" />
    <path d="m22 10-7.5 7.5L13 16" />
  </Glyph>
);

export const IconMore = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
  </Glyph>
);

export const IconArrowLeft = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Glyph>
);

export const IconChevronDown = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
);

export const IconChevronRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m9 18 6-6-6-6" />
  </Glyph>
);

export const IconCopy = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2.5" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Glyph>
);

export const IconEye = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Glyph>
);

export const IconEyeOff = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.4 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <path d="M6.61 6.61A18.15 18.15 0 0 0 2 12s3.6 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
    <path d="m2 2 20 20" />
  </Glyph>
);

export const IconLogout = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Glyph>
);

export const IconSun = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Glyph>
);

export const IconMoon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Glyph>
);

export const IconMonitor = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2" y="3" width="20" height="14" rx="2.5" />
    <path d="M8 21h8M12 17v4" />
  </Glyph>
);

export const IconUsers = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Glyph>
);

export const IconUserPlus = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </Glyph>
);

export const IconTrash = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 6h18" />
    <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
    <path d="M18.5 6 17.6 19.2A2 2 0 0 1 15.6 21H8.4a2 2 0 0 1-2-1.8L5.5 6" />
  </Glyph>
);

export const IconPencil = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Glyph>
);

export const IconClock = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Glyph>
);

export const IconHistory = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.05 11a9 9 0 1 1 .5 4" />
    <path d="M3 4v5h5" />
    <path d="M12 8v4.5l3 1.8" />
  </Glyph>
);

export const IconSparkles = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Glyph>
);

export const IconShield = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 22s8-4 8-10V5.5l-8-3-8 3V12c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Glyph>
);

export const IconInfo = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </Glyph>
);

export const IconAlert = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Glyph>
);

export const IconPlus = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);

export const IconArrowUpRight = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M7 17 17 7" />
    <path d="M7 7h10v10" />
  </Glyph>
);

export const IconArrowDownLeft = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M17 7 7 17" />
    <path d="M17 17H7V7" />
  </Glyph>
);

export const IconLoader = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M21 12a9 9 0 1 1-6.2-8.56" />
  </Glyph>
);

export const IconHash = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </Glyph>
);

export const IconLogo = ({ size = 28, ...props }: IconProps) => {
  // Every instance carries its own gradient id: two logos can be on one page
  // (brand panel + form), and one of them may sit behind `display:none`.
  // A shared id would then resolve to that hidden paint server and the mark
  // would come out blank instead of brand-colored.
  const gradientId = `connect-brand-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <path
        d="M11 12.5a5 5 0 0 1 9.6-1.4"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M21 19.5a5 5 0 0 1-9.6 1.4"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M13 19h6"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.75"
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
};
