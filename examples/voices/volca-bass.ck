// voices/volca-bass.ck — Volca Bass–inspired 3-VCO monobass into rackBus.
// Load: oscillators/master.ck → volca-bass.ck → fx/cyber-fx.ck (or dac-out / bus-fx)
//
// Sequencer: vb_noteHz / vb_accent / vb_plockCut / vb_slide — gate=vb_gate
// CPU: voiceUnlink when silent; one hitWorker; legato retriggers skip blocking waits.

global Gain rackBus;
global Gain vb_meter;
global float vb_meter_p;
0.0 => vb_meter_p;

// ---- sequencer ----
// @seq mode=midi min=28 max=60 step=1 default=40 gate=vb_gate
global float vb_noteHz;
// @seq mode=raw min=0 max=1 step=0.01 default=0.6 gate=vb_gate
global float vb_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=vb_gate
global float vb_plockCut;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=vb_gate
global float vb_slide;
// @seqGate
global Event vb_gate;
Event hitGo;

global float live_stepDur;
global int live_running;
0.125 => live_stepDur;
0 => live_running;

// ---- oscillators ----
// @knob min=0 max=1 step=0.01 default=0.5
global float vb_vco1;
// @knob min=0 max=1 step=0.01 default=0.35
global float vb_vco2;
// @knob min=0 max=1 step=0.01 default=0.35
global float vb_vco3;
// @knob min=0 max=0.5 step=0.01 default=0.15
global float vb_detune;
// @knob min=0.5 max=1 step=0.5 default=1
global float vb_vco2Oct;
// @knob min=0.5 max=1 step=0.5 default=0.5
global float vb_vco3Oct;
// @knob min=0.1 max=0.9 step=0.01 default=0.5
global float vb_pulse;

// ---- filter / EG ----
// @slider min=80 max=6000 step=10 default=800
// @modTarget label=Filter unit=hz
global float vb_cutoff;
// @knob min=1 max=8 step=0.1 default=5
global float vb_peak;
// @knob min=40 max=900 step=5 default=200
global float vb_egDecay;
// @knob min=0 max=1 step=0.01 default=0.7
global float vb_egInt;
// @knob min=0 max=1 step=0.01 default=0.2
global float vb_feedback;       // soft drive amount (not a closed loop)

// ---- amp / glide / accent ----
// @knob min=0 max=0.8 step=0.01 default=0.45
global float vb_amp;
// @knob min=0 max=1 step=0.01 default=0.65
global float vb_accentAmt;
// @knob min=0 max=350 step=1 default=80
global float vb_slideTime;

// @modSource label=ENV bipolar=0
global float vb_envOut;

global float vb_cutoff_mod;
global int vb_cutoff_mod_src;
global float vb_cutoff_mod_depth;

// @modRoute src=ENV dst=Filter default=1 depth=0.35

82.41 => vb_noteHz;
0.6 => vb_accent;
0.0 => vb_plockCut;
0.0 => vb_slide;
0.5 => vb_vco1;
0.35 => vb_vco2;
0.35 => vb_vco3;
0.15 => vb_detune;
1.0 => vb_vco2Oct;
0.5 => vb_vco3Oct;
0.5 => vb_pulse;
800.0 => vb_cutoff;
5.0 => vb_peak;
200.0 => vb_egDecay;
0.7 => vb_egInt;
0.2 => vb_feedback;
0.45 => vb_amp;
0.65 => vb_accentAmt;
80.0 => vb_slideTime;
0 => vb_cutoff_mod_src;
0.0 => vb_cutoff_mod_depth;

vb_noteHz => float vb_landHz;
vb_noteHz => float vb_playHz;
0.0 => float plockCutNow;
0.6 => float accNow;
0.0 => float slideNow;
1.0 => float accGain;
0 => int envOn;
0 => int hitGen;
0 => int voiceLinked;
-1.0 => float lastGateSec;

PulseOsc vco1 => Gain oscMix;
PulseOsc vco2 => oscMix;
PulseOsc vco3 => oscMix;
// Soft drive only — no closed filter feedback (that path self-oscillates
// when cutoff/peak open and can keep screaming past env / shred remove).
oscMix => Gain drive => LPF lpf1 => LPF lpf2 => ADSR env => Gain outG;
// Meter/rack wired only in voiceLink() so silence can fully detach.

env.set(1::ms, 200::ms, 0.0, 50::ms);
800.0 => lpf1.freq;
800.0 => lpf2.freq;
6.0 => lpf1.Q;
6.0 => lpf2.Q;
0.0 => outG.gain;
0.0 => drive.gain;
0.0 => vco1.gain;
0.0 => vco2.gain;
0.0 => vco3.gain;

spork ~ follow();
spork ~ pitchLoop();
spork ~ onGate();
spork ~ hitWorker();
spork ~ transportWatch();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void sleepMix() {
  0.0 => vco1.gain;
  0.0 => vco2.gain;
  0.0 => vco3.gain;
  0.0 => drive.gain;
  0.0 => outG.gain;
}

fun void forceSilence() {
  hitGen + 1 => hitGen;
  env.keyOff();
  0 => envOn;
  sleepMix();
  voiceUnlink();
}

fun float gateHoldSec() {
  Math.max(0.01, live_stepDur) => float hold;
  if (!live_running) {
    vb_egDecay / 1000.0 * 0.5 => float manual;
    if (manual > hold) manual => hold;
  }
  return hold;
}

fun void transportWatch() {
  int lastRun;
  0 => lastRun;
  while (true) {
    live_running => int r;
    if (lastRun == 1 && r == 0) {
      forceSilence();
    }
    r => lastRun;
    20::ms => now;
  }
}

fun int voiceSilent() {
  return (!envOn && env.value() < 0.001);
}

fun int voiceSustaining() {
  return (env.value() > 0.015);
}

fun void voiceUnlink() {
  if (voiceLinked) {
    sleepMix();
    outG =< vb_meter;
    oscMix =< blackhole;
    vb_meter =< rackBus;
    0 => voiceLinked;
  }
}

fun void voiceLink() {
  if (!voiceLinked) {
    oscMix => blackhole;
    outG => vb_meter;
    vb_meter => rackBus;
    1 => voiceLinked;
  }
}

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(vb_meter.last()) => float s;
    if (s > vb_meter_p) s => vb_meter_p; else vb_meter_p * d => vb_meter_p;
    25::ms => now;
  }
}

fun void snapPitchToNote() {
  if (slideNow > 0.5) return;
  vb_noteHz => vb_landHz;
  if (vb_slideTime <= 1.0) {
    vb_landHz => vb_playHz;
  }
}

fun void applyEnvTimes() {
  vb_egDecay * (0.65 + (1.0 - accNow) * 0.5) => float decMs;
  1::ms => dur a;
  decMs::ms => dur d;
  50::ms => dur r;
  env.set(a, d, 0.0, r);
}

fun void updateVcoFreqs() {
  vb_playHz => float f;
  Math.max(22.0, f) => f;
  f => vco1.freq;
  f * vb_vco2Oct * (1.0 + vb_detune) => vco2.freq;
  f * vb_vco3Oct * (1.0 - vb_detune) => vco3.freq;
}

fun void pitchLoop() {
  while (true) {
    if (voiceSilent()) {
      5::ms => now;
      continue;
    }

    vb_slideTime => float gms;
    if (slideNow > 0.5) {
      gms * 3.0 + 80.0 => gms;
    }
    vb_noteHz => float dest;
    vb_noteHz => vb_landHz;
    if (gms <= 1.0 && slideNow <= 0.5) {
      dest => vb_playHz;
    } else {
      Math.max(0.001, gms / 1000.0) => float tau;
      Math.exp(-0.005 / tau) => float coef;
      vb_playHz + (dest - vb_playHz) * (1.0 - coef) => vb_playHz;
    }

    updateVcoFreqs();
    3::ms => now;
  }
}

fun void follow() {
  while (true) {
    if (voiceSilent()) {
      voiceUnlink();
      25::ms => now;
      continue;
    }

    voiceLink();

    vb_pulse => vco1.width;
    vb_pulse => vco2.width;
    vb_pulse => vco3.width;
    vb_vco1 => vco1.gain;
    vb_vco2 => vco2.gain;
    vb_vco3 => vco3.gain;

    // Mild grit only — keep drive modest so open cutoff stays musical.
    0.55 + vb_feedback * 0.9 => drive.gain;

    // Cap resonance hard; dual LPF + high Q screams when cutoff opens.
    Math.min(8.0, vb_peak) => float qEff;
    qEff => lpf1.Q;
    qEff => lpf2.Q;

    env.value() => vb_envOut;

    vb_cutoff => float cf;
    cf + plockCutNow * 2500.0 => cf;
    if (vb_cutoff_mod_src == 0) {
      cf + env.value() * vb_egInt * (0.3 + accNow * 0.7) * 2800.0 => cf;
    } else {
      vb_cutoff + vb_cutoff_mod * 2500.0 + plockCutNow * 2500.0 => cf;
    }
    Math.max(80.0, Math.min(5000.0, cf)) => cf;
    cf => lpf1.freq;
    cf => lpf2.freq;

    vb_amp * accGain => outG.gain;

    if (voiceSustaining()) 10::ms => now;
    else 5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    vb_gate => now;
    now / second => float t;
    if (t - lastGateSec < 0.003) continue;
    t => lastGateSec;
    hitGo.broadcast();
  }
}

fun void hitWorker() {
  while (true) {
    hitGo => now;
    0.75::ms => now;
    hit();
  }
}

fun void readHitGlobals() {
  vb_accent => float acc;
  vb_plockCut => float pCut;
  vb_slide => float sl;

  acc => accNow;
  pCut => plockCutNow;
  sl => slideNow;
  Math.max(0.15, acc * vb_accentAmt + (1.0 - vb_accentAmt) * 0.35) => float aMul;
  0.55 + aMul * 0.65 => accGain;
}

fun void noteRelease(int gen) {
  gateHoldSec() * 0.92 => float hold;
  hold::second => now;
  if (gen == hitGen) {
    env.keyOff();
    0 => envOn;
  }
}

fun void slideRelease(int gen) {
  Math.max(0.01, live_stepDur) * 1.2 => float w;
  w::second => now;
  if (gen == hitGen && envOn) {
    env.keyOff();
    0 => envOn;
  }
}

fun void hit() {
  readHitGlobals();
  voiceLink();

  // Legato: refresh P-locks / accent only, keep release spork alive.
  if (slideNow <= 0.5 && envOn) {
    vb_noteHz => vb_landHz;
    return;
  }

  hitGen + 1 => hitGen;
  hitGen => int myGen;

  snapPitchToNote();
  applyEnvTimes();

  if (!(slideNow > 0.5 && envOn)) {
    env.keyOn();
  }
  1 => envOn;

  if (slideNow > 0.5) {
    spork ~ slideRelease(myGen);
  } else {
    spork ~ noteRelease(myGen);
  }
}
