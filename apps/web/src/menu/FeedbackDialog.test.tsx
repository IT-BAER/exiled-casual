// @vitest-environment jsdom
import React from "react";
import { flushSync } from "react-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import { FeedbackDialog, issueUrl } from "./FeedbackDialog";
import { GAME_VERSION } from "../version";

afterEach(cleanup);

describe("issueUrl", () => {
  it("carries the text, the label and the build into a GitHub issue", () => {
    const url = new URL(issueUrl("bug", "The portal closed early\nand I fell out"));
    expect(url.origin + url.pathname).toBe("https://github.com/IT-BAER/exiled-casual/issues/new");
    expect(url.searchParams.get("labels")).toBe("bug");
    // The title is the first line only; the whole report is the body.
    expect(url.searchParams.get("title")).toBe("Bug: The portal closed early");
    expect(url.searchParams.get("body")).toContain("and I fell out");
    expect(url.searchParams.get("body")).toContain("Viewport:");
  });

  it("names the release and the content the report was written against", () => {
    const body = new URL(issueUrl("bug", "Crashed")).searchParams.get("body") ?? "";
    expect(body).toContain(`Version: ${GAME_VERSION}, content ${CONTENT_VERSION}`);
  });

  it("labels an idea as feedback rather than as a bug", () => {
    const url = new URL(issueUrl("idea", "Louder loot beams"));
    expect(url.searchParams.get("labels")).toBe("feedback");
    expect(url.searchParams.get("title")).toBe("Feedback: Louder loot beams");
  });
});

describe("FeedbackDialog", () => {
  it("will not open an issue with nothing in it", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const onClose = vi.fn();
    render(<FeedbackDialog kind="idea" onClose={onClose} />);
    fireEvent.click(screen.getByText("Open Issue"));
    expect(open).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("takes Escape from the game: it closes, and the pause menu behind never hears it", () => {
    const game = vi.fn();
    let bump = (): void => {};
    // The game's window listener was there first, and its state change re-renders the dialog's parent.
    const onGameKey = (e: KeyboardEvent): void => { game(e.key); flushSync(() => bump()); };
    window.addEventListener("keydown", onGameKey);
    const closed = vi.fn();
    function Host(): React.ReactElement {
      const [n, setN] = React.useState(0);
      bump = () => setN((v) => v + 1);
      return <FeedbackDialog kind="bug" onClose={() => closed(n)} />;
    }
    try {
      render(<Host />);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(closed).toHaveBeenCalledTimes(1);
      expect(game).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onGameKey);
    }
  });

  it("holds the game's keys while it is up, and starts with its field focused", () => {
    const game = vi.fn();
    window.addEventListener("keydown", game);
    try {
      render(<FeedbackDialog kind="bug" onClose={() => {}} />);
      expect(document.activeElement).toBe(screen.getByTestId("feedback-text"));
      fireEvent.keyDown(document.body, { key: "i" });
      expect(game).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", game);
    }
  });

  it("opens the issue in a new tab and closes itself", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const onClose = vi.fn();
    render(<FeedbackDialog kind="bug" onClose={onClose} />);
    fireEvent.change(screen.getByTestId("feedback-text"), { target: { value: "It fell through the floor" } });
    fireEvent.click(screen.getByText("Open Issue"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]![0])).toContain("It+fell+through+the+floor");
    expect(onClose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
