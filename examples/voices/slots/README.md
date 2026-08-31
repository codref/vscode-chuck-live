# Doom voice slots (multi-phrase)

One **lite shred per WAV**, each with its own sequencer gate — for two voices on different steps.

## Quick copy

1. Duplicate [`doom-vox-slot.ck`](../doom-vox-slot.ck) → `doom-YOURNAME.ck`
2. **Search-replace** `slot` → your prefix (`cy`, `rm`, `v2`, …) — globals, events, meter, log tag
3. Change `"SLOT.wav"` → your file in `voices/samples/`
4. **Add** the new `.ck` as a shred (keep `master.ck` + `cyber-fx.ck` running)
5. Sequencer: program `yourprefix_gate` on its own step row

Bundled examples:

| File | Gate | Sample |
|------|------|--------|
| `doom-cyber.ck` | `cy_gate` | `cyber.wav` |
| `doom-remember.ck` | `rm_gate` | `doom-vox.wav` |

Pattern: load `doom-vox-dual.json` (both gates interleaved).

## vs `doom-vox.ck`

| | `doom-vox.ck` | slot wrapper |
|--|---------------|--------------|
| Modes | vocoder / pitched / oneshot | oneshot only |
| Size | full instrument | ~130 lines |
| Multiple phrases | `dv_sample` knob, one shred | one shred per phrase |
| Sequencer | `dv_gate` + pitch tracks | gate (+ accent/chop) only |

Use slots when phrases need **independent step grids**. Use `doom-vox.ck` for one morphable voice.
