// oscillators/triangle.ck — soft triangle into rackBus (load master.ck first).

global Gain rackBus;

// @knob min=0 max=0.7 step=0.01 default=0.18
global float tri_amp;

// @slider min=40 max=1000 step=1 default=165
global float tri_freq;

// @knob min=0 max=1 step=0.01 default=0.35
global float tri_sub;

// @knob min=0 max=1 step=0.01 default=0
global float tri_fifth;

// @knob min=0 max=0.5 step=0.01 default=0
global float tri_chorus;

0.18 => tri_amp;
165.0 => tri_freq;
0.35 => tri_sub;
0.0 => tri_fifth;
0.0 => tri_chorus;

TriOsc osc => Gain g => rackBus;
TriOsc sub => g;
TriOsc fifth => g;
TriOsc ch => g;
0.0 => osc.gain;
0.0 => sub.gain;
0.0 => fifth.gain;
0.0 => ch.gain;

spork ~ follow();
while (true) 20::ms => now;

fun void follow() {
  while (true) {
    tri_amp * (1.0 - tri_sub * 0.35) => osc.gain;
    tri_amp * tri_sub * 0.7 => sub.gain;
    tri_amp * tri_fifth * 0.45 => fifth.gain;
    tri_amp * tri_chorus * 0.35 => ch.gain;

    tri_freq => osc.freq;
    tri_freq * 0.5 => sub.freq;
    tri_freq * 1.5 => fifth.freq;
    now / second => float t;
    tri_freq * (1.0 + 0.003 * Math.sin(t * 0.7)) => ch.freq;
    5::ms => now;
  }
}
