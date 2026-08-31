# Darkwave Cyberpunk — Live Performance Guide

Modular bus preset: cyber drums, 808 sub, acid bass, modem texture, formant FX.  
Short load recipe: [`README.md`](README.md).

---

## 1. Quick start (5 minutes)

### Load shreds (in order)

1. **ChucK: Start VM**
2. Add `oscillators/master.ck`
3. Add cyber drums: `drums/cyber/kick-industrial.ck`, `hat-metal.ck`, `snare-digital.ck`, `perc-glitch.ck`
4. Add `drums/bass.ck` (sub layer)
5. Add `voices/acid-bass.ck`
6. Add `voices/modem.ck`
7. Add `fx/cyber-fx.ck` (**not** `bus-fx.ck` — never load two outputs to `dac`)

### Patterns — pick one path

**Path A — Sequencer (live editing)**

1. **ChucK: Import Bundled Patterns** (or init project library)
2. **ChucK: Open Sequencer**
3. **Load…** → `cyberpunk-full.json` (or `.ck`)
4. Scale **phrygian**, **Sync ON**, BPM **118**
5. **Run all**

**Path B — Pattern shred (hand-edited `.ck`)**

1. Add `sequences/cyberpunk-full.ck` as a shred after instruments
2. Sequencer **Sync OFF** (avoid double clock with managed transport)
3. Pattern runs from the file's built-in `clockLoop()`

### First listen

- Pull `master_cutoff` to ~4500 Hz (master.ck tab)
- `cf_mix` ~0.18 on cyber-fx.ck
- If too dense, mute `cy_glitch` in Sequencer

---

## 2. Panel map

| Panel | Use in this preset |
|-------|-------------------|
| **Knobs** | Tone for the **active editor tab** only — click the `.ck` file first |
| **Sequencer** | Patterns, A/B banks, swing, probability, mute/solo |
| **Rack** | VU meters, master amp, module overview |
| **Mod Matrix** | Route LFO / ENV / FSK between acid and modem |

---

## 3. Cyber drum live knobbing

| Recipe | Knobs |
|--------|-------|
| **Harder floor** | `cy_kick_dec` 80–100 ms, `cy_kick_click` 0.7, `cy_kick_tight` 140–160 |
| **Ice hats** | `cy_hat_tone` 11000+, `cy_hat_ring` 12, `cy_hat_dec` 8 ms |
| **Broken clap** | `cy_snare_tight` 0.3; Shift+drag snare gate probability 0.6–0.8 |
| **Glitch storm** | `cy_glitch_amp` up; narrow `cy_glitch_high` − `cy_glitch_low` |
| **Sub weight** | `dk_bass_amp` ~0.7, `dk_bass_freq` 40–45 Hz under `cy_kick` |

Do **not** load classic `dk_kick` / `dk_hat` / `dk_snare` with the cyber set.

---

## 4. Acid bass sessions

| Session | Settings |
|---------|----------|
| **Squelch rise** | `ab_res` 12→16, sweep `ab_cutoff` 800→3000 (hand or ENV→Filter) |
| **Tight low end** | `ab_hpf` 120–180 Hz — dual LPF resonance vs `dk_bass` |
| **Melting glide** | `ab_glide` 80–150 ms, shorten `ab_dec` |
| **Neon bite** | `ab_drive` up, `ab_pulse` 0.4, modest `master_drive` |
| **Sub merge** | Lower `ab_amp`; balance on Rack VU vs `dk_bass` |

Sequencer tracks: `ab_noteHz` (pitch), `ab_accent` (0–1 per step, shared gate).

---

## 5. Filter performance (master + cyber-fx + modem)

### Master (`master.ck`)

- `master_hp` 50–80 Hz
- `master_cutoff` 3500–5500 Hz (default 8000 is bright for darkwave)
- `master_Q` 1.5–3

### Cyber-FX (`cyber-fx.ck`)

- `cf_formant` 1200–1800 Hz, `cf_formQ` 3–5 — radio band
- `cf_dark` 2500–4000 — wet LPF after delay
- `cf_hp` 200–280 — tighten wet mud
- `cf_mix` 0.15–0.22 normal; 0.3+ breakdown

### Modem telecom (`modem.ck`)

- `md_tele` down + `md_teleQ` up → lo-fi phone booth
- `md_hiss` down → darker tail

---

## 6. Modem performance

- Load `modem-pulse.json`; mute drums briefly to hear the layer
- `md_baud` 15–30 classic handshake; 60+ data frenzy
- **md_connect** button (Knobs on modem.ck) — one-shot dial sequence
- Mod Matrix: **FSK → Filter** on acid for rhythm-locked wobble

---

## 6b. Doom voice (optional layer)

Standalone sample voice — not part of `cyberpunk-full`.

1. **ChucK: Generate Voice Sample** (needs `edge-tts` + `ffmpeg`; set `chuckLive.edgeTtsExecutable` / `ffmpegExecutable` if not on PATH) → writes `voices/samples/doom-vox.wav`
2. Load `voices/doom-vox.ck` after master; keep `cyber-fx.ck`
3. **Reload** shred after generating; Sequencer Load `doom-vox.json`
4. `dv_mode`: **0** FFT vocoder, **1** pitched sample + synth, **2** phrase one-shot
5. Darken with `dv_formant` ~900–1400, `dv_cutoff` ~1200, `dv_drive` up; sparse gates only

---

## 7. Sequencer techniques

- **A/B banks**: Dup→standby, edit B while A plays, Queue at bar end
- **Swing** on `cy_hat` only (header Swing ON)
- **Shift+drag** probability on `cy_glitch`, `cy_snare`
- **Mute/S**: hat+glitch off for acid+sub breakdown; mute acid for modem interlude
- **Save As…**: JSON for A/B editing; `.ck` for git-friendly transport snapshot
- **Load…**: accepts both `.json` and `.ck` from `.chuck-live/patterns/`

---

## 8. Suggested mod-matrix patches

| Source | Destination | Depth | Effect |
|--------|-------------|-------|--------|
| ENV | Filter (acid) | 0.25–0.4 | Per-note filter sweep |
| LFO | Pitch (acid) | 0.03–0.08 | Detune wobble |
| FSK (modem) | Filter (acid) | 0.15 | Cyber chatter |
| ENV | Drive (acid) | 0.1 | Accent punch |

Mod matrix depth is 0–1 unscaled — large filter sweeps use `ab_envMod` inside the patch.

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| No sound | Load `master.ck`; only one output shred (`cyber-fx` **or** `dac-out`) |
| Missing seq tracks | Load voice/drum shreds before Load pattern |
| Knobs dead | Wrong active editor tab |
| Transport silent after Load | Click **Run all** (load resets running) |
| Double grid / flam | Pattern `.ck` shred + Sync ON — use one workflow |
| `.ck` load missing bank B | Expected — use JSON for A/B bank editing |

---

## Pattern files

See [`../sequences/README.md`](../sequences/README.md) for track lists and hand-editing `.ck` arrays.

Regenerate bundled patterns from repo root:

```bash
node scripts/gen-bundled-patterns.js
```
