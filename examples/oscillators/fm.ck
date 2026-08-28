// oscillators/fm.ck — two-operator FM synthesis into rackBus (load master.ck first).
//
// Modulator (mod) does not connect to dac — it only affects carrier frequency.
// `mod.last()` reads the previous modulator sample for the FM equation.

global Gain rackBus;
global Gain fm_meter;
global float fm_meter_p;
0.0 => fm_meter_p;

// @knob min=0 max=0.5 step=0.01 default=0.15
global float fm_amp;

// @slider min=40 max=800 step=1 default=110
global float fm_car;              // carrier base frequency (Hz)

// @knob min=0.25 max=8 step=0.01 default=2
global float fm_ratio;            // modulator freq = carrier × ratio

// @slider min=0 max=800 step=1 default=120
global float fm_index;            // modulation depth (Hz-ish scaling)

// @knob min=0 max=1 step=0.01 default=0.2
global float fm_fb;               // feedback — scales index for harsher timbres

0.15 => fm_amp;
110.0 => fm_car;
2.0 => fm_ratio;
120.0 => fm_index;
0.2 => fm_fb;

SinOsc mod => blackhole;          // modulator runs but output is discarded
SinOsc car => fm_meter => rackBus;
0.0 => car.gain;
0.0 => mod.gain;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(fm_meter.last()) => float s;
    if (s > fm_meter_p) s => fm_meter_p; else fm_meter_p * d => fm_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    fm_amp => car.gain;
    fm_car => float c;
    c * fm_ratio => float mfreq;
    mfreq => mod.freq;
    // classic FM: car.freq = carrier + mod × index
    // light feedback: boost index when fm_fb > 0
    (fm_index + fm_fb * fm_index) => float idx;
    1.0 => mod.gain;
    c + mod.last() * idx => car.freq;   // per-sample FM — run fast (1 ms loop)
    1::ms => now;
  }
}
