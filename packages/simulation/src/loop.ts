import type { EquipSlotId } from "@exiled/protocol";
import { World, type Entity } from "./ecs";
import type { DamageEvent } from "./components";

export interface Command {
  tick: number;
  entity?: Entity;
  type: string;
  /** Set when type === "useSkill" */
  skillId?: string;
  data?: Record<string, number>;
  /** Set when type === "activateMap"; kept off `data` since that field is numbers-only. */
  atlasNodeId?: string;
  /** Set when type === "activateMap": the backpack cell holding the stone. */
  x?: number;
  y?: number;
  /** Set when type === "equipItem" | "unequipItem" */
  slot?: EquipSlotId;
  /** Set when type === "useFlask" */
  flask?: "life" | "mana";
}

export type System = (
  world: World,
  tick: number,
  commands: readonly Command[],
) => void;

// Fixed-step authoritative loop. System execution order equals registration
// order and is inspectable via systemOrder(). Changing the order is a
// simulation migration (see spec §3).
export class Simulation {
  readonly world = new World();
  tick = 0;
  /** Per-tick damage queue. Cleared at the start of each step; drained by damageResolve. */
  damageQueue: DamageEvent[] = [];
  private readonly systems: { name: string; fn: System }[] = [];

  register(name: string, fn: System): void {
    this.systems.push({ name, fn });
  }

  systemOrder(): string[] {
    return this.systems.map((s) => s.name);
  }

  enqueueDamage(e: DamageEvent): void {
    this.damageQueue.push(e);
  }

  step(commands: readonly Command[] = []): void {
    this.damageQueue = [];
    for (const s of this.systems) s.fn(this.world, this.tick, commands);
    this.tick++;
  }
}
