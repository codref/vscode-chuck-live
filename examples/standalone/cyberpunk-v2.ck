// cyberpunk-v2.ck — neon rain / dark bass / hex arp with more live knobs.
//
// Same self-contained idea as cyberpunk.ck (one file → dac, no master.ck),
// but every layer and the FX chain is exposed for screencast / live tweaking.
// Start VM → Add this file → open Knobs.

// ---- mix ----
// @knob min=0 max=0.8 step=0.01 default=0.35
global float master;
// @knob min=0 max=1 step=0.01 default=0.55
global float bassMix;             // sub level (was `bass` — that was only a mix knob)
// @knob min=0 max=1 step=0.01 default=0.45
global float pad;
// @knob min=0 max=1 step=0.01 default=0.7
global float arp;
// @knob min=0 max=0.5 step=0.01 default=0.12
global float rainMix;
// @knob min=0 max=1 step=0.01 default=0.25
global float glitch;

// ---- bass sequencer (add track ★ bassNote — Sync ON, Run) ----
// @seq mode=midi min=24 max=48 step=1 default=33 gate=bassGate
global float bassNote;            // MIDI note → sub Hz
// @seqGate
global Event bassGate;

// ---- tone / motion ----
// @slider min=200 max=5000 step=10 default=900
global float cutoff;
// @knob min=0.3 max=4 step=0.05 default=0.7
global float darkQ;
// @slider min=0.5 max=2 step=0.01 default=1
global float root;
// @slider min=4 max=28 step=1 default=12
global float arpHz;
// @knob min=0.05 max=0.95 step=0.01 default=0.35
global float pulse;
// @knob min=0 max=2 step=1 default=0
global float arpOct;
// @knob min=0.05 max=0.6 step=0.01 default=0.15
global float breathe;
// @knob min=0 max=8 step=0.1 default=1.5
global float detune;
// @knob min=0 max=4 step=0.05 default=0.6
global float subSpread;

// ---- FX ----
// @knob min=0 max=0.55 step=0.01 default=0.12
global float verb;
// @knob min=0 max=0.7 step=0.01 default=0.35
global float echo;
// @slider min=80 max=900 step=5 default=450
global float echoMs;
// @knob min=0 max=1 step=0.01 default=0.15
global float drive;
// @knob min=2000 max=9000 step=50 default=4200
global float rainTone;
// @knob min=0.5 max=8 step=0.1 default=2.5
global float rainQ;

// @button
global Event rain;

0.35 => master;
0.55 => bassMix;
0.45 => pad;
0.7 => arp;
0.12 => rainMix;
0.25 => glitch;
33.0 => bassNote;                 // A1
900.0 => cutoff;
0.7 => darkQ;
1.0 => root;
12.0 => arpHz;
0.35 => pulse;
0.0 => arpOct;
0.15 => breathe;
1.5 => detune;
0.6 => subSpread;
0.12 => verb;
0.35 => echo;
450.0 => echoMs;
0.15 => drive;
4200.0 => rainTone;
2.5 => rainQ;

Gain mix => Gain pre => LPF dark => NRev hall => Gain out => dac;
1.0 => pre.gain;
0.12 => hall.mix;
900 => dark.freq;
0.7 => dark.Q;
master => out.gain;

SawOsc sub => LPF subLp => ADSR subEnv => Gain subG => mix;
55.0 => sub.freq;
0.18 => sub.gain;
120 => subLp.freq;
1.2 => subLp.Q;
subEnv.set(3::ms, 90::ms, 0.65, 140::ms);
0.0 => subG.gain;

SawOsc sub2 => subLp;
54.4 => sub2.freq;
0.12 => sub2.gain;

global float live_stepDur;
0.125 => live_stepDur;
Event bassGo;
0.0 => float bassLastGateSec;

SawOsc p1 => Gain padG => Echo trail => mix;
SawOsc p2 => padG;
SawOsc p3 => padG;
110.0 => p1.freq;
138.59 => p2.freq;
164.81 => p3.freq;
0.04 => p1.gain;
0.035 => p2.gain;
0.03 => p3.gain;
0.0 => padG.gain;
450::ms => trail.delay;
0.35 => trail.mix;
0.55 => trail.gain;

PulseOsc arpOsc => ADSR arpEnv => LPF arpLp => Gain arpG => mix;
0.35 => arpOsc.width;
0.0 => arpOsc.gain;
arpEnv.set(2::ms, 40::ms, 0.0, 20::ms);
1800 => arpLp.freq;
0.0 => arpG.gain;

[110.0, 130.81, 164.81, 220.0, 261.63, 329.63, 440.0, 392.0] @=> float hex[];

Noise hiss => BPF rainBp => Gain rainG => mix;
0.0 => hiss.gain;
4200 => rainBp.freq;
2.5 => rainBp.Q;
0.0 => rainG.gain;

0.0 => float rainBoost;
-1.0 => float echoMsPrev;

Noise spit => HPF spitHp => ADSR spitEnv => Gain spitG => mix;
8000 => spitHp.freq;
spitEnv.set(0.5::ms, 8::ms, 0.0, 5::ms);
0.0 => spit.gain;
0.0 => spitG.gain;

spork ~ follow();
spork ~ padBreathe();
spork ~ hexArp();
spork ~ rainFall();
spork ~ glitchTicks();
spork ~ onRain();
spork ~ onBassGate();
spork ~ bassHitWorker();

while (true) {
  20::ms => now;
}

fun void follow() {
  while (true) {
    master => out.gain;
    cutoff => dark.freq;
    cutoff * 1.4 => arpLp.freq;
    Math.max(80.0, cutoff * 0.12) => subLp.freq;
    1.0 + drive * 2.4 => pre.gain;
    // quiet drone floor + gated envelope on top
    bassMix * 0.55 * (0.28 + 0.72 * subEnv.value()) => subG.gain;
    pad * (0.18 + glitch * 0.12) => padG.gain;
    arp * (0.28 + (1.0 - glitch) * 0.12) => arpG.gain;
    Math.min(1.0, rainMix + rainBoost) => rainG.gain;
    glitch * 0.45 => spitG.gain;
    darkQ => dark.Q;
    Std.mtof(bassNote) => float f;
    f => sub.freq;
    Math.max(20.0, f - subSpread) => sub2.freq;
    pulse => arpOsc.width;
    verb => hall.mix;
    echo => trail.mix;
    if (echoMs != echoMsPrev) {
      echoMs => echoMsPrev;
      Math.max(80.0, echoMs)::ms => trail.delay;
    }
    rainTone => rainBp.freq;
    rainQ => rainBp.Q;
    8::ms => now;
  }
}

fun void padBreathe() {
  while (true) {
    now / second => float t;
    breathe * Math.PI * 2.0 => float w;
    root * 110.0 + Math.sin(t * w) * detune => p1.freq;
    root * 138.59 + Math.sin(t * w * 1.13 + 1.0) * detune * 1.1 => p2.freq;
    root * 164.81 + Math.sin(t * w * 0.87 + 2.0) * detune * 0.9 => p3.freq;
    20::ms => now;
  }
}

fun void hexArp() {
  0 => int i;
  while (true) {
    hex[i % hex.size()] * root => float f;
    Math.pow(2.0, Math.max(0.0, Math.min(2.0, arpOct))) * f => arpOsc.freq;
    if (Math.random2f(0.0, 1.0) < glitch * 0.35) {
      arpOsc.freq() * 2.0 => arpOsc.freq;
    }
    0.28 => arpOsc.gain;
    arpEnv.keyOn();
    (1.0 / Math.max(4.0, arpHz))::second => now;
    arpEnv.keyOff();
    2::ms => now;
    (i + 1) % hex.size() => i;
  }
}

fun void rainFall() {
  while (true) {
    rainTone * Math.random2f(0.75, 1.35) => rainBp.freq;
    0.02 + (rainMix + rainBoost) * 0.14 => hiss.gain;
    Math.random2f(30.0, 90.0)::ms => now;
  }
}

fun void glitchTicks() {
  while (true) {
    if (glitch > 0.05 && Math.random2f(0.0, 1.0) < glitch * 0.55) {
      0.5 => spit.gain;
      spitEnv.keyOn();
      Math.random2f(4.0, 18.0)::ms => now;
      spitEnv.keyOff();
      0.0 => spit.gain;
    }
    Math.random2f(40.0, 160.0)::ms => now;
  }
}

fun void onBassGate() {
  while (true) {
    bassGate => now;
    now / second => float t;
    if (t - bassLastGateSec < 0.003) continue;
    t => bassLastGateSec;
    bassGo.broadcast();
  }
}

fun void bassHitWorker() {
  while (true) {
    bassGo => now;
    Std.mtof(bassNote) => float f;
    f => sub.freq;
    Math.max(20.0, f - subSpread) => sub2.freq;
    if (subEnv.value() > 0.015) {
      // legato — pitch already updated; skip long wait pile-up
      continue;
    }
    subEnv.keyOn();
    Math.max(0.02, live_stepDur * 0.85)::second => now;
    subEnv.keyOff();
  }
}

fun void onRain() {
  while (true) {
    rain => now;
    for (0 => int i; i <= 12; i++) {
      (i $ float / 12.0) * 0.9 => rainBoost;
      6::ms => now;
    }
    for (12 => int i; i >= 0; i--) {
      (i $ float / 12.0) * 0.9 => rainBoost;
      10::ms => now;
    }
    0.0 => rainBoost;
  }
}
