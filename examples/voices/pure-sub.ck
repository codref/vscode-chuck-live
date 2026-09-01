// voices/pure-sub.ck — layered sub-bass voice (Pure SUB P0+P1) into rackBus.
// Load: oscillators/master.ck → pure-sub.ck → fx/cyber-fx.ck (or dac-out / bus-fx)
//
// P0: Sub / Harmonics / Texture busses, per-layer routing, Sub Regen, pitch envelope
// P1: Pressure vs Reese harmonic engines, corroder texture, ring mod vs sub
//
// Sequencer: ps_noteHz, ps_accent, ps_plockPit, ps_plockCut, ps_slide — gate=ps_gate
// CPU: keep signal chain linked; 25 ms peak meter (see neural-matrix.ck).

global Gain rackBus;
global Gain ps_meter;
global float ps_meter_p;
0.0 => ps_meter_p;

// ---- sequencer ----
// @seq mode=midi min=24 max=72 step=1 default=40 gate=ps_gate
global float ps_noteHz;
// @seq mode=raw min=0 max=1 step=0.01 default=0.6 gate=ps_gate
global float ps_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=ps_gate
global float ps_plockPit;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=ps_gate
global float ps_plockCut;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=ps_gate
global float ps_slide;
// @seqGate
global Event ps_gate;
Event hitGo;

global float live_stepDur;
global int live_running;
0.125 => live_stepDur;
0 => live_running;

// ---- layers ----
// @knob min=0 max=1 step=0.01 default=0.7
global float ps_sub;
// @knob min=0.25 max=2 step=0.01 default=0.5
global float ps_subOct;
// @knob min=0 max=1 step=0.01 default=0.55
global float ps_harm;
// @knob min=0 max=1 step=0.01 default=0.35
global float ps_reese;
// @knob min=0 max=1 step=0.01 default=0.2
global float ps_morph;
// @knob min=0 max=1 step=0.01 default=0.12
global float ps_tex;
// @knob min=0 max=1 step=0.01 default=0.4
global float ps_width;
// @knob min=0 max=1 step=0.01 default=0.28
global float ps_corrode;
// @knob min=0 max=1 step=0.01 default=0.18
global float ps_ring;

// ---- routing & regen ----
// @knob min=0 max=1 step=0.01 default=0.15
global float ps_routeSub;
// @knob min=0 max=1 step=0.01 default=0.85
global float ps_routeHarm;
// @knob min=0 max=1 step=0.01 default=0.6
global float ps_routeTex;
// @knob min=0 max=1 step=0.01 default=0.65
global float ps_regen;

// ---- pitch envelope ----
// @knob min=0 max=1 step=0.01 default=0.45
global float ps_pitEnv;
// @knob min=0.2 max=1 step=0.01 default=0.55
global float ps_pitTime;

// ---- drive / fold / crush ----
// @knob min=0 max=1 step=0.01 default=0.3
// @modTarget label=Drive
global float ps_drive;
// @knob min=0 max=1 step=0.01 default=0.2
// @modTarget label=Fold
global float ps_fold;
// @knob min=1 max=12 step=0.1 default=8
// @modTarget label=Crush
global float ps_bits;
// @knob min=1 max=32 step=1 default=8
global float ps_hold;

// ---- filter ----
// @slider min=60 max=6000 step=10 default=750
// @modTarget label=Filter unit=hz
global float ps_cutoff;
// @knob min=1 max=16 step=0.1 default=5.5
global float ps_res;

// ---- amp / glide ----
// @knob min=0 max=0.85 step=0.01 default=0.42
global float ps_amp;
// @knob min=1 max=60 step=1 default=4
global float ps_atk;
// @knob min=40 max=900 step=5 default=220
global float ps_dec;
// @knob min=0 max=1 step=0.01 default=0.25
global float ps_sus;
// @knob min=40 max=900 step=5 default=160
global float ps_rel;
// @knob min=0 max=350 step=1 default=35
global float ps_glide;

// ---- LFO ----
// @knob min=0.05 max=16 step=0.01 default=3.5
global float ps_lfoRate;
// @knob min=0 max=1 step=0.01 default=0.1
global float ps_lfoAmt;

// @modSource label=LFO bipolar=1
global float ps_lfoOut;
// @modSource label=ENV bipolar=0
global float ps_envOut;
// @modSource label=PitEnv bipolar=0
global float ps_pitEnvOut;

// @modTarget label=Pitch unit=hz
global float ps_pitchMod;
global int ps_pitchMod_src;
global float ps_pitchMod_depth;

global float ps_cutoff_mod;
global int ps_cutoff_mod_src;
global float ps_cutoff_mod_depth;

global float ps_drive_mod;
global int ps_drive_mod_src;
global float ps_drive_mod_depth;

global float ps_fold_mod;
global int ps_fold_mod_src;
global float ps_fold_mod_depth;

global float ps_bits_mod;
global int ps_bits_mod_src;
global float ps_bits_mod_depth;

// @modRoute src=ENV dst=Filter default=1 depth=0.35
// @modRoute src=PitEnv dst=Pitch default=0 depth=0.2

82.41 => ps_noteHz;
0.6 => ps_accent;
0.0 => ps_plockPit;
0.0 => ps_plockCut;
0.0 => ps_slide;
0.7 => ps_sub;
0.5 => ps_subOct;
0.55 => ps_harm;
0.35 => ps_reese;
0.2 => ps_morph;
0.12 => ps_tex;
0.4 => ps_width;
0.28 => ps_corrode;
0.18 => ps_ring;
0.15 => ps_routeSub;
0.85 => ps_routeHarm;
0.6 => ps_routeTex;
0.65 => ps_regen;
0.45 => ps_pitEnv;
0.55 => ps_pitTime;
0.3 => ps_drive;
0.2 => ps_fold;
8.0 => ps_bits;
8.0 => ps_hold;
750.0 => ps_cutoff;
5.5 => ps_res;
0.42 => ps_amp;
4.0 => ps_atk;
220.0 => ps_dec;
0.25 => ps_sus;
160.0 => ps_rel;
35.0 => ps_glide;
3.5 => ps_lfoRate;
0.1 => ps_lfoAmt;
0.0 => ps_lfoOut;
0.0 => ps_envOut;
0.0 => ps_pitEnvOut;
0.0 => ps_pitchMod;
0 => ps_pitchMod_src;
0.0 => ps_pitchMod_depth;
0.0 => ps_cutoff_mod;
0 => ps_cutoff_mod_src;
0.0 => ps_cutoff_mod_depth;
0.0 => ps_drive_mod;
0 => ps_drive_mod_src;
0.0 => ps_drive_mod_depth;
0.0 => ps_fold_mod;
0 => ps_fold_mod_src;
0.0 => ps_fold_mod_depth;
0.0 => ps_bits_mod;
0 => ps_bits_mod_src;
0.0 => ps_bits_mod_depth;

// runtime
ps_noteHz => float ps_landHz;
ps_noteHz => float ps_playHz;
0.0 => float ps_pitEnvAmt;
0.0 => float ps_plockCutNow;
0.5 => float ps_accNow;
0.0 => float ps_slideNow;
1.0 => float ps_accGain;
0 => int ps_envOn;
0 => int ps_hitGen;
0 => int ps_voiceLinked;
0 => int ps_pitDropGen;
-1.0 => float ps_lastGateSec;
1.0 => float ps_foldDrive;
0.0 => float ps_bitsEff;
8.0 => float ps_holdEff;
0.003 => float ps_detune;
0.0 => float ps_ringAmt;
0.0 => float ps_corrodeAmt;

// Layer tap points (declare before patching — ChucK does not auto-create mid-chain)
Gain subTap;
Gain harmTap;
Gain texTap;

// ---- Sub layer (clean sine for regen) ----
SinOsc subOsc => Gain subGn => subTap => blackhole;

// ---- Harmonics: Reese (6 detuned saws + Haas) + Pressure (blit + formants + pulse) ----
Gain harmSum;
Gain formGn;
SawOsc harm1 => harmSum;
SawOsc harm2 => harmSum;
SawOsc harm3 => harmSum;
SawOsc harm4 => harmSum;
SawOsc harm5 => harmSum;
SawOsc harm6 => harmSum;
harm2 => Delay harmHaas => Gain harmHaasG => harmSum;
BlitSaw pressBlit => Gain pressGn => harmSum;
harmSum => BPF form1 => formGn => harmSum;
harmSum => BPF form2 => formGn;
PulseOsc harmPulse => Gain pulseGn => harmSum;
harmSum => Gain harmGn => harmTap => blackhole;
0.42 => harmPulse.width;
10 => pressBlit.harmonics;
12::ms => harmHaas.max;
700.0 => form1.freq;
4.0 => form1.Q;
1800.0 => form2.freq;
5.0 => form2.Q;

// ---- Texture: noise + crackle + corroder; ring-mod vs sub in texLoop ----
Gain texRaw;
Gain corrodeGn;
Noise texNoise => Gain texNG => texRaw;
Step texCr => Gain texCG => texRaw;
SawOsc corrodeSaw => corrodeGn => texRaw;
PulseOsc corrodeSqr => corrodeGn;
0.5 => corrodeSqr.width;
texRaw => blackhole;
Step texOut;
texOut => Gain texGn => texTap => blackhole;
0.0 => texOut.next;

// ---- Processing chain ----
Step layerIn;
layerIn => Gain foldInG => blackhole;
Step foldOut;
foldOut => LPF lpf1 => LPF lpf2 => Gain drvG => HPF corpHp => Gain crushIn => blackhole;
Step crushOut;
Gain sumMix;
crushOut => Gain procG => sumMix;
subTap => Gain regenG => sumMix;
harmTap => Gain harmDryG => sumMix;
texTap => Gain texDryG => sumMix;
sumMix => ADSR env => Gain outG => ps_meter => rackBus;

env.set(4::ms, 220::ms, 0.25, 160::ms);
750.0 => lpf1.freq;
750.0 => lpf2.freq;
5.5 => lpf1.Q;
5.5 => lpf2.Q;
50.0 => corpHp.freq;
1.0 => corpHp.Q;
0.0 => outG.gain;
0.0 => layerIn.next;
0.0 => foldOut.next;
0.0 => crushOut.next;

spork ~ follow();
spork ~ pitchLoop();
spork ~ layerLoop();
spork ~ texLoop();
spork ~ foldLoop();
spork ~ crushLoop();
spork ~ crackleLoop();
spork ~ onGate();
spork ~ hitWorker();
spork ~ transportWatch();
spork ~ bootWarmup();
spork ~ _ckLivePeak();
voiceLink();
primeVoice();
while (true) 20::ms => now;

fun void forceSilence() {
  ps_hitGen + 1 => ps_hitGen;
  ps_pitDropGen + 1 => ps_pitDropGen;
  env.keyOff();
  0 => ps_envOn;
  0.0 => outG.gain;
  0.0 => layerIn.next;
  0.0 => foldOut.next;
  0.0 => crushOut.next;
  0.0 => texOut.next;
}

fun float gateHoldSec() {
  Math.max(0.01, live_stepDur) => float hold;
  if (!live_running) {
    ps_dec / 1000.0 * 0.5 => float manual;
    if (manual > hold) manual => hold;
  }
  return hold;
}

fun void transportWatch() {
  int lastRun;
  0 => lastRun;
  while (true) {
    live_running => int r;
    if (lastRun == 0 && r == 1) {
      snapPitchToNote();
      primeVoice();
    }
    if (lastRun == 1 && r == 0) {
      forceSilence();
    }
    r => lastRun;
    20::ms => now;
  }
}

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(ps_meter.last()) => float s;
    if (s > ps_meter_p) s => ps_meter_p; else ps_meter_p * d => ps_meter_p;
    25::ms => now;
  }
}

fun float triFold(float x) {
  x + 1.0 => float y;
  y * 0.25 => y;
  y - Math.floor(y) => y;
  if (y > 0.5) 1.0 - y => y;
  return y * 4.0 - 1.0;
}

fun int voiceSilent() {
  return (!ps_envOn && env.value() < 0.001);
}

fun int procActive() {
  return (ps_envOn || env.value() > 0.001);
}

fun void snapPitchToNote() {
  if (ps_slideNow > 0.5) return;
  ps_noteHz => ps_landHz;
  if (ps_glide <= 1.0) {
    ps_landHz => ps_playHz;
  }
}

fun void primeProcessing() {
  if (ps_drive_mod_src == 0) {
    1.0 + ps_drive * 3.5 => drvG.gain;
  } else {
    Math.max(0.0, 1.0 + (ps_drive + ps_drive_mod) * 3.5) => drvG.gain;
  }

  if (ps_fold_mod_src == 0) {
    1.0 + ps_fold * 4.5 + ps_drive * 0.8 => ps_foldDrive;
  } else {
    1.0 + (ps_fold + ps_fold_mod) * 5.0 => ps_foldDrive;
  }

  if (ps_bits_mod_src == 0) {
    ps_bits - ps_drive * 3.0 => ps_bitsEff;
  } else {
    ps_bits + ps_bits_mod * 3.0 => ps_bitsEff;
  }
  Math.max(1.0, Math.min(12.0, ps_bitsEff)) => ps_bitsEff;
  ps_hold => ps_holdEff;

  ps_cutoff => float cf;
  cf + ps_plockCutNow * 3800.0 => cf;
  if (ps_cutoff_mod_src != 0) {
    ps_cutoff + ps_cutoff_mod * 3500.0 => cf;
  }
  Math.max(60.0, Math.min(10000.0, cf)) => cf;
  cf => lpf1.freq;
  cf => lpf2.freq;
  ps_res => lpf1.Q;
  ps_res => lpf2.Q;
  35.0 + ps_drive * 120.0 => corpHp.freq;
}

fun void primeMixGains() {
  ps_sub * (0.55 + ps_accNow * 0.35) => float subG;
  ps_harm * (0.5 + ps_accNow * 0.45) => float harmG;
  ps_tex => float texG;
  harmTap.last() * harmG * (1.0 - ps_routeHarm) * 0.7 => harmDryG.gain;
  texTap.last() * texG * (1.0 - ps_routeTex) * 0.65 => texDryG.gain;
  ps_regen * subG * (0.5 + ps_drive * 0.35) => regenG.gain;
  1.0 => procG.gain;
  ps_amp * ps_accGain => outG.gain;
}

fun void primeVoice() {
  primeLayerGains();
  primeProcessing();
  primeMixGains();
}

fun void bootWarmup() {
  voiceLink();
  primeVoice();
  applyEnvTimes();
}

fun void primeLayerGains() {
  ps_reese => float reeseAmt;
  1.0 - reeseAmt => float pressAmt;
  reeseAmt * (1.0 + ps_width * 0.8) * 0.014 => ps_detune;

  reeseAmt * 0.2 => float r1;
  reeseAmt * 0.18 => float r2;
  if (pressAmt > 0.35) pressAmt * 0.45 => r1;
  r1 => harm1.gain;
  r2 => harm2.gain;
  r2 * 0.95 => harm3.gain;
  r2 * 0.88 => harm4.gain;
  r2 * 0.82 => harm5.gain;
  r2 * 0.76 => harm6.gain;
  reeseAmt * ps_width * 0.42 => harmHaasG.gain;

  pressAmt * 0.42 => pressGn.gain;
  pressAmt * ps_morph * 0.55 => formGn.gain;
  (ps_morph * 0.35 + pressAmt * 0.15) * ps_harm => pulseGn.gain;

  ps_corrode * (0.4 + ps_tex * 0.6) => ps_corrodeAmt;
  ps_ring * (0.3 + ps_tex * 0.7) => ps_ringAmt;
  ps_tex * (1.0 - ps_corrodeAmt * 0.65) * 0.55 => texNG.gain;
  ps_tex * (1.0 - ps_corrodeAmt * 0.4) * 0.4 => texCG.gain;
  ps_corrodeAmt * 0.35 => corrodeSaw.gain;
  ps_corrodeAmt * 0.25 => corrodeSqr.gain;

  ps_sub * (0.55 + ps_accNow * 0.35) => subGn.gain;
  ps_harm * (0.5 + ps_accNow * 0.45) => harmGn.gain;
  ps_tex => texGn.gain;
}

fun int voiceSustaining() {
  return (env.value() > 0.015);
}

fun void sleepLayers() {
  // Layers stay hot while linked — only outG/env gate audibility.
}

fun void voiceUnlink() {
  // Intentionally disabled: unlink/relink caused dry clicks and stuck proc paths.
}

fun void voiceLink() {
  if (!ps_voiceLinked) {
    subTap => blackhole;
    harmTap => blackhole;
    texTap => blackhole;
    foldInG => blackhole;
    crushIn => blackhole;
    outG => ps_meter;
    1 => ps_voiceLinked;
  }
}

fun void crackleLoop() {
  while (true) {
    if (voiceSilent() && ps_tex < 0.02) {
      0.0 => texCr.next;
      50::ms => now;
      continue;
    }
    Math.random2f(-1.0, 1.0) => texCr.next;
    Math.random2f(8.0, 60.0)::ms => now;
  }
}

fun void texLoop() {
  while (true) {
    if (!procActive() && ps_tex < 0.02 && ps_corrode < 0.02) {
      0.0 => texOut.next;
      5::ms => now;
      continue;
    }
    texRaw.last() => float raw;
    subTap.last() => float car;
    raw * (1.0 - ps_ringAmt) + raw * car * ps_ringAmt => float out;
    out => texOut.next;
    1::samp => now;
  }
}

fun void layerLoop() {
  while (true) {
    if (!procActive()) {
      0.0 => layerIn.next;
      5::ms => now;
      continue;
    }
    subTap.last() => float subS;
    harmTap.last() => float harmS;
    texTap.last() => float texS;

    ps_sub * (0.55 + ps_accNow * 0.35) => float subLvl;
    ps_harm * (0.5 + ps_accNow * 0.45) => float harmLvl;
    ps_tex => float texLvl;

    subS * subLvl * ps_routeSub => float subF;
    harmS * harmLvl * ps_routeHarm => float harmF;
    texS * texLvl * ps_routeTex => float texF;

    subF + harmF + texF => layerIn.next;
    1::samp => now;
  }
}

fun void foldLoop() {
  while (true) {
    if (!procActive()) {
      0.0 => foldOut.next;
      5::ms => now;
      continue;
    }
    foldInG.last() * ps_foldDrive => float x;
    triFold(x) => foldOut.next;
    1::samp => now;
  }
}

fun void crushLoop() {
  while (true) {
    if (!procActive()) {
      0.0 => crushOut.next;
      5::ms => now;
      continue;
    }
    Math.max(1.0, Math.min(12.0, ps_bitsEff)) => float bits;
    Math.pow(2.0, bits) => float levels;
    Math.max(1.0, ps_holdEff) $ int => int hold;
    Math.floor(crushIn.last() * levels + 0.5) / levels => float q;
    q => crushOut.next;
    hold::samp => now;
  }
}

fun void pitchLoop() {
  while (true) {
    if (!procActive()) {
      5::ms => now;
      continue;
    }

    // Glide current pitch toward target; pitchDrop owns playHz during 808 slam
    if (ps_pitEnvAmt < 0.02 && ps_slideNow <= 0.5) {
      if (ps_glide <= 1.0) {
        ps_landHz => ps_playHz;
      } else {
        Math.max(0.001, ps_glide / 1000.0) => float tau;
        Math.exp(-0.002 / tau) => float coef;
        ps_playHz + (ps_landHz - ps_playHz) * (1.0 - coef) => ps_playHz;
      }
    }

    ps_playHz => float f;
    if (ps_pitchMod_src == 0) {
      f * (1.0 + ps_lfoOut * 0.04) => f;
    } else {
      f + ps_pitchMod => f;
    }
    Math.max(22.0, f) => f;
    f * ps_subOct => float subF;
    f => float harmF;

    subF => subOsc.freq;
    harmF => harm1.freq;
    harmF * (1.0 + ps_detune) => harm2.freq;
    harmF * (1.0 - ps_detune) => harm3.freq;
    harmF * (1.0 + ps_detune * 1.35) => harm4.freq;
    harmF * (1.0 - ps_detune * 1.1) => harm5.freq;
    harmF * (1.0 + ps_detune * 1.8) => harm6.freq;
    harmF => harmPulse.freq;
    harmF => pressBlit.freq;
    harmF * 2.4 => form1.freq;
    harmF * 5.1 => form2.freq;
    harmF * (1.0 + ps_corrodeAmt * 0.5) => corrodeSaw.freq;
    harmF * (2.0 + ps_corrodeAmt * 3.0) => corrodeSqr.freq;

    2::ms => now;
  }
}

fun void pitchDrop(int gen) {
  ps_landHz => float land;
  land * (1.0 + ps_pitEnvAmt * 2.8) => float f0;
  if (ps_pitEnvAmt < 0.02) {
    land => ps_playHz;
    1.0 => ps_pitEnvOut;
    return;
  }
  0.0 => ps_pitEnvOut;
  (24.0 + ps_pitTime * 200.0) $ int => int steps;
  for (0 => int i; i < steps; i++) {
    if (gen != ps_pitDropGen) return;
    f0 * Math.pow(0.94, i) => float f;
    if (f < land) land => f;
    f => ps_playHz;
    1.0 - (i $ float) / (steps $ float) => ps_pitEnvOut;
    (4.0 + ps_pitTime * 4.0)::ms => now;
  }
  if (gen == ps_pitDropGen) {
    land => ps_playHz;
    1.0 => ps_pitEnvOut;
  }
}

fun void follow() {
  while (true) {
    if (voiceSilent()) {
      0.0 => outG.gain;
      0.0 => layerIn.next;
      0.0 => foldOut.next;
      0.0 => crushOut.next;
      0.0 => texOut.next;
      env.value() => ps_envOut;
      25::ms => now;
      continue;
    }

    primeLayerGains();

    ps_reese => float reeseAmt;
    1.0 - reeseAmt => float pressAmt;
    reeseAmt * ps_width * 0.42 => harmHaasG.gain;
    (0.5 + ps_width * 8.0)::ms => harmHaas.delay;
    4.0 + pressAmt * 5.0 => form1.Q;
    5.0 + pressAmt * 6.0 => form2.Q;
    1.0 => corrodeGn.gain;

    primeProcessing();

    ps_sub * (0.55 + ps_accNow * 0.35) => float subG;
    ps_harm * (0.5 + ps_accNow * 0.45) => float harmG;
    ps_tex => float texG;

    // Dry bypass paths (layers not sent through filter/drive)
    harmTap.last() * harmG * (1.0 - ps_routeHarm) * 0.7 => float harmDry;
    texTap.last() * texG * (1.0 - ps_routeTex) * 0.65 => float texDry;
    harmDry => harmDryG.gain;
    texDry => texDryG.gain;

    ps_regen * subG * (0.5 + ps_drive * 0.35) => regenG.gain;
    1.0 => procG.gain;

    env.value() => ps_envOut;
    now / second => float t;
    Math.sin(2.0 * Math.PI * ps_lfoRate * t) * ps_lfoAmt => ps_lfoOut;

    ps_cutoff => float cf;
    cf + env.value() * 3200.0 * (0.25 + ps_accNow * 0.55) => cf;
    cf + ps_plockCutNow * 3800.0 => cf;
    if (ps_cutoff_mod_src != 0) {
      ps_cutoff + ps_cutoff_mod * 3500.0 => cf;
    }
    Math.max(60.0, Math.min(10000.0, cf)) => cf;
    cf => lpf1.freq;
    cf => lpf2.freq;

    ps_noteHz => ps_landHz;

    ps_amp * ps_accGain => outG.gain;

    if (voiceSustaining()) 10::ms => now;
    else 5::ms => now;
  }
}

fun void applyEnvTimes() {
  ps_dec * (0.65 + (1.0 - ps_accNow) * 0.5) => float decMs;
  ps_atk::ms => dur a;
  decMs::ms => dur d;
  ps_rel::ms => dur r;
  env.set(a, d, ps_sus, r);
}

fun void onGate() {
  while (true) {
    ps_gate => now;
    now / second => float t;
    if (t - ps_lastGateSec < 0.003) continue;
    t => ps_lastGateSec;
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
  ps_accent => float acc;
  ps_plockPit => float pPit;
  ps_plockCut => float pCut;
  ps_slide => float sl;

  acc => ps_accNow;
  pCut => ps_plockCutNow;
  sl => ps_slideNow;
  Math.max(0.0, Math.min(1.0, ps_pitEnv + pPit * (1.0 - ps_pitEnv * 0.35))) => ps_pitEnvAmt;
  Math.max(0.15, acc) => float aMul;
  0.55 + aMul * 0.6 => ps_accGain;
}

fun void noteRelease(int gen) {
  gateHoldSec() * 0.92 => float hold;
  if (ps_slideNow > 0.5) hold * 1.1 => hold;
  hold::second => now;
  if (gen == ps_hitGen) {
    env.keyOff();
    0 => ps_envOn;
  }
}

fun void hit() {
  readHitGlobals();
  voiceLink();
  snapPitchToNote();

  ps_hitGen + 1 => ps_hitGen;
  ps_hitGen => int myGen;

  applyEnvTimes();

  if (!(ps_slideNow > 0.5 && ps_envOn)) {
    env.keyOn();
  }
  1 => ps_envOn;

  primeVoice();

  ps_pitDropGen + 1 => ps_pitDropGen;
  spork ~ pitchDrop(ps_pitDropGen);
  spork ~ noteRelease(myGen);
}
