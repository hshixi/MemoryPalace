import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </Svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 11.5a7.8 7.8 0 0 1-8 7.7 8.6 8.6 0 0 1-3.2-.6L4 20.5l1.4-4.1a7.5 7.5 0 0 1-1-3.7 7.8 7.8 0 0 1 8-7.7 7.8 7.8 0 0 1 8.1 6.5Z" />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m15.7 15.7 4.1 4.1" />
    </Svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2.2h8A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" />
    </Svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M13.5 3v5.5H19M8.5 13h7M8.5 16.5h5" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 4.6-4.4a1.6 1.6 0 0 1 2.2 0l3.1 3 1.8-1.7a1.6 1.6 0 0 1 2.2 0L21 17" />
    </Svg>
  );
}

export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11M15 9v11M3 14.5h18" />
    </Svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5c.5 4.3 2.7 6.5 7 7-4.3.5-6.5 2.7-7 7-.5-4.3-2.7-6.5-7-7 4.3-.5 6.5-2.7 7-7Z" />
      <path d="M19 17.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z" />
    </Svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 4.8 6v5.4c0 4.4 3 8 7.2 9.6 4.2-1.6 7.2-5.2 7.2-9.6V6Z" />
      <path d="m9 12 2.1 2.1L15.5 10" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <circle cx="12" cy="15" r="1.2" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11.5a8 8 0 0 0-14-4.7L4 9" />
      <path d="M4 4.5V9h4.5" />
      <path d="M4 12.5a8 8 0 0 0 14 4.7L20 15" />
      <path d="M20 19.5V15h-4.5" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 21 20H3Z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 13h9.4l.8-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h15M14 6.5 20.5 12 14 17.5" />
    </Svg>
  );
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconBrain(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.2a3 3 0 0 0-5.7-1.3A2.8 2.8 0 0 0 4 8.6a3 3 0 0 0 .6 4.6A3 3 0 0 0 8 18.4a3 3 0 0 0 4-1.1" />
      <path d="M12 5.2a3 3 0 0 1 5.7-1.3A2.8 2.8 0 0 1 20 8.6a3 3 0 0 1-.6 4.6 3 3 0 0 1-3.4 5.2 3 3 0 0 1-4-1.1" />
      <path d="M12 5.2v12.1" />
    </Svg>
  );
}

export function IconBulb(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9c.6.4 1 1 1.1 1.7l.1.4h4.4l.1-.4c.1-.7.5-1.3 1.1-1.7A6 6 0 0 0 12 3Z" />
    </Svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h3.5l2.2-6 4.2 12 2.4-6H21" />
    </Svg>
  );
}

export function IconFlask(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3h6M10 3v5.2L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 8.2V3" />
      <path d="M7.5 15h9" />
    </Svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m21 3-7.2 18-3.4-7.4L3 10.2Z" />
      <path d="M10.4 13.6 21 3" />
    </Svg>
  );
}

export function IconPaperclip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7-7L13 4.5a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6" />
    </Svg>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconZoomIn(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m15.7 15.7 4.1 4.1M8.2 10.8h5.2M10.8 8.2v5.2" />
    </Svg>
  );
}

export function IconZoomOut(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m15.7 15.7 4.1 4.1M8.2 10.8h5.2" />
    </Svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 3.5h-5v5M15.5 3.5h5v5M8.5 20.5h-5v-5M15.5 20.5h5v-5" />
    </Svg>
  );
}

export function IconMap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 5.8 5.5-2.3 7 2.7 5.5-2.4v14.4l-5.5 2.3-7-2.6L3 20.2Z" />
      <path d="M8.5 3.5v14.4M15.5 6.2v14.4" />
    </Svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r=".9" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r=".9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.5v13l10-6.5Z" />
    </Svg>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 7.5 4 12l5 4.5" />
      <path d="M4.5 12H14a5.5 5.5 0 0 1 0 11h-2" />
    </Svg>
  );
}
