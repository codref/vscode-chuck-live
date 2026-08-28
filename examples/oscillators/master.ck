// oscillators/master.ck — shared mix bus + master tone stage → mainBus.
//
// Load THIS FIRST after Start VM. Every instrument/drum connects to `rackBus`.
// Then load dac-out.ck OR fx/bus-fx.ck so `mainBus` reaches the speakers.
// Without master, bus modules connect to a silent `rackBus`. Without dac-out/fx,
// `mainBus` has nowhere to go.
//
// ChucK Live scans `// @knob` / `// @slider` comments on `global` lines below.
// It generates an OSC bridge shred that listens on port 9000 and writes those
// globals when you move controls in the Knobs panel (active editor file).

global Gain rackBus;   // sum of all instruments — hot-plug shreds share this name
global Gain mainBus;   // post-master output — dac-out.ck / record-out.ck read this

// @knob min=0 max=1 step=0.01 default=0.75
// Extension: float knob "master_amp" → OSC /chuck/master_amp
global float master_amp;

// @slider min=200 max=12000 step=10 default=8000
global float master_cutoff;   // low-pass cutoff (Hz)

// @knob min=0.5 max=8 step=0.1 default=1.2
global float master_Q;        // low-pass resonance

// @slider min=20 max=2000 step=5 default=40
global float master_hp;       // high-pass cutoff (Hz) — clears mud

// @knob min=0 max=1 step=0.01 default=0
global float master_drive;    // soft saturation amount

// Initial values before the bridge connects (match annotation defaults).
0.75 => master_amp;
8000.0 => master_cutoff;
1.2 => master_Q;
40.0 => master_hp;
0.0 => master_drive;

// Signal chain: rackBus → HPF → drive Gain → LPF → out Gain → mainBus (not dac).
rackBus => HPF hp => Gain drive => LPF lpf => Gain out => mainBus;
1.0 => rackBus.gain;    // instruments set their own level; bus stays unity
1.0 => mainBus.gain;    // final trim lives in `out.gain` via master_amp
40.0 => hp.freq;
1.0 => drive.gain;
8000.0 => lpf.freq;
1.2 => lpf.Q;
0.75 => out.gain;

// `follow` shred copies OSC-driven globals into UGen params every few ms.
spork ~ follow();
while (true) 20::ms => now;   // keep this shred alive

fun void follow() {
  while (true) {
    master_hp => hp.freq;
    master_cutoff => lpf.freq;
    master_Q => lpf.Q;
    1.0 + master_drive * 3.5 => drive.gain;   // map 0..1 knob → 1..4.5× gain
    master_amp => out.gain;
    5::ms => now;   // poll rate — smooth enough for knobs, light on CPU
  }
}
