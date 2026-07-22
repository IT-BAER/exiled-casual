// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { offerWaystones, areaLevel, atlasNodes, WAYSTONE_OFFER_COUNT } from "@pact/rules";
import { PreparationPanel } from "./PreparationPanel.js";

describe("PreparationPanel", () => {
  const atlasSeed = 42;

  afterEach(cleanup);

  it("activates with the selected node and waystone, and shows its area level", () => {
    const onActivate = vi.fn();
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} onActivate={onActivate} onClose={() => {}} />,
    );
    const node = atlasNodes()[0]!;
    const ws = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT)[0]!;

    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
    fireEvent.click(screen.getByTestId(`prep-ws-${ws.id}`));

    expect(screen.getByTestId("prep-arealevel").textContent).toContain(String(areaLevel(ws.tier)));

    fireEvent.click(screen.getByTestId("prep-activate"));
    expect(onActivate).toHaveBeenCalledWith(node.id, ws.id);
  });

  it("disables activate until both a node and a waystone are chosen", () => {
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} onActivate={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByTestId("prep-activate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables a completed node", () => {
    const done = atlasNodes()[0]!.id;
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[done]} onActivate={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByTestId(`prep-node-${done}`) as HTMLButtonElement).disabled).toBe(true);
  });
});
