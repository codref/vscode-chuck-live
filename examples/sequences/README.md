# Sequencer patterns (darkwave preset)

Bundled groove files for the cyberpunk / darkwave stack. Each preset ships as **JSON** (Sequencer UI, A/B banks) and **`.ck`** (standalone transport shred or import).

## Files

| Pattern | Tracks |
|---------|--------|
| `darkwave-acid` | `cy_*` drums, `dk_bass`, `ab_noteHz`, `ab_accent` |
| `modem-pulse` | `md_gate`, `md_digit` |
| `cyberpunk-full` | All of the above |
| `bass-cyber-crescendo` | `cy_*` drums + `vb_*` Volca Bass (intro on A, peak on B) |
| `neural-matrix` | `nm_noteHz` plus accent, cutoff/fold/crush P-locks, slide, ratchet |
| `pure-sub` | `ps_noteHz`, accent, pitch-env P-lock, cutoff P-lock, slide |
| `warm-pad` | `wp_noteHz`, `wp_accent` — sparse held chord pad |
| `doom-vox` | `dv_noteHz`, `dv_accent`, `dv_chop` (sparse doom vocal) |
| `doom-vox-dual` | `rm_gate`, `cy_gate` — two slot wrappers on different steps |

## Load order (before patterns)

1. `oscillators/master.ck`
2. `drums/cyber/*.ck` (four files)
3. `drums/bass.ck`
4. `voices/acid-bass.ck`
5. `voices/modem.ck`
6. `fx/cyber-fx.ck`

Neural Matrix (standalone voice, not part of cyberpunk-full): `master.ck` → `voices/neural-matrix.ck` → `fx/cyber-fx.ck` (or `dac-out.ck`), then Load `neural-matrix.json`.

Pure SUB (standalone layered bass): `master.ck` → `voices/pure-sub.ck` → `fx/cyber-fx.ck` (or `dac-out.ck`), then Load `pure-sub.json`. Turn up `ps_pitEnv` / sequence `ps_plockPit` for 808-style drops; `ps_regen` restores clean sub after drive.

Warm pad (chord cluster, not acid): `master.ck` → `voices/warm-pad.ck` → `fx/bus-fx.ck` (or `dac-out.ck`), then Load `warm-pad.json`. Scale **aeolian**, BPM ~96. Try `wp_voicing` 0–4 and long `wp_hold` / `wp_rel`.

Bass cyber crescendo (Volca Bass + cyber drums): `master.ck` → `drums/cyber/*.ck` → `voices/volca-bass.ck` → `fx/cyber-fx.ck`, then Load `bass-cyber-crescendo.json`. Per-track seq presets `intro` / `build` / `peak` live under `.chuck-live/seq-presets/`; knob presets `cyber-intro` / `cyber-build` / `cyber-peak` under `.chuck-live/knob-presets/`.

Doom voice (standalone): `master.ck` → `voices/doom-vox.ck` → `fx/cyber-fx.ck`. Generate WAV via **ChucK: Generate Voice Sample**, Reload shred, Load `doom-vox.json`. Modes: `dv_mode` 0/1/2.

## Two workflows

### A — Sequencer (recommended for live editing)

1. **ChucK: Import Bundled Patterns** (or project init)
2. Open **Sequencer** → **Load…** → pick `.json` or `.ck`
3. **Sync ON**, scale **phrygian**, **Run all**

### B — Pattern shred (hand-edited arrays)

1. Add `cyberpunk-full.ck` as a shred after instruments
2. **Sync OFF** in Sequencer (avoid double clock)
3. Pattern runs from the file's `clockLoop()`

## Hand-editing `.ck`

Edit the `tN_g[]` (gates), `tN_v[]` (values), `tN_p[]` (probability) arrays. Track names are in comments: `// track N: globalName (float|gate)`.

Regenerate from source: `node scripts/gen-bundled-patterns.js`
