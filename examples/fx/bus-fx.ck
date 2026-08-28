// fx/bus-fx.ck — post-master delay / reverb / grit → dac.
// Load AFTER master.ck INSTEAD of out/dac-out.ck (never both — double dac).
//
// Taps `mainBus` (same point as record-out.ck). With Sync + Sequencer running,
// you hear wet FX on the full mix; WAV from record-out stays dry at mainBus.

global Gain mainBus;
global Gain bus_fx_meter;
global float bus_fx_meter_p;
0.0 => bus_fx_meter_p;

// @knob min=0 max=1 step=0.01 default=0.22
global float fx_mix;              // 0 = dry only, 1 = full wet path level
// @slider min=50 max=800 step=5 default=280
global float fx_delay;            // echo delay time (ms)
// @knob min=0 max=0.9 step=0.01 default=0.35
global float fx_feedback;         // echo regeneration
// @knob min=0 max=0.6 step=0.01 default=0.18
global float fx_reverb;           // NRev mix amount
// @knob min=0 max=1 step=0.01 default=0.15
global float fx_crush;            // crude grit — attenuates wet path

0.22 => fx_mix;
280.0 => fx_delay;
0.35 => fx_feedback;
0.18 => fx_reverb;
0.15 => fx_crush;

// Parallel dry/wet: both paths sum into `sum` then dac.
mainBus => Gain dry => Gain sum => bus_fx_meter => dac;
mainBus => Gain intoWet => Echo echo => NRev rev => Gain crushG => Gain wet => sum;

1.0 => dry.gain;
0.0 => intoWet.gain;
0.0 => wet.gain;
800::ms => echo.max;              // max delay line length
280::ms => echo.delay;
0.35 => echo.mix;
0.55 => echo.gain;
0.12 => rev.mix;

spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(bus_fx_meter.last()) => float s;
    if (s > bus_fx_meter_p) s => bus_fx_meter_p; else bus_fx_meter_p * d => bus_fx_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    // dry/wet balance from single fx_mix knob
    (1.0 - fx_mix) => dry.gain;
    fx_mix => intoWet.gain;
    fx_mix => wet.gain;

    Math.max(50.0, Math.min(800.0, fx_delay))::ms => echo.delay;
    fx_feedback => echo.gain;
    fx_reverb * 0.5 => rev.mix;

    // crude "crush": attenuate wet (not a true bit-crusher UGen)
    1.0 - fx_crush * 0.55 => crushG.gain;

    5::ms => now;
  }
}
