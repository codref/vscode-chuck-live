// oscillators/master.ck — shared mix bus + master filters.
// Load THIS FIRST, then Add other oscillators/*.ck (they feed rackBus).
// Without master, bus-aware oscillators are silent.

global Gain rackBus;

// @knob min=0 max=1 step=0.01 default=0.75
global float master_amp;

// @slider min=200 max=12000 step=10 default=8000
global float master_cutoff;

// @knob min=0.5 max=8 step=0.1 default=1.2
global float master_Q;

// @slider min=20 max=2000 step=5 default=40
global float master_hp;

// @knob min=0 max=1 step=0.01 default=0
global float master_drive;

0.75 => master_amp;
8000.0 => master_cutoff;
1.2 => master_Q;
40.0 => master_hp;
0.0 => master_drive;

// rackBus => HPF => drive => LPF => out => dac
rackBus => HPF hp => Gain drive => LPF lpf => Gain out => dac;
1.0 => rackBus.gain;
40.0 => hp.freq;
1.0 => drive.gain;
8000.0 => lpf.freq;
1.2 => lpf.Q;
0.75 => out.gain;

spork ~ follow();
while (true) 20::ms => now;

fun void follow() {
  while (true) {
    master_hp => hp.freq;
    master_cutoff => lpf.freq;
    master_Q => lpf.Q;
    1.0 + master_drive * 3.5 => drive.gain;
    master_amp => out.gain;
    5::ms => now;
  }
}
