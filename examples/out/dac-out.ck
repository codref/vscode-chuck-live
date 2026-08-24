// out/dac-out.ck — wire mainBus to dac (unity).
// Load AFTER master.ck. Do NOT load together with fx/bus-fx.ck (double dac).

global Gain mainBus;
global Gain dac_out_meter;
global float dac_out_meter_p;
0.0 => dac_out_meter_p;

mainBus => dac_out_meter => dac;
1.0 => mainBus.gain;

spork ~ _ckLivePeak();
while (true) 1::second => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(dac_out_meter.last()) => float s;
    if (s > dac_out_meter_p) s => dac_out_meter_p; else dac_out_meter_p * d => dac_out_meter_p;
    1::samp => now;
  }
}
