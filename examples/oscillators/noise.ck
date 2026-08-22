// oscillators/noise.ck — filtered noise into rackBus (load master.ck first).

global Gain rackBus;

// @knob min=0 max=0.4 step=0.01 default=0.08
global float nz_amp;

// @slider min=200 max=10000 step=10 default=2500
global float nz_cutoff;

// @knob min=0.3 max=12 step=0.1 default=1.5
global float nz_Q;

// @knob min=0 max=1 step=0.01 default=0
global float nz_hp;

// @knob min=0 max=8 step=0.01 default=0
global float nz_gateHz;

0.08 => nz_amp;
2500.0 => nz_cutoff;
1.5 => nz_Q;
0.0 => nz_hp;
0.0 => nz_gateHz;

Noise n => HPF hp => BPF bp => Gain g => rackBus;
0.0 => n.gain;
80.0 => hp.freq;
1.0 => g.gain;

spork ~ follow();
while (true) 20::ms => now;

fun void follow() {
  while (true) {
    nz_cutoff => bp.freq;
    nz_Q => bp.Q;
    80.0 + nz_hp * 2000.0 => hp.freq;

    now / second => float t;
    float env;
    if (nz_gateHz > 0.05) {
      // rhythmic noise chops
      Math.sin(2.0 * Math.PI * nz_gateHz * t) => float s;
      (s > 0.0 ? s : 0.0) => env;
    } else {
      1.0 => env;
    }
    nz_amp * env => n.gain;
    5::ms => now;
  }
}
