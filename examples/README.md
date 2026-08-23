# ChucK Live examples

Patches for the **ChucK Live** extension. For install / commands, see the [root README](../README.md).

## Prerequisites

1. **ChucK: Start VM** (uses `bin/chuck-pw` → `pw-jack chuck` when available).
2. Watch **Output → ChucK** if audio fails.
3. **Knobs** / **Open Rack** / **Open Sequencer**.

## Audio graph (bus modules)

```text
osc / voice / drums ──► rackBus ──► master.ck ──► mainBus ──► dac-out.ck ──► dac
                                                         └─► fx/bus-fx.ck ──► dac
```

Load **either** [`out/dac-out.ck`](out/dac-out.ck) **or** [`fx/bus-fx.ck`](fx/bus-fx.ck) after master — not both (double `dac`).

### Load order

1. Start VM  
2. [`oscillators/master.ck`](oscillators/master.ck)  
3. Instruments / drums (any order)  
4. **`out/dac-out.ck` or `fx/bus-fx.ck`**  
5. Open Sequencer / Rack  

Without master, bus modules are silent. Without dac-out/fx, `mainBus` never reaches the speakers.

## Standalone demos (direct `dac`)

| File | What it is |
|------|------------|
| [`demo.ck`](demo.ck) | Minimal sine + knobs |
| [`cyberpunk.ck`](cyberpunk.ck) | Neon pad / arp / rain (self-contained, no bus) |

## Oscillators (`oscillators/`)

| File | Role |
|------|------|
| `master.ck` | `rackBus` → filters → `mainBus` |
| `sine.ck` … | Tone into `rackBus` (`@seq` on `sine_freq`) |

## Drums (`drums/`)

| File | Gate Event | Notes |
|------|------------|--------|
| `kick.ck` | `dk_kick` | Pitch-drop kick |
| `hat.ck` | `dk_hat` | Noise hat |
| `snare.ck` | `dk_snare` | Noise + body |

Sequencer auto-adds `@seqGate` tracks (pads only). Run with Sync clocks for a locked groove.

## FX (`fx/`)

[`bus-fx.ck`](fx/bus-fx.ck): delay / reverb / crush wet-dry from `mainBus` → `dac`. Knobs: `fx_mix`, `fx_delay`, `fx_feedback`, `fx_reverb`, `fx_crush`.

## MiniBrute (`minibrute/`)

[`voice.ck`](minibrute/voice.ck): mono voice; Open Sequencer → `mb_noteHz` + gate `mb_gate`.

## Cyberpunk bus recipe

1. Start VM  
2. `master.ck` → `drums/kick.ck` + `hat.ck` + `snare.ck` → `minibrute/voice.ck` → `oscillators/sine.ck`  
3. `fx/bus-fx.ck` (or `dac-out.ck` for dry)  
4. Open Sequencer — Sync on, scale **phrygian**  
5. Run drum gate tracks + `mb_noteHz` (and optional `sine_freq`)  
6. Keep `master_amp` / module amps modest  

See also [`cyberpunk/README.md`](cyberpunk/README.md).

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
- **Sync clocks** + Master BPM = shared 16ths  
- **Scale** snaps MIDI tracks (default phrygian)  
- Gate tracks: pads only (drums)

## Not yet

Free patch cables between arbitrary jacks.
