/**
 * Error boundaries. Without one, React 19 unmounts the whole root on a throw in
 * render or commit, so a translated text node in one panel blanked the game.
 * A caught throw no longer reaches `window`'s error event; it is reported here as "react".
 */
import React from "react";
import { isError, reportError, thrownText } from "./telemetry/errors";
import { DISPLAY, Divider, FramedPanel, GOLD, MenuButton, SERIF } from "./menu/frames";

type BoundaryProps = {
  /** Prefixed to the reported message, so the report says which part failed. */
  name: string;
  children?: React.ReactNode;
  /** Drawn in place of the children; nothing when absent. */
  fallback?: (retry: () => void) => React.ReactNode;
  /** A change clears the failure: the router passes the screen. */
  resetKey?: unknown;
};

type BoundaryState = { failed: boolean; key: unknown };

export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(p: BoundaryProps, s: BoundaryState): Partial<BoundaryState> | null {
    return Object.is(p.resetKey, s.key) ? null : { failed: false, key: p.resetKey };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const err = isError(error) ? (error as Error) : null;
    const text = err ? `${err.name}: ${err.message}` : thrownText(error);
    const stack = [err?.stack, info.componentStack].filter(Boolean).join("\n");
    reportError("react", `${this.props.name}: ${text}`, stack || undefined);
  }

  retry = (): void => this.setState({ failed: false });

  override render(): React.ReactNode {
    return this.state.failed ? (this.props.fallback?.(this.retry) ?? null) : this.props.children;
  }
}

/**
 * The framed note a failed part leaves behind, in the pause menu's look.
 * `cover` hides what is behind it (a whole screen failed); without it the game
 * stays visible and clickable around the note.
 */
export function ErrorNote({
  text,
  actions,
  cover = false,
}: {
  text: string;
  actions: { label: string; onClick: () => void }[];
  cover?: boolean;
}): React.ReactElement {
  return (
    <div
      data-testid="error-note"
      role="alert"
      style={{
        position: cover ? "fixed" : "absolute", inset: 0, zIndex: 70,
        display: "grid", placeItems: "center",
        background: cover ? "#060709" : "transparent",
        pointerEvents: cover ? "auto" : "none",
      }}
    >
      <FramedPanel style={{ padding: "18px 26px 20px", minWidth: 320, maxWidth: 440, pointerEvents: "auto" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: 4, textTransform: "uppercase", color: GOLD, textAlign: "center" }}>
          Something went wrong
        </div>
        <Divider style={{ margin: "10px 0 14px" }} />
        <div style={{ fontFamily: SERIF, fontSize: 13, color: "#9a9187", textAlign: "center", marginBottom: 16 }}>
          {text}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actions.map((a, i) => (
            <MenuButton key={a.label} tone={i === 0 ? "primary" : "normal"} style={{ width: "100%" }} onClick={a.onClick}>
              {a.label}
            </MenuButton>
          ))}
        </div>
      </FramedPanel>
    </div>
  );
}

/** One HUD panel or dialog: on a throw the rest of the game keeps running around a note. */
export function PanelBoundary({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose?: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <ErrorBoundary
      name={name}
      fallback={(retry) => (
        <ErrorNote
          text="This panel hit an error and it was reported. The game is still running."
          actions={[{ label: "Retry", onClick: retry }, ...(onClose ? [{ label: "Close", onClick: onClose }] : [])]}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
