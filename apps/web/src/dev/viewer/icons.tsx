/** The viewer's controls, drawn once in one stroke: 16px box, 1.6 stroke, round joins. */
import React from "react";

type IconName = "play" | "pause" | "back" | "forward" | "repeat" | "search" | "camera" | "panelLeft" | "panelRight" | "close";

const PATHS: Record<IconName, React.ReactNode> = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: <><path d="M5.5 3.5v9" /><path d="M10.5 3.5v9" /></>,
  back: <><path d="M4 3.5v9" /><path d="M12.5 3.5 6.5 8l6 4.5z" fill="currentColor" stroke="none" /></>,
  forward: <><path d="M12 3.5v9" /><path d="M3.5 3.5 9.5 8l-6 4.5z" fill="currentColor" stroke="none" /></>,
  repeat: <><path d="M3 7.5V6a2 2 0 0 1 2-2h7.5" /><path d="m10.5 2 2 2-2 2" /><path d="M13 8.5V10a2 2 0 0 1-2 2H3.5" /><path d="m5.5 14-2-2 2-2" /></>,
  search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3.25 3.25" /></>,
  camera: <><path d="M2.5 5.5h2.5l1.25-1.75h3.5L11 5.5h2.5v7h-11z" /><circle cx="8" cy="9" r="2.25" /></>,
  panelLeft: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M6.5 3v10" /></>,
  panelRight: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M9.5 3v10" /></>,
  close: <><path d="m4 4 8 8" /><path d="m12 4-8 8" /></>,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
