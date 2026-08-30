# Cyber drums (`cy_*`)

Industrial / digital drum kit for darkwave presets. Do **not** load alongside classic `dk_kick` / `dk_hat` / `dk_snare` — pick one kit.

| File | Gate | Sound | Mod matrix |
|------|------|--------|------------|
| `kick-industrial.ck` | `cy_kick` | Hard EBM kick, metallic ring, post-LPF | — |
| `bass-digital.ck` | `cy_bass` | 808-style boom with square + bit/sample crush | ENV src; Pitch / Drive / Crush dests |
| `hat-metal.ck` | `cy_hat` | Resonant metallic tick | — |
| `snare-digital.ck` | `cy_snare` | Staggered digital clap | — |
| `perc-glitch.ck` | `cy_glitch` | Random laser blips | — |

**Load:** `master.ck` → cyber drums → optionally classic `bass.ck` (`dk_bass`) *or* `bass-digital.ck` (`cy_bass`) → voices → `cyber-fx.ck`.

Classic `dk_*` drums remain in `../` for other presets. Use `cy_bass` for lo-bit cyber weight; keep `dk_bass` for clean 808 sub. Both bass modules expose **ENV** to the Mod Matrix and accept Pitch/Drive (digital also Crush) so you can route e.g. bass ENV → acid Filter, or modem FSK → bass Pitch.
