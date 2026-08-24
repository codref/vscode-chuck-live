// oscillators/square.ck — pulse into rackBus (load master.ck first).

global Gain rackBus;
global Gain square_meter;
global float square_meter_p;
0.0 => square_meter_p;

// @knob min=0 max=0.5 step=0.01 default=0.12
global float sqr_amp;

// @slider min=40 max=1200 step=1 default=110
global float sqr_freq;

// @knob min=0.05 max=0.5 step=0.01 default=0.25
global float sqr_width;

// @slider min=200 max=6000 step=10 default=2500
global float sqr_cutoff;

// @knob min=0 max=1 step=0.01 default=0
global float sqr_pwmHz;

0.12 => sqr_amp;
110.0 => sqr_freq;
0.25 => sqr_width;
2500.0 => sqr_cutoff;
0.0 => sqr_pwmHz;

PulseOsc osc => LPF lpf => square_meter => rackBus;
0.0 => osc.gain;
0.25 => osc.width;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(square_meter.last()) => float s;
    if (s > square_meter_p) s => square_meter_p; else square_meter_p * d => square_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    sqr_amp => osc.gain;
    sqr_freq => osc.freq;
    sqr_cutoff => lpf.freq;
    now / second => float t;
    // PWM: width wobbles around sqr_width when sqr_pwmHz > 0
    sqr_width + Math.sin(2.0 * Math.PI * sqr_pwmHz * t) * 0.15 * sqr_pwmHz => float w;
    Math.max(0.05, Math.min(0.5, w)) => osc.width;
    5::ms => now;
  }
}
