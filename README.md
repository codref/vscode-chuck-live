# ChucK Live

VS Code / Cursor extension for **live coding** with [ChucK](https://chuck.stanford.edu/): persistent VM, shred add/replace/remove, and a knobs panel driven by source annotations over OSC.

## Requirements

- [ChucK](https://chuck.stanford.edu/) on your `PATH` (`chuck` CLI). This machine has 1.5.x+.
- Node.js 18+ to build.

## Install (this workspace)

```bash
cd /home/operatore/git-codref/r-n-d/vscode-chuck-live
# If npm is available:
npm install && npm run compile && npm run package
# Without npm (deps already vendored under node_modules/typescript):
node node_modules/typescript/lib/tsc.js -p .
node scripts/package-vsix.js

cursor --install-extension chuck-live-0.1.0.vsix
# or: code --install-extension chuck-live-0.1.0.vsix
```

**Dev host:** open this folder in Cursor/VS Code, press F5 (“Run Extension”).

## Quick start

1. Open `examples/demo.ck`, `examples/cyberpunk.ck`, or an oscillator under `examples/oscillators/`.
2. Command Palette → **ChucK: Start VM** (or the ChucK Live activity bar).
3. **ChucK: Add Current File** (`Ctrl+Shift+.` / `Cmd+Shift+.`).
4. Open the **Knobs** view; use **All (grouped)** when several shreds are loaded.
5. Edit and **ChucK: Replace / Live Update** (`Ctrl+.` / `Cmd+.`) to hot-swap.

### Mixable oscillators (`examples/oscillators/`)

Each file is a separate shred with **unique** knob names so they can run together and mix at the DAC:

| File | Role | Main knobs |
|------|------|------------|
| `sine.ck` | clean tone | amp, freq, detune, vib, pan |
| `saw.ck` | bass / lead body | amp, freq, cutoff, Q, drive |
| `square.ck` | pulse / PWM | amp, freq, width, cutoff, pwmHz |
| `triangle.ck` | soft stack | amp, freq, sub, fifth, chorus |
| `fm.ck` | 2-op FM | amp, car, ratio, index, fb |
| `noise.ck` | air / grit | amp, cutoff, Q, hp, gateHz |
| `lfo-sine.ck` | slow pad drone | amp, rate, center, depth, space |

Workflow: Start VM → Add `sine.ck` → Add `saw.ck` → … → Knobs **All (grouped)** → blend amps.

## Annotations

Place a comment **immediately above** a `global` declaration:

```chuck
// @knob min=0 max=1 step=0.01 default=0.5
global float gain;

// @knob ui=slider min=110 max=880
global float freq;

// @slider min=0 max=1
global float mix;

// @button
global Event bang;
```

| Tag | Applies to | OSC |
|-----|------------|-----|
| `@knob` | `global float` or `global int` | `/chuck/<name>` float |
| `@knob ui=slider` or `@slider` | same | same (horizontal slider UI) |
| `@button` | `global Event` | `/chuck/<name>` int bang |

Default knob UI is a **rotary dial**. Use `ui=slider` or `@slider` for a classic range slider.

Optional knob attrs: `min`, `max`, `step`, `default`, `ui` (`dial` \| `slider`).

Unannotated globals are ignored. The extension generates a temp OSC bridge shred that declares the same globals and writes them when knobs move.

## Architecture

- **VM:** `chuck --loop` (OTF TCP, default port 8888).
- **Shreds:** `chuck +/=/-/^` against that listener.
- **Knobs:** UDP OSC (default port 9000) → bridge shred → shared `global`s.

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `chuckLive.executable` | `chuck` | Binary path. Default auto-picks `bin/chuck-pw` (`pw-jack chuck`) when installed; set an absolute path to override |
| `chuckLive.otfPort` | `8888` | OTF / VM port |
| `chuckLive.oscPort` | `9000` | Knob OSC port |
| `chuckLive.vmArgs` | `[]` | Extra `--loop` args |
| `chuckLive.saveBeforeAdd` | `true` | Save editor before add/replace |

### Audio (PipeWire / JACK)

This build of `chuck` uses **JACK**. On PipeWire systems the extension ships `bin/chuck-pw`:

```sh
#!/bin/sh
exec pw-jack chuck "$@"
```

Start the VM after PipeWire is running. Verify with:

```bash
bin/chuck-pw --probe
```

## Commands

- Start / Stop VM
- Add Current File / Replace (live update) / Remove Shred / Remove All
- Refresh Status / Refresh Knobs
