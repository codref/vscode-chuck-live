// drums/cyber/kick-industrial.ck — industrial EBM kick into rackBus.
// Load master first; sequence cy_kick. Pair with dk_bass.ck for sub weight.

global Gain rackBus;
global Gain cy_kick_meter;
global float cy_kick_meter_p;
0.0 => cy_kick_meter_p;

// @seqGate
global Event cy_kick;

// @knob min=0 max=0.9 step=0.01 default=0.7
global float cy_kick_amp;
// @knob min=45 max=120 step=1 default=62
global float cy_kick_freq;
// @knob min=30 max=280 step=5 default=140
global float cy_kick_dec;
// @knob min=0 max=1 step=0.01 default=0.55
global float cy_kick_click;
// @knob min=0 max=1 step=0.01 default=0.35
global float cy_kick_metal;
// @knob min=0 max=1 step=0.01 default=0.4
global float cy_kick_drive;
// @knob min=80 max=400 step=5 default=180
global float cy_kick_tight;

0.7 => cy_kick_amp;
62.0 => cy_kick_freq;
140.0 => cy_kick_dec;
0.55 => cy_kick_click;
0.35 => cy_kick_metal;
0.4 => cy_kick_drive;
180.0 => cy_kick_tight;

SinOsc body => ADSR env => Gain drive => Gain bodyG => Gain mix;
PulseOsc click => BPF clickF => Gain clickG => mix;
SinOsc ring => BPF ringF => Gain ringG => mix;
mix => LPF tight => Gain g => cy_kick_meter => rackBus;

env.set(1::ms, 140::ms, 0.0, 25::ms);
clickF.set(3200, 2.5);
ringF.set(3000, 4.0);
180 => tight.freq;
1.0 => tight.Q;
0.0 => g.gain;
0.0 => bodyG.gain;
0.0 => clickG.gain;
0.0 => ringG.gain;

spork ~ onKick();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(cy_kick_meter.last()) => float s;
    if (s > cy_kick_meter_p) s => cy_kick_meter_p; else cy_kick_meter_p * d => cy_kick_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    cy_kick_amp => g.gain;
    cy_kick_click => clickG.gain;
    cy_kick_metal => ringG.gain;
    1.0 + cy_kick_drive * 3.0 => drive.gain;
    cy_kick_tight => tight.freq;
    cy_kick_dec::ms => dur d;
    env.set(1::ms, d, 0.0, 25::ms);
    5::ms => now;
  }
}

fun void onKick() {
  while (true) {
    cy_kick => now;
    spork ~ kickHit();
  }
}

fun void kickHit() {
  cy_kick_freq * 2.4 => float f0;
  f0 => body.freq;
  1.0 => bodyG.gain;
  env.keyOn();
  spork ~ drop(f0);
  spork ~ clickBurst();
  spork ~ ringBurst();
  cy_kick_dec::ms => now;
  env.keyOff();
  0.0 => bodyG.gain;
}

fun void drop(float f0) {
  for (0 => int i; i < 20; i++) {
    f0 * Math.pow(0.88, i) => float f;
    if (f < cy_kick_freq) cy_kick_freq => f;
    f => body.freq;
    4::ms => now;
  }
  cy_kick_freq => body.freq;
}

fun void clickBurst() {
  if (cy_kick_click < 0.01) return;
  cy_kick_freq * 4.5 => click.freq;
  cy_kick_click => clickG.gain;
  10::ms => now;
  0.0 => clickG.gain;
}

fun void ringBurst() {
  if (cy_kick_metal < 0.01) return;
  3000.0 => ring.freq;
  cy_kick_metal => ringG.gain;
  35::ms => now;
  0.0 => ringG.gain;
}
