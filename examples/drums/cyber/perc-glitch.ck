// drums/cyber/perc-glitch.ck — random laser blips into rackBus.
// Load master first; sequence cy_glitch.

global Gain rackBus;
global Gain cy_glitch_meter;
global float cy_glitch_meter_p;
0.0 => cy_glitch_meter_p;

// @seqGate
global Event cy_glitch;

// @knob min=0 max=0.5 step=0.01 default=0.2
global float cy_glitch_amp;
// @knob min=200 max=2000 step=10 default=400
global float cy_glitch_low;
// @knob min=800 max=8000 step=20 default=3200
global float cy_glitch_high;
// @knob min=3 max=40 step=1 default=14
global float cy_glitch_dec;
// @knob min=0.05 max=0.5 step=0.01 default=0.15
global float cy_glitch_width;

0.2 => cy_glitch_amp;
400.0 => cy_glitch_low;
3200.0 => cy_glitch_high;
14.0 => cy_glitch_dec;
0.15 => cy_glitch_width;

// phrygian-ish laser table (Hz)
[400.0, 450.0, 530.0, 630.0, 710.0, 800.0, 950.0, 1060.0] @=> float phrygLaser[];

PulseOsc blip => BPF bp => ADSR env => Gain g => cy_glitch_meter => rackBus;
env.set(0.5::ms, 14::ms, 0.0, 6::ms);
0.15 => blip.width;
1800 => bp.freq;
3.0 => bp.Q;
0.0 => g.gain;

spork ~ onGlitch();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(cy_glitch_meter.last()) => float s;
    if (s > cy_glitch_meter_p) s => cy_glitch_meter_p; else cy_glitch_meter_p * d => cy_glitch_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    cy_glitch_amp => g.gain;
    cy_glitch_width => blip.width;
    cy_glitch_dec::ms => dur d;
    env.set(0.5::ms, d, 0.0, 6::ms);
    5::ms => now;
  }
}

fun void onGlitch() {
  while (true) {
    cy_glitch => now;
    spork ~ glitchHit();
  }
}

fun void glitchHit() {
  Math.random2(0, phrygLaser.size() - 1) => int idx;
  phrygLaser[idx] => float f;
  Math.random2f(cy_glitch_low, cy_glitch_high) => float r;
  (f + r) * 0.5 => float freq;
  freq => blip.freq;
  freq * 1.8 => bp.freq;
  env.keyOn();
  cy_glitch_dec::ms => now;
  env.keyOff();
}
