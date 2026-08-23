// cyberpunk.ck — neon rain, dark bass, hex arp, glitch stutter
// Start VM → Add this file → twist knobs / hit bang for a street-run drop.

// @knob min=0 max=0.8 step=0.01 default=0.35
global float master;

// @knob min=0 max=1 step=0.01 default=0.55
global float bass;

// @slider min=200 max=4000 step=10 default=900
global float cutoff;

// @slider min=4 max=24 step=1 default=12
global float arpHz;

// @knob min=0 max=1 step=0.01 default=0.25
global float glitch;

// @knob min=0 max=0.4 step=0.01 default=0.12
global float rain;

// @button
global Event bang;

0.35 => master;
0.55 => bass;
900.0 => cutoff;
12.0 => arpHz;
0.25 => glitch;
0.12 => rain;

// ---- bus ----
Gain mix => LPF dark => NRev hall => Gain out => dac;
0.12 => hall.mix;
900 => dark.freq;
0.7 => dark.Q;
master => out.gain;

// ---- dark sub ----
SawOsc sub => LPF subLp => Gain subG => mix;
55.0 => sub.freq;
0.18 => sub.gain;
120 => subLp.freq;
1.2 => subLp.Q;
0.0 => subG.gain;

// slightly detuned twin for thickness
SawOsc sub2 => subLp;
54.4 => sub2.freq;
0.12 => sub2.gain;

// ---- neon pad (minor triad smear) ----
SawOsc p1 => Gain padG => Echo trail => mix;
SawOsc p2 => padG;
SawOsc p3 => padG;
110.0 => p1.freq;
138.59 => p2.freq;  // m3
164.81 => p3.freq;  // P5
0.04 => p1.gain;
0.035 => p2.gain;
0.03 => p3.gain;
0.0 => padG.gain;
450::ms => trail.delay;
0.35 => trail.mix;
0.55 => trail.gain;

// ---- hex arp ----
PulseOsc arp => ADSR arpEnv => LPF arpLp => Gain arpG => mix;
0.35 => arp.width;
0.0 => arp.gain;
arpEnv.set(2::ms, 40::ms, 0.0, 20::ms);
1800 => arpLp.freq;
0.0 => arpG.gain;

// cyber minor run (A minor-ish, two octaves feel)
[110.0, 130.81, 164.81, 220.0, 261.63, 329.63, 440.0, 392.0] @=> float hex[];

// ---- digital rain ----
Noise hiss => BPF rainBp => Gain rainG => mix;
0.0 => hiss.gain;
4200 => rainBp.freq;
2.5 => rainBp.Q;
0.0 => rainG.gain;

// ---- glitch clicks ----
Noise spit => HPF spitHp => ADSR spitEnv => Gain spitG => mix;
8000 => spitHp.freq;
spitEnv.set(0.5::ms, 8::ms, 0.0, 5::ms);
0.0 => spit.gain;
0.0 => spitG.gain;

// ---- control / voices ----
spork ~ follow();
spork ~ padBreathe();
spork ~ hexArp();
spork ~ rainFall();
spork ~ glitchTicks();
spork ~ onBang();

while (true) {
  20::ms => now;
}

fun void follow() {
  while (true) {
    master => out.gain;
    bass * 0.55 => subG.gain;
    cutoff => dark.freq;
    cutoff * 1.4 => arpLp.freq;
    Math.max(80.0, cutoff * 0.12) => subLp.freq;
    rain => rainG.gain;
    glitch * 0.45 => spitG.gain;
    0.12 + glitch * 0.2 => padG.gain;
    0.22 + (1.0 - glitch) * 0.15 => arpG.gain;
    8::ms => now;
  }
}

fun void padBreathe() {
  // slow LFO on pad detune — neon wobble
  while (true) {
    now / second => float t;
    110.0 + Math.sin(t * 0.15) * 1.2 => p1.freq;
    138.59 + Math.sin(t * 0.17 + 1.0) * 1.5 => p2.freq;
    164.81 + Math.sin(t * 0.13 + 2.0) * 1.1 => p3.freq;
    20::ms => now;
  }
}

fun void hexArp() {
  0 => int i;
  while (true) {
    hex[i % hex.size()] => arp.freq;
    // occasional octave jump when glitch is hot
    if (Math.random2f(0.0, 1.0) < glitch * 0.35) {
      arp.freq() * 2.0 => arp.freq;
    }
    0.28 => arp.gain;
    arpEnv.keyOn();
    (1.0 / Math.max(4.0, arpHz))::second => now;
    arpEnv.keyOff();
    2::ms => now;
    (i + 1) % hex.size() => i;
  }
}

fun void rainFall() {
  while (true) {
    Math.random2f(2800.0, 7200.0) => rainBp.freq;
    0.015 + rain * 0.04 => hiss.gain;
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

fun void onBang() {
  // street-run drop: filter open + stutter + sub slam
  while (true) {
    bang => now;
    cutoff => float cutSave;
    master => float mastSave;
    bass => float bassSave;

    0.7 => master;
    1.0 => bass;
    3200.0 => cutoff;

    repeat (8) {
      0.0 => out.gain;
      28::ms => now;
      master * 0.9 => out.gain;
      42::ms => now;
    }

    // neon sweep down
    for (0 => int i; i < 50; i++) {
      3200.0 - i * 40.0 => cutoff;
      12::ms => now;
    }

    cutSave => cutoff;
    mastSave => master;
    bassSave => bass;
  }
}
