// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { installErrorCapture } from "./errors";

/** Chrome's ErrorEvent for `throw "x"` reads "Uncaught " plus the value; the value is what matters. */
function fire(error: unknown, message = "Uncaught ") {
  const report = vi.fn();
  const remove = installErrorCapture(report);
  window.dispatchEvent(new ErrorEvent("error", { message, error, filename: "index.js" }));
  remove();
  return report.mock.calls[0]!;
}

describe("error capture", () => {
  it("keeps the browser's message for a thrown Error", () => {
    const err = new TypeError("x is undefined");
    const [src, msg, stack] = fire(err, "Uncaught TypeError: x is undefined");
    expect(src).toBe("window");
    expect(msg).toBe("Uncaught TypeError: x is undefined");
    expect(stack).toBe(err.stack);
  });

  it("names an Error whose event message is a bare \"Uncaught \" by its own name and message", () => {
    // Edge 139 on 0.7.1: a DOMException from React's insertBefore arrived as "Uncaught ".
    const err = new DOMException("The node before which the new node is to be inserted is not a child of this node.", "NotFoundError");
    expect(fire(err)[1]).toBe("Uncaught NotFoundError: The node before which the new node is to be inserted is not a child of this node.");
  });

  it("records the type and text of a thrown string", () => {
    expect(fire("socket gone")[1]).toBe("Uncaught [string] socket gone");
  });

  it("records the type and fields of a thrown object", () => {
    class Refusal { code = 7; why = "no stone"; }
    expect(fire(new Refusal())[1]).toBe('Uncaught [Refusal] {"code":7,"why":"no stone"}');
    // No value at all is a cross-origin script: the browser's own text is all there is.
    expect(fire(null, "Script error.")[1]).toBe("Script error.");
  });

  it("names a thrown Event by its type, which JSON alone would hide", () => {
    expect(fire(new Event("abort"))[1]).toBe("Uncaught [Event] abort");
  });

  it("survives a value that cannot be stringified", () => {
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    expect(fire(loop)[1]).toBe("Uncaught [Object] [object Object]");
  });

  it("records a rejected non-Error the same way", () => {
    const report = vi.fn();
    const remove = installErrorCapture(report);
    const e = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.assign(e, { reason: { status: 404 } });
    window.dispatchEvent(e);
    remove();
    expect(report).toHaveBeenCalledWith("promise", '[Object] {"status":404}', undefined);
  });
});
