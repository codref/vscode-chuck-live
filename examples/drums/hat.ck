// drums/hat.ck — noise hi-hat into rackBus. Load master first; sequence dk_hat.
//
// Simple gate drum: Event → keyOn → wait decay → keyOff. HPF + short ADSR = hat.

global Gain rackBus;
global Gain hat_meter;
global float hat_meter_p;
0.0 => hat_meter_p;

// @seqGate
global Event dk_hat;

// @knob min=0 max=0.5 step=0.01 default=0.18
global float dk_hat_amp;
// @knob min=5 max=80 step=1 default=25
global float dk_hat_dec;          // envelope length (ms)
// @slider min=2000 max=12000 step=50 default=7000
global float dk_hat_color;        // HPF cutoff — brightness

0.18 => dk_hat_amp;
25.0 => dk_hat_dec;
7000.0 => dk_hat_color;

Noise n => HPF hp => ADSR env => Gain g => hat_meter => rackBus;
env.set(1::ms, 25::ms, 0.0, 15::ms);
7000 => hp.freq;
1.0 => n.gain;                    // noise always on; envelope shapes amplitude
0.0 => g.gain;

spork ~ onHat();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(hat_meter.last()) => float s;
    if (s > hat_meter_p) s => hat_meter_p; else hat_meter_p * d => hat_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    dk_hat_amp => g.gain;
    dk_hat_color => hp.freq;
    dk_hat_dec::ms => dur d;
    env.set(1::ms, d, 0.0, 15::ms);
    5::ms => now;
  }
}

fun void onHat() {
  while (true) {
    dk_hat => now;                // sequencer gate
    env.keyOn();
    dk_hat_dec::ms => now;
    env.keyOff();
  }
}
