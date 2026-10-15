import type { ReactNode } from 'react';

const Svg = ({ children, size = 16, strokeWidth = 2 }: { children: ReactNode; size?: number; strokeWidth?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconPause = ({ size }: { size?: number }) => (
  <Svg size={size} strokeWidth={2.5}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
);

export const IconPlay = ({ size }: { size?: number }) => (
  <Svg size={size} strokeWidth={2.2}>
    <path d="M7 5l12 7-12 7z" />
  </Svg>
);

export const IconCheck = ({ size }: { size?: number }) => (
  <Svg size={size} strokeWidth={2.5}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);

export const IconPlus = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMoon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Svg>
);

export const IconSun = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconMore = ({ size }: { size?: number }) => (
  <Svg size={size} strokeWidth={2.4}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Svg>
);

export const IconMinus = ({ size }: { size?: number }) => (
  <Svg size={size} strokeWidth={2.2}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconClose = ({ size }: { size?: number }) => (
  <Svg size={size} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconPencil = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
  </Svg>
);

export const IconShrink = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </Svg>
);

export const IconExpand = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </Svg>
);

export const ProgressRing = ({ size, stroke, fraction, color, track }: { size: number; stroke: number; fraction: number; color: string; track: string }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, fraction)) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 1s linear' }}
      />
    </svg>
  );
};
