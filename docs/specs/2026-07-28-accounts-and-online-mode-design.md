# Accounts and online mode

Status: **local half built; online half remains design-only.** Written 2026-07-28 and reconciled
against current code 2026-08-05. See **What has shipped** below and the
[`current implementation contract`](2026-08-05-current-implementation-contract.md).

The intended playable game can eventually ship at **exiledcasual.com**, in two modes: **local** (browser
storage, no account, works offline) and **online** (login, account, database). This document
picks the architecture and names what it costs, so the choice is not made accidentally by the
first commit that touches auth.

As of 2026-08-05 the domain serves a teaser only. No playable build or online service is deployed.

## What already holds

Verified 2026-07-28, not assumed:

- Nothing under `packages/` references `window`, `document`, `indexedDB` or `localStorage`
  except `packages/persistence/src/index.ts`. Sim, rules, mapgen, protocol and replay are
  DOM-free, so the *same* simulation runs unmodified in Node.
- Storage already sits behind `KvStore` (`MemoryKv`, `IndexedDbKv` in `packages/persistence`).
- The client is untrusted by construction: it sends intents; `interact.ts` and friends re-check
  range, tier, cost and placement. It has never been allowed to state an outcome.
- `packages/replay` reconstructs a run from a seed and a command log, and the sim is fixed-point
  deterministic, so a replay lands on an identical checksum.

That last pair is the whole reason a cheap online mode is available at all.

## The choice: who runs the simulation

**A. Server-authoritative sim.** Sim runs in Node, client sends intents over a socket and
receives snapshots. Textbook-correct. Costs a live process per concurrent player, makes every
input round-trip, and an ARPG at 30 Hz with a click-to-move melee character feels every bit of
that latency. It also means the game stops working the moment the server does, which kills the
local mode as a shared code path.

**B. Client sim, server verification by replay.** The client keeps simulating locally, exactly
as it does today, and submits `{ seed, commandLog, resultChecksum }` at each durable boundary
(map completed, item stashed, level gained). The server re-runs the same deterministic sim over
that log and commits the result only when its own checksum matches. Hosting is a request
handler, not a session; local and online run identical code; offline play is free.

**Take B.** It is the lazy option that actually holds, and it is only available because the
determinism and replay work is already done. B stops the attack that matters for an ARPG: item
and currency duplication, edited stashes, invented gold. State can only change through a
sequence of inputs that legitimately produces it.

Be honest about B's ceiling, because it is real:

- It does **not** stop input automation. A bot that plays legitimately produces a legitimate
  log. Botting is a detection problem (behavioural, server-side), not an architecture problem,
  and it is not worth solving before there is anyone to bot against.
- It does **not** stop a modified client from playing with perfect information or reaction.
- Verification cost is proportional to real playtime. A map that took four minutes takes the
  server real CPU to re-simulate. Mitigate by verifying at map granularity (not per tick) and
  by capping submitted log length; if it ever bites, sample-verify and re-simulate in full only
  on suspicion.

B upgrades to A later for a ladder or hardcore league without the sim changing, because the sim
is the same binary either way. That optionality is the point.

## Save authority

Today the client writes its own blob through `IndexedDbKv`. Online, a client-written save is a
client-written gold balance, so:

- **Local mode:** unchanged. `IndexedDbKv`, the client is the authority over its own machine,
  and cheating only hurts the cheater.
- **Online mode:** the server owns the row. The client never PUTs a save blob. It submits
  command logs; the server derives and stores the state. A third `KvStore` implementation is
  *not* the answer here — `KvStore` is an opaque blob store, and swapping in an `HttpKv` would
  faithfully upload a forged blob. The interface stays for local mode; online mode uses a
  different, narrower API (`submitRun`, `fetchState`).

## Cross-mode progression

**Local and online characters are separate pools. No import, in either direction.** A local
character importable online is a duplication path unless the server has seen every command that
made it, which is exactly the thing local mode does not send. Separation costs one sentence in
the UI and zero code; the alternative costs a permanent economy exploit.

If a bridge is ever wanted, the only safe form is replaying the local character's full command
log server-side on import, which is B applied retroactively and can be added later without
changing this decision.

## Save migration

`persist.VERSION` used to discard any blob whose version did not match, and `persist.ts` said so
plainly: "nothing is live yet, no migration path". That was correct then and unacceptable the day
a stranger has a character.

**Done, 2026-07-29.** The first migration exists: `migrateSingleSave` in
`packages/simulation/src/roster-io.ts` turns a `version: 2` single save into a one-character v3
roster, hoisting its stash up to the roster on the way. It is deliberately narrow — only v2 is
understood — and the discard behaviour survives as the final fallback for anything older, which
is exactly the shape this section asked for. `characters.test.ts` runs it against a blob captured
from the real `saveTo`, not a hand-written fixture.

Two versions are now in play and they are not the same number: `persist.VERSION` (2) versions ONE
character's save and did not move, because its shape did not change; `ROSTER_VERSION` (3) versions
the blob that wraps those saves.

Migration is applied on read and **not committed on read**: a player who only opens the menu still
has their old blob on disk untouched. The new shape lands on the first save.

## Auth, database, hosting

Keep this boring; it is the least interesting part of the project and should consume the least
time.

- **Auth + database:** one managed Postgres with built-in auth and row-level security. Email and
  password, with the row-level policy doing the real work: a player can only read and write
  their own rows, enforced by the database rather than by application code that has to remember.
- **Client hosting:** static build on an edge host, plus one function endpoint for run
  submission and state fetch. There is no persistent socket in architecture B, which is what
  makes edge hosting viable at all.
- **The sim on the server** is the existing `packages/simulation` published as a plain Node
  dependency of that endpoint. It must never fork: a server-only branch of the sim is the same
  failure as writing the game twice.

## Legal

Going public on a bought domain raises the stakes on the fan-project framing in `README.md`.
That framing is a claim, and it has to keep being true: original name and fiction, original and
CC0 art only, no shipped game data, no PoE branding. The reference screenshots stay gitignored
and undistributed. Revisit before the first public link, not after.

## Sequence

Nothing here blocks gameplay work, and none of it should start before there is a game worth an
account. Rough order when it does start:

1. ~~Migration chain replacing the `VERSION` discard~~ **done 2026-07-29**, see Save migration.
2. Run submission format: `{ seed, commandLog, checksum }` and the durable boundaries that
   trigger it.
3. Server verification endpoint re-simulating the log.
4. Auth, accounts, rows.
5. ~~Mode selection in the client, and the separation notice~~ **done 2026-07-29** — the UI half
   of it, see below. The online branch is present and refused.

## What has shipped

2026-07-29, with the main menu and character select:

- **A roster.** `packages/persistence/src/roster.ts` holds a record per character (id, name,
  class, level, league) plus a shared stash, and treats each character's save as an OPAQUE
  `state`. The storage leaf still knows nothing about sessions or inventories;
  `packages/simulation/src/roster-io.ts` and `characters.ts` are the only places that parse it.
- **The local cap is one character** (`LOCAL_CHARACTER_CAP`). Not a technical limit — the shape
  holds any number — but the honest one: without a server there is no account for several
  characters to belong to. The cap is passed in by the caller, so online passes `Infinity` and
  nothing about the shape changes when it lands.
- **The separation notice is a choice, not a footnote.** `PLAY` opens a dialog asking which world
  the character lives in, before the roster is ever shown, because "no import in either
  direction" is only fair if it is said before the character exists rather than after.
- **The stash moved up.** It used to sit inside the single save; it now sits on the roster,
  shared by every character, the way PoE shares a stash account-wide.
- **Gold and shards did not.** They stay per-character even though `protocol/index.ts` calls gold
  "account-bound", because sharing them means threading roster state through vendor buy and sell,
  and with the cap at one character nothing is observable until online exists. Decide it there.
- **Portable local saves shipped on 2026-08-02.** Character select exports the complete roster as
  versioned JSON. Import validates the roster version before confirmation and atomic replacement;
  a rejected file leaves the existing save untouched.
- **Settings are roster-global opaque data.** The persistence package stores them without learning
  their schema; `settings.ts` is the total parser and corrupt fields fall back independently.

Still absent, deliberately: any account, any login, any network call. The client has never once
tried to reach a server.
