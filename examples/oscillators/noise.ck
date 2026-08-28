// oscillators/noise.ck — filtered noise texture into rackBus (load master.ck first).
//
// HPF removes rumble; BPF shapes color. Optional nz_gateHz chops noise rhythmically.

global Gain rackBus;
global Gain noise_meter;
global float noise_meter_p;
0.0 => noise_meter_p;

// @knob min=0 max=0.4 step=0.01 default=0.08
global float nz_amp;

// @slider min=200 max=10000 step=10 default=2500
global float nz_cutoff;           // BPF center frequency

// @knob min=0.3 max=12 step=0.1 default=1.5
global float nz_Q;                // BPF resonance

// @knob min=0 max=1 step=0.01 default=0
global float nz_hp;               // high-pass amount (mapped to 80..2080 Hz)

// @knob min=0 max=8 step=0.01 default=0
global float nz_gateHz;           // 0 = steady noise; >0 = amplitude chop rate

0.08 => nz_amp;
2500.0 => nz_cutoff;
1.5 => nz_Q;
0.0 => nz_hp;
0.0 => nz_gateHz;

Noise n => HPF hp => BPF bp => Gain g => noise_meter => rackBus;
0.0 => n.gain;                    // follow() sets level (possibly gated)
80.0 => hp.freq;
1.0 => g.gain;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(noise_meter.last()) => float s;
    if (s > noise_meter_p) s => noise_meter_p; else noise_meter_p * d => noise_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    nz_cutoff => bp.freq;
    nz_Q => bp.Q;
    80.0 + nz_hp * 2000.0 => hp.freq;

    now / second => float t;
    float env;
    if (nz_gateHz > 0.05) {
      // rhythmic noise chops — half-wave rectified sine as simple gate
      Math.sin(2.0 * Math.PI * nz_gateHz * t) => float s;
      (s > 0.0 ? s : 0.0) => env;
    } else {
      1.0 => env;                 // full level when gate is off
    }
    nz_amp * env => n.gain;
    5::ms => now;
  }
}
