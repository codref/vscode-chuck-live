// out/record-out.ck — tap mainBus → WAV file (does NOT connect to dac).
// Load anytime after master.ck WHILE dac-out.ck or fx/bus-fx.ck is already up.
// Safe to Add/Remove mid-session — playback keeps going through the other output shred.
//
// Focus this file in the editor so Knobs shows rec_toggle. Click once = record,
// again = stop and flush. Watch Output → ChucK for "recording →" / "saved" lines.

global Gain mainBus;              // post-master mix (same tap as dac-out input)
global Gain record_out_meter;
global float record_out_meter_p;
0.0 => record_out_meter_p;

// @button
global Event rec_toggle;          // start/stop toggle in Knobs panel

// Edit path (relative to VM cwd or absolute) before you record:
"take.wav" => string OUT_PATH;

// WvOut needs a downstream connection — blackhole absorbs samples without sound.
mainBus => WvOut rec => blackhole;
mainBus => record_out_meter => blackhole;   // meter tap (optional UI feedback)

spork ~ recorder();               // handles toggle logic
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
    rec_toggle => now;            // extension broadcasts on button click
    if (!recording) {
      OUT_PATH => rec.path;
      1 => rec.openFile;          // begin writing WAV
      1 => recording;
      chout <= "recording → " <= OUT_PATH <= IO.newline();
    } else {
      0 => rec.openFile;          // close file handle
      0 => recording;
      chout <= "saved " <= OUT_PATH <= IO.newline();
    }
  }
}
