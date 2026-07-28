# Accounts and online mode

Status: design, not implemented. Written 2026-07-28, before any account code exists.

The game goes public and playable at **exiledcasual.com**, in two modes: **local** (browser
storage, no account, works offline) and **online** (login, account, database). This document
picks the architecture and names what it costs, so the choice is not made accidentally by the
first commit that touches auth.

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

`persist.VERSION` currently discards any blob whose version does not match, and
`persist.ts` says so plainly: "nothing is live yet, no migration path". That is correct today
and unacceptable the day a stranger has a character.

**Before public launch:** replace the discard with a migration chain, one pure function per
version step, each with a test that loads a real captured blob of the previous version. The
discard behaviour stays only as the final fallback for a blob older than the oldest migration.

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

1. Migration chain replacing the `VERSION` discard (the only item that is a bug the day it is
   needed, and the cheapest to do while nothing is live).
2. Run submission format: `{ seed, commandLog, checksum }` and the durable boundaries that
   trigger it.
3. Server verification endpoint re-simulating the log.
4. Auth, accounts, rows.
5. Mode selection in the client, and the separation notice.
