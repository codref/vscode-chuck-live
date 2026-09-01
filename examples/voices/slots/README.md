# Doom voice slots (multi-phrase)

One **phrase shred per WAV**, each with its own sequencer gate — full darkwave knob set (same as doom-vox oneshot mode).

## Quick copy

1. Duplicate [`doom-vox-slot.ck`](../doom-vox-slot.ck) → `doom-YOURNAME.ck`
2. **Search-replace** `slot` → your prefix (`cy`, `rm`, `v2`, …) — globals, events, meter, log tag
3. Change `"SLOT.wav"` → your file in `voices/samples/`
4. **Add** the new `.ck` as a shred (keep `master.ck` + `cyber-fx.ck` running)
5. Sequencer: program `yourprefix_gate` on its own step row — **one gate per phrase** (sparse). Dense 16th gates restart the same `SndBuf` and you only hear syllable-sized chunks (`cy`, `ber`, …).

Bundled examples:

| File | Gate | Sample |
|------|------|--------|
| `doom-cyber.ck` | `cy_gate` | `cyber.wav` |
| `doom-remember.ck` | `rm_gate` | `doom-vox.wav` |

Pattern: load `doom-vox-dual.json` (both gates interleaved).

## vs `doom-vox.ck`

| | `doom-vox.ck` | slot wrapper |
|--|---------------|--------------|
| Modes | vocoder / pitched / oneshot | oneshot phrase only |
| Multiple phrases | `dv_sample` knob, one shred | one shred per WAV / gate |
| Tone / FX knobs | full set | **same set** (synth, crush, env, chop, …) |
| Sequencer | `dv_gate` + pitch/chop tracks | `xx_gate` + accent/chop per slot |

Use slots for **independent step grids** across phrases. Keep `doom-vox.ck` only for vocoder/pitched modes or one-shred sample switching.
