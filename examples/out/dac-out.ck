// out/dac-out.ck — final hop: mainBus → speakers (unity gain).
//
// ChucK Live load order: Start VM → master.ck → instruments → THIS FILE.
// Only ONE output shred at a time: do NOT load together with fx/bus-fx.ck
// (both connect to `dac`; you would hear double / clip).
//
// `global` names are shared across every running shred in the VM. master.ck
// writes the mix into `mainBus`; this shred reads it and sends audio out.

global Gain mainBus;              // declared in master.ck — post-filter mix bus
global Gain dac_out_meter;        // tap for peak metering (extension Rack UI)
global float dac_out_meter_p;     // peak level 0..1, read by the extension
0.0 => dac_out_meter_p;           // start silent until audio arrives

// Audio graph: `=>` connects UGens left-to-right (sample flow).
// mainBus → meter tap → dac (built-in digital-to-analog converter).
mainBus => dac_out_meter => dac;
1.0 => mainBus.gain;              // unity — level is set upstream in master.ck

// `spork` starts a concurrent shred (ChucK thread). Peak meter runs in parallel.
spork ~ _ckLivePeak();
// Main shred must advance time or the VM exits when idle. Sleep forever.
while (true) 1::second => now;

// Rack meter helper (same pattern in every bus module).
fun void _ckLivePeak() {
  // Exponential decay: ~50 ms fall time at 44.1 kHz (attack is instant).
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(dac_out_meter.last()) => float s;   // abs value of last sample
    if (s > dac_out_meter_p) s => dac_out_meter_p; else dac_out_meter_p * d => dac_out_meter_p;
    1::samp => now;                               // once per sample — cheap peak hold
  }
}
