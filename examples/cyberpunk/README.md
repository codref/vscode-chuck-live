# Cyberpunk bus recipe

Modular stack (not the standalone [`../cyberpunk.ck`](../cyberpunk.ck)).

## Load

1. **ChucK: Start VM**  
2. Add [`../oscillators/master.ck`](../oscillators/master.ck)  
3. Add [`../drums/kick.ck`](../drums/kick.ck), [`hat.ck`](../drums/hat.ck), [`snare.ck`](../drums/snare.ck)  
4. Add [`../minibrute/voice.ck`](../minibrute/voice.ck) (and optionally [`../oscillators/sine.ck`](../oscillators/sine.ck))  
5. Add [`../fx/bus-fx.ck`](../fx/bus-fx.ck) **or** [`../out/dac-out.ck`](../out/dac-out.ck)  
6. **Open Sequencer** — Sync clocks · scale phrygian · Run drum gates + `mb_noteHz`

## Tips

- Pull `master_amp` down when many modules run  
- `fx_mix` ~0.2; raise crush slowly  
- Hat/snare/kick are separate `@seqGate` tracks — use **M** to mute (or Stop) per track  
