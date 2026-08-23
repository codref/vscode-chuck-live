# ChucK Live examples

Bundled **module library** shipped with the extension. To copy into your own project (with AI agent guides), run **ChucK: Init Project Library** from the command palette or Shreds toolbar.

Patches for the **ChucK Live** extension. For install / commands, see the [root README](../README.md).

## Prerequisites

1. **ChucK: Start VM** (uses `bin/chuck-pw` → `pw-jack chuck` when available).
2. Watch **Output → ChucK** if audio fails.
3. **Knobs** / **Open Rack** / **Open Sequencer**.

## Audio graph (bus modules)

```text
osc / voice / drums ──► rackBus ──► master.ck ──► mainBus ──► dac-out.ck ──► dac
                                                         ├─► fx/bus-fx.ck ──► dac
                                                         └─► record-out.ck ──► WvOut (optional tap)
```

Load **one** speaker output after master: [`out/dac-out.ck`](out/dac-out.ck) **or** [`fx/bus-fx.ck`](fx/bus-fx.ck) — not both (double `dac`).

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
- **A/B banks** per track: **Dup→standby** copies the live bank; edit the other tab while A plays; **Queue** swaps at the end of the 16-step cycle; **Swap now** switches immediately  
- **Swing** per track (0–100%); odd steps late — header **Swing** must be on (off by default)  
- **Probability**: Shift+drag a gate pad (opacity shows chance)  
- **M / S**: mute or solo without stopping the clock (unlike Stop)  
- **Save As… / Load…**: named JSON under `.chuck-live/patterns/`

## Not yet

Free patch cables between arbitrary jacks.
