# ChucK Live

VS Code / Cursor extension for **live coding** with [ChucK](https://chuck.stanford.edu/): persistent VM, shred add/replace/remove, and a knobs panel driven by source annotations over OSC.

## Requirements

- [ChucK](https://chuck.stanford.edu/) on your `PATH` (`chuck` CLI). This machine has 1.5.x+.
- Node.js 18+ only if you build from source.

## Install (VS Code / Cursor)

1. Open the latest [GitHub Release](https://github.com/codref/vscode-chuck-live/releases) and download `chuck-live-*.vsix`.
2. In **VS Code** or **Cursor**:
   - Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Extensions: Install from VSIX…**
   - Or: Extensions view (`Ctrl+Shift+X`) → `…` menu (top right) → **Install from VSIX…**
3. Pick the downloaded `.vsix`, then **Developer: Reload Window** if the extension does not activate yet.

CLI alternative (with the editor CLI on `PATH`):

```bash
# Cursor
cursor --install-extension chuck-live-0.3.59.vsix --force
# VS Code
code --install-extension chuck-live-0.3.59.vsix --force
```

After install you should see **ChucK Live** and **ChucK Session** in the Activity Bar.

### Build from this workspace

```bash
npm run install-local
# or: node scripts/install-local.js
```

From the editor: **Terminal → Run Task… → install-local**, then **Developer: Reload Window**. Each local package/install bumps the **build (patch)** version (`0.3.0` → `0.3.1`); the status bar and ChucK output show the running build.

Override the CLI with `CHUCK_LIVE_EDITOR=code` (or `cursor`) if both are on `PATH`.

**Dev host:** open this folder in Cursor/VS Code, press F5 (“Run Extension”).

**Release a build:** tag and push (`git tag v0.3.59 && git push origin v0.3.59`) — CI packs the `.vsix` and attaches it to the GitHub Release.
## Quick start

1. **ChucK: Init Project Library** (optional) — copies modules into `chuck/` and AI agent docs for Cursor/Copilot.
2. See **[examples/README.md](examples/README.md)** for the bundled library reference.
3. Open a patch → **ChucK Session** → **Start VM** (Control). **Knobs** stay under **ChucK Live**.
4. **Add Current File** (`Ctrl+Shift+.`) — shreds appear in **Shreds**. Drag to reorder (list + rack).
5. **Open Rack** / **Open Sequencer** from the Shreds toolbar; **Meter** sits under Shreds.
6. **Reload Shred** (`Ctrl+.`) — or the editor **Run** play button / **Load** CodeLens above the first line.

Tip: drag the **ChucK Session** activity icon to the Secondary Side Bar for a right-hand panel (Cursor does not allow extensions to pin views there directly).

### Mixable oscillators (`examples/oscillators/`)

Load **`master.ck` first**, then instruments/drums, then **`out/dac-out.ck` or `fx/bus-fx.ck`**. Add **`out/record-out.ck` anytime** to capture WAV (tap-only; safe mid-session). **Add / Reload** warns if a bus module is missing master or a second speaker shred would double-`dac` (Cancel or Add anyway). Details: [examples/README.md](examples/README.md).

Cyberpunk: [examples/cyberpunk/GUIDE.md](examples/cyberpunk/GUIDE.md) (darkwave preset). Standalone: `standalone/demo.ck`, `standalone/cyberpunk.ck`, `standalone/cyberpunk-v2.ck`.

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
- **Transport:** managed shred owns Sync-on sequencer clock; publishes `live_*` globals; playhead OSC `/chuck/live_playhead` on the meter port.
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
| `chuckLive.edgeTtsExecutable` | `edge-tts` | Binary for **Generate Voice Sample** (absolute path if not on PATH) |
| `chuckLive.ffmpegExecutable` | `ffmpeg` | Converts TTS → mono 44.1 kHz WAV for `doom-vox.ck` |
| `chuckLive.edgeTtsVoice` | `en-US-GuyNeural` | Default neural voice pre-selected in the voice picker |

### Audio (PipeWire / JACK)

This build of `chuck` uses **JACK**. On PipeWire systems the extension ships `bin/chuck-pw`:

```sh
#!/bin/sh
exec stdbuf -oL -eL pw-jack chuck "$@"
```

Start the VM after PipeWire is running. Verify with:

```bash
bin/chuck-pw --probe
```

## Commands

- Start / Stop VM (Session **Control**)
- Add Current File / Reload Shred / Remove Shred / Remove All — inline actions on the Shreds list, CodeLens **Load** / **Reload**, editor title icons
- Refresh Status / Refresh Knobs
- **Open Rack** — full-page Eurorack modules for loaded shreds; **sequencer** faceplate with master BPM (`live_bpm`) when VM is running. Group controls with `// ---- section ----` comments above globals; gate buttons and gain/amp knobs stay pinned at the top of each module.
- **Open Sequencer** — 16-step cascade: A/B banks, swing, probability, mute/solo, **Save As… / Load…** as JSON or `.ck` → `.chuck-live/patterns/`. **Sync ON** = ChucK transport (`live_*` globals).
- **Init Project Library** — copy bundled modules + seed patterns into `.chuck-live/patterns/`
- **Import Bundled Patterns** — copy `examples/sequences/*.{json,ck}` without full library init
- **Generate Voice Sample** — runs `edge-tts --list-voices` for the full catalog (~300+), then edge-tts + ffmpeg → `voices/samples/doom-vox.wav` for `doom-vox.ck`
- **Re-init Project Library (force)** — replace an existing library and refresh AI guides (full preset wipes the library folder first)
- **Meter** (ChucK Session) — L/R peak VU bars; auto-loaded with Start VM (with bridge + transport)
