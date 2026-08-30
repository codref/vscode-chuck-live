// fx/cyber-fx.ck — dark formant wet chain → dac (darkwave preset).
// Load AFTER master.ck INSTEAD of bus-fx.ck (never both — double dac).
//
// Wet path: HPF → formant BPF → Echo → dark LPF → NRev → dac

global Gain mainBus;
global Gain cf_meter;
global float cf_meter_p;
0.0 => cf_meter_p;

// @knob min=0 max=1 step=0.01 default=0.2
global float cf_mix;
// @knob min=100 max=800 step=5 default=220
global float cf_hp;
// @slider min=400 max=3500 step=10 default=1400
global float cf_formant;
// @knob min=0.5 max=8 step=0.1 default=3.5
global float cf_formQ;
// @slider min=800 max=8000 step=20 default=3200
global float cf_dark;
// @slider min=50 max=800 step=5 default=340
global float cf_delay;
// @knob min=0 max=0.85 step=0.01 default=0.38
global float cf_feedback;
// @knob min=0 max=0.6 step=0.01 default=0.16
global float cf_reverb;
// @knob min=0 max=1 step=0.01 default=0.12
global float cf_crush;

0.2 => cf_mix;
220.0 => cf_hp;
1400.0 => cf_formant;
3.5 => cf_formQ;
3200.0 => cf_dark;
340.0 => cf_delay;
0.38 => cf_feedback;
0.16 => cf_reverb;
0.12 => cf_crush;

mainBus => Gain dry => Gain sum => cf_meter => dac;
mainBus => Gain intoWet => HPF hp => BPF form => Echo echo => LPF dark => NRev rev => Gain crushG => Gain wet => sum;

1.0 => dry.gain;
0.0 => intoWet.gain;
0.0 => wet.gain;
220 => hp.freq;
1.0 => hp.Q;
1400 => form.freq;
3.5 => form.Q;
3200 => dark.freq;
1.2 => dark.Q;
800::ms => echo.max;
340::ms => echo.delay;
0.35 => echo.mix;
0.55 => echo.gain;
0.12 => rev.mix;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(cf_meter.last()) => float s;
    if (s > cf_meter_p) s => cf_meter_p; else cf_meter_p * d => cf_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    (1.0 - cf_mix) => dry.gain;
    cf_mix => intoWet.gain;
    cf_mix => wet.gain;

    cf_hp => hp.freq;
    cf_formant => form.freq;
    cf_formQ => form.Q;
    cf_dark => dark.freq;

    Math.max(50.0, Math.min(800.0, cf_delay))::ms => echo.delay;
    cf_feedback => echo.gain;
    cf_reverb * 0.5 => rev.mix;
    1.0 - cf_crush * 0.55 => crushG.gain;

    5::ms => now;
  }
}
