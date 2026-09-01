// voices/acid-bass.ck — 303-style monobass into rackBus.
// Load order: master.ck → acid-bass.ck → cyber-fx.ck (or dac-out.ck)
//
// Sequencer: ab_noteHz (MIDI), ab_accent (0–1), ab_gate

global Gain rackBus;
global Gain ab_meter;
global float ab_meter_p;
0.0 => ab_meter_p;

// @seq mode=midi min=28 max=60 step=1 default=40 gate=ab_gate
global float ab_noteHz;
// @seq mode=raw min=0 max=1 step=0.01 default=0.6 gate=ab_gate
global float ab_accent;
// @seqGate
global Event ab_gate;

global float live_stepDur;
0.125 => live_stepDur;

// @slider min=200 max=8000 step=10 default=1200
// @modTarget label=Filter unit=hz
global float ab_cutoff;
// @knob min=1 max=18 step=0.1 default=8
global float ab_res;
// @knob min=40 max=400 step=5 default=90
global float ab_hpf;
// @knob min=0 max=300 step=1 default=40
global float ab_glide;
// @knob min=0 max=1 step=0.01 default=0.65
global float ab_envMod;
// @knob min=0 max=1 step=0.01 default=0.5
global float ab_drive;
// @knob min=0 max=0.8 step=0.01 default=0.45
global float ab_amp;
// @knob min=0 max=1 step=0.01 default=0.2
global float ab_pulse;
// @knob min=0.1 max=0.9 step=0.01 default=0.45
global float ab_width;

// @knob min=1 max=80 step=1 default=3
global float ab_atk;
// @knob min=40 max=800 step=5 default=180
global float ab_dec;
// @knob min=0 max=1 step=0.01 default=0.35
global float ab_sus;
// @knob min=40 max=800 step=5 default=120
global float ab_rel;

// @knob min=0.05 max=20 step=0.01 default=5
global float ab_lfoRate;
// @knob min=0 max=1 step=0.01 default=0.12
global float ab_lfoAmt;

// @modSource label=LFO bipolar=1
global float ab_lfoOut;
// @modSource label=ENV bipolar=0
global float ab_envOut;

global float ab_cutoff_mod;
global int ab_cutoff_mod_src;
global float ab_cutoff_mod_depth;

// @modRoute src=ENV dst=Filter default=1 depth=0.3

1200.0 => ab_cutoff;
8.0 => ab_res;
90.0 => ab_hpf;
40.0 => ab_glide;
0.65 => ab_envMod;
0.5 => ab_drive;
0.45 => ab_amp;
0.2 => ab_pulse;
0.45 => ab_width;
3.0 => ab_atk;
180.0 => ab_dec;
0.35 => ab_sus;
120.0 => ab_rel;
5.0 => ab_lfoRate;
0.12 => ab_lfoAmt;
82.41 => ab_noteHz;
82.41 => float ab_curHz;
0 => ab_cutoff_mod_src;
0.0 => ab_cutoff_mod_depth;

SawOsc saw => Gain pre;
PulseOsc pulse => pre;
pre => Gain fold => HPF hp => LPF lpf1 => LPF lpf2 => ADSR env => Gain post => Gain out => ab_meter => rackBus;

0.8 => saw.gain;
0.0 => pulse.gain;
0.45 => pulse.width;
env.set(3::ms, 180::ms, 0.35, 120::ms);
0.0 => out.gain;
1200 => lpf1.freq;
1200 => lpf2.freq;
8 => lpf1.Q;
8 => lpf2.Q;
90 => hp.freq;

spork ~ follow();
spork ~ onGate();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(ab_meter.last()) => float s;
    if (s > ab_meter_p) s => ab_meter_p; else ab_meter_p * d => ab_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    ab_width => pulse.width;
    (1.0 - ab_pulse) => saw.gain;
    ab_pulse => pulse.gain;
    1.0 + ab_drive * 6.0 => fold.gain;
    1.0 + ab_drive * 2.5 => post.gain;
    ab_hpf => hp.freq;

    if (ab_glide <= 1.0) {
      ab_noteHz => ab_curHz;
    } else {
      Math.max(0.001, ab_glide / 1000.0) => float tau;
      Math.exp(-0.005 / tau) => float coef;
      ab_curHz + (ab_noteHz - ab_curHz) * (1.0 - coef) => ab_curHz;
    }
    ab_curHz => saw.freq;
    ab_curHz => pulse.freq;

    now / second => float t;
    Math.sin(2.0 * Math.PI * ab_lfoRate * t) * ab_lfoAmt => ab_lfoOut;
    env.value() => ab_envOut;

    ab_res => lpf1.Q;
    ab_res => lpf2.Q;

    if (ab_cutoff_mod_src == 0) {
      ab_cutoff + env.value() * ab_envMod * 4000.0 => float cf;
      cf => lpf1.freq;
      cf => lpf2.freq;
    } else {
      // Matrix writes source×depth in ~[-1,1]; scale to Hz like the internal env path.
      ab_cutoff + ab_cutoff_mod * 4000.0 => float cf;
      Math.max(80.0, cf) => cf;
      cf => lpf1.freq;
      cf => lpf2.freq;
    }

    ab_atk::ms => dur a;
    ab_dec::ms => dur d;
    ab_rel::ms => dur r;
    env.set(a, d, ab_sus, r);

    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    ab_gate => now;
    spork ~ hit();
  }
}

fun void hit() {
  ab_accent => float acc;
  Math.max(0.15, acc) => float aMul;
  ab_amp * (0.55 + aMul * 0.65) => out.gain;

  ab_dec * (0.7 + (1.0 - acc) * 0.5) => float decMs;
  ab_atk::ms => dur a;
  decMs::ms => dur d;
  ab_rel::ms => dur r;
  env.set(a, d, ab_sus, r);

  env.keyOn();
  Math.max(0.01, live_stepDur) * 0.92 => float hold;
  hold::second => now;
  env.keyOff();
  ab_amp => out.gain;
}
