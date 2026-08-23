# Copilot instructions — ChucK Live

This workspace targets the **ChucK Live** extension (live VM, shreds, OSC knobs).

## Modular audio bus

- Instruments: `global Gain rackBus;` → patch oscillators/drums into `rackBus`.
- `oscillators/master.ck`: `rackBus` → filters → `mainBus` (never to `dac`).
- Load **one** speaker output after master: `out/dac-out.ck` or `fx/bus-fx.ck`.
- Optional `out/record-out.ck`: tap-only WAV (`mainBus → WvOut`); add/remove mid-session.
- Load order: VM → master → modules → speaker output; record anytime after master.

## Controls

Annotate globals with `// @knob`, `// @slider`, `// @button`, `// @seq`, `// @seqGate` on the line above. Extension bridge sends OSC `/chuck/<name>`. Button labels show the event name.

## Do not

- Connect bus modules straight to `dac`.
- Load dac-out and bus-fx together.
- Duplicate global names across shreds.

Refer to `AGENTS.md` and `chuck/README.md` for full detail.
