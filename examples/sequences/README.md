# Sequencer patterns (darkwave preset)

Bundled groove files for the cyberpunk / darkwave stack. Each preset ships as **JSON** (Sequencer UI, A/B banks) and **`.ck`** (standalone transport shred or import).

## Files

| Pattern | Tracks |
|---------|--------|
| `darkwave-acid` | `cy_*` drums, `dk_bass`, `ab_noteHz`, `ab_accent` |
| `modem-pulse` | `md_gate`, `md_digit` |
| `cyberpunk-full` | All of the above |
| `neural-matrix` | `nm_noteHz` plus accent, cutoff/fold/crush P-locks, slide, ratchet |

## Load order (before patterns)

1. `oscillators/master.ck`
2. `drums/cyber/*.ck` (four files)
3. `drums/bass.ck`
4. `voices/acid-bass.ck`
5. `voices/modem.ck`
6. `fx/cyber-fx.ck`

Neural Matrix (standalone voice, not part of cyberpunk-full): `master.ck` → `voices/neural-matrix.ck` → `fx/cyber-fx.ck` (or `dac-out.ck`), then Load `neural-matrix.json`.

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
