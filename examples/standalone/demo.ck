// ChucK Live demo — smallest patch that shows annotations + Knobs + direct dac.
//
// Workflow: ChucK: Start VM → Add this file → open Knobs (or focus this editor tab).
// The extension parses `// @knob` / `// @slider` / `// @button` on globals, spawns
// an OSC bridge, and sends `/chuck/<name>` messages when you touch the UI.
//
// Unlike bus examples, this patch skips master.ck and wires straight to `dac`
// — good for learning annotations before the rackBus graph.

// @knob min=0 max=1 step=0.01 default=0.3
global float gain;    // output level — appears as a knob in the panel

// @slider min=110 max=880 step=1 default=440
global float freq;    // oscillator pitch in Hz — vertical slider in the panel

// @button
global Event bang;    // momentary control — extension sends a broadcast on click

0.3 => gain;          // seed values until OSC bridge loads
440.0 => freq;

SinOsc osc => Gain g => dac;   // classic ChucK chain: oscillator → level → output
gain => g.gain;                 // one-shot init (follow() keeps it updated)
freq => osc.freq;

// Globals change in the bridge shred; this patch reads them in a `follow` loop.
spork ~ follow();
spork ~ onBang();     // separate shred waits on the Event

while (true) {
  10::ms => now;      // main shred sleeps — must not exit or Add would stop audio
}

fun void follow() {
  while (true) {
    gain => g.gain;       // copy OSC value → UGen every 10 ms
    freq => osc.freq;
    10::ms => now;
  }
}

fun void onBang() {
  while (true) {
    bang => now;          // blocks until extension broadcasts `bang`
    // Soft swell (~0.5 s) — nicer than an instant level jump
    0.85 => float peak;
    // attack ramp
    for (0 => int i; i < 40; i++) {
      gain + (peak - gain) * (i / 40.0) => g.gain;
      4::ms => now;
    }
    // hold at peak briefly
    180::ms => now;
    // release back to knob value
    for (40 => int i; i > 0; i--) {
      gain + (peak - gain) * (i / 40.0) => g.gain;
      6::ms => now;
    }
    gain => g.gain;       // restore exact knob level
  }
}
