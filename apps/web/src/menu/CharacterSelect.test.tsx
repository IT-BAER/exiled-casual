// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CharacterHeader } from "@exiled/persistence";
import { CharacterSelect } from "./CharacterSelect";

afterEach(cleanup);

const VESS: CharacterHeader = {
  id: "vess", name: "Vess", classId: "class.stalker", level: 12, league: "Local", createdAt: 1,
};
const TOREN: CharacterHeader = {
  id: "toren", name: "Toren", classId: "class.ironsworn", level: 3, league: "Local", createdAt: 2,
};

function view(over: Partial<React.ComponentProps<typeof CharacterSelect>> = {}) {
  const props = {
    characters: [VESS, TOREN],
    selectedId: "vess",
    onSelect: vi.fn(),
    onPlay: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onBack: vi.fn(),
    onOptions: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    cap: 8,
    ...over,
  };
  render(<CharacterSelect {...props} />);
  return props;
}

describe("CharacterSelect", () => {
  it("offers Options for real, because the panel exists now", () => {
    const props = view();
    const options = screen.getByRole("button", { name: /options/i }) as HTMLButtonElement;
    // It used to be disabled with "Options are not built yet." Leaving that
    // there once the panel shipped would be a button telling the player a lie.
    expect(options.disabled).toBe(false);
    fireEvent.click(options);
    expect(props.onOptions).toHaveBeenCalledTimes(1);
  });

  it("offers portable save export and import", () => {
    const props = view();
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    const file = new File(["{}"], "save.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/import save/i), { target: { files: [file] } });
    expect(props.onImport).toHaveBeenCalledWith(file);
  });

  it("shows a row per character with its name, level and class", () => {
    view();
    const row = screen.getByTestId("row-vess");
    expect(row.textContent).toMatch(/Vess/);
    expect(row.textContent).toMatch(/Level 12 Stalker/);
    expect(row.textContent).toMatch(/Local/);
    expect(screen.getByTestId("row-toren").textContent).toMatch(/Level 3 Ironsworn/);
  });

  it("says so plainly when there is nobody yet", () => {
    view({ characters: [], selectedId: null });
    expect(screen.getByTestId("roster").textContent).toMatch(/no one here yet/i);
  });

  it("play and delete are dead until a character is picked", () => {
    view({ characters: [], selectedId: null });
    expect((screen.getByRole("button", { name: /^play$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^delete$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("plays the selected character", () => {
    const { onPlay } = view();
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
    expect(onPlay).toHaveBeenCalledWith("vess");
  });

  it("double-clicking a row plays it, the way a list should", () => {
    const { onPlay } = view();
    fireEvent.doubleClick(screen.getByTestId("row-toren"));
    expect(onPlay).toHaveBeenCalledWith("toren");
  });

  it("arrow keys walk the roster and Enter plays it", () => {
    const { onSelect, onPlay } = view();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("toren");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("toren"); // wraps from the top back round
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onPlay).toHaveBeenCalledWith("vess");
  });

  it("escape goes back to the menu", () => {
    const { onBack } = view();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalled();
  });

  describe("the local cap", () => {
    it("closes create once the world is full, and says why", () => {
      view({ characters: [VESS], cap: 1 });
      const create = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
      expect(create.disabled).toBe(true);
      expect(create.title).toMatch(/one character/i);
      expect(create.title).toMatch(/online/i);
    });

    it("leaves create open below the cap", () => {
      const { onCreate } = view({ characters: [VESS], cap: 8 });
      fireEvent.click(screen.getByRole("button", { name: /create/i }));
      expect(onCreate).toHaveBeenCalled();
    });
  });

  describe("deleting", () => {
    it("will not delete until the name is typed exactly", () => {
      const { onDelete } = view();
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
      const dialog = screen.getByTestId("confirm-delete");
      const confirm = () =>
        Array.from(dialog.querySelectorAll("button")).find((b) => /delete/i.test(b.textContent ?? ""))!;

      expect(confirm().disabled).toBe(true);
      fireEvent.change(screen.getByTestId("confirm-name"), { target: { value: "Ves" } });
      expect(confirm().disabled).toBe(true);
      expect(onDelete).not.toHaveBeenCalled();

      fireEvent.change(screen.getByTestId("confirm-name"), { target: { value: "vess" } });
      expect(confirm().disabled).toBe(false);
      fireEvent.click(confirm());
      expect(onDelete).toHaveBeenCalledWith("vess");
    });

    it("cancels out without touching the save", () => {
      const { onDelete } = view();
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(screen.queryByTestId("confirm-delete")).toBeNull();
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});
