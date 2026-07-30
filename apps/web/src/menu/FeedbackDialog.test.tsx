// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FeedbackDialog, issueUrl } from "./FeedbackDialog";

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
