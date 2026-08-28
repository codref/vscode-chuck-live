// minibrute/voice.ck — MiniBrute-inspired monosynth into rackBus.
// Load order: oscillators/master.ck → voice.ck → out/dac-out.ck (or fx/bus-fx.ck)
//
// Sequencer tracks (from annotations):
//   mb_noteHz — `// @seq mode=midi` → pitch snapped to scale; values are Hz
//   mb_gate   — `// @seqGate` → note on/off; hold length uses transport bus
//
// Transport globals (`live_*`) are always declared in the OSC bridge. When Sync
// is ON, the transport shred sets live_stepDur = seconds per 16th at master BPM.

global Gain rackBus;
global Gain voice_meter;
global float voice_meter_p;
0.0 => voice_meter_p;

// @seq mode=midi min=24 max=84 step=1 default=48 gate=mb_gate
global float mb_noteHz;           // pitch track; gate= ties note length to mb_gate Event
// @seqGate
global Event mb_gate;             // sequencer fires this on each active step

// Sequencer transport bus (written by ChucK Live bridge / transport shred)
global float live_stepDur;        // seconds per 16th — use for musically timed gates
0.125 => live_stepDur;            // fallback: one 16th at 120 BPM before transport starts

// @knob min=0 max=1 step=0.01 default=0.35
global float mb_saw;              // oscillator mix levels
// @knob min=0 max=1 step=0.01 default=0.25
global float mb_square;
// @knob min=0 max=1 step=0.01 default=0.1
global float mb_tri;
// @knob min=0 max=0.4 step=0.01 default=0.05
global float mb_noise;
// @knob min=0 max=1 step=0.01 default=0.4
global float mb_sub;

// @slider min=200 max=8000 step=10 default=1800
global float mb_cutoff;
// @knob min=0.5 max=12 step=0.1 default=3
global float mb_res;

// @knob min=1 max=500 step=1 default=5
global float mb_atk;
// @knob min=10 max=800 step=1 default=120
global float mb_dec;
// @knob min=0 max=1 step=0.01 default=0.55
global float mb_sus;
// @knob min=10 max=1000 step=1 default=200
global float mb_rel;

// @knob min=0.05 max=20 step=0.01 default=4
global float mb_lfoRate;          // filter + pitch wobble rate
// @knob min=0 max=1 step=0.01 default=0.15
global float mb_lfoAmt;

// @knob min=0 max=1 step=0.01 default=0.2
global float mb_metal;            // pre-filter drive ("metalizer")
// @knob min=0 max=1 step=0.01 default=0.25
global float mb_brute;            // post-filter drive

// @knob min=0 max=0.8 step=0.01 default=0.4
global float mb_amp;

0.35 => mb_saw;
0.25 => mb_square;
0.1 => mb_tri;
0.05 => mb_noise;
0.4 => mb_sub;
1800.0 => mb_cutoff;
3.0 => mb_res;
5.0 => mb_atk;
120.0 => mb_dec;
0.55 => mb_sus;
200.0 => mb_rel;
4.0 => mb_lfoRate;
0.15 => mb_lfoAmt;
0.2 => mb_metal;
0.25 => mb_brute;
0.4 => mb_amp;
110.0 => mb_noteHz;

SawOsc saw => Gain mix;
PulseOsc sqr => mix;
TriOsc tri => mix;
Noise nz => mix;
SawOsc sub => mix;
0.5 => sqr.width;

mix => Gain fold => LPF flt => ADSR env => Gain drive => Gain out => voice_meter => rackBus;
env.set(5::ms, 120::ms, 0.55, 200::ms);
0.0 => out.gain;
1800 => flt.freq;
3 => flt.Q;

spork ~ follow();                 // knobs + seq pitch → synth
spork ~ onGate();                 // mb_gate → envelope timing
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(voice_meter.last()) => float s;
    if (s > voice_meter_p) s => voice_meter_p; else voice_meter_p * d => voice_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    mb_saw => saw.gain;
    mb_square => sqr.gain;
    mb_tri => tri.gain;
    mb_noise => nz.gain;
    mb_sub * 0.7 => sub.gain;

    mb_noteHz => float f;         // sequencer writes Hz each step (after scale snap)
    now / second => float t;
    f * (1.0 + Math.sin(2.0 * Math.PI * mb_lfoRate * t) * mb_lfoAmt * 0.05) => float pf;
    pf => saw.freq;
    pf => sqr.freq;
    pf => tri.freq;
    pf * 0.5 => sub.freq;         // sub osc one octave down

    mb_cutoff * (1.0 + Math.sin(2.0 * Math.PI * mb_lfoRate * t) * mb_lfoAmt * 0.35)
      => flt.freq;
    mb_res => flt.Q;

    // soft metalizer / brute: extra gain into filter and output stages
    1.0 + mb_metal * 4.0 => fold.gain;
    1.0 + mb_brute * 3.0 => drive.gain;
    mb_amp => out.gain;

    mb_atk::ms => dur a;
    mb_dec::ms => dur d;
    mb_rel::ms => dur r;
    env.set(a, d, mb_sus, r);
    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    mb_gate => now;               // note on from sequencer
    env.keyOn();
    // Hold ~90% of one 16th from the shared transport — stays in sync with BPM
    Math.max(0.01, live_stepDur) * 0.9 => float hold;
    hold::second => now;
    env.keyOff();
  }
}
