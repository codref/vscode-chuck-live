// oscillators/saw.ck — bright saw into rackBus (load master.ck first).

global Gain rackBus;
global Gain saw_meter;
global float saw_meter_p;
0.0 => saw_meter_p;

// @knob min=0 max=0.6 step=0.01 default=0.15
global float saw_amp;

// @slider min=30 max=400 step=1 default=55
global float saw_freq;

// @slider min=80 max=8000 step=10 default=1200
global float saw_cutoff;

// @knob min=0.5 max=8 step=0.1 default=2
global float saw_Q;

// @knob min=0 max=1 step=0.01 default=0
global float saw_drive;

0.15 => saw_amp;
55.0 => saw_freq;
1200.0 => saw_cutoff;
2.0 => saw_Q;
0.0 => saw_drive;

SawOsc osc => LPF lpf => Gain drive => saw_meter => rackBus;
0.0 => osc.gain;
1.0 => drive.gain;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(saw_meter.last()) => float s;
    if (s > saw_meter_p) s => saw_meter_p; else saw_meter_p * d => saw_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    saw_amp => osc.gain;
    saw_freq => osc.freq;
    saw_cutoff => lpf.freq;
    saw_Q => lpf.Q;
    1.0 + saw_drive * 4.0 => drive.gain;
    5::ms => now;
  }
}
