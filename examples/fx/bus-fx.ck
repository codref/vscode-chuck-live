// fx/bus-fx.ck — post-master delay / reverb / crush → dac.
// Load AFTER master.ck instead of out/dac-out.ck (not both).

global Gain mainBus;

// @knob min=0 max=1 step=0.01 default=0.22
global float fx_mix;
// @slider min=50 max=800 step=5 default=280
global float fx_delay;
// @knob min=0 max=0.9 step=0.01 default=0.35
global float fx_feedback;
// @knob min=0 max=0.6 step=0.01 default=0.18
global float fx_reverb;
// @knob min=0 max=1 step=0.01 default=0.15
global float fx_crush;

0.22 => fx_mix;
280.0 => fx_delay;
0.35 => fx_feedback;
0.18 => fx_reverb;
0.15 => fx_crush;

mainBus => Gain dry => Gain sum => dac;
mainBus => Gain intoWet => Echo echo => NRev rev => Gain crushG => Gain wet => sum;

1.0 => dry.gain;
0.0 => intoWet.gain;
0.0 => wet.gain;
800::ms => echo.max;
280::ms => echo.delay;
0.35 => echo.mix;
0.55 => echo.gain;
0.12 => rev.mix;

spork ~ follow();
while (true) 20::ms => now;

fun void follow() {
  while (true) {
    // dry/wet
    (1.0 - fx_mix) => dry.gain;
    fx_mix => intoWet.gain;
    fx_mix => wet.gain;

    Math.max(50.0, Math.min(800.0, fx_delay))::ms => echo.delay;
    fx_feedback => echo.gain;
    fx_reverb * 0.5 => rev.mix;

    // crude "crush": attenuate + slight gain punch (grit without true bitcrush UGen)
    1.0 - fx_crush * 0.55 => crushG.gain;

    5::ms => now;
  }
}
