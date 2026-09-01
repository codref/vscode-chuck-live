// drums/cyber/hat-metal.ck — resonant metallic tick into rackBus.
// Load master first; sequence cy_hat.

global Gain rackBus;
global Gain cy_hat_meter;
global float cy_hat_meter_p;
0.0 => cy_hat_meter_p;

// @seqGate
global Event cy_hat;

// @knob min=0 max=0.5 step=0.01 default=0.22
global float cy_hat_amp;
// @knob min=3 max=40 step=1 default=12
global float cy_hat_dec;
// @slider min=6000 max=14000 step=50 default=9500
global float cy_hat_tone;
// @knob min=2 max=16 step=0.1 default=9
global float cy_hat_ring;
// @knob min=0 max=0.4 step=0.01 default=0.08
global float cy_hat_grit;

0.22 => cy_hat_amp;
12.0 => cy_hat_dec;
9500.0 => cy_hat_tone;
9.0 => cy_hat_ring;
0.08 => cy_hat_grit;

SinOsc ping => BPF bp => ADSR env => Gain pingG => Gain mix;
Noise grit => HPF hp => ADSR gritEnv => Gain gritG => mix;
mix => Gain g => cy_hat_meter => rackBus;

env.set(0.5::ms, 12::ms, 0.0, 8::ms);
gritEnv.set(0.3::ms, 6::ms, 0.0, 4::ms);
9500 => bp.freq;
9 => bp.Q;
6000 => hp.freq;
1.0 => ping.gain;
1.0 => grit.gain;
0.0 => g.gain;
0.0 => pingG.gain;
0.0 => gritG.gain;

spork ~ onHat();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(cy_hat_meter.last()) => float s;
    if (s > cy_hat_meter_p) s => cy_hat_meter_p; else cy_hat_meter_p * d => cy_hat_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    cy_hat_amp => g.gain;
    cy_hat_tone => bp.freq;
    cy_hat_ring => bp.Q;
    cy_hat_grit => gritG.gain;
    cy_hat_dec::ms => dur d;
    env.set(0.5::ms, d, 0.0, 8::ms);
    5::ms => now;
  }
}

fun void onHat() {
  while (true) {
    cy_hat => now;
    cy_hat_tone => ping.freq;
    env.keyOn();
    if (cy_hat_grit > 0.01) gritEnv.keyOn();
    cy_hat_dec::ms => now;
    env.keyOff();
    gritEnv.keyOff();
  }
}
