// out/record-out.ck — tap mainBus → WAV (does NOT own dac).
// Load anytime after master.ck WHILE dac-out.ck or fx/bus-fx.ck is already up.
// Safe to add/remove mid-session. Edit OUT_PATH before recording.
// Focus this file for Knobs → click rec_toggle to start/stop.

global Gain mainBus;

// @button
global Event rec_toggle;

// Edit path (relative to VM cwd or absolute) before you record:
"take.wav" => string OUT_PATH;

mainBus => WvOut rec => blackhole;

spork ~ recorder();
while (true) 1::second => now;

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
