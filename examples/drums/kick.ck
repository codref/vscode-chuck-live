// drums/kick.ck — analog-ish kick into rackBus. Load master first; sequence dk_kick.

global Gain rackBus;
global Gain kick_meter;
global float kick_meter_p;
0.0 => kick_meter_p;

// @seqGate
global Event dk_kick;

// @knob min=0 max=0.9 step=0.01 default=0.65
global float dk_kick_amp;
// @knob min=40 max=160 step=1 default=75
global float dk_kick_freq;
// @knob min=40 max=400 step=5 default=220
global float dk_kick_dec;

0.65 => dk_kick_amp;
75.0 => dk_kick_freq;
220.0 => dk_kick_dec;

SinOsc osc => ADSR env => Gain g => kick_meter;
Noise click => BPF clickF => Gain clickG => kick_meter;
kick_meter => rackBus;

env.set(1::ms, 220::ms, 0.0, 30::ms);
clickF.set(800, 1.5);
0.5 => clickG.gain;
0.0 => g.gain;
1.0 => osc.gain;

spork ~ onKick();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(kick_meter.last()) => float s;
    if (s > kick_meter_p) s => kick_meter_p; else kick_meter_p * d => kick_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    dk_kick_amp => g.gain;
    dk_kick_dec::ms => dur d;
    env.set(1::ms, d, 0.0, 30::ms);
    5::ms => now;
  }
}

fun void onKick() {
  while (true) {
    dk_kick => now;
    // pitch-drop body + short click (audible on small speakers)
    dk_kick_freq * 2.2 => float f0;
    f0 => osc.freq;
    env.keyOn();
    spork ~ drop(f0);
    spork ~ clickHit();
    dk_kick_dec::ms => now;
    env.keyOff();
  }
}

fun void drop(float f0) {
  for (0 => int i; i < 28; i++) {
    f0 * Math.pow(0.91, i) => osc.freq;
    4::ms => now;
  }
}

fun void clickHit() {
  1.0 => click.gain;
  12::ms => now;
  0.0 => click.gain;
}
