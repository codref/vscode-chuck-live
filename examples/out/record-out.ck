// out/record-out.ck — tap mainBus → WAV (does NOT own dac).
// Load anytime after master.ck WHILE dac-out.ck or fx/bus-fx.ck is already up.
// Safe to add/remove mid-session. Edit OUT_PATH before recording.
// Focus this file for Knobs → click rec_toggle to start/stop.

global Gain mainBus;
global Gain record_out_meter;
global float record_out_meter_p;
0.0 => record_out_meter_p;

// @button
global Event rec_toggle;

// Edit path (relative to VM cwd or absolute) before you record:
"take.wav" => string OUT_PATH;

mainBus => WvOut rec => blackhole;
mainBus => record_out_meter => blackhole;

spork ~ recorder();
spork ~ _ckLivePeak();
while (true) 1::second => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(record_out_meter.last()) => float s;
    if (s > record_out_meter_p) s => record_out_meter_p; else record_out_meter_p * d => record_out_meter_p;
    1::samp => now;
  }
}

fun void recorder() {
  0 => int recording;
  while (true) {
    rec_toggle => now;
    if (!recording) {
      OUT_PATH => rec.path;
      1 => rec.openFile;
      1 => recording;
      chout <= "recording → " <= OUT_PATH <= IO.newline();
    } else {
      0 => rec.openFile;
      0 => recording;
      chout <= "saved " <= OUT_PATH <= IO.newline();
    }
  }
}
