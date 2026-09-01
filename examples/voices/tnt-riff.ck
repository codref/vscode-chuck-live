// voices/tnt-riff.ck — acid power-chord stabs into rackBus (TNT-style riff voice).
//
// Load order: oscillators/master.ck → tnt-riff.ck → out/dac-out.ck (or fx/bus-fx.ck)
//
// Sequencer:
//   tnt_noteHz — root pitch (MIDI → Hz); power fifth + octaves follow automatically
//   tnt_gate   — gate pads; program your own pattern in Open Sequencer
//
// Sync ON: gates fire on the grid; decay/release knobs set how long each hit
// rings (hits overlap freely — like a cranked amp, not grid-length stabs).

global Gain rackBus;
global Gain tnt_meter;
global float tnt_meter_p;
0.0 => tnt_meter_p;

// @seq mode=midi min=28 max=60 step=1 default=40 gate=tnt_gate
global float tnt_noteHz;          // root (default 40 ≈ E2)
// @seqGate
global Event tnt_gate;

global float live_stepDur;        // seconds per 16th when Sync is on
0.125 => live_stepDur;

// @knob min=0 max=0.85 step=0.01 default=0.52
global float tnt_amp;
// @knob min=0 max=1 step=0.01 default=0.78
global float tnt_drive;           // pre-filter saturation
// @knob min=0 max=1 step=0.01 default=0.62
global float tnt_brute;           // post-filter saturation
// @slider min=400 max=8000 step=10 default=1800
global float tnt_cutoff;
// @knob min=1 max=14 step=0.1 default=5.5
global float tnt_res;             // acid bite — higher = squelchier
// @knob min=80 max=1200 step=5 default=480
global float tnt_dec;             // distortion body (ms) — independent of grid
// @knob min=0 max=1 step=0.01 default=0.58
global float tnt_sus;             // sustain level through the decay phase
// @knob min=80 max=1600 step=5 default=620
global float tnt_rel;             // tail after decay (ms)

0.52 => tnt_amp;
0.78 => tnt_drive;
0.62 => tnt_brute;
1800.0 => tnt_cutoff;
5.5 => tnt_res;
480.0 => tnt_dec;
0.58 => tnt_sus;
620.0 => tnt_rel;
82.41 => tnt_noteHz;

// ---- power-chord stack (root + fifth + octaves + pulse bite) ----
SawOsc rootA => Gain pre;
SawOsc rootB => pre;
SawOsc fifth => pre;
SawOsc octA => pre;
SawOsc octB => pre;
PulseOsc bite => pre;
0.22 => bite.width;

pre => HPF hp => Gain fold => LPF lpf => ADSR env => Gain post => Gain out => tnt_meter => rackBus;
70.0 => hp.freq;
1.2 => hp.Q;
1800.0 => lpf.freq;
5.5 => lpf.Q;
env.set(2::ms, 480::ms, 0.58, 620::ms);
0.0 => out.gain;

0.42 => rootA.gain;
0.38 => rootB.gain;
0.36 => fifth.gain;
0.30 => octA.gain;
0.24 => octB.gain;
0.20 => bite.gain;

spork ~ follow();
spork ~ onGate();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(tnt_meter.last()) => float s;
    if (s > tnt_meter_p) s => tnt_meter_p; else tnt_meter_p * d => tnt_meter_p;
    25::ms => now;
  }
}

fun void setPower(float root) {
  root => float r;
  r * 1.006 => float r2;
  r * 1.498307 => float f5;         // just fifth
  r * 2.0 => float o1;
  r * 2.012 => float o2;
  r * 3.0 => float biteF;

  r => rootA.freq;
  r2 => rootB.freq;
  f5 => fifth.freq;
  o1 => octA.freq;
  o2 => octB.freq;
  biteF => bite.freq;
}

fun void follow() {
  while (true) {
    tnt_amp => out.gain;
    1.0 + tnt_drive * 8.0 => fold.gain;
    1.0 + tnt_brute * 5.0 => post.gain;
    tnt_cutoff => lpf.freq;
    tnt_res => lpf.Q;

    tnt_noteHz => float root;
    setPower(root);

    tnt_dec::ms => dur d;
    tnt_rel::ms => dur r;
    env.set(2::ms, d, tnt_sus, r);

    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    tnt_gate => now;
    spork ~ hit();
  }
}

fun void hit() {
  tnt_noteHz => float root;

  // pick attack scoop — drops into the power chord
  setPower(root * 0.965);
  env.keyOn();
  28::ms => now;
  setPower(root);

  tnt_dec::ms => now;
  env.keyOff();
}
