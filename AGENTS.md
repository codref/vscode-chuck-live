# ChucK Live extension — AI agent guide

VS Code/Cursor extension for live ChucK: one VM, OTF shreds, OSC bridge, rack, sequencer.

## Workflow

1. **Start VM** — `chuck --loop` on `chuckLive.otfPort` (default 8888).
2. **Add / Reload** `.ck` shreds — bridge, meter, transport managed automatically.
3. **Open Rack / Sequencer** from Shreds toolbar.
4. Watch **Output → ChucK** for VM logs.

Init-project templates ship their own `AGENTS.md` under `templates/project-init/`.

## Architecture (one VM)

| Piece | Role |
|-------|------|
| Bridge shred | OSC → `global`s (`chuckLive.oscPort`, 9000) |
| Meter shred | dac L/R + module peaks → `meterPort` (9001) |
| Transport shred | Sync-on sequencer clock, `live_*` globals |
| User shreds | `rackBus` → master → `mainBus` → fx/dac |

**Do not** assume multiple ChucK processes — extension manages a single listener.

## CPU policy (required for all `.ck` and generator changes)

ChucK Live sessions stack many shreds. **Always minimize work when silent** and avoid orphaned high-rate loops.

### Extension-generated shreds (`src/*Gen.ts`)

- **No `spork` from OTF-replaced parents** unless children exit on a generation counter (`transportGen` pattern). Orphan sporks are a common cause of 50–70% idle CPU.
- **Meter** (`meterGen.ts`): one main loop at **25 ms** (~40 Hz); never `spork` per-sample dac trackers.
- **Mod matrix** (`modGen.ts`): apply routes in the **main shred loop**; idle **250 ms** when no routes active.
- **Transport** (`transportGen.ts`): clock in **main loop**; swing workers only for active tracks; bump `transportGen` so old workers exit.

### Example / voice / drum `.ck` files

1. **Peak meters (`_ckLivePeak`)** — **25 ms** control rate (~40 Hz UI), not `1::samp`. Decay: `Math.pow(0.001, 1.0 / (0.05 * 40.0))`.
2. **Follow / knob mirroring** — **5–25 ms**; slower when idle or sustaining.
3. **Manual sample loops** (`foldLoop`, `crushLoop`, etc.) — run at audio rate **only while the voice is sounding**; otherwise sleep **25 ms** and output 0.
4. **Idle sleep** — when envelope off and output silent:
   - `voiceUnlink()` — disconnect `out` and synthesis pulls (`mix =< blackhole`, etc.) so the DAC does not tick the full graph.
   - `sleepMix()` — zero oscillator gains into the bus.
5. **Gate / sequencer voices**:
   - **One `hitWorker` shred** — never `spork ~ hit()` per gate (pile-up under dense patterns).
   - **Coalesce** same-step bangs (`lastGateSec` / 3 ms window).
   - **Legato** — if `env.value() > 0.015`, refresh P-locks only; skip blocking `stepDur` waits on retrigger.
6. **Texture loops** (crackle, chaos) — sleep when macros near zero and voice silent.
7. **Avoid** `while (true)` with no `=> now` or with `continue` and no sleep on hot paths.

### When full CPU is acceptable

- Active notes, release tails, dense FX — the ugen graph runs at audio rate by design.
- Do not “optimize” by breaking sound; unlink when **truly silent**.

### Checklist before merging voice/drum changes

- [ ] Reload shred 3× — idle CPU should not climb (no spork leak).
- [ ] Stop VM — CPU returns to baseline.
- [ ] Sequencer all-16 gates — no shred explosion; legato path for stacked 16ths.

## Key paths

| Area | Path |
|------|------|
| Transport generator | `src/transportGen.ts` |
| Meter generator | `src/meterGen.ts` |
| Mod matrix generator | `src/modGen.ts` |
| Reference voice (CPU patterns) | `examples/voices/neural-matrix.ck` |
| Bus examples | `examples/oscillators/master.ck`, `examples/README.md` |

## Settings

- `chuckLive.otfPort`, `oscPort`, `meterPort`, `executable`
