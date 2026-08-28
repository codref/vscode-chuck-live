// drums/snare.ck — snare/clap into rackBus. Load master first; sequence dk_snare.
//
// Two layers: filtered noise (snare wires) + short sine body ( drum shell ).

global Gain rackBus;
global Gain snare_meter;
global float snare_meter_p;
0.0 => snare_meter_p;

// @seqGate
global Event dk_snare;

// @knob min=0 max=0.7 step=0.01 default=0.35
global float dk_snare_amp;
// @knob min=30 max=250 step=5 default=120
global float dk_snare_dec;
// @slider min=400 max=4000 step=20 default=1800
global float dk_snare_tone;       // BPF center for noise layer

0.35 => dk_snare_amp;
120.0 => dk_snare_dec;
1800.0 => dk_snare_tone;

Noise nz => BPF bp => ADSR envN => Gain mix;
SinOsc body => ADSR envB => mix;  // both envelopes feed one mix Gain
mix => Gain g => snare_meter => rackBus;

envN.set(1::ms, 120::ms, 0.0, 40::ms);
envB.set(1::ms, 60::ms, 0.0, 30::ms);
1800 => bp.freq;
1.5 => bp.Q;
180.0 => body.freq;
0.0 => g.gain;

spork ~ onSnare();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(snare_meter.last()) => float s;
    if (s > snare_meter_p) s => snare_meter_p; else snare_meter_p * d => snare_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    dk_snare_amp => g.gain;
    dk_snare_tone => bp.freq;
    dk_snare_dec::ms => dur d;
    envN.set(1::ms, d, 0.0, 40::ms);
    (d * 0.45) => dur db;         // body decays faster than noise
    envB.set(1::ms, db, 0.0, 30::ms);
    5::ms => now;
  }
}

fun void onSnare() {
  while (true) {
    dk_snare => now;
    0.55 => nz.gain;              // fixed mix per hit (could be knobs)
    0.25 => body.gain;
    envN.keyOn();
    envB.keyOn();
    dk_snare_dec::ms => now;
    envN.keyOff();
    envB.keyOff();
  }
}
