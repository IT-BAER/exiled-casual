/**
 * The live character on the select and create screens.
 *
 * A canvas over the painted hall, holding the real wardrobe rig in the real
 * idle, dressed in the chosen class's starting gear. It is the same code the
 * game dresses the player with, which is the point: a preview drawn any other
 * way eventually stops matching what you get.
 *
 * Everything about it is allowed to fail. Headless (jsdom, tests) there is no
 * WebGL and `createMenuStage` resolves null; the screens keep their backdrop and
 * their roster and simply have nobody standing in the hall.
 */
import React from "react";
import { createMenuStage, type MenuStage as Stage } from "../render/menu-scene";
import { looksForClass } from "./class-looks";

export function MenuStage({ classId }: { classId: string | null }): React.ReactElement {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const stageRef = React.useRef<Stage | null>(null);
  /** What was standing here last, so a departure can be told from an empty hall. */
  const wasThere = React.useRef<string | null>(classId);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let dead = false;
    void createMenuStage(canvas)
      .then((stage) => {
        if (dead) { stage?.dispose(); return; }
        stageRef.current = stage;
        stage?.setLooks(classId === null ? null : looksForClass(classId));
      })
      // No WebGL, no wardrobe, no stage. The screen is still a screen.
      .catch(() => undefined);
    return () => {
      dead = true;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
    // Mount once: changing class re-dresses the rig below rather than rebuilding
    // the scene, which would restart the idle and cost a wardrobe fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const stage = stageRef.current;
    const leaving = classId === null && wasThere.current !== null;
    wasThere.current = classId;
    if (classId !== null) {
      stage?.setLooks(looksForClass(classId));
      return;
    }
    // Somebody was here and now is not: that is a deletion, and it gets the
    // frames it takes to watch him go. An empty hall that was already empty just
    // stays empty — a dissolve with nothing to dissolve is a stall on a screen
    // that has never had anyone in it.
    if (!leaving) {
      stage?.setLooks(null);
      return;
    }
    void stage?.dissolve().catch(() => stage?.setLooks(null));
  }, [classId]);

  return (
    <canvas
      ref={ref}
      data-testid="menu-stage"
      aria-hidden
      style={{
        position: "absolute",
        // The painted floor's near edge and the roster panel's left edge box the
        // figure in: he stands in the open half of the hall, not behind the UI.
        left: 0,
        top: 0,
        width: "68vw",
        height: "100%",
        pointerEvents: "none",
        display: "block",
        // Above the painted hall, below the panel. See App.tsx for why it is not
        // a child of either screen.
        zIndex: 1,
      }}
    />
  );
}
