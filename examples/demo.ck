// ChucK Live demo — annotate globals, Start VM, Add this file, move Knobs.

// @knob min=0 max=1 step=0.01 default=0.3
global float gain;

// @slider min=110 max=880 step=1 default=440
global float freq;

// @button
global Event bang;

0.3 => gain;
440.0 => freq;

SinOsc osc => Gain g => dac;
gain => g.gain;
freq => osc.freq;

// Follow OSC-updated globals
spork ~ follow();
spork ~ onBang();

while (true) {
  10::ms => now;
}

fun void follow() {
  while (true) {
    gain => g.gain;
    freq => osc.freq;
    10::ms => now;
  }
}

fun void onBang() {
  while (true) {
    bang => now;
    // Soft swell (~0.5s) so it isn't a harsh click
    0.85 => float peak;
    // attack
    for (0 => int i; i < 40; i++) {
      gain + (peak - gain) * (i / 40.0) => g.gain;
      4::ms => now;
    }
    // hold
    180::ms => now;
    // release
    for (40 => int i; i > 0; i--) {
      gain + (peak - gain) * (i / 40.0) => g.gain;
      6::ms => now;
    }
    gain => g.gain;
  }
}
