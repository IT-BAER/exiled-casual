/**
 * Say something about the game, from inside the game.
 *
 * It files a real GitHub issue and needs no server to do it: the text, the
 * build and the platform are packed into an issue URL and opened in a tab, so
 * the player lands on a pre-filled form already signed in as themselves. A
 * hosted endpoint would mean a token in the client or a service to run, and
 * would file every report as one anonymous robot — this way the person who
 * wrote it owns it and can be replied to.
 *
 * Two moods, one dialog. A bug report asks what happened and what should have;
 * an idea asks for the idea. They differ in the prompt and in the label, which
 * is the whole difference at this stage.
 */
import React from "react";
import { BODY_SERIF, Divider, FramedPanel, GOLD, GOLD_DIM, MenuButton, PARCHMENT, SERIF } from "./frames";

const REPO = "https://github.com/IT-BAER/exiled-casual";

export type FeedbackKind = "bug" | "idea";

const COPY: Record<FeedbackKind, { title: string; prompt: string; label: string; placeholder: string }> = {
  bug: {
    title: "Report a Bug",
    prompt: "What happened, and what did you expect instead?",
    label: "bug",
    placeholder: "The portal closed while I was still walking into it…",
  },
  idea: {
    title: "Send Feedback",
    prompt: "What would make this better?",
    label: "feedback",
    placeholder: "The loot beam should stay lit until…",
  },
};

/** Everything about the build that a report is useless without. */
export function reportContext(): string {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const screen = typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "unknown";
  return [
    `Build: ${import.meta.env?.MODE ?? "unknown"}`,
    `Platform: ${nav?.platform ?? "unknown"}`,
    `Agent: ${nav?.userAgent ?? "unknown"}`,
    `Viewport: ${screen}`,
  ].join("\n");
}

/** The URL that opens a pre-filled issue. Exported so a test can read it. */
export function issueUrl(kind: FeedbackKind, text: string): string {
  const c = COPY[kind];
  const body = `${text.trim()}\n\n---\n${reportContext()}`;
  const params = new URLSearchParams({
    title: `${kind === "bug" ? "Bug" : "Feedback"}: ${firstLine(text)}`,
    body,
    labels: c.label,
  });
  return `${REPO}/issues/new?${params.toString()}`;
}

/** The issue title: the first line of what was written, kept short. */
function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

export function FeedbackDialog({
  kind,
  onClose,
}: {
  kind: FeedbackKind;
  onClose: () => void;
}): React.ReactElement {
  const c = COPY[kind];
  const [text, setText] = React.useState("");
  const empty = text.trim().length === 0;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = (): void => {
    if (empty) return;
    window.open(issueUrl(kind, text), "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <div
      data-testid="feedback-dialog"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(3,4,6,0.7)",
        zIndex: 45,
      }}
    >
      <FramedPanel style={{ padding: "18px 26px 20px", width: "min(560px, 86vw)" }}>
        <div style={{
          fontFamily: SERIF, fontSize: 18, letterSpacing: 4,
          textTransform: "uppercase", color: GOLD, textAlign: "center",
        }}>
          {c.title}
        </div>
        <Divider style={{ margin: "10px 0 14px" }} />
        <label
          htmlFor="feedback-text"
          style={{ display: "block", fontFamily: BODY_SERIF, fontSize: 14, color: GOLD_DIM, marginBottom: 8 }}
        >
          {c.prompt}
        </label>
        <textarea
          id="feedback-text"
          data-testid="feedback-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={c.placeholder}
          rows={7}
          style={{
            width: "100%",
            resize: "vertical",
            // The one place in the client with a text field, so it has to opt back
            // into selection: the body turns it off everywhere (index.html).
            userSelect: "text",
            WebkitUserSelect: "text",
            fontFamily: BODY_SERIF,
            fontSize: 15,
            lineHeight: 1.5,
            color: PARCHMENT,
            background: "rgba(6,7,9,0.72)",
            border: "1px solid #3b3226",
            outline: "none",
            padding: "10px 12px",
            boxSizing: "border-box",
          }}
        />
        <div style={{
          fontFamily: BODY_SERIF, fontSize: 12.5, color: "#7d7469", margin: "10px 2px 14px",
        }}>
          Opens a GitHub issue with your build and platform attached. Nothing is sent from here.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <MenuButton height={38} onClick={onClose}>Cancel</MenuButton>
          <MenuButton height={38} tone="primary" onClick={send} disabled={empty}>
            Open Issue
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}
