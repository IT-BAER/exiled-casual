# Data Model and Rules Engine

This document defines the model that keeps combat, skills, items, maps, crafting, progression, and economy consistent. TypeScript examples are normative shapes, not complete code. Display names are illustrative and should be replaced by original game terminology.

## Modeling principles

1. **Identity is stable.** Definitions use permanent namespaced IDs. Labels, icons, balance, and localization can change without changing identity.
2. **Definitions and instances are separate.** A sword definition describes possible behavior. One dropped sword instance records concrete rolls, state, provenance, and owner.
3. **Rules consume structured facts.** Tooltips render rules. Rules never parse tooltips.
4. **One modifier engine serves everything.** Items, passives, buffs, debuffs, map affixes, monster rarity, encounter stages, and party scaling use the same scope and stat vocabulary.
5. **Randomness is named and replayable.** No authoritative call to `Math.random()`.
6. **Ordering is part of the design.** The engine specifies exactly when commands, triggers, damage, ailments, death, loot, and objectives resolve.
7. **Persistence is transactional.** Every ownership or value transition is idempotent and revision-checked.
8. **Content is immutable per build.** A run uses one compiled content manifest from creation through finalization.

## Primitive types and units

Use branded IDs so unrelated strings cannot be mixed accidentally:

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

type ContentId = Brand<string, "ContentId">;
type EntityId = Brand<number, "EntityId">;
type AccountId = Brand<string, "AccountId">;
type CharacterId = Brand<string, "CharacterId">;
type ItemId = Brand<string, "ItemId">;
type RunId = Brand<string, "RunId">;
type Tick = Brand<number, "Tick">;
type Fixed = Brand<number, "Fixed">;
type BasisPoints = Brand<number, "BasisPoints">;
```

Recommended authoritative units:

| Quantity | Unit |
|---|---|
| Position | integer millimeters or 1/1024 world unit |
| Angle | unsigned 16-bit full turn |
| Time | simulation ticks; convert content milliseconds during compile |
| Resource | integer fixed point, proposed scale 1/256 |
| Percent | basis points, 10,000 = 100% |
| Multiplier | fixed rational numerator/denominator or basis-point delta |
| Weight | unsigned integer, accumulated with 64-bit-safe arithmetic |

Content authors can use friendly seconds and percentages. The compiler rejects values that quantize out of tolerance.

## Content manifest

```ts
interface ContentManifest {
  manifestId: string;             // content-addressed hash
  gameVersion: string;            // original product version, not PoE branding
  rulesVersion: number;
  protocolMin: number;
  protocolMax: number;
  publishedAt: string;
  parentManifestId?: string;
  schemaVersions: Record<string, number>;
  bundleHashes: Record<string, string>;
  migrations: ContentMigrationRef[];
  evidenceSnapshot?: string;      // internal research provenance, never runtime logic
}
```

Every persisted item, character snapshot, Atlas state, and run stores a manifest ID or a generation version. Old instances can be projected into current play through explicit migration policies:

- `new-only`: only newly generated instances use the new definition.
- `definition-live`: existing instances reference updated behavior while retaining rolls.
- `range-clamp`: existing values outside a new legal range are clamped.
- `reroll`: explicit, rare migration with an audit event.
- `legacy`: preserve the old definition as a retired runtime record.
- `destroy-or-refund`: only for invalidated temporary content, with a support-visible reason.

## Definition model

All content definitions share a header:

```ts
interface DefinitionHeader {
  id: ContentId;
  revision: number;
  tags: ContentId[];
  displayKey: string;
  iconId?: ContentId;
  availability: {
    introduced: string;
    removed?: string;
    featureFlags?: string[];
  };
}
```

Tags are stable semantic facts such as `damage.fire`, `skill.attack`, `weapon.bow`, `area.map`, or `monster.rare`. Do not use UI color, translated terms, or fragile substring matching as mechanics tags.

## Stat definitions

```ts
interface StatDefinition extends DefinitionHeader {
  valueType: "integer" | "fixed" | "basisPoints" | "boolean" | "enum";
  defaultValue: number | boolean | string;
  minimum?: number;
  maximum?: number;
  rounding: "floor" | "ceil" | "nearest" | "towardZero";
  aggregation:
    | "additive"
    | "maximum"
    | "minimum"
    | "latest"
    | "booleanOr"
    | "booleanAnd"
    | "custom";
  derived?: Expression;
  dependencies?: ContentId[];
  presentation: {
    format: string;
    hidden?: boolean;
    showSign?: boolean;
  };
}
```

Examples of stat identities:

```text
resource.life.maximum
resource.mana.regeneration_per_second
offence.attack_speed.increased
damage.fire.more
defence.armour.rating
skill.projectile.count
skill.cost.mana.multiplier
loot.item_rarity.area
map.monster_effectiveness
```

Do not store a single untyped bag where a stat named `damage` changes meaning by context. Domain and unit must be clear from the ID and definition.

## Modifier definitions and rolls

```ts
interface ModifierDefinition extends DefinitionHeader {
  domain:
    | "item"
    | "passive"
    | "skill"
    | "buff"
    | "monster"
    | "area"
    | "encounter";
  generationType?:
    | "prefix"
    | "suffix"
    | "implicit"
    | "enchant"
    | "rune"
    | "corruption"
    | "crafted"
    | "special";
  exclusiveGroups: ContentId[];
  requiredLevel?: number;
  tiers?: ModifierTier[];
  applicability: Predicate;
  operations: ModifierOperation[];
  spawnWeights?: WeightedPredicate[];
}

interface ModifierTier {
  tier: number;                    // 1 means strongest in the advanced item UI
  requiredItemLevel: number;
  rolls: RollSpec[];
}

interface ModifierRoll {
  definitionId: ContentId;
  definitionRevision: number;
  tier?: number;
  values: number[];
  sourceId: string;
  generationType?: string;
  fractured?: boolean;
}
```

A hybrid modifier with three displayed lines is still one `ModifierRoll`. Removal, fracture, capacity, reroll, and conflict behavior operate on the modifier, not its lines.

### Operations

```ts
type ModifierOperation =
  | { op: "addFlat"; stat: ContentId; value: ValueRef }
  | { op: "increase"; stat: ContentId; value: ValueRef }
  | { op: "more"; stat: ContentId; value: ValueRef }
  | { op: "set"; stat: ContentId; value: ValueRef; priority: number }
  | { op: "capMin"; stat: ContentId; value: ValueRef }
  | { op: "capMax"; stat: ContentId; value: ValueRef }
  | { op: "convert"; from: ContentId; to: ContentId; value: ValueRef }
  | { op: "gainAsExtra"; from: ContentId; to: ContentId; value: ValueRef }
  | { op: "grantTag"; tag: ContentId }
  | { op: "grantSkill"; skill: ContentId; level: ValueRef }
  | { op: "registerTrigger"; trigger: ContentId };
```

### Scope and predicates

A modifier operation evaluates against a `RuleContext`:

```ts
interface RuleContext {
  actor?: EntityId;
  source?: EntityId;
  target?: EntityId;
  skill?: ContentId;
  item?: ItemId;
  area?: ContentId;
  encounter?: ContentId;
  tags: ReadonlyTagSet;
  values: Readonly<Record<string, number | boolean | string>>;
}
```

Predicates are compiled expression trees, never arbitrary JavaScript:

```ts
type Predicate =
  | { kind: "true" }
  | { kind: "hasTag"; tag: ContentId }
  | { kind: "compare"; left: ValueExpr; op: "eq" | "lt" | "lte" | "gt" | "gte"; right: ValueExpr }
  | { kind: "all"; children: Predicate[] }
  | { kind: "any"; children: Predicate[] }
  | { kind: "not"; child: Predicate };
```

The compiler detects impossible tags, unbounded recursion, scope-invalid value references, and predicates that are always false.

## Stat aggregation

For the common flat/increased/more model:

```text
pre-cap value =
  (base + sum(flat additions))
  * max(0, 1 + sum(increased) - sum(reduced))
  * product(1 + each more)
  * product(1 - each less)
```

Then apply ordered overrides, conversions appropriate to that stat, minimum/maximum caps, and the stat's rounding rule. `More` effects are independently multiplicative unless a definition explicitly places them in one shared bucket.

Local item operations must resolve into the item's local base before the actor aggregates equipment. For example:

```text
local weapon damage =
  (base weapon damage + local flat damage)
  * local increased/reduced damage bucket
  * local quality multiplier

actor attack damage starts from local weapon damage,
then applies actor/skill/global operations
```

Never persist derived tooltips as authority. Cache them with a dependency generation and recompute when a source changes.

### Dependency graph and invalidation

At content compile time:

1. Build a directed graph from derived stat to dependencies.
2. Reject cycles unless the stat declares an iterative solver and convergence bound.
3. Topologically order derived computations.
4. Precompute which outputs each source can invalidate.

At runtime, equipment swap or buff change increments a source generation. Derived caches whose dependency mask intersects that source are recomputed lazily or at a defined synchronization point. Do not recalculate all stats every tick.

Requirement cascades need a bounded fixed-point solver because unequipping one item can remove attributes needed by another:

```text
assume all placed equipment enabled
-> aggregate requirements and grants
-> disable every item whose requirements fail
-> aggregate again without disabled items
-> repeat until stable
-> if a cycle oscillates, disable the deterministic lowest-priority set and report validation telemetry
```

## Skill definition and effect graph

```ts
interface SkillDefinition extends DefinitionHeader {
  kind: "attack" | "spell" | "warcry" | "buff" | "minion" | "movement" | "meta";
  grantedLevelRange: [number, number];
  weaponRequirement?: Predicate;
  targeting: TargetingDefinition;
  action: ActionTimingDefinition;
  costs: CostDefinition[];
  cooldown?: CooldownDefinition;
  reservations?: ReservationDefinition[];
  baseTags: ContentId[];
  levelTable: SkillLevelRow[];
  qualityEffects: ModifierOperation[];
  graph: EffectGraph;
  supportSockets: { base: number; maximum: number };
}
```

### Action timing

```ts
interface ActionTimingDefinition {
  windup: DurationExpr;
  executeAt: DurationExpr;
  recovery: DurationExpr;
  canMoveDuring: boolean;
  movementSpeedMultiplier?: ValueExpr;
  turnRate?: ValueExpr;
  cancelWindows: CancelWindow[];
  interruptResistance?: ValueExpr;
  queueWindowTicks: number;
}
```

An action is a state machine with authoritative start, execute, and finish ticks. Animation samples that state. The animation event does not decide when damage happens.

### Effect primitives

```ts
type EffectNode =
  | { id: string; type: "sequence"; children: string[] }
  | { id: string; type: "parallel"; children: string[] }
  | { id: string; type: "condition"; when: Predicate; yes: string; no?: string }
  | { id: string; type: "repeat"; count: ValueExpr; intervalTicks: ValueExpr; child: string; limit: number }
  | { id: string; type: "selectTargets"; query: TargetQuery; output: string }
  | { id: string; type: "dealHit"; targets: string; packet: DamageTemplate }
  | { id: string; type: "applyEffect"; targets: string; effect: ContentId; magnitude: ValueExpr; duration: ValueExpr }
  | { id: string; type: "spawnProjectile"; projectile: ProjectileDefinitionRef; count: ValueExpr }
  | { id: string; type: "spawnArea"; areaEffect: ContentId; placement: PlacementExpr }
  | { id: string; type: "spawnEntity"; entity: ContentId; placement: PlacementExpr }
  | { id: string; type: "moveActor"; movement: ForcedMovementDefinition }
  | { id: string; type: "consumeResource"; resource: ContentId; amount: ValueExpr }
  | { id: string; type: "grantResource"; resource: ContentId; amount: ValueExpr }
  | { id: string; type: "emitEvent"; event: ContentId; payload: ValueMap }
  | { id: string; type: "roll"; stream: string; chance: ValueExpr; yes: string; no?: string };
```

Every loop has a compile-time maximum. Every entity-spawning path has a budget. Graph recursion is forbidden. A support transforms a graph, stats, tags, cost, or targeting through declared operations and compatibility checks. It does not inject arbitrary runtime code.

### Support application

```ts
interface SupportDefinition extends DefinitionHeader {
  compatibility: Predicate;
  category?: ContentId;
  attribute: "strength" | "dexterity" | "intelligence" | "none";
  costMultiplier?: ValueExpr;
  reservationMultiplier?: ValueExpr;
  addTags?: ContentId[];
  removeTags?: ContentId[];
  graphTransforms?: GraphTransform[];
  modifierOperations?: ModifierOperation[];
}
```

Compilation of one equipped skill:

1. Load base skill and level/quality row.
2. Resolve item-granted or gem-specific changes.
3. Validate support compatibility and duplicate category constraints.
4. Apply support transforms in stable socket order, with explicit transform priorities.
5. Apply actor, weapon-set, passive, equipment, buff, and area modifiers by scope.
6. Validate cost, reservation, target, entity, and recursion budgets.
7. Produce an immutable `CompiledSkill` referenced by hash.

Recompile only when loadout or relevant persistent sources change. Momentary buffs remain runtime modifiers where possible.

## Damage packet and resolution

```ts
interface DamagePacket {
  source: EntityId;
  target: EntityId;
  skill: ContentId;
  hitId: string;
  tags: ReadonlyTagSet;
  components: Partial<Record<"physical" | "fire" | "cold" | "lightning" | "chaos", Fixed>>;
  critical: boolean;
  criticalBonus: BasisPoints;
  penetration: Partial<Record<string, BasisPoints>>;
  cannotAilment?: ContentId[];
}
```

Normative high-level ordering:

```text
base skill and weapon damage
-> local weapon/item calculation
-> skill conversion and gain-as-extra stages
-> applicable flat additions
-> increased/reduced source damage
-> independent more/less source damage
-> critical multiplier
-> target avoidance or block result
-> target mitigation by final type
-> penetration and resistance handling at their defined stages
-> target increased/reduced damage taken
-> target more/less damage taken
-> resource routing: guard, energy shield, life, special lethal protection
-> ailment magnitude/duration evaluation
-> hit/dealt/taken triggers
-> stun and action interruption
-> death proposal
```

The combat document specifies known PoE-like formulas. The engine expresses each stage as a versioned strategy. This matters when a patch changes one defence from a rating formula to a flat chance or changes which conversions inherit scaling.

### Event result

```ts
interface DamageResult {
  outcome: "avoided" | "blocked" | "hit";
  rawByType: DamageVector;
  mitigatedByType: DamageVector;
  appliedToGuard: Fixed;
  appliedToEnergyShield: Fixed;
  appliedToLife: Fixed;
  ailmentsApplied: EffectInstanceId[];
  stunApplied?: EffectInstanceId;
  lethal: boolean;
}
```

This object supports UI explanation, replay diffing, death recap, leech, on-hit triggers, and balance telemetry. Do not reduce it immediately to one floating-point number.

## Buffs, debuffs, ailments, and reservations

```ts
interface EffectInstance {
  id: string;
  definitionId: ContentId;
  source: EntityId;
  owner?: EntityId;
  target: EntityId;
  appliedTick: Tick;
  expiresTick?: Tick;
  magnitude: Fixed;
  stacks: number;
  stackKey: string;
  snapshot: Record<string, number>;
  flags: number;
}
```

Each effect definition declares:

- Refresh, replace, strongest-wins, add-stack, independent-stack, or ignore behavior.
- Maximum stacks and per-source/per-target scope.
- Which values snapshot at application and which query live stats.
- Tick interval and expiration inclusivity.
- Dispel categories and immunity tags.
- Modifier operations and event subscriptions.

Persistent Spirit skills create a reservation record plus one or more maintained effects/entities. Reservation validation must be atomic. If a change makes the loadout unaffordable, reject the change or deactivate skills using a deterministic priority policy shown to the player.

## Deterministic event ordering

Every event receives:

```ts
interface SimEvent<T = unknown> {
  tick: Tick;
  phase: number;
  priority: number;
  sourceOrdinal: number;
  eventOrdinal: number;
  type: ContentId;
  payload: T;
}
```

Sort lexicographically by those fields. Entity IDs and registration order must not accidentally decide design behavior.

Proposed phases:

| Phase | Events |
|---:|---|
| 10 | command acceptance and queued action start |
| 20 | movement and collision results |
| 30 | action execution, projectile collision, area pulse |
| 40 | avoidance, hit, damage, resource changes |
| 50 | ailments, buffs, leech, stun, ordinary triggers |
| 60 | death proposals and death-prevention effects |
| 70 | confirmed deaths, encounter kills, XP credit |
| 80 | loot and objective state changes |
| 90 | cleanup, expiration, snapshot |

Triggers produced in a phase may only execute in the same phase if their definition explicitly permits it and a depth budget remains. Otherwise schedule them into the next eligible phase/tick. Track a trigger ancestry chain and reject cycles with telemetry.

## Random number generation

Use a documented deterministic generator such as PCG or xoshiro with platform-identical integer operations. Derive independent streams from a master run seed with a cryptographic hash or strong keyed derivation:

```text
run master
  / atlas generation
  / area topology
  / terrain variants
  / encounter placement
  / monster packs
  / monster AI choices
  / combat proc per actor
  / loot count per source
  / item base
  / item rarity
  / affix selection
  / affix values
  / crafting operation
```

A random draw has `(stream_id, ordinal, bound, result)` in debug replays. Production can store periodic stream counters rather than every draw, but high-value economy operations should record their chosen definition IDs and values in the ledger.

Weighted selection must avoid floating-point normalization:

```ts
function weightedPick<T>(rng: Rng, rows: readonly { value: T; weight: bigint }[]): T {
  const total = rows.reduce((sum, row) => sum + row.weight, 0n);
  if (total <= 0n) throw new Error("empty weighted pool");
  let roll = rng.bigintBelow(total);
  for (const row of rows) {
    if (roll < row.weight) return row.value;
    roll -= row.weight;
  }
  throw new Error("unreachable");
}
```

Never expose economy stream state to the browser. A public map seed can reproduce geometry without being sufficient to predict item outcomes.

## Item model

```ts
interface ItemInstance {
  id: ItemId;
  templateId: ContentId;
  templateRevision: number;
  generatedManifestId: string;
  leagueId: string;
  itemLevel: number;
  rarity: "normal" | "magic" | "rare" | "unique";
  identified: boolean;
  unidentifiedTier?: number;
  quality?: { kind: ContentId; value: number; cap: number };
  modifiers: ModifierRoll[];
  implicits: ModifierRoll[];
  enchants: ModifierRoll[];
  augments: ItemAugment[];
  sockets: ItemSocket[];
  stackCount: number;
  flags: ItemFlags;
  provenance: ItemProvenance;
  location: ItemLocation;
  revision: number;
}
```

`ItemLocation` is a discriminated union for ground, inventory grid, equipment slot, stash grid, trade escrow, vendor buyback, reward claim, and destroyed tombstone. One item has exactly one location. The database enforces that invariant.

### Craft command

```ts
interface CraftItemCommand {
  operationId: string;
  accountId: AccountId;
  characterId: CharacterId;
  itemId: ItemId;
  expectedItemRevision: number;
  currencyItemIds: ItemId[];
  operationDefinitionId: ContentId;
  omenItemId?: ItemId;
  clientRequestAt: string;
}
```

Server transaction:

1. Lock or compare-and-swap all inputs in stable ID order.
2. Verify owner, location, league, count, state flags, and operation preconditions.
3. Resolve optional trigger items and exact content revision.
4. Derive an operation seed from server secret, operation ID, and locked revisions.
5. Execute a pure item transformation.
6. Append consumed, transformed, created, and destroyed economy events.
7. Update projections and increment revisions.
8. Return the already-committed result if the idempotency key is retried.

## Inventory grid model

```ts
interface GridContainer {
  id: string;
  width: number;
  height: number;
  revision: number;
  placements: Array<{ itemId: ItemId; x: number; y: number; rotated: false }>;
  affinity?: ContentId;
}
```

Use a bitset per row for collision and first-fit search. Rotation is not part of the PoE-like inventory grammar. Validate bounds and occupancy server-side. A transfer involving two containers locks them in stable container ID order and commits both revisions atomically.

## Atlas and map model

```ts
interface AtlasState {
  accountId: AccountId;
  leagueId: string;
  atlasSeed: string;
  algorithmVersion: number;
  discoveredChunks: AtlasChunkState[];
  nodes: Record<string, AtlasNodeProgress>;
  passiveAllocations: ContentId[];
  passiveChoices: Record<ContentId, ContentId>;
  masterProgress: Record<ContentId, MasterProgress>;
  bookmarks: AtlasBookmark[];
  revision: number;
}

interface AtlasNodeDefinition {
  id: string;                       // derived from atlas seed and coordinate or fixed landmark ID
  coordinate: { x: number; y: number };
  biome: ContentId;
  areaDefinitionId: ContentId;
  connections: string[];
  pointOfInterest?: ContentId;
  fixedLocation?: boolean;
  baseContent: ContentId[];
}

interface AtlasNodeProgress {
  discovered: boolean;
  status: "unattempted" | "active" | "completed" | "failed";
  attempts: number;
  completionManifestId?: string;
  strippedAfterFailure?: boolean;
}
```

Generated graph identity must survive content label changes. For chunked generation, use a deterministic node ID derived from atlas seed, algorithm version, canonical chunk owner, and local point index.

### Map input and run

```ts
interface MapActivationRequest {
  operationId: string;
  characterId: CharacterId;
  atlasNodeId: string;
  waystoneItemId: ItemId;
  expectedWaystoneRevision: number;
  tabletItemIds: ItemId[];
  partyId?: string;
}

interface MapRun {
  runId: RunId;
  accountId: AccountId;
  ownerCharacterId: CharacterId;
  partySnapshot: PartyMemberSnapshot[];
  atlasNodeId: string;
  contentManifestId: string;
  seedEnvelope: EncryptedSeedEnvelope;
  inputs: RunInputSnapshot;
  areaLevel: number;
  modifiers: CompiledAreaModifier[];
  revivesByCharacter: Record<string, number>;
  objectives: ObjectiveState[];
  state: "reserving" | "generating" | "ready" | "active" | "grace" | "finalizing" | "committed" | "cancelled";
  result?: "completed" | "failed" | "abandoned" | "invalid";
  finalizationRevision: number;
}
```

The run snapshot freezes all inputs. Later passive-tree or content changes cannot alter a run already created.

## Objective and encounter state

```ts
interface ObjectiveDefinition extends DefinitionHeader {
  completion: Predicate;
  failure?: Predicate;
  events: ContentId[];
  rewards: RewardTableRef[];
  visibility: "hidden" | "discovered" | "always";
  requiredForAreaCompletion: boolean;
}

interface EncounterDefinition extends DefinitionHeader {
  entry: Predicate;
  stateMachine: StateMachineDefinition;
  spawnBudget: BudgetDefinition;
  timerPolicy?: TimerPolicy;
  rewardTables: RewardTableRef[];
  objectiveIds: ContentId[];
}
```

Use a generic finite-state machine with guarded transitions and entry/exit effects for strongboxes, expanding breaches, ritual circles, delirium fog, multi-wave remnants, bosses, and map completion. Boss-specific scripts can use authored graph nodes, but remain bounded and deterministic.

## Reward tables

```ts
interface RewardTable extends DefinitionHeader {
  rolls: ValueExpr;
  entries: RewardEntry[];
  replacementPolicy?: "withReplacement" | "withoutReplacement";
  pityCounter?: PityDefinition;
}

type RewardEntry =
  | { weight: ValueExpr; when: Predicate; result: { kind: "nested"; tableId: ContentId } }
  | { weight: ValueExpr; when: Predicate; result: { kind: "item"; poolId: ContentId; quantity: ValueExpr } }
  | { weight: ValueExpr; when: Predicate; result: { kind: "gold"; amount: ValueExpr } }
  | { weight: ValueExpr; when: Predicate; result: { kind: "progress"; progressId: ContentId; amount: ValueExpr } };
```

Quantity, rarity, item-tier quality, monster rarity, encounter multipliers, and party policy are separate context values. This lets the UI explain reward pressure and allows balance changes without replacing the drop engine.

## Passive trees

```ts
interface PassiveNodeDefinition extends DefinitionHeader {
  graphPosition: { x: number; y: number };
  connections: ContentId[];
  kind: "minor" | "notable" | "keystone" | "socket" | "choice" | "start";
  cost: number;
  allocationRules: Predicate;
  options?: PassiveChoiceOption[];
  operations: ModifierOperation[];
  grants?: ContentId[];
}
```

Character and Atlas passive trees use the same graph model but separate point currencies and allocation policies. Weapon-set specialization records one common allocation plus set-specific deltas. Choice nodes keep the node allocated and switch one active option without pretending the whole tree was respecced.

Allocation is a transaction:

1. Apply requested adds/removes/choice changes to a candidate graph.
2. Verify point balance, connection to a valid start, class/quest restrictions, non-specializable node rules, and choice cardinality.
3. Compile affected stats/skills and ensure the loadout remains valid.
4. Commit graph revision and cost/refund events.

## Persistence schema

Representative relational tables:

```text
accounts(id, created_at, status, revision)
leagues(id, rules_manifest_id, starts_at, ends_at, flags)
characters(id, account_id, league_id, class_id, level, xp, build_revision, state_json)
item_instances(id, league_id, owner_account_id, template_id, generated_manifest_id,
               state_json, location_kind, location_id, revision, destroyed_at)
containers(id, owner_account_id, league_id, kind, width, height, revision, metadata_json)
container_placements(container_id, item_id, x, y, primary key(container_id, item_id))
atlas_states(account_id, league_id, seed, algorithm_version, state_json, revision)
map_runs(id, owner_account_id, character_id, node_id, manifest_id, state,
         input_json, result_json, finalization_revision, created_at, finalized_at)
economy_events(sequence, event_id, operation_id, account_id, item_id, type,
               before_hash, after_hash, payload_json, created_at)
trade_orders(id, seller_account_id, item_id, price_json, state, revision, created_at)
trade_fills(id, order_id, buyer_account_id, operation_id, fee, result_json, created_at)
idempotency_results(scope, operation_id, request_hash, response_json, committed_at)
```

Use normalized columns for identity, ownership, revision, and query-critical state. Use JSONB for versioned item/Atlas payloads where shape changes frequently. Add constraints and partial unique indexes so one live item cannot occupy two locations or back two open listings.

## Economy event invariants

For every operation:

```text
sum(created value identities)
and sum(destroyed/consumed identities)
must be explainable by one authorized rule,
with no item owned by two accounts,
no negative stack,
no missing parent operation,
and no duplicate operation ID in scope.
```

The ledger is not a blockchain and does not need public consensus. It is an append-only audit stream backed by normal database transactions and retention policies. Sensitive support metadata stays access-controlled.

## Save, replay, and checksum formats

A run replay contains:

```ts
interface ReplayEnvelope {
  replayVersion: number;
  protocolVersion: number;
  contentManifestId: string;
  rulesBuildHash: string;
  mapGeneration: { algorithmVersion: number; publicSeed: string; generatedMapHash: string };
  privateSeedReference: string;
  initialCheckpoint: Uint8Array;
  commandBatches: CommandBatch[];
  authoritativeEvents?: CompactEvent[];
  checkpoints: Array<{ tick: Tick; state: Uint8Array; checksum: string }>;
}
```

Canonical checksum serialization sorts entities by ID, components by numeric type ID, maps by compiled stable key, and excludes presentation-only state. Hash quantized authoritative values only.

When checksums diverge, the replay differ prints the first tick, entity, component, field, event ancestry, and RNG stream ordinal that differs. A checksum mismatch without such tooling is not actionable.

## Content validation

Compiler errors:

- Missing or duplicate stable ID.
- Reference to unavailable or removed content.
- Stat unit mismatch.
- Cyclic derived stat or effect graph.
- Unbounded repeat, trigger, entity spawn, chain, fork, or target count.
- Impossible skill/support compatibility.
- Modifier with no eligible base or conflicting groups that make a tier unreachable.
- Reward table with zero total weight for a reachable context.
- Passive graph with unreachable nodes or illegal allocation cycle.
- Map or encounter requiring an absent socket type.
- Localization key or gameplay-critical icon missing.
- Migration that cannot read a supported saved instance.

Warnings with enforced budgets:

- Item-affix tier never selected in one million simulated rolls.
- Skill cost can become negative or overflow cap.
- Boss phase has no legal transition under a tested build.
- Reward expected value differs beyond configured patch tolerance.
- Visual effect can exceed entity/particle budget.

## Explainability API

Players and developers need the same derivation engine:

```ts
interface ExplainedValue {
  statId: ContentId;
  finalValue: number;
  stages: Array<{
    stage: string;
    input: number;
    operations: Array<{ source: string; kind: string; value: number }>;
    output: number;
  }>;
}
```

Use it for advanced character sheet values, skill cost, damage range, defence estimates, map reward modifiers, death recap, and test failure messages. A data-heavy ARPG becomes unmaintainable when the only answer to "why is this number 317?" is stepping through arbitrary code.

## Rules-engine completion gate

The model is sufficient for production content only when:

- One effect graph can express every vertical-slice skill without custom damage code.
- Items, passives, buffs, monsters, and area modifiers share the same stat operations.
- Golden replays match in Node and all supported browser engines.
- Every persistent operation is retry-safe and economy-audited.
- A content migration round-trips old items, builds, Atlas states, and replays.
- The explainability API accounts for every visible final value.
- Fuzzing cannot produce negative stack sizes, multiple item locations, invalid passive graphs, infinite triggers, or non-finite combat values.

