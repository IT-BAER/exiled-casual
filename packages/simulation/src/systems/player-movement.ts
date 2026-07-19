import { fpClamp, fpStepToward } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import type { Position, PlayerC, MoveTarget, MoveDir } from "../components";

export function registerPlayerMovement(sim: Simulation): void {
  sim.register("playerMovement", (world, _tick, commands) => {
    // 1. Apply commands to moveTarget / moveDir components.
    for (const cmd of commands) {
      if (cmd.entity === undefined) continue;
      if (!world.has(cmd.entity, "player")) continue;
      const e = cmd.entity;
      if (cmd.type === "moveTo") {
        const x = cmd.data?.["x"] ?? 0;
        const y = cmd.data?.["y"] ?? 0;
        world.set<MoveTarget>(e, "moveTarget", { x, y, active: 1 });
      } else if (cmd.type === "moveDir") {
        const dx = cmd.data?.["dx"] ?? 0;
        const dy = cmd.data?.["dy"] ?? 0;
        world.set<MoveDir>(e, "moveDir", { dx, dy });
      } else if (cmd.type === "stop") {
        const mt = world.get<MoveTarget>(e, "moveTarget");
        if (mt) world.set<MoveTarget>(e, "moveTarget", { x: mt.x, y: mt.y, active: 0 });
        world.set<MoveDir>(e, "moveDir", { dx: 0, dy: 0 });
      }
    }

    // 2. Integrate all player entities.
    for (const e of world.query("position", "player")) {
      const pos = world.get<Position>(e, "position")!;
      const player = world.get<PlayerC>(e, "player")!;
      const moveDir = world.get<MoveDir>(e, "moveDir");
      const moveTarget = world.get<MoveTarget>(e, "moveTarget");

      let nx = pos.x;
      let ny = pos.y;

      const dirActive = moveDir && (moveDir.dx !== 0 || moveDir.dy !== 0);
      if (dirActive && moveDir) {
        if (moveDir.dx !== 0 && moveDir.dy !== 0) {
          // ponytail: 707/1000 approximates 1/sqrt(2) in integer math
          const diagSpeed = Math.trunc(player.moveSpeed * 707 / 1000);
          nx += moveDir.dx * diagSpeed;
          ny += moveDir.dy * diagSpeed;
        } else {
          nx += moveDir.dx * player.moveSpeed;
          ny += moveDir.dy * player.moveSpeed;
        }
      } else if (moveTarget?.active === 1) {
        const step = fpStepToward(pos.x, pos.y, moveTarget.x, moveTarget.y, player.moveSpeed);
        nx += step.dx;
        ny += step.dy;
        // snap: if new position equals target, deactivate
        const cnx = fpClamp(nx, WORLD_MIN, WORLD_MAX);
        const cny = fpClamp(ny, WORLD_MIN, WORLD_MAX);
        if (cnx === moveTarget.x && cny === moveTarget.y) {
          world.set<MoveTarget>(e, "moveTarget", { x: moveTarget.x, y: moveTarget.y, active: 0 });
        }
      }

      world.set<Position>(e, "position", {
        x: fpClamp(nx, WORLD_MIN, WORLD_MAX),
        y: fpClamp(ny, WORLD_MIN, WORLD_MAX),
      });
    }
  });
}
