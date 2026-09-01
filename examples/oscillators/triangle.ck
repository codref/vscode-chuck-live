// oscillators/triangle.ck — soft triangle stack into rackBus (load master.ck first).
//
// Four TriOsc shreds into one Gain — sub octave, fifth, and chorus detune layers.

global Gain rackBus;
global Gain triangle_meter;
global float triangle_meter_p;
0.0 => triangle_meter_p;

// @knob min=0 max=0.7 step=0.01 default=0.18
global float tri_amp;             // master level split across partials

// @slider min=40 max=1000 step=1 default=165
global float tri_freq;            // root pitch

// @knob min=0 max=1 step=0.01 default=0.35
global float tri_sub;             // mix of octave-down triangle

// @knob min=0 max=1 step=0.01 default=0
global float tri_fifth;           // mix of perfect-fifth partial

// @knob min=0 max=0.5 step=0.01 default=0
global float tri_chorus;          // very slow detune layer for width

0.18 => tri_amp;
165.0 => tri_freq;
0.35 => tri_sub;
0.0 => tri_fifth;
0.0 => tri_chorus;

TriOsc osc => Gain g => triangle_meter => rackBus;
TriOsc sub => g;                  // parallel oscillators summed in `g`
TriOsc fifth => g;
TriOsc ch => g;
0.0 => osc.gain;
0.0 => sub.gain;
0.0 => fifth.gain;
0.0 => ch.gain;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(triangle_meter.last()) => float s;
    if (s > triangle_meter_p) s => triangle_meter_p; else triangle_meter_p * d => triangle_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    tri_amp * (1.0 - tri_sub * 0.35) => osc.gain;
    tri_amp * tri_sub * 0.7 => sub.gain;
    tri_amp * tri_fifth * 0.45 => fifth.gain;
    tri_amp * tri_chorus * 0.35 => ch.gain;

    tri_freq => osc.freq;
    tri_freq * 0.5 => sub.freq;       // one octave down
    tri_freq * 1.5 => fifth.freq;     // perfect fifth above root
    now / second => float t;
    tri_freq * (1.0 + 0.003 * Math.sin(t * 0.7)) => ch.freq;   // slow chorus wobble
    5::ms => now;
  }
}
