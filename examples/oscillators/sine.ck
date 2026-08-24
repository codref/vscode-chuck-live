// oscillators/sine.ck — pure sine into rackBus (load master.ck first).

global Gain rackBus;
global Gain sine_meter;
global float sine_meter_p;
0.0 => sine_meter_p;

// @knob min=0 max=0.8 step=0.01 default=0.2
global float sine_amp;

// @slider min=40 max=1600 step=1 default=220
// @seq mode=raw
global float sine_freq;

// @knob min=-12 max=12 step=0.01 default=0
global float sine_detune;

// @knob min=0 max=8 step=0.01 default=0
global float sine_vibHz;

// @knob min=0 max=50 step=0.1 default=0
global float sine_vibDepth;

// @knob min=-1 max=1 step=0.01 default=0
global float sine_pan;

0.2 => sine_amp;
220.0 => sine_freq;
0.0 => sine_detune;
0.0 => sine_vibHz;
0.0 => sine_vibDepth;
0.0 => sine_pan;

SinOsc osc => Pan2 pan;
pan.chan(0) => sine_meter;
pan.chan(1) => sine_meter;
sine_meter => rackBus;
0.0 => osc.gain;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(sine_meter.last()) => float s;
    if (s > sine_meter_p) s => sine_meter_p; else sine_meter_p * d => sine_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    sine_amp => osc.gain;
    Std.mtof(Std.ftom(sine_freq) + sine_detune) => float base;
    now / second => float t;
    base + Math.sin(2.0 * Math.PI * sine_vibHz * t) * sine_vibDepth => osc.freq;
    sine_pan => pan.pan;
    5::ms => now;
  }
}
