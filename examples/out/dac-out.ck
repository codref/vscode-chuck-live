// out/dac-out.ck — wire mainBus to dac (unity).
// Load AFTER master.ck. Do NOT load together with fx/bus-fx.ck (double dac).

global Gain mainBus;

mainBus => dac;
1.0 => mainBus.gain;

while (true) 1::second => now;
