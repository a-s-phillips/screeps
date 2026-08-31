# screeps-bot

A [Screeps: World](https://docs.screeps.com/introduction.html) colony AI, written in TypeScript and bundled to a single JS file for the Screeps runtime.

Status: **early / post-MVP.** One room, three creep roles, automatic extension placement, and a telemetry pipeline. No multi-room logic, no combat, no economy beyond "keep the controller fed."

## What it does today

- **Spawning** (`src/spawn/`) — a single spawn per room decides what to spawn next based on simple role targets: `2× harvester` per active energy source, up to `2` upgraders, and up to `2` builders whenever construction sites exist. Body plans (`src/spawn/bodyPlanner.ts`) repeat a fixed `WORK`/`CARRY`/`MOVE` block as many times as available energy and `MAX_CREEP_SIZE` allow.
- **Roles** (`src/roles/`) — harvester, upgrader, builder. All three share a `working`/`!working` state machine (`src/roles/shared.ts`): gather energy from the nearest active source until full, then spend it until empty. Harvesters fill the spawn first and upgrade the controller with any leftover trips; builders prefer open construction sites and fall back to upgrading; upgraders always upgrade.
- **Room planning** (`src/planning/`) — once a room is visible, `roomPlanner.ts` checks how many `STRUCTURE_EXTENSION`s the current RCL allows and, if under that cap, places one construction site per tick. `extensionPlanner.ts` searches concentric rings out from the spawn for the nearest free, walkable, checkerboard-spaced tile.
- **Memory hygiene** (`src/memory/cleanup.ts`) — prunes `Memory.creeps` entries for creeps that died since the last tick.
- **Logging & telemetry** (`src/logging/`) — an in-memory ring buffer of structured log entries (spawns, spawn failures, hostile sightings, RCL level-ups, per-tick room/CPU summaries, uncaught errors) gets serialized into `RawMemory` segment 0 every tick. `tools/telemetry/poller.mjs` polls that segment from outside the game (via the Screeps API) and writes it into a local SQLite file (`telemetry.sqlite`) for querying/dashboarding.

## Architecture

- **Entry point:** `src/main.ts` exports `loop()`, called once per game tick by the Screeps runtime. It resets per-tick caches, prunes dead creep memory, runs spawning, runs every creep's role, runs room planning and hostile/RCL detection per visible room, and flushes the log buffer.
- **State:** `Game.*` is rebuilt fresh every tick by the runtime; only `Memory` (backed by `RawMemory`) persists across ticks. Memory shapes are declared via module augmentation in `src/types/memory.d.ts` rather than `any`-casts.
- **Per-tick caching:** `src/utils/roomCache.ts` memoizes `Room.find()` calls within a single tick (cleared at the top of `loop()`) since the same `FIND_*` queries get reused across spawning, roles, and planning.
- **Error isolation:** `src/logging/errorHandler.ts` wraps the whole tick body so an uncaught exception gets logged instead of crashing the runtime script silently.

## Tech stack

- TypeScript, bundled with [Rollup](https://rollupjs.org/) into a single JS file (no Node built-ins, no runtime `require`), following [`screeps-typescript-starter`](https://github.com/screepers/screeps-typescript-starter) conventions.
- [`@types/screeps`](https://www.npmjs.com/package/@types/screeps) for ambient `Game`/`Memory`/`Creep`/etc. types.
- [Vitest](https://vitest.dev/) for unit tests, ESLint + Prettier for lint/format, all wired into GitHub Actions CI (`.github/workflows/`) on every push/PR to `main`.
- Deploys via a maintained fork of `rollup-plugin-screeps` (`github:a-s-phillips/rollup-plugin-screeps`) — the upstream package is unmaintained.

## Getting started

```bash
nix develop        # or: direnv allow (uses .envrc -> flake devShell)
npm install
npm test            # vitest
npm run typecheck
npm run lint
npm run build        # rollup -c, output in dist/
```

Copy `screeps.json.example` to `screeps.json` (gitignored — never commit real tokens) and fill in credentials for whichever destinations you use:

```bash
npm run push-pserver   # push to the local private server
npm run push-main      # push to the official screeps.com server
```

**First push to a brand-new branch name on any account:** pushing creates the branch via `clone-branch` but does _not_ make it active. Call `POST /api/user/set-active-branch` once (`{branch, activeName: "activeWorld"}`) or the engine keeps silently running the empty `default` branch — see `CLAUDE.md` for the full gotcha writeup.

## Dev environments

Two deploy targets, same source tree:

1. **Local private server** — Docker Compose stack in the sibling repo `~/code/screeps/pserver` (game engine + browser client). Safe to experiment on freely.
2. **Official `screeps.com`** — a real, persistent (eventually shared) world. Treat pushes here as real deploys.

Telemetry dashboards (Grafana, reading `telemetry.sqlite`) are managed from the sibling repo `~/code/screeps/telemetry`. Run the poller with `npm run telemetry` (official server, rate-limit-safe interval) or `npm run telemetry:pserver` (local server, faster polling).

Full setup details, credentials, endpoints, and known gotchas for both environments live in `CLAUDE.md`.

## Testing philosophy

TDD: every piece of logic is covered by a unit test, mocking `Game`/`Memory`/`RawMemory` as needed rather than requiring a live server. Pure logic (spawn decisions, body planning, room/extension planning, log buffer management) is tested this way in `test/`, mirroring the `src/` layout. Integration-level checks run against the local private server, not the official one.

## Project management

To-dos and design notes for this project live outside this repo, in a `zk`-managed notes vault (`~/secondbrain`, tagged `#screeps`) — not as markdown files or GitHub issues here.
