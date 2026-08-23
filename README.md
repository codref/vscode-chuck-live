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

1. **ChucK: Init Project Library** (optional) — copies modules into `chuck/` and AI agent docs for Cursor/Copilot.
2. See **[examples/README.md](examples/README.md)** for the bundled library reference.
3. Open a patch → **ChucK Session** → **Start VM** (Control). **Knobs** stay under **ChucK Live**.
4. **Add Current File** (`Ctrl+Shift+.`) — shreds appear in **Shreds**. Drag to reorder (list + rack).
5. **Open Rack** / **Open Sequencer** from the Shreds toolbar; **Meter** sits under Shreds.
6. **Reload Shred** (`Ctrl+.`) or the inline sync icon on a shred to hot-swap — also via editor title / CodeLens **Reload**.

Tip: drag the **ChucK Session** activity icon to the Secondary Side Bar for a right-hand panel (Cursor does not allow extensions to pin views there directly).

### Mixable oscillators (`examples/oscillators/`)

Load **`master.ck` first**, then instruments/drums, then **`out/dac-out.ck` or `fx/bus-fx.ck`**. Add **`out/record-out.ck` anytime** to capture WAV (tap-only; safe mid-session). Details: [examples/README.md](examples/README.md).

Cyberpunk bus recipe: [examples/cyberpunk/README.md](examples/cyberpunk/README.md). Standalone: `demo.ck`, `cyberpunk.ck` (direct `dac`).

## Annotations

Place a comment **immediately above** a `global` declaration. Type `// @` for IntelliSense: tags, attributes (`min`, `max`, `step`, `default`, `ui`, `mode`, `gate`), and `gate=` Event names from the current file.

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

- **VM:** `chuck --loop` (OTF TCP, default port 8888). Session **Control** + status bar.
- **Shreds:** **ChucK Session** — add / reload / remove / drag-reorder (UI + rack order only).
- **Knobs:** **ChucK Live** sidebar (alone) for the active `.ck`; UDP OSC (default port 9000) → bridge → shared `global`s.
- **Meter:** dac L/R peaks → meter shred → UDP OSC (default port 9001) → Session **Meter** view.
- **Rack / Sequencer:** editor panels, opened from the Shreds toolbar.

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `chuckLive.executable` | `chuck` | Binary path. Default auto-picks `bin/chuck-pw` (`pw-jack chuck`) when installed; set an absolute path to override |
| `chuckLive.otfPort` | `8888` | OTF / VM port |
| `chuckLive.oscPort` | `9000` | Knob OSC port |
| `chuckLive.meterPort` | `9001` | VU meter OSC port |
| `chuckLive.vmArgs` | `[]` | Extra `--loop` args |
| `chuckLive.saveBeforeAdd` | `true` | Save editor before add/reload |
| `chuckLive.initLibraryDir` | `chuck` | Default folder for **Init Project Library** |

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

- Start / Stop VM (Session **Control**)
- Add Current File / Reload Shred / Remove Shred / Remove All — inline actions on the Shreds list, CodeLens **Load** / **Reload**, editor title icons
- Refresh Status / Refresh Knobs
- **Open Rack** — full-page Eurorack modules for loaded shreds
- **Open Sequencer** — 16-step grid bound to any `@knob`/`@seq` float (e.g. `sine_freq`, `mb_noteHz`)
- **Init Project Library** — copy the bundled module library into your workspace (`chuck/` by default) and deploy AI guides (`AGENTS.md`, Cursor rule, Copilot instructions)
- **Re-init Project Library (force)** — replace an existing library and refresh AI guides (full preset wipes the library folder first)
- **Meter** (ChucK Session) — L/R peak VU bars; auto-loaded with Start VM
