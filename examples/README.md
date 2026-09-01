# ChucK Live examples

Bundled **module library** shipped with the extension. To copy into your own project (with AI agent guides), run **ChucK: Init Project Library** from the command palette or Shreds toolbar.

Patches for the **ChucK Live** extension. For install / commands, see the [root README](../README.md).

Every `.ck` file here is heavily commented — read them as tutorials. Infrastructure stubs live in [`chuck/`](../chuck/) (`bridge.ck`, `transport.ck`, `meter.ck`).

## Annotation cookbook

Minimal recipe for a live-controllable patch:

```chuck
// 1) Annotate globals (line directly above). Extension scans all loaded .ck files.
// @knob min=0 max=1 step=0.01 default=0.3
global float gain;

// @slider min=110 max=880 step=1 default=440
// @seq mode=raw                    ← optional: Sequencer pitch track (Hz)
global float freq;

// @button
global Event bang;                // Knobs sends click → bridge broadcasts Event

// 2) Seed values (used until OSC bridge connects on Start VM)
0.3 => gain;
440.0 => freq;

// 3) Audio graph
SinOsc osc => Gain g => dac;      // or => rackBus when using master.ck

// 4) Copy globals → UGens in a sporked loop (bridge only writes globals)
spork ~ follow();
while (true) 10::ms => now;       // main shred must not exit

fun void follow() {
  while (true) {
    gain => g.gain;
    freq => osc.freq;
    10::ms => now;
  }
}
```

| Tag | UI | ChucK type | Notes |
|-----|-----|------------|-------|
| `@knob` | rotary | `float` or `int` | `min`, `max`, `step`, `default` |
| `@slider` | vertical | `float` or `int` | same attrs as `@knob` |
| `@button` | click | `Event` | handler: `bang => now;` |
| `@seq` | Sequencer lane | `float` | `mode=raw` (Hz) or `mode=midi` (snaps to scale); optional `gate=my_gate` |
| `@seqGate` | gate pads only | `Event` | drums / triggers — `dk_kick => now;` |
| `@modSource` | Mod Matrix source | `float` | Patch writes LFO/env value in `follow()`; `label`, `bipolar` |
| `@modTarget` | Mod Matrix dest | `float` | Matrix writes offset; stack on `@knob` or dedicated `*_mod` global |
| `@modRoute` | factory route | — | Standalone line: `src=LFO dst=Pitch default=1 depth=0.05` |

**Mod matrix** — open the bottom-panel **Mod Matrix** view (`ChucK: Show Mod Matrix`). It is a **source × destination click grid**: columns are `@modSource` outputs, rows are `@modTarget` inputs (cross-module routing works when both are loaded). Click a cell to patch; click the lit cell again to clear; select a patched cell and use the depth slider for amount. When route `src` is `0`, the patch uses its internal default. See [`minibrute/voice.ck`](minibrute/voice.ck), [`voices/acid-bass.ck`](voices/acid-bass.ck), [`voices/neural-matrix.ck`](voices/neural-matrix.ck), [`voices/modem.ck`](voices/modem.ck), [`drums/bass.ck`](drums/bass.ck), [`drums/cyber/bass-digital.ck`](drums/cyber/bass-digital.ck).

**Gate drums** — never block the listener for the full envelope; `spork` the hit:

```chuck
// @seqGate
global Event dk_kick;

fun void onKick() {
  while (true) {
    dk_kick => now;       // wait only for the gate
    spork ~ kickHit();    // sound runs in its own shred
  }
}
```

**Bus modules** — declare `global Gain rackBus;` (from `master.ck`), route `… => rackBus`, add `_ckLivePeak()` for Rack meters (25 ms control rate — see root `AGENTS.md` CPU policy). See [`oscillators/sine.ck`](oscillators/sine.ck).

**Transport** — when Sequencer Sync is on, read `live_stepDur` / `live_tick` for grid-locked timing ([`minibrute/voice.ck`](minibrute/voice.ck)).

Behind the scenes: `bridge.ck` (OSC → globals), `transport.ck` (clock + patterns), `meter.ck` (VU → OSC). Reference stubs in [`chuck/`](../chuck/); running copies are auto-generated in `$TMPDIR`.

## Prerequisites

1. **ChucK: Start VM** (uses `bin/chuck-pw` → `pw-jack chuck` when available).
2. Watch **Output → ChucK** if audio fails.
3. **Knobs** / **Open Rack** / **Open Sequencer**.

## Audio graph (bus modules)

```text
osc / voice / drums ──► rackBus ──► master.ck ──► mainBus ──► dac-out.ck ──► dac
                                                         ├─► fx/bus-fx.ck ──► dac
                                                         ├─► fx/cyber-fx.ck ──► dac
                                                         └─► record-out.ck ──► WvOut (optional tap)
```

Load **one** speaker output after master: [`out/dac-out.ck`](out/dac-out.ck), [`fx/bus-fx.ck`](fx/bus-fx.ck), or [`fx/cyber-fx.ck`](fx/cyber-fx.ck) — not more than one (double `dac`).

Add [`out/record-out.ck`](out/record-out.ck) **anytime** after master to capture `mainBus` to WAV. It does **not** connect to `dac`, so it is safe to load/unload mid-session while dac-out or bus-fx stays up.

### Load order

1. Start VM  
2. [`oscillators/master.ck`](oscillators/master.ck)  
3. Instruments / drums (any order; add/remove live as you like)  
4. **`out/dac-out.ck` or `fx/bus-fx.ck`** (keep for the set)  
5. Optionally **`out/record-out.ck`** when you want to record (add/remove freely)  
6. Open Sequencer / Rack  

Without master, bus modules are silent. Without dac-out/fx, `mainBus` never reaches the speakers.

### Recording (`record-out.ck`)

Tap-only shred: `mainBus → WvOut → blackhole`. Leave your output shred loaded.

1. Edit `OUT_PATH` at the top of the file (e.g. `"my-take.wav"`).  
2. **Add** `record-out.ck` (master + dac-out/fx already running).  
3. Open `record-out.ck` in the editor (Knobs shows the **active file** only).  
4. Click **rec_toggle** once to start, again to stop and flush the file.  
5. Watch **Output → ChucK** for `recording →` / `saved` lines.  
6. **Remove** the record shred when done — audio keeps playing.

Records the **post-master** mix. With `bus-fx.ck`, the file is pre-FX (same tap point as dry `mainBus`).

## Standalone demos (direct `dac`)

| File | What it is |
|------|------------|
| [`standalone/demo.ck`](standalone/demo.ck) | Minimal sine + knobs |
| [`standalone/cyberpunk.ck`](standalone/cyberpunk.ck) | Neon pad / arp / rain (self-contained, no bus) |

## Oscillators (`oscillators/`)

| File | Role |
|------|------|
| `master.ck` | `rackBus` → filters → `mainBus` |
| `sine.ck` … | Tone into `rackBus` (`@seq` on `sine_freq`) |

## Drums (`drums/`)

### Classic (`dk_*`)

| File | Gate Event | Notes |
|------|------------|--------|
| `kick.ck` | `dk_kick` | Pitch-drop kick |
| `hat.ck` | `dk_hat` | Noise hat |
| `snare.ck` | `dk_snare` | Noise + body |
| `bass.ck` | `dk_bass` | 808-style sub boom |

### Cyber darkwave (`drums/cyber/`, `cy_*`)

| File | Gate | Notes |
|------|------|--------|
| `kick-industrial.ck` | `cy_kick` | EBM kick + metallic ring |
| `bass-digital.ck` | `cy_bass` | Lo-bit cyber sub boom (square + crush) |
| `hat-metal.ck` | `cy_hat` | Resonant tick |
| `snare-digital.ck` | `cy_snare` | Digital clap |
| `perc-glitch.ck` | `cy_glitch` | Laser blips |

Use **either** classic or cyber kit, not both. Darkwave: cyber drums + `cy_bass` *or* classic `bass.ck`. See [`drums/cyber/README.md`](drums/cyber/README.md).

Sequencer auto-adds `@seqGate` tracks (pads only). Run with Sync clocks for a locked groove.

## Voices (`voices/`)

| File | Sequencer | Notes |
|------|-----------|--------|
| `tnt-riff.ck` | `tnt_noteHz`, `tnt_gate` | Power-chord stabs |
| `acid-bass.ck` | `ab_noteHz`, `ab_accent`, `ab_gate` | 303-style monobass |
| `neural-matrix.ck` | `nm_noteHz`, P-locks, `nm_gate` | Dual wavetable/FM bass + fold/crush macros |
| `pure-sub.ck` | `ps_noteHz`, pitch-env P-lock, `ps_gate` | Layered sub/harm/texture + Sub Regen; P1: Reese/Pressure, corroder, ring mod |
| `modem.ck` | `md_gate`, `md_digit` | DTMF / FSK texture |
| `doom-vox.ck` | `dv_noteHz`, `dv_accent`, `dv_chop`, `dv_gate` | edge-tts sample: vocoder / pitched / oneshot |
| `doom-vox-slot.ck` | copy template → unique `xx_gate` | Full oneshot slot (same knobs as doom-vox phrase mode); see [`voices/slots/README.md`](voices/slots/README.md) |
| `slots/doom-cyber.ck` | `cy_gate` | Example slot → `cyber.wav` |
| `slots/doom-remember.ck` | `rm_gate` | Example slot → `doom-vox.wav` |

**Doom voice** — load `master.ck` → `voices/doom-vox.ck` → `fx/cyber-fx.ck`. WAVs live in `voices/samples/`. **Generate Voice Sample** writes a new file; add its filename to `dv_sampleNames[]` in `doom-vox.ck` and bump the `dv_sample` knob `max`, then **Reload** once. Switch phrases live with the **`dv_sample`** knob (no second shred). **Two phrases on different steps:** copy [`doom-vox-slot.ck`](voices/doom-vox-slot.ck), load each slot shred, pattern `doom-vox-dual.json`. Pattern: Load `doom-vox.json` or `doom-vox-dual.json`.

## FX (`fx/`)

| File | Role |
|------|------|
| [`bus-fx.ck`](fx/bus-fx.ck) | Delay / reverb / crush wet-dry |
| [`cyber-fx.ck`](fx/cyber-fx.ck) | Formant BPF wet chain (darkwave preset) |

## Sequences (`sequences/`)

Bundled patterns as **JSON** (Sequencer A/B) and **`.ck`** (transport / standalone shred). Import via **ChucK: Import Bundled Patterns** or project init → `.chuck-live/patterns/`. See [`sequences/README.md`](sequences/README.md).

## MiniBrute (`minibrute/`)

[`voice.ck`](minibrute/voice.ck): mono voice; Open Sequencer → `mb_noteHz` + gate `mb_gate`.

## Darkwave cyberpunk preset

1. Start VM  
2. `master.ck` → `drums/cyber/*.ck` → `drums/bass.ck` → `voices/acid-bass.ck` → `voices/modem.ck`  
3. `fx/cyber-fx.ck` (not `bus-fx.ck`)  
4. Import patterns → Sequencer Load `cyberpunk-full.json` — Sync on, scale **phrygian**, BPM ~118  

Full guide: [`cyberpunk/GUIDE.md`](cyberpunk/GUIDE.md). Short recipe: [`cyberpunk/README.md`](cyberpunk/README.md).

## Legacy cyberpunk bus (classic drums)

1. Start VM  
2. `master.ck` → `drums/kick.ck` + `hat.ck` + `snare.ck` → `minibrute/voice.ck`  
3. `fx/bus-fx.ck` (or `dac-out.ck` for dry)  
4. Open Sequencer — Sync on, scale **phrygian**  

## Annotations

```chuck
// @slider min=40 max=1600
// @seq mode=raw
global float sine_freq;

// @seq mode=midi min=24 max=84 gate=mb_gate
global float mb_noteHz;

// @seqGate
global Event dk_kick;
```

| Tag | Meaning |
|-----|---------|
| `@knob` / `@slider` | OSC float |
| `@button` | OSC Event bang |
| `@seq` | Preferred float seq track (`mode=raw\|midi`, optional `gate=`) |
| `@seqGate` | Preferred gate-only seq track |

## Sequencer cascade

- One track per float or `@seqGate` Event; independent Run/Stop  
- **Sync clocks** (default ON) = **ChucK-owned** 16th clock (`transport` shred); Master BPM shared  
- **Sync OFF** = independent host-side clocks per track (legacy)  
- **Scale** snaps MIDI tracks (default phrygian)  
- Gate tracks: pads only (drums)
- **A/B banks** per track: **Dup→standby** copies the live bank; edit the other tab while A plays; **Queue** swaps at the end of the 16-step cycle; **Swap now** switches immediately  
- **Swing** per track (0–100%); odd steps late — header **Swing** must be on (off by default)  
- **Probability**: Shift+drag a gate pad (opacity shows chance)  
- **M / S**: mute or solo without stopping the clock (unlike Stop)  
- **Save As… / Load…**: JSON or `.ck` under `.chuck-live/patterns/` (init / **Import Bundled Patterns** seeds from `examples/sequences/`)

### Keyboard drawer (MIDI tracks)

For any **MIDI** lane (`@seq mode=midi`, e.g. `ps_noteHz`, `ab_noteHz`):

1. Click **⌨** on the track bar — bottom drawer opens with **scale pads** (one button per scale degree; uses header **Scale**).
2. **Play** — press pads to audition (OSC preview + gate).
3. **Step** — click a step column, then pads to write notes one step at a time (auto-advances). Volca Bass **S.rEc**-style.
4. **● Rec** → **Run all** → play pads while the step chase moves — notes quantize to 16ths (Volca Keys loop record). Lower **Master BPM** while learning.
5. **Suggest** (Walk / Bass / Arp / Motif) — seed the edit bank with an in-scale melody; also in each track’s **Gen** transform row.
6. Keys **1–7** (and **8–9** on larger scales) mirror the pads.

### Transport bus (`live_*`)

Always declared by the OSC bridge (and driven by the transport shred when Sync is on):

| Global | Type | Meaning |
|--------|------|---------|
| `live_bpm` | float | Master BPM |
| `live_step` | int | Current 16th index 0–15 |
| `live_stepDur` | float | Seconds per 16th (`60/bpm/4`) |
| `live_tick` | Event | Bang each master step |
| `live_running` | int | 1 while transport is running |

Example shreds can follow the grid, e.g. MiniBrute `onGate` holds `0.9 * live_stepDur`. Drum envelope decay knobs stay in ms (musical length, independent of the grid).
