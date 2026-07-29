// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { addCharacter, emptyRoster } from "@exiled/persistence";
import { CLASS_IDS } from "@exiled/rules";
import { CLASS_LIST } from "@exiled/content-runtime";
import { CreateCharacter } from "./CreateCharacter";

afterEach(cleanup);

const OCCUPIED = addCharacter(
  emptyRoster(),
  { id: "vess", name: "Vess", classId: "class.stalker", level: 4, league: "Local", createdAt: 1, state: null },
  8,
);

function view(over: Partial<React.ComponentProps<typeof CreateCharacter>> = {}) {
  const props = {
    roster: OCCUPIED,
    classId: "class.stalker",
    onClassChange: vi.fn(),
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<CreateCharacter {...props} />);
  return props;
}

describe("CreateCharacter", () => {
  it("offers every class content defines", () => {
    view();
    for (const id of CLASS_IDS) expect(screen.getByTestId(`class-${id}`)).toBeTruthy();
    expect(screen.getByTestId("class-picker").querySelectorAll("[role=radio]")).toHaveLength(CLASS_LIST.length);
  });

  it("marks the chosen class and reports a change up", () => {
    const { onClassChange } = view({ classId: "class.stalker" });
    expect(screen.getByTestId("class-class.stalker").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("class-class.ironsworn").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByTestId("class-class.ironsworn"));
    expect(onClassChange).toHaveBeenCalledWith("class.ironsworn");
  });

  it("shows the chosen class's own blurb", () => {
    view({ classId: "class.emberbound" });
    const emberbound = CLASS_LIST.find((c) => c.id === "class.emberbound")!;
    expect(screen.getByTestId("create-character").textContent).toContain(emberbound.blurb);
  });

  it("says out loud that a class is not a build choice yet", () => {
    view();
    expect(screen.getByTestId("create-character").textContent).toMatch(/does not change your\s+numbers/i);
  });

  describe("the name", () => {
    it("blocks create until there is a usable one", () => {
      view();
      const create = () => screen.getByRole("button", { name: /^create$/i }) as HTMLButtonElement;
      expect(create().disabled).toBe(true);
      fireEvent.change(screen.getByTestId("name-input"), { target: { value: "To" } });
      expect(create().disabled).toBe(true);
      fireEvent.change(screen.getByTestId("name-input"), { target: { value: "Toren" } });
      expect(create().disabled).toBe(false);
    });

    it("refuses one that is already in the roster", () => {
      view();
      fireEvent.change(screen.getByTestId("name-input"), { target: { value: "vess" } });
      fireEvent.blur(screen.getByTestId("name-input"));
      expect(screen.getByTestId("name-error").textContent).toMatch(/taken/i);
      expect((screen.getByRole("button", { name: /^create$/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("explains what a name may contain, once it has been tried", () => {
      view();
      fireEvent.change(screen.getByTestId("name-input"), { target: { value: "9lives" } });
      fireEvent.blur(screen.getByTestId("name-input"));
      expect(screen.getByTestId("name-error").textContent).toMatch(/letters/i);
    });

    it("stays quiet until the field has been touched", () => {
      view();
      expect(screen.getByTestId("name-error").textContent).toBe("");
    });

    it("creates on Enter, trimmed, with the chosen class", () => {
      const { onCreate } = view({ classId: "class.ironsworn" });
      fireEvent.change(screen.getByTestId("name-input"), { target: { value: "  Toren  " } });
      fireEvent.keyDown(screen.getByTestId("name-input"), { key: "Enter" });
      expect(onCreate).toHaveBeenCalledWith("Toren", "class.ironsworn");
    });
  });

  it("escape cancels", () => {
    const { onCancel } = view();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
