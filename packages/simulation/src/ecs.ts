// Minimal ECS. Component data are plain flat records. All iteration used for
// output (query, componentNames, entitiesWith) is sorted for determinism.
// ponytail: Map-of-Maps storage, not structure-of-arrays. Swap to SoA only when
// a profiler shows a hot component loop is the bottleneck.

export type Entity = number;

export class World {
  private next = 1;
  readonly alive = new Set<Entity>();
  private readonly stores = new Map<string, Map<Entity, unknown>>();

  // The next id to be allocated. Part of serialized state so create/destroy
  // history is captured by the checksum, not just the current alive set.
  get nextId(): Entity {
    return this.next;
  }

  create(): Entity {
    const e = this.next++;
    this.alive.add(e);
    return e;
  }

  destroy(e: Entity): void {
    this.alive.delete(e);
    for (const store of this.stores.values()) store.delete(e);
  }

  set<T extends Record<string, unknown>>(e: Entity, comp: string, data: T): void {
    let store = this.stores.get(comp);
    if (!store) {
      store = new Map<Entity, unknown>();
      this.stores.set(comp, store);
    }
    store.set(e, data);
  }

  get<T>(e: Entity, comp: string): T | undefined {
    return this.stores.get(comp)?.get(e) as T | undefined;
  }

  has(e: Entity, comp: string): boolean {
    return this.stores.get(comp)?.has(e) ?? false;
  }

  remove(e: Entity, comp: string): void {
    this.stores.get(comp)?.delete(e);
  }

  query(...comps: string[]): Entity[] {
    const result: Entity[] = [];
    for (const e of this.alive) {
      if (comps.every((c) => this.has(e, c))) result.push(e);
    }
    return result.sort((a, b) => a - b);
  }

  componentNames(): string[] {
    return [...this.stores.keys()].sort();
  }

  entitiesWith(comp: string): Entity[] {
    const store = this.stores.get(comp);
    return store ? [...store.keys()].sort((a, b) => a - b) : [];
  }
}
