// voices/warm-pad.ck — soft chord-cluster pad into rackBus (not an acid bass).
// Load: oscillators/master.ck → warm-pad.ck → fx/bus-fx.ck (or dac-out / cyber-fx)
//
// Sequencer: wp_noteHz (MIDI lane → Hz), wp_accent, wp_gate
// Voicings: 0 minor · 1 major · 2 sus2 · 3 add9 · 4 close cluster
// CPU: gen-cancelled pad shreds; voiceUnlink when envelope idle.

global Gain rackBus;
global Gain wp_meter;
global float wp_meter_p;
0.0 => wp_meter_p;

// ---- sequencer ----
// @seq mode=midi min=36 max=72 step=1 default=48 gate=wp_gate
global float wp_noteHz;
// @seq mode=raw min=0 max=1 step=0.01 default=0.55 gate=wp_gate
global float wp_accent;
// @seqGate
global Event wp_gate;
Event hitGo;

global float live_stepDur;
0.125 => live_stepDur;

// ---- mix / tone ----
// @knob min=0 max=0.7 step=0.01 default=0.38
global float wp_amp;
// @knob min=0 max=4 step=1 default=0
global float wp_voicing;
// @knob min=0 max=1 step=0.01 default=0.45
global float wp_saw;
// @knob min=0 max=6 step=0.05 default=1.2
global float wp_detune;
// @knob min=0.05 max=0.5 step=0.01 default=0.12
global float wp_breathe;
// @slider min=400 max=6000 step=10 default=2200
global float wp_cutoff;
// @knob min=0.4 max=3 step=0.05 default=0.85
global float wp_res;
// @knob min=40 max=1200 step=5 default=420
global float wp_atk;
// @knob min=80 max=2000 step=5 default=800
global float wp_dec;
// @knob min=0.2 max=1 step=0.01 default=0.72
global float wp_sus;
// @knob min=120 max=4000 step=10 default=1400
global float wp_rel;
// @knob min=0.5 max=8 step=0.1 default=3.5
global float wp_hold;
// @knob min=0 max=0.45 step=0.01 default=0.22
global float wp_chorus;
// @knob min=0 max=0.4 step=0.01 default=0.14
global float wp_space;

0.38 => wp_amp;
0.0 => wp_voicing;
0.45 => wp_saw;
1.2 => wp_detune;
0.12 => wp_breathe;
2200.0 => wp_cutoff;
0.85 => wp_res;
420.0 => wp_atk;
800.0 => wp_dec;
0.72 => wp_sus;
1400.0 => wp_rel;
3.5 => wp_hold;
0.22 => wp_chorus;
0.14 => wp_space;
130.81 => wp_noteHz;              // C3 Hz (seq writes Hz)
0.55 => wp_accent;

TriOsc t1 => Gain v1;
SawOsc s1 => v1;
TriOsc t2 => Gain v2;
SawOsc s2 => v2;
TriOsc t3 => Gain v3;
SawOsc s3 => v3;
TriOsc t4 => Gain v4;
SawOsc s4 => v4;
SinOsc sub => Gain subG;

v1 => Gain chord;
v2 => chord;
v3 => chord;
v4 => chord;
subG => chord;

chord => LPF soft => Chorus lush => ADSR env => NRev hall => Gain out => wp_meter;
0.0 => out.gain;
2200 => soft.freq;
0.85 => soft.Q;
env.set(420::ms, 800::ms, 0.72, 1400::ms);
0.14 => hall.mix;
0.22 => lush.mix;
0.15 => lush.modFreq;
0.002 => lush.modDepth;

0 => int voiceLinked;
0.0 => float lastGateSec;
0.0 => float accNow;
0 => int envOn;
0 => int hitGen;

spork ~ follow();
spork ~ onGate();
spork ~ hitWorker();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(wp_meter.last()) => float s;
    if (s > wp_meter_p) s => wp_meter_p; else wp_meter_p * d => wp_meter_p;
    25::ms => now;
  }
}

fun void voiceUnlink() {
  if (voiceLinked) {
    wp_meter =< rackBus;
    0 => voiceLinked;
  }
}

fun void voiceLink() {
  if (!voiceLinked) {
    wp_meter => rackBus;
    1 => voiceLinked;
  }
}

fun int voiceSilent() {
  return (envOn == 0 && env.value() < 0.008);
}

fun void setChordHz(float rootHz) {
  Std.ftom(rootHz) => float rootMidi;
  Math.max(0.0, Math.min(4.0, wp_voicing)) $ int => int shape;

  0 => int i0; 3 => int i1; 7 => int i2; 12 => int i3;
  if (shape == 1) {
    4 => i1; 7 => i2; 12 => i3;
  } else if (shape == 2) {
    2 => i1; 7 => i2; 12 => i3;
  } else if (shape == 3) {
    3 => i1; 7 => i2; 14 => i3;
  } else if (shape == 4) {
    1 => i1; 3 => i2; 7 => i3;
  }

  now / second => float t;
  wp_breathe * Math.PI * 2.0 => float w;
  Math.sin(t * w) * wp_detune * 0.35 => float lfo;

  Std.mtof(rootMidi + i0) + lfo => float f1;
  Std.mtof(rootMidi + i1) + lfo * 1.1 => float f2;
  Std.mtof(rootMidi + i2) - lfo * 0.9 => float f3;
  Std.mtof(rootMidi + i3) + lfo * 0.6 => float f4;

  f1 => t1.freq; f1 => s1.freq;
  f2 => t2.freq; f2 => s2.freq;
  f3 => t3.freq; f3 => s3.freq;
  f4 => t4.freq; f4 => s4.freq;
  Std.mtof(rootMidi - 12.0) => sub.freq;

  (1.0 - wp_saw) * 0.22 => t1.gain;
  wp_saw * 0.16 => s1.gain;
  (1.0 - wp_saw) * 0.2 => t2.gain;
  wp_saw * 0.14 => s2.gain;
  (1.0 - wp_saw) * 0.18 => t3.gain;
  wp_saw * 0.12 => s3.gain;
  (1.0 - wp_saw) * 0.14 => t4.gain;
  wp_saw * 0.1 => s4.gain;
  0.12 => sub.gain;
}

fun void follow() {
  while (true) {
    if (voiceSilent()) {
      voiceUnlink();
      0.0 => out.gain;
      25::ms => now;
      continue;
    }

    voiceLink();
    setChordHz(wp_noteHz);

    wp_amp * (0.55 + accNow * 0.45) => out.gain;
    wp_cutoff => soft.freq;
    wp_res => soft.Q;
    wp_chorus => lush.mix;
    wp_space => hall.mix;
    wp_breathe * 0.8 + 0.05 => lush.modFreq;
    0.001 + wp_detune * 0.0004 => lush.modDepth;

    wp_atk::ms => dur a;
    wp_dec::ms => dur d;
    wp_rel::ms => dur r;
    env.set(a, d, wp_sus, r);

    10::ms => now;
  }
}

fun void onGate() {
  while (true) {
    wp_gate => now;
    now / second => float t;
    if (t - lastGateSec < 0.003) continue;
    t => lastGateSec;
    hitGo.broadcast();
  }
}

fun void hitWorker() {
  while (true) {
    hitGo => now;
    0.5::ms => now;
    hitGen + 1 => hitGen;
    spork ~ padVoice(hitGen);
  }
}

fun void padVoice(int gen) {
  wp_accent => accNow;
  voiceLink();
  setChordHz(wp_noteHz);

  if (env.value() <= 0.02) {
    env.keyOn();
  }
  1 => envOn;

  Math.max(0.05, live_stepDur * wp_hold)::second => now;
  if (gen != hitGen) return;

  env.keyOff();
  wp_rel::ms => now;
  if (gen != hitGen) return;
  0 => envOn;
}
