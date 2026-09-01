// oscillators/sine.ck — pure sine tone into rackBus (load master.ck first).
//
// Open Sequencer → track "sine_freq" appears because of `// @seq mode=raw`.
// Each step writes Hz directly; no MIDI scale snapping on raw mode tracks.

global Gain rackBus;              // shared input bus from master.ck
global Gain sine_meter;           // mono tap for Rack peak meter
global float sine_meter_p;        // peak 0..1 — extension reads this global
0.0 => sine_meter_p;

// @knob min=0 max=0.8 step=0.01 default=0.2
global float sine_amp;            // oscillator level

// @slider min=40 max=1600 step=1 default=220
// @seq mode=raw
global float sine_freq;           // pitch in Hz — sequenced + slider in Knobs

// @knob min=-12 max=12 step=0.01 default=0
global float sine_detune;         // semitone offset applied after freq→note conversion

// @knob min=0 max=8 step=0.01 default=0
global float sine_vibHz;          // vibrato rate (Hz)

// @knob min=0 max=50 step=0.1 default=0
global float sine_vibDepth;       // vibrato depth in Hz (not semitones)

// @knob min=-1 max=1 step=0.01 default=0
global float sine_pan;            // stereo pan: -1 left, +1 right

0.2 => sine_amp;
220.0 => sine_freq;
0.0 => sine_detune;
0.0 => sine_vibHz;
0.0 => sine_vibDepth;
0.0 => sine_pan;

SinOsc osc => Pan2 pan;           // stereo panner splits L/R
pan.chan(0) => sine_meter;        // sum both channels for meter (mono peak)
pan.chan(1) => sine_meter;
sine_meter => rackBus;            // into master chain
0.0 => osc.gain;                  // follow() sets gain from sine_amp

spork ~ follow();                 // OSC / knob → UGen mapping
spork ~ _ckLivePeak();            // Rack meter shred
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(sine_meter.last()) => float s;
    if (s > sine_meter_p) s => sine_meter_p; else sine_meter_p * d => sine_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    sine_amp => osc.gain;
    // Treat freq as Hz but allow semitone detune via mtof/ftom round-trip
    Std.mtof(Std.ftom(sine_freq) + sine_detune) => float base;
    now / second => float t;      // audio-time clock for LFO
    base + Math.sin(2.0 * Math.PI * sine_vibHz * t) * sine_vibDepth => osc.freq;
    sine_pan => pan.pan;
    5::ms => now;
  }
}
