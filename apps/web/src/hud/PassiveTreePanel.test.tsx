// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Intent } from "@exiled/protocol";
import { PASSIVE_TREE, passiveNode, startNodeId } from "@exiled/rules";
import { PassiveTreePanel } from "./PassiveTreePanel";

afterEach(cleanup);

const CLASS = "class.stalker";
const door = passiveNode(startNodeId(CLASS))!;
const near = door.links[0]!;
const far = PASSIVE_TREE.find((n) => n.kind === "keystone")!.id;

function panel(over: Partial<React.ComponentProps<typeof PassiveTreePanel>> = {}) {
  const seen: Intent[] = [];
  render(
    <PassiveTreePanel
      open
      classId={CLASS}
      allocated={[]}
      points={24}
      onIntent={(i) => seen.push(i)}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return seen;
}

describe("PassiveTreePanel", () => {
  it("draws nothing at all while closed", () => {
    panel({ open: false });
    expect(screen.queryByTestId("passive-panel")).toBeNull();
  });

  it("draws every node in the tree", () => {
    panel();
    for (const node of PASSIVE_TREE.slice(0, 12)) {
      expect(screen.getByTestId(`passive-node-${node.id}`)).toBeTruthy();
    }
  });

  it("counts the unspent points in words the header can hold", () => {
    panel({ points: 1 });
    expect(screen.getByTestId("passive-points").textContent).toBe("1 point unspent");
  });

  /** The click is a REQUEST: the panel never allocates anything itself. */
  it("asks the sim for a node the door touches", () => {
    const seen = panel();
    fireEvent.click(screen.getByTestId(`passive-node-${near}`));
    expect(seen).toEqual([{ kind: "allocatePassive", nodeId: near }]);
  });

  it("says nothing at all when a node is out of reach", () => {
    const seen = panel();
    fireEvent.click(screen.getByTestId(`passive-node-${far}`));
    expect(seen).toEqual([]);
  });

  it("says nothing when a node is already taken", () => {
    const seen = panel({ allocated: [near] });
    fireEvent.click(screen.getByTestId(`passive-node-${near}`));
    expect(seen).toEqual([]);
  });

  it("lights an allocated node and leaves the rest dark", () => {
    panel({ allocated: [near] });
    const taken = screen.getByTestId(`passive-node-${near}`);
    const untaken = screen.getByTestId(`passive-node-${far}`);
    expect(taken.getAttribute("fill")).not.toBe(untaken.getAttribute("fill"));
  });

  it("offers a refund only once there is something to refund", () => {
    panel();
    expect((screen.getByTestId("passive-respec") as HTMLButtonElement).disabled).toBe(true);
    screen.getByTestId("passive-close");
  });

  it("asks for a full refund when the button is pressed", () => {
    const seen = panel({ allocated: [near] });
    fireEvent.click(screen.getByTestId("passive-respec"));
    expect(seen).toEqual([{ kind: "respecPassives" }]);
  });

  it("names the node and what it grants on hover", () => {
    panel();
    const node = PASSIVE_TREE.find((n) => n.kind === "notable")!;
    fireEvent.mouseEnter(screen.getByTestId(`passive-node-${node.id}`), { clientX: 10, clientY: 10 });
    const tip = screen.getByTestId("passive-tooltip");
    expect(tip.textContent).toContain(node.name);
    expect(tip.textContent).toMatch(/\d/);
  });
});
