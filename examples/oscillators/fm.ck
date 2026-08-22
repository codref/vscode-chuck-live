// oscillators/fm.ck — 2-op FM (carrier × modulator); metallic / bell / growl.

// @knob min=0 max=0.5 step=0.01 default=0.15
global float fm_amp;

// @slider min=40 max=800 step=1 default=110
global float fm_car;

// @knob min=0.25 max=8 step=0.01 default=2
global float fm_ratio;

// @slider min=0 max=800 step=1 default=120
global float fm_index;

// @knob min=0 max=1 step=0.01 default=0.2
global float fm_fb;

0.15 => fm_amp;
110.0 => fm_car;
2.0 => fm_ratio;
120.0 => fm_index;
0.2 => fm_fb;

SinOsc mod => blackhole;
SinOsc car => dac;
0.0 => car.gain;
0.0 => mod.gain;

spork ~ follow();
while (true) 20::ms => now;

fun void follow() {
  while (true) {
    fm_amp => car.gain;
    fm_car => float c;
    c * fm_ratio => float mfreq;
    mfreq => mod.freq;
    // classic FM: car.freq = carrier + mod * index
    // light feedback: feed last car sample-ish via mod depth scaling
    (fm_index + fm_fb * fm_index) => float idx;
    1.0 => mod.gain;
    c + mod.last() * idx => car.freq;
    1::ms => now;
  }
}
