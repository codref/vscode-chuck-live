// drums/kick.ck — analog-ish kick into rackBus. Load master first; sequence dk_kick.
//
// Sequencer: `// @seqGate` on `dk_kick` adds a gate-only pad track. On each step
// with a hit, the extension broadcasts `dk_kick` — this shred waits on that Event.
// Sync clocks (default ON) align drum hits to the shared 16th-note transport.

global Gain rackBus;
global Gain kick_meter;
global float kick_meter_p;
0.0 => kick_meter_p;

// @seqGate
global Event dk_kick;             // fired by sequencer gate pads — not a float track

// @knob min=0 max=0.9 step=0.01 default=0.65
global float dk_kick_amp;
// @knob min=40 max=160 step=1 default=75
global float dk_kick_freq;        // landing pitch after pitch drop
// @knob min=40 max=400 step=5 default=220
global float dk_kick_dec;         // ADSR decay time in ms (musical, not grid-locked)

0.65 => dk_kick_amp;
75.0 => dk_kick_freq;
220.0 => dk_kick_dec;

SinOsc osc => ADSR env => Gain g => kick_meter;       // body: sine + envelope
Noise click => BPF clickF => Gain clickG => kick_meter; // transient click layer
kick_meter => rackBus;

env.set(1::ms, 220::ms, 0.0, 30::ms);   // attack, decay, sustain, release
clickF.set(800, 1.5);                      // BPF center Hz, Q
0.5 => clickG.gain;
0.0 => g.gain;                             // follow() maps dk_kick_amp here
1.0 => osc.gain;

spork ~ onKick();                 // listens for sequencer gates
spork ~ follow();                 // knob → envelope + level
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(kick_meter.last()) => float s;
    if (s > kick_meter_p) s => kick_meter_p; else kick_meter_p * d => kick_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    dk_kick_amp => g.gain;
    dk_kick_dec::ms => dur d;
    env.set(1::ms, d, 0.0, 30::ms);   // live-update decay from knob
    5::ms => now;
  }
}

fun void onKick() {
  while (true) {
    dk_kick => now;               // block until sequencer broadcasts gate
    // pitch-drop body + short click (audible on small speakers)
    dk_kick_freq * 2.2 => float f0;   // start high, sweep down
    f0 => osc.freq;
    env.keyOn();
    spork ~ drop(f0);             // parallel pitch glide shred
    spork ~ clickHit();           // parallel noise burst
    dk_kick_dec::ms => now;       // hold gate open for decay length
    env.keyOff();
  }
}

fun void drop(float f0) {
  for (0 => int i; i < 28; i++) {
    f0 * Math.pow(0.91, i) => osc.freq;   // exponential pitch fall
    4::ms => now;
  }
}

fun void clickHit() {
  1.0 => click.gain;              // manual noise gate — short burst
  12::ms => now;
  0.0 => click.gain;
}
