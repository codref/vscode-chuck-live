// drums/snare.ck — snare/clap-ish into rackBus. Load master first; sequence dk_snare.

global Gain rackBus;

// @seqGate
global Event dk_snare;

// @knob min=0 max=0.7 step=0.01 default=0.35
global float dk_snare_amp;
// @knob min=30 max=250 step=5 default=120
global float dk_snare_dec;
// @slider min=400 max=4000 step=20 default=1800
global float dk_snare_tone;

0.35 => dk_snare_amp;
120.0 => dk_snare_dec;
1800.0 => dk_snare_tone;

Noise nz => BPF bp => ADSR envN => Gain mix;
SinOsc body => ADSR envB => mix;
mix => Gain g => rackBus;

envN.set(1::ms, 120::ms, 0.0, 40::ms);
envB.set(1::ms, 60::ms, 0.0, 30::ms);
1800 => bp.freq;
1.5 => bp.Q;
180.0 => body.freq;
0.0 => g.gain;

spork ~ onSnare();
spork ~ follow();
while (true) 20::ms => now;

fun void follow() {
  while (true) {
    dk_snare_amp => g.gain;
    dk_snare_tone => bp.freq;
    dk_snare_dec::ms => dur d;
    envN.set(1::ms, d, 0.0, 40::ms);
    (d * 0.45) => dur db;
    envB.set(1::ms, db, 0.0, 30::ms);
    5::ms => now;
  }
}

fun void onSnare() {
  while (true) {
    dk_snare => now;
    0.55 => nz.gain;
    0.25 => body.gain;
    envN.keyOn();
    envB.keyOn();
    dk_snare_dec::ms => now;
    envN.keyOff();
    envB.keyOff();
  }
}
