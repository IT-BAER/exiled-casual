/**
 * The VFX kit: reusable primitives the class skills are composed from. Each is
 * a factory returning an `Fx` handle (`update(dt)`, `dispose()`, `done`);
 * `fire(scene, fx)` drives one off the scene and disposes it when done. See
 * core.ts for the handle, pools and materials, and preview.ts for `?viewer&clip=kit:<name>`.
 */
export * from "./core";
export * from "./chunks";
export * from "./emit";
export * from "./ground";
export * from "./sky";
export * from "./lightning";
export * from "./frost";
export * from "./fire";
export * from "./motion";
export * from "./sun-orb";
export * from "./buffs";
export * from "./status";
export * from "./warm";
