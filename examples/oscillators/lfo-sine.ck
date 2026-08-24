// oscillators/lfo-sine.ck — slow pad into rackBus (load master.ck first).

global Gain rackBus;
global Gain lfo_sine_meter;
global float lfo_sine_meter_p;
0.0 => lfo_sine_meter_p;

// @knob min=0 max=0.6 step=0.01 default=0.22
global float lfo_amp;

// @slider min=0.05 max=20 step=0.01 default=0.25
global float lfo_rate;

// @slider min=40 max=600 step=1 default=82
global float lfo_center;

// @knob min=0 max=40 step=0.1 default=8
global float lfo_depth;

// @knob min=0 max=1 step=0.01 default=0.4
global float lfo_space;

0.22 => lfo_amp;
0.25 => lfo_rate;
82.0 => lfo_center;
8.0 => lfo_depth;
0.4 => lfo_space;

SinOsc a => Gain g => NRev rev;
SinOsc b => g;
rev.chan(0) => lfo_sine_meter;
rev.chan(1) => lfo_sine_meter;
lfo_sine_meter => rackBus;
0.0 => a.gain;
0.0 => b.gain;
0.15 => rev.mix;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(lfo_sine_meter.last()) => float s;
    if (s > lfo_sine_meter_p) s => lfo_sine_meter_p; else lfo_sine_meter_p * d => lfo_sine_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    lfo_amp * 0.55 => a.gain;
    lfo_amp * 0.45 * lfo_space => b.gain;
    0.08 + lfo_space * 0.25 => rev.mix;

    now / second => float t;
    lfo_center + Math.sin(2.0 * Math.PI * lfo_rate * t) * lfo_depth => a.freq;
    a.freq() * 1.005 => b.freq;
    5::ms => now;
  }
}
