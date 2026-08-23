# ChucK Live — AI agent guide

This project uses the **ChucK Live** VS Code/Cursor extension for live coding.

## Workflow

1. **ChucK: Start VM** (Session **Control**) — starts `chuck --loop` (OTF port 8888 by default).
2. **Add Current File** — loads a `.ck` shred into the VM (listed under **Shreds**).
3. **Reload Shred** (`Ctrl+.` / `Cmd+.`) — hot-swap; also the inline sync icon on a shred.
4. **Knobs** (**ChucK Live** activity icon) — controls for the **active editor** (`@knob`, `@slider`, `@button`).
5. **Open Rack** / **Open Sequencer** — from the Shreds toolbar.
6. **Meter** (ChucK Session) — L/R peak VU (auto-loaded with VM).
7. Drag shreds in the list to reorder (display + rack only).

Watch **Output → ChucK** for VM logs and recording messages.

## Bus architecture (modular patches)

```text
instruments ──► rackBus ──► master.ck ──► mainBus ──► ONE speaker output ──► dac
                                                      ├─ out/dac-out.ck
                                                      └─ fx/bus-fx.ck
                                         └─► out/record-out.ck → WvOut (optional tap)
```

Shared globals:

| Global | Owner | Role |
|--------|-------|------|
| `rackBus` | `master.ck` | Sum bus; instruments patch here |
| `mainBus` | `master.ck` | Post-master mix; output + record read this |

**Load order:** `master.ck` → instruments/drums → **exactly one** of `dac-out.ck` or `bus-fx.ck`. Add/remove instruments live. Add `record-out.ck` anytime to capture; remove it without killing speakers.

**Never load two speaker outputs** (dac-out + bus-fx) — double `dac` breaks audio.

Without `master.ck`, bus-aware modules are silent. Without an output shred, `mainBus` never reaches speakers.

## Standalone patches

Files under `standalone/` connect directly to `dac` (no `rackBus`). Do not mix standalone and bus modules in one session without refactoring.

## Annotations (comment immediately above `global`)

```chuck
// @knob min=0 max=1 step=0.01 default=0.5
global float gain;

// @slider min=40 max=1600
// @seq mode=raw
global float sine_freq;

// @seq mode=midi min=24 max=84 gate=mb_gate
global float mb_noteHz;

// @seqGate
global Event dk_kick;

// @button
global Event rec_toggle;
```

Extension generates a temp **OSC bridge** shred mapping `/chuck/<name>` → those globals. Unique global names across loaded files. Knobs/Rack buttons show the **event name** (not a generic label).

## When editing or generating `.ck` files

- Bus instruments: `global Gain rackBus;` then `… => rackBus` (often via `Pan2`).
- Use `spork ~ follow();` loops to copy knob globals into UGen params (~5–20 ms).
- Master owns filtering/drive on `rackBus` → `mainBus`; instruments do not connect to `dac` directly.
- Prefer modest amplitudes on stacked modules (`master_amp`, per-voice amps).
- Recording: `out/record-out.ck` is tap-only (`mainBus → WvOut`); keep dac-out/fx loaded. Edit `OUT_PATH`, toggle `rec_toggle` from Knobs with that file focused. Safe to unload mid-session.

## Settings (workspace)

- `chuckLive.otfPort` — VM OTF (default 8888)
- `chuckLive.oscPort` — knob OSC (default 9000)
- `chuckLive.executable` — `chuck` or path; extension may use `bin/chuck-pw` (PipeWire/JACK)

See `chuck/README.md` in this repo for module inventory and recipes.
