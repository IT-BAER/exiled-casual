import React from "react";
import type { TimelineState } from "../../render/viewer-scene";
import { Icon } from "./icons";

export const SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2] as const;

export interface TimelineProps {
  state: TimelineState | null;
  repeat: boolean;
  onPause: (paused: boolean) => void;
  onSeek: (fraction: number) => void;
  onStep: (frames: number) => void;
  onSpeed: (speed: number) => void;
  onRepeat: (on: boolean) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onLeft: () => void;
  onRight: () => void;
}

/** The shown clip's clock: transport, scrubber, frame counter, playback rate and repeat. */
export function Timeline(p: TimelineProps): React.ReactElement {
  const s = p.state;
  const span = s ? Math.max(1e-6, s.to - s.from) : 1;
  const frac = s ? Math.min(1, Math.max(0, (s.frame - s.from) / span)) : 0;
  const paused = s?.paused ?? false;
  return (
    <div className="av-panel av-bottom" role="toolbar" aria-label="Timeline">
      <button type="button" className="av-icon" aria-pressed={p.leftOpen} onClick={p.onLeft}
        title="Subjects ([)" aria-label="Show subjects"><Icon name="panelLeft" /></button>
      <span className="av-sep" />
      <button type="button" className="av-icon" disabled={!s} onClick={() => p.onStep(-1)}
        title="One frame back (,)" aria-label="One frame back"><Icon name="back" /></button>
      <button type="button" className="av-icon av-primary" disabled={!s} onClick={() => p.onPause(!paused)}
        title={paused ? "Play (Space)" : "Pause (Space)"} aria-label={paused ? "Play" : "Pause"}>
        <Icon name={paused ? "play" : "pause"} />
      </button>
      <button type="button" className="av-icon" disabled={!s} onClick={() => p.onStep(1)}
        title="One frame on (.)" aria-label="One frame on"><Icon name="forward" /></button>
      <span className="av-clip" title={s?.label}>{s ? s.label.replace(/([a-z])([A-Z])/g, "$1 $2") : "No clip"}</span>
      <input className="av-range" type="range" min={0} max={1000} step={1} disabled={!s}
        value={Math.round(frac * 1000)} aria-label="Scrub"
        style={{ "--p": `${frac * 100}%` } as React.CSSProperties}
        onChange={(e) => p.onSeek(Number(e.target.value) / 1000)} />
      <span className="av-frames">{s ? `${(s.frame - s.from).toFixed(0).padStart(3, " ")} / ${span.toFixed(0)}` : "--- / ---"}</span>
      <select className="av-select" value={s?.speed ?? 1} aria-label="Playback speed" style={{ width: 70 }}
        onChange={(e) => p.onSpeed(Number(e.target.value))}>
        {SPEEDS.map((v) => <option key={v} value={v}>{v}x</option>)}
      </select>
      <button type="button" className="av-icon" aria-pressed={p.repeat} onClick={() => p.onRepeat(!p.repeat)}
        title="Loop the last action (R)" aria-label="Loop the last action"><Icon name="repeat" /></button>
      <span className="av-sep" />
      <button type="button" className="av-icon" aria-pressed={p.rightOpen} onClick={p.onRight}
        title="Inspector (])" aria-label="Show inspector"><Icon name="panelRight" /></button>
    </div>
  );
}
