// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryKv, emptyRoster, addCharacter, saveRoster, loadRoster } from "@exiled/persistence";
import { setKv } from "./save/roster";

// The game and the 3D stage both build a Babylon engine on mount, and neither
// exists in jsdom. Stubbing them is also the assertion this file cares about:
// the router either mounted the game or it did not.
vi.mock("./GameView", () => ({
  GameView: ({ characterId }: { characterId?: string }) => (
    <div data-testid="game-view">{characterId}</div>
  ),
}));
vi.mock("./menu/MenuStage", () => ({
  MenuStage: ({ classId }: { classId: string }) => <div data-testid="menu-stage">{classId}</div>,
}));

import { App } from "./App";

let kv: MemoryKv;

beforeEach(() => {
  kv = new MemoryKv();
  setKv(kv);
});
afterEach(() => {
  cleanup();
  setKv(null);
});

/** Walk from the main menu into the roster, which is behind the world choice. */
async function toSelect() {
  render(<App />);
  await screen.findByTestId("main-menu");
  fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
  fireEvent.click(await screen.findByRole("button", { name: /play local/i }));
  return screen.findByTestId("character-select");
}

async function withCharacter() {
  await saveRoster(
    kv,
    addCharacter(
      emptyRoster(),
      { id: "vess", name: "Vess", classId: "class.stalker", level: 7, league: "Local", createdAt: 1, state: null },
      8,
    ),
  );
}

describe("App routing", () => {
  it("boots to the menu, not into the game", async () => {
    render(<App />);
    expect(await screen.findByTestId("main-menu")).toBeTruthy();
    // The whole point of the split: no engine, no worker, until a character is chosen.
    expect(screen.queryByTestId("game-view")).toBeNull();
  });

  it("play asks which world before it shows anyone", async () => {
    render(<App />);
    await screen.findByTestId("main-menu");
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
    expect(await screen.findByTestId("mode-dialog")).toBeTruthy();
    expect(screen.queryByTestId("character-select")).toBeNull();
  });

  it("local mode leads to the roster", async () => {
    expect(await toSelect()).toBeTruthy();
  });

  it("lists a saved character and enters the game with its id", async () => {
    await withCharacter();
    await toSelect();
    expect((await screen.findByTestId("row-vess")).textContent).toMatch(/Level 7 Stalker/);
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
    expect((await screen.findByTestId("game-view")).textContent).toBe("vess");
  });

  it("creates a character, saves it, and comes back to the roster", async () => {
    await toSelect();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await screen.findByTestId("create-character");
    fireEvent.click(screen.getByTestId("class-class.emberbound"));
    fireEvent.change(screen.getByTestId("name-input"), { target: { value: "Toren" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await screen.findByTestId("character-select");
    expect(screen.getByTestId("roster").textContent).toMatch(/Toren/);
    // ...and it is on disk, not just on screen.
    const saved = await loadRoster(kv);
    expect(saved?.characters.map((c) => c.name)).toEqual(["Toren"]);
    expect(saved?.characters[0]?.classId).toBe("class.emberbound");
  });

  it("deleting takes the character off the roster and out of the save", async () => {
    await withCharacter();
    await toSelect();
    await screen.findByTestId("row-vess");
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.change(screen.getByTestId("confirm-name"), { target: { value: "Vess" } });
    fireEvent.click(
      Array.from(screen.getByTestId("confirm-delete").querySelectorAll("button")).find((b) =>
        /delete/i.test(b.textContent ?? ""),
      )!,
    );
    await waitFor(() => expect(screen.queryByTestId("row-vess")).toBeNull());
    expect((await loadRoster(kv))?.characters).toEqual([]);
  });

  it("local mode holds one character, and the roster says why", async () => {
    await withCharacter();
    await toSelect();
    const create = (await screen.findByRole("button", { name: /create/i })) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.title).toMatch(/online mode/i);
  });

  it("the stage wears the selected character's class", async () => {
    await withCharacter();
    await toSelect();
    expect((await screen.findByTestId("menu-stage")).textContent).toBe("class.stalker");
  });

  it("stands nobody in the hall when there is nobody to stand there", async () => {
    // The class the stage wears used to fall back to `DEFAULT_CLASS_ID` whenever
    // nothing was selected, which quietly turned "no character" into "some
    // character": an empty roster still had a full figure standing in the hall,
    // and deleting your last one left him behind. The empty roster is the same
    // state, so it is what this pins — no delete needed to catch the regression.
    await toSelect();
    expect(screen.queryByTestId("row-vess")).toBeNull();
    expect((await screen.findByTestId("menu-stage")).textContent).toBe("");
  });

  it("takes the figure out of the hall when the last character is deleted", async () => {
    await withCharacter();
    await toSelect();
    expect((await screen.findByTestId("menu-stage")).textContent).toBe("class.stalker");
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.change(screen.getByTestId("confirm-name"), { target: { value: "Vess" } });
    fireEvent.click(
      Array.from(screen.getByTestId("confirm-delete").querySelectorAll("button")).find((b) =>
        /delete/i.test(b.textContent ?? ""),
      )!,
    );
    await waitFor(() => expect(screen.getByTestId("menu-stage").textContent).toBe(""));
  });

  it("options and credits are real screens with a way back", async () => {
    render(<App />);
    await screen.findByTestId("main-menu");
    fireEvent.click(screen.getByRole("button", { name: /about/i }));
    const info = await screen.findByTestId("info-screen");
    expect(info.textContent).toMatch(/original fan project/i);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByTestId("main-menu")).toBeTruthy();
  });

  it("a pre-roster save is migrated into a listed character", async () => {
    // The exact shape `saveTo` wrote before the roster existed.
    await kv.save(
      JSON.stringify({
        version: 2,
        session: { area: "hideout", atlasSeed: 1, completedNodes: [] },
        inventory: { cols: 12, rows: 5, items: [] },
        progress: { level: 21, xp: 0, gold: 0 },
      }),
    );
    await toSelect();
    const row = await screen.findByTestId("row-migrated-1");
    expect(row.textContent).toMatch(/Exile/);
    expect(row.textContent).toMatch(/Level 21/);
  });
});
