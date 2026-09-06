# Cyberpunk bus recipe

Modular darkwave stack. Full performance guide: **[GUIDE.md](GUIDE.md)**.

## Load

1. **ChucK: Start VM**
2. [`../oscillators/master.ck`](../oscillators/master.ck)
3. Cyber drums: [`../drums/cyber/`](../drums/cyber/) (all four)
4. [`../drums/bass.ck`](../drums/bass.ck)
5. [`../voices/acid-bass.ck`](../voices/acid-bass.ck)
6. [`../voices/modem.ck`](../voices/modem.ck)
7. [`../fx/cyber-fx.ck`](../fx/cyber-fx.ck) — not `bus-fx.ck`

## Patterns

- **ChucK: Import Bundled Patterns** → Sequencer **Load…** → `cyberpunk-full.json`
- Or add [`../sequences/cyberpunk-full.ck`](../sequences/cyberpunk-full.ck) with Sync OFF

## Tips

- Scale **phrygian**, BPM ~118, Sync ON (Path A)
- `master_cutoff` ~4500 Hz; `cf_mix` ~0.18
- Mute per track in Sequencer for live arrangement

Standalone all-in-one demos: [`../standalone/cyberpunk.ck`](../standalone/cyberpunk.ck), [`../standalone/cyberpunk-v2.ck`](../standalone/cyberpunk-v2.ck) (more knobs)
