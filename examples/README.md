# ChucK Live examples

Patches for the **ChucK Live** extension. For install / commands, see the [root README](../README.md).

## Prerequisites

1. **ChucK: Start VM** (uses `bin/chuck-pw` → `pw-jack chuck` when available).
2. Watch **Output → ChucK** if audio fails.
3. **Knobs** (sidebar) — compact controls; toggle **Current file** / **All (grouped)**.
4. **ChucK: Open Rack** — full-page Eurorack-style case (one module per loaded shred).
5. **ChucK: Open Sequencer** — 16-step grid bound to any annotated float (optional gate Event).

## Standalone demos (direct `dac`)

These do **not** use the mix bus. Add alone (or after Remove All).

| File | What it is |
|------|------------|
| [`demo.ck`](demo.ck) | Minimal sine + `@knob` / `@slider` / `@button` bang swell |
| [`cyberpunk.ck`](cyberpunk.ck) | Neon pad, hex arp, rain, glitch; **bang** = stutter drop |

## Mixable oscillators (`oscillators/`)

Shared bus: every oscillator feeds `global Gain rackBus`. **Master** filters the sum and hits `dac`.

### Load order (important)

1. Start VM  
2. Add [`oscillators/master.ck`](oscillators/master.ck) **first**  
3. Add any of sine / saw / square / triangle / fm / noise / lfo-sine  
4. Open **Knobs → All (grouped)** or **Open Rack**  
5. Blend per-module amps + master filters  

Without `master.ck`, bus oscillators produce **no sound** (they never touch `dac`).

```text
sine / saw / … ──► rackBus ──► HPF ──► LPF ──► amp ──► dac
                      ▲
                   master.ck
```

### Sequence an oscillator

1. Start VM → add `master.ck` → add [`oscillators/sine.ck`](oscillators/sine.ck)  
2. **ChucK: Open Sequencer** → target **`sine_freq`** (marked ★ via `@seq`) → **Run**  

The host clock writes `/chuck/sine_freq` each 16th. Any `@knob` / `@slider` float can be picked as a target.

### Modules

| File | Role | Main knobs |
|------|------|------------|
| `master.ck` | Mix bus + filters | `master_amp`, `master_cutoff`, `master_Q`, `master_hp`, `master_drive` |
| `sine.ck` | Clean tone | `sine_amp`, `sine_freq` (+ `@seq`), detune, vib, pan |
| `saw.ck` | Bass / lead body | `saw_amp`, `saw_freq`, cutoff, Q, drive |
| `square.ck` | Pulse / PWM | `sqr_amp`, `sqr_freq`, width, cutoff, pwmHz |
| `triangle.ck` | Soft stack | `tri_amp`, `tri_freq`, sub, fifth, chorus |
| `fm.ck` | 2-op FM | `fm_amp`, `fm_car`, ratio, index, fb |
| `noise.ck` | Air / grit | `nz_amp`, cutoff, Q, hp, gateHz |
| `lfo-sine.ck` | Slow pad | `lfo_amp`, rate, center, depth, space |

Knob names are **prefixed** so several shreds can run without OSC clashes.

### Master filters

| Knob | Effect |
|------|--------|
| `master_amp` | Overall level out of the bus |
| `master_cutoff` | Low-pass on the whole mix |
| `master_Q` | LPF resonance |
| `master_hp` | High-pass (tighten / remove rumble) |
| `master_drive` | Gain into the filter (grit) |

## MiniBrute-style mono + sequencer (`minibrute/`)

Inspired by Arturia MiniBrute 2 (not a full analog clone): osc mix, Steiner-ish LPF, ADSR, LFO, metal/brute drive. Pitch/gate come from the **Open Sequencer** panel (host clock), not a separate `seq.ck`.

### Load order

1. Start VM  
2. Add [`oscillators/master.ck`](oscillators/master.ck)  
3. Add [`minibrute/voice.ck`](minibrute/voice.ck)  
4. **ChucK: Open Sequencer** → pick **`mb_noteHz`** → Gate **`mb_gate`** → **Run**  
5. Shape tone on Rack/Knobs (`mb_*`, `master_*`)

```text
Open Sequencer ──OSC──► mb_noteHz / mb_gate ──► voice.ck ──► rackBus ──► master ──► dac
```

| File | Role |
|------|------|
| `voice.ck` | Mono voice + `@seq mode=midi` on `mb_noteHz` + `@seqGate` on `mb_gate` |

Default pattern is a C-minor-ish 16-step MIDI line. Drag pitch, toggle gates, set BPM.

## Annotations

Place the comment **immediately above** a `global` declaration (stack several tags):

```chuck
// @knob min=0 max=1 step=0.01 default=0.5
global float saw_amp;

// @slider min=40 max=1600 step=1 default=220
// @seq mode=raw
global float sine_freq;

// @seq mode=midi min=24 max=84 gate=mb_gate
global float mb_noteHz;

// @seqGate
global Event mb_gate;

// @button
global Event bang;
```

| Tag | UI | OSC |
|-----|----|-----|
| `@knob` | Rotary dial (default) | `/chuck/<name>` float |
| `@knob ui=slider` or `@slider` | Horizontal slider | same |
| `@button` | Bang (on `global Event`) | `/chuck/<name>` int |
| `@seq` | Marks float as preferred sequencer target (`mode=raw\|midi`, optional `gate=`) | same float OSC |
| `@seqGate` | Event offered as sequencer gate | same Event OSC |

## Live coding commands

| Action | Command / shortcut |
|--------|-------------------|
| Load file into VM | **Add Current File** (`Ctrl+Shift+.`) |
| Hot-swap current file | **Replace / Live Update** (`Ctrl+.`) |
| Drop one shred | **Remove Shred** (Shreds view) |
| Clear user shreds | **Remove All Shreds** |
| Performance UI | **Open Rack** / **Open Sequencer** |

Replace only updates the shred for the **active** file; others keep running.

## Rack view

**ChucK: Open Rack** opens a full editor panel:

- One **module** faceplate per loaded shred (OSC bridge hidden)
- `master.ck` sorts first and uses wider "MASTER" chrome
- Same annotations / OSC as the Knobs sidebar

**ChucK: Open Sequencer** opens a **cascade** of 16-step tracks (one per bound float). `@seq` targets appear automatically; **Add track** for other knobs. Each track has its own Run/Stop/BPM.

## Not yet

Free **patch cables** between arbitrary jacks (virtual CV/audio graph) are not implemented. Today the only "cable" is the fixed path: oscillators → `rackBus` → master filters → `dac`.
