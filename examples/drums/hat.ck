// drums/hat.ck — noise hat into rackBus. Load master first; sequence dk_hat.

global Gain rackBus;

// @seqGate
global Event dk_hat;

// @knob min=0 max=0.5 step=0.01 default=0.18
global float dk_hat_amp;
// @knob min=5 max=80 step=1 default=25
global float dk_hat_dec;
// @slider min=2000 max=12000 step=50 default=7000
global float dk_hat_color;

0.18 => dk_hat_amp;
25.0 => dk_hat_dec;
7000.0 => dk_hat_color;

Noise n => HPF hp => ADSR env => Gain g => rackBus;
env.set(1::ms, 25::ms, 0.0, 15::ms);
7000 => hp.freq;
1.0 => n.gain;
0.0 => g.gain;

spork ~ onHat();
spork ~ follow();
while (true) 20::ms => now;

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
    dk_hat => now;
    env.keyOn();
    dk_hat_dec::ms => now;
    env.keyOff();
  }
}
