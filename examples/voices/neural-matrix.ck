// voices/neural-matrix.ck — Neural Matrix Synth into rackBus.
// Dual wavetable/FM bass + texture: fold → MS-20 LPF → crush → resonator → space.
// Load: oscillators/master.ck → neural-matrix.ck → fx/cyber-fx.ck (or dac-out / bus-fx)
//
// Sequencer:
//   nm_noteHz / nm_accent / P-locks / nm_slide / nm_ratchet — all share gate=nm_gate
//   (same step pads bang the voice once; onGate debounces multi-lane broadcasts)
//   nm_gate — trigger
//
// Macros: Volt (drive), Chrome (FM/comb/detune), Corrupt (bits/noise/HPF),
//         Neon (cutoff/chorus/reverb), Mutate (per-step chaos)
//
// nm_route is pre vs post-filter *gain staging*, not live reconnection.

global Gain rackBus;
global Gain nm_meter;
global float nm_meter_p;
0.0 => nm_meter_p;

// ---- sequencer ----
// @seq mode=midi min=24 max=84 step=1 default=40 gate=nm_gate
global float nm_noteHz;
// @seq mode=raw min=0 max=1 step=0.01 default=0.5 gate=nm_gate
global float nm_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=nm_gate
global float nm_plockCut;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=nm_gate
global float nm_plockFold;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=nm_gate
global float nm_plockCrush;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=nm_gate
global float nm_slide;
// @seq mode=raw min=1 max=8 step=1 default=1 gate=nm_gate
global float nm_ratchet;
// @seqGate
global Event nm_gate;

global float live_stepDur;
0.125 => live_stepDur;

// ---- macros ----
// @knob min=0 max=1 step=0.01 default=0.25
global float nm_volt;
// @knob min=0 max=1 step=0.01 default=0.2
global float nm_chrome;
// @knob min=0 max=1 step=0.01 default=0.1
global float nm_corrupt;
// @knob min=0 max=1 step=0.01 default=0.08
global float nm_neon;
// @knob min=0 max=1 step=0.01 default=0
global float nm_mutate;

// ---- oscillators ----
// @knob min=0 max=1 step=0.01 default=0.25
global float nm_morph;
// @knob min=0 max=1 step=0.01 default=0.35
global float nm_unison;
// @knob min=0 max=1 step=0.01 default=0.55
global float nm_sub;
// @knob min=0 max=1 step=0.01 default=0.15
global float nm_fm;
// @knob min=0 max=1 step=0.01 default=0
global float nm_xmod;
// @knob min=0 max=1 step=0.01 default=0.1
global float nm_tex;

// ---- waveshape / crush ----
// @knob min=0 max=1 step=0.01 default=0.25
// @modTarget label=Fold
global float nm_fold;
// @knob min=0 max=0.8 step=0.01 default=0.15
global float nm_bias;
// @knob min=1 max=12 step=0.1 default=8
// @modTarget label=Crush
global float nm_bits;
// @knob min=1 max=48 step=1 default=6
global float nm_hold;

// ---- filter ----
// @slider min=80 max=8000 step=10 default=900
// @modTarget label=Filter unit=hz
global float nm_cutoff;
// @knob min=1 max=18 step=0.1 default=6
global float nm_res;
// @knob min=0 max=1 step=0.01 default=0.15
global float nm_shape;
// @knob min=0 max=1 step=0.01 default=0.12
global float nm_fmix;
// @knob min=0 max=1 step=0.01 default=0.2
global float nm_route;

// ---- amp / env / glide ----
// @knob min=0 max=0.8 step=0.01 default=0.35
global float nm_amp;
// @knob min=1 max=80 step=1 default=3
global float nm_atk;
// @knob min=40 max=800 step=5 default=180
global float nm_dec;
// @knob min=0 max=1 step=0.01 default=0.4
global float nm_sus;
// @knob min=40 max=1200 step=5 default=140
global float nm_rel;
// @knob min=0 max=400 step=1 default=40
global float nm_glide;

// ---- LFO ----
// @knob min=0.05 max=20 step=0.01 default=4.5
global float nm_lfoRate;
// @knob min=0 max=1 step=0.01 default=0.12
global float nm_lfoAmt;

// @modSource label=LFO bipolar=1
global float nm_lfoOut;
// @modSource label=ENV bipolar=0
global float nm_envOut;
// @modSource label=Chaos bipolar=1
global float nm_chaosOut;

// @modTarget label=Pitch unit=hz
global float nm_pitchMod;
global int nm_pitchMod_src;
global float nm_pitchMod_depth;

global float nm_cutoff_mod;
global int nm_cutoff_mod_src;
global float nm_cutoff_mod_depth;

global float nm_fold_mod;
global int nm_fold_mod_src;
global float nm_fold_mod_depth;

global float nm_bits_mod;
global int nm_bits_mod_src;
global float nm_bits_mod_depth;

// @modRoute src=ENV dst=Filter default=1 depth=0.3
// @modRoute src=Chaos dst=Crush default=1 depth=0.2

82.41 => nm_noteHz;
0.5 => nm_accent;
0.0 => nm_plockCut;
0.0 => nm_plockFold;
0.0 => nm_plockCrush;
0.0 => nm_slide;
1.0 => nm_ratchet;
0.25 => nm_volt;
0.2 => nm_chrome;
0.1 => nm_corrupt;
0.08 => nm_neon;
0.0 => nm_mutate;
0.25 => nm_morph;
0.35 => nm_unison;
0.55 => nm_sub;
0.15 => nm_fm;
0.0 => nm_xmod;
0.1 => nm_tex;
0.25 => nm_fold;
0.15 => nm_bias;
8.0 => nm_bits;
6.0 => nm_hold;
900.0 => nm_cutoff;
6.0 => nm_res;
0.15 => nm_shape;
0.12 => nm_fmix;
0.2 => nm_route;
0.35 => nm_amp;
3.0 => nm_atk;
180.0 => nm_dec;
0.4 => nm_sus;
140.0 => nm_rel;
40.0 => nm_glide;
4.5 => nm_lfoRate;
0.12 => nm_lfoAmt;
0.0 => nm_lfoOut;
0.0 => nm_envOut;
0.0 => nm_chaosOut;
0.0 => nm_pitchMod;
0 => nm_pitchMod_src;
0.0 => nm_pitchMod_depth;
0.0 => nm_cutoff_mod;
0 => nm_cutoff_mod_src;
0.0 => nm_cutoff_mod_depth;
0.0 => nm_fold_mod;
0 => nm_fold_mod_src;
0.0 => nm_fold_mod_depth;
0.0 => nm_bits_mod;
0 => nm_bits_mod_src;
0.0 => nm_bits_mod_depth;

// runtime (gate shred writes, follow/fm/fold/crush read)
82.41 => float nm_curHz;
1.0 => float octMulNow;
0.0 => float plockCutNow;
0.0 => float plockFoldNow;
0.0 => float plockCrushNow;
0.5 => float accNow;
0.0 => float slideNow;
1.0 => float accGain;
0 => int envOn;
0 => int hitGen;
0 => int voiceLinked;
-1.0 => float lastGateSec;
1.0 => float foldDrive;
0.15 => float foldBias;
0.0 => float xmodAmt;
8.0 => float bitsEff;
6.0 => float holdEff;
80.0 => float fmIndex;
0.003 => float detuneAmt;

// ---- Osc A: morphing saw / pulse / blit + formants + Haas tap ----
SawOsc saw1 => Gain sawMix;
SawOsc saw2 => sawMix;
SawOsc saw3 => sawMix;
sawMix => Gain sawG => Gain mix;
PulseOsc pulse => Gain pulseG => mix;
BlitSaw blit => Gain blitG => mix;
sawMix => BPF form1 => Gain formG => mix;
sawMix => BPF form2 => formG;
saw2 => Delay haas => Gain haasG => mix;
0.45 => pulse.width;
8 => blit.harmonics;
8::ms => haas.max;
2.5::ms => haas.delay;
700.0 => form1.freq;
4.0 => form1.Q;
1800.0 => form2.freq;
5.0 => form2.Q;

// ---- Osc B: sub + FM operator ----
SinOsc subSine => Gain subG => mix;
TriOsc subTri => subG;
SinOsc fmMod => blackhole;
0.7 => subSine.gain;
0.3 => subTri.gain;

// ---- noise / artifacts ----
Noise white => Gain wG => mix;
Step crackle => Gain cG => mix;
SinOsc hum => Gain hG => mix;
60.0 => hum.freq;
0.15 => hum.gain;

mix => blackhole;

// ---- wavefold (sample loop writes Step) ----
Step foldOut;
foldOut => Gain f1In => LPF lpf1 => LPF lpf2 => Gain f1Out;
foldOut => Gain parToF2 => Gain f2Src;
f1Out => Gain serToF2 => f2Src;

f2Src => HPF hp => Gain hpG => Gain f2Mix;
f2Src => BRF brf => Gain brfG => f2Mix;
f2Src => Gain f2combIn => DelayL f2comb => Gain combG => f2Mix;
f2comb => Gain f2fb => f2combIn;
50::ms => f2comb.max;
2::ms => f2comb.delay;
0.35 => f2fb.gain;

f1Out => Gain parF1 => Gain fMix;
f2Mix => Gain f2ToOut => fMix;

fMix => Gain postDrv => HPF corpHp => Gain crushIn => blackhole;
40.0 => corpHp.freq;
1.0 => corpHp.Q;

Step crushOut;
crushOut => Gain resoIn => DelayL reso => Gain resoWet => Gain spaceIn;
crushOut => Gain resoDry => spaceIn;
reso => Gain resoFb => resoIn;
80::ms => reso.max;
4::ms => reso.delay;

spaceIn => ADSR env => Chorus cho => Echo echo => NRev rev => Gain out => nm_meter => rackBus;
env.set(3::ms, 180::ms, 0.4, 140::ms);
800::ms => echo.max;
180::ms => echo.delay;
0.0 => echo.mix;
0.25 => echo.gain;
0.0 => cho.mix;
0.0 => rev.mix;
0.0 => out.gain;
0.0 => foldOut.next;
0.0 => crushOut.next;

900.0 => lpf1.freq;
900.0 => lpf2.freq;
6.0 => lpf1.Q;
6.0 => lpf2.Q;
180.0 => hp.freq;
1.2 => hp.Q;
900.0 => brf.freq;
2.0 => brf.Q;

spork ~ follow();
spork ~ fmLoop();
spork ~ foldLoop();
spork ~ crushLoop();
spork ~ crackleLoop();
spork ~ chaosLoop();
spork ~ onGate();
spork ~ _ckLivePeak();
1 => voiceLinked;
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(nm_meter.last()) => float s;
    if (s > nm_meter_p) s => nm_meter_p; else nm_meter_p * d => nm_meter_p;
    25::ms => now;
  }
}

fun float triFold(float x) {
  x + 1.0 => float y;
  y * 0.25 => y;
  y - Math.floor(y) => y;
  if (y > 0.5) {
    1.0 - y => y;
  }
  return y * 4.0 - 1.0;
}

fun int voiceSilent() {
  return (!envOn && env.value() < 0.001);
}

fun void sleepMix() {
  0.0 => sawG.gain;
  0.0 => pulseG.gain;
  0.0 => blitG.gain;
  0.0 => formG.gain;
  0.0 => haasG.gain;
  0.0 => subG.gain;
  0.0 => wG.gain;
  0.0 => cG.gain;
  0.0 => hG.gain;
}

fun void voiceUnlink() {
  if (voiceLinked) {
    out =< nm_meter;
    mix =< blackhole;
    0 => voiceLinked;
  }
}

fun void voiceLink() {
  if (!voiceLinked) {
    mix => blackhole;
    out => nm_meter;
    1 => voiceLinked;
  }
}

fun int snapRatchet(float r) {
  Math.max(1.0, Math.min(8.0, r)) $ int => int n;
  if (n >= 7) return 8;
  if (n >= 5) return 4;
  return n;
}

fun void crackleLoop() {
  while (true) {
    if (voiceSilent() && nm_tex < 0.02 && nm_corrupt < 0.02) {
      0.0 => crackle.next;
      50::ms => now;
      continue;
    }
    Math.random2f(-1.0, 1.0) => crackle.next;
    Math.random2f(6.0, 70.0)::ms => now;
  }
}

fun void chaosLoop() {
  while (true) {
    if (voiceSilent() && nm_mutate < 0.001) {
      0.0 => nm_chaosOut;
      100::ms => now;
      continue;
    }
    Math.random2f(-1.0, 1.0) => nm_chaosOut;
    (40.0 + Math.random2f(0.0, 220.0) * (1.0 - nm_mutate * 0.6))::ms => now;
  }
}

fun void foldLoop() {
  while (true) {
    if (voiceSilent()) {
      0.0 => foldOut.next;
      25::ms => now;
      continue;
    }
    mix.last() => float x;
    fmMod.last() => float m;
    x * (1.0 - xmodAmt + xmodAmt * m) => x;
    x + foldBias => x;
    x * foldDrive => x;
    triFold(x) => foldOut.next;
    1::samp => now;
  }
}

fun void crushLoop() {
  while (true) {
    if (voiceSilent()) {
      0.0 => crushOut.next;
      25::ms => now;
      continue;
    }
    Math.max(1.0, Math.min(12.0, bitsEff)) => float bits;
    Math.pow(2.0, bits) => float levels;
    Math.max(1.0, holdEff) $ int => int hold;
    Math.floor(crushIn.last() * levels + 0.5) / levels => float q;
    q => crushOut.next;
    hold::samp => now;
  }
}

fun void fmLoop() {
  while (true) {
    if (voiceSilent()) {
      25::ms => now;
      continue;
    }
    nm_curHz * octMulNow => float f;
    if (nm_pitchMod_src == 0) {
      f * (1.0 + nm_lfoOut * 0.05) => f;
    } else {
      f + nm_pitchMod => f;
    }
    Math.max(20.0, f) => f;

    f + fmMod.last() * fmIndex * (1.0 - xmodAmt) => float fa;
    Math.max(20.0, fa) => fa;
    fa => saw1.freq;
    fa * (1.0 + detuneAmt) => saw2.freq;
    fa * (1.0 - detuneAmt) => saw3.freq;
    fa => pulse.freq;
    fa => blit.freq;
    f * 0.5 => subSine.freq;
    f * 0.5 => subTri.freq;
    f * 2.0 => fmMod.freq;
    1.0 => fmMod.gain;
    fa * 2.4 => form1.freq;
    fa * 5.1 => form2.freq;
    1::ms => now;
  }
}

fun void follow() {
  while (true) {
    if (voiceSilent()) {
      voiceUnlink();
      sleepMix();
      0.0 => out.gain;
      0.0 => foldOut.next;
      0.0 => crushOut.next;
      env.value() => nm_envOut;
      25::ms => now;
      continue;
    }
    voiceLink();
    nm_morph => float m;
    Math.max(0.0, 1.0 - m * 0.85) => float sawAmt;
    0.0 => float pulseAmt;
    if (m < 0.45) {
      m / 0.45 => pulseAmt;
    } else {
      1.0 - (m - 0.45) / 0.55 * 0.8 => pulseAmt;
    }
    Math.max(0.0, (m - 0.35) / 0.65) => float blitAmt;
    Math.max(0.0, (m - 0.4) / 0.6) * 0.5 => float formAmt;

    sawAmt * 0.55 => sawG.gain;
    pulseAmt * 0.42 => pulseG.gain;
    blitAmt * 0.38 => blitG.gain;
    formAmt => formG.gain;
    4.0 + nm_chrome * 6.0 => form1.Q;
    5.0 + nm_chrome * 7.0 => form2.Q;

    nm_unison * (1.0 + nm_chrome * 1.4) => float uni;
    uni * 0.012 => detuneAmt;
    (0.4 + uni * 5.5)::ms => haas.delay;
    uni * 0.4 => haasG.gain;

    nm_sub * (1.0 + nm_volt * 0.35) * 0.55 => subG.gain;

    nm_tex => float tx;
    tx + nm_corrupt * 0.55 => float texAmt;
    Math.max(0.0, 1.0 - texAmt * 2.0) => float whiteAmt;
    1.0 - Math.fabs(texAmt - 0.45) * 2.2 => float crackAmt;
    if (crackAmt < 0.0) 0.0 => crackAmt;
    Math.max(0.0, texAmt * 2.0 - 0.7) => float humAmt;
    whiteAmt * 0.12 * (0.35 + nm_corrupt) => wG.gain;
    crackAmt * 0.18 * (0.4 + nm_corrupt) => cG.gain;
    humAmt * 0.1 * (0.5 + nm_corrupt) => hG.gain;

    nm_xmod => xmodAmt;
    nm_fm * (1.0 + nm_chrome * 2.2) * 420.0 => fmIndex;

    accNow => float acc;
    plockFoldNow => float pFold;
    if (nm_fold_mod_src == 0) {
      nm_fold + pFold * 0.85 + nm_volt * 0.65 => float fAmt;
      1.0 + fAmt * (4.0 + (1.0 - nm_route) * 3.0) => foldDrive;
    } else {
      1.0 + (nm_fold + nm_fold_mod + pFold + nm_volt * 0.5) * 5.0 => foldDrive;
    }
    nm_bias => foldBias;

    1.0 + nm_volt * 0.8 * nm_route + nm_route * 2.2 => postDrv.gain;

    nm_shape => float sh;
    Math.max(0.0, 1.0 - sh * 2.0) => hpG.gain;
    1.0 - Math.fabs(sh - 0.5) * 2.0 => float notchG;
    if (notchG < 0.0) 0.0 => notchG;
    notchG => brfG.gain;
    Math.max(0.0, sh * 2.0 - 1.0) => combG.gain;

    nm_fmix => float fx;
    fx => parToF2.gain;
    1.0 - fx => serToF2.gain;
    fx * 0.7 => parF1.gain;
    0.55 + (1.0 - fx) * 0.45 => f2ToOut.gain;

    env.value() => nm_envOut;
    now / second => float t;
    Math.sin(2.0 * Math.PI * nm_lfoRate * t) * nm_lfoAmt => nm_lfoOut;

    nm_cutoff * (1.0 + nm_neon * 1.8) => float cf;
    cf + env.value() * (0.32 + acc * 0.55) * 3800.0 => cf;
    cf + plockCutNow * 4200.0 => cf;
    if (nm_mutate > 0.001) {
      cf + nm_chaosOut * nm_mutate * 900.0 => cf;
    }
    if (nm_cutoff_mod_src != 0) {
      nm_cutoff + nm_cutoff_mod * 4000.0 => cf;
    }
    Math.max(80.0, Math.min(12000.0, cf)) => cf;
    cf => lpf1.freq;
    cf => lpf2.freq;
    Math.max(40.0, cf * 0.22) => hp.freq;
    cf => brf.freq;
    nm_res => lpf1.Q;
    nm_res => lpf2.Q;
    1.0 + nm_res * 0.15 => hp.Q;
    1.5 + nm_res * 0.2 => brf.Q;

    (1.0 / Math.max(80.0, cf))::second => dur f2d;
    if (f2d > 45::ms) 45::ms => f2d;
    if (f2d < 0.4::ms) 0.4::ms => f2d;
    f2d => f2comb.delay;
    Math.min(0.72, 0.28 + nm_chrome * 0.4) => f2fb.gain;

    (1.0 / Math.max(60.0, nm_curHz * 2.0 * (1.0 + nm_chrome)))::second => dur rd;
    if (rd > 70::ms) 70::ms => rd;
    if (rd < 0.5::ms) 0.5::ms => rd;
    rd => reso.delay;
    Math.min(0.78, nm_chrome * 0.7) => resoFb.gain;
    nm_chrome * 0.55 => resoWet.gain;
    1.0 - nm_chrome * 0.25 => resoDry.gain;

    40.0 + nm_corrupt * 480.0 => corpHp.freq;

    if (nm_bits_mod_src == 0) {
      nm_bits - nm_corrupt * 4.5 - plockCrushNow * 5.0 - nm_chaosOut * nm_mutate * 2.0 => bitsEff;
    } else {
      nm_bits + nm_bits_mod * 3.0 - nm_corrupt * 3.0 - plockCrushNow * 4.0 => bitsEff;
    }
    Math.max(1.0, Math.min(12.0, bitsEff)) => bitsEff;
    nm_hold + nm_corrupt * 18.0 + plockCrushNow * 12.0 => holdEff;
    Math.max(1.0, Math.min(48.0, holdEff)) => holdEff;

    nm_neon * 0.45 => cho.mix;
    0.4 + nm_neon * 3.5 => cho.modFreq;
    0.02 + nm_neon * 0.12 => cho.modDepth;
    nm_neon * 0.28 => echo.mix;
    0.15 + nm_neon * 0.35 => echo.gain;
    (120.0 + nm_neon * 280.0)::ms => echo.delay;
    nm_neon * 0.22 => rev.mix;

    nm_glide => float gms;
    if (slideNow > 0.5) {
      gms * 3.0 + 80.0 => gms;
    }
    nm_noteHz => float dest;
    if (gms <= 1.0 && slideNow <= 0.5) {
      dest => nm_curHz;
    } else {
      Math.max(0.001, gms / 1000.0) => float tau;
      Math.exp(-0.005 / tau) => float coef;
      nm_curHz + (dest - nm_curHz) * (1.0 - coef) => nm_curHz;
    }

    nm_dec * (0.7 + (1.0 - acc) * 0.45) => float decMs;
    nm_rel * (1.0 + nm_neon * 1.8) => float relMs;
    nm_atk::ms => dur a;
    decMs::ms => dur d;
    relMs::ms => dur r;
    env.set(a, d, nm_sus, r);

    nm_amp * accGain => out.gain;
    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    nm_gate => now;
    now / second => float t;
    // Coalesce same-step bangs from every P-lock lane sharing nm_gate.
    if (t - lastGateSec < 0.003) {
      continue;
    }
    t => lastGateSec;
    // Let sibling float writes in this step finish before capturing.
    spork ~ settledHit();
  }
}

fun void settledHit() {
  0.75::ms => now;
  hit();
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
  voiceLink();
  hitGen + 1 => hitGen;
  hitGen => int myGen;

  nm_accent => float acc;
  nm_plockCut => float pCut;
  nm_plockFold => float pFold;
  nm_plockCrush => float pCrush;
  nm_slide => float sl;
  nm_ratchet => float rat;
  nm_mutate => float mut;

  1.0 => float oct;
  if (mut > 0.001 && Math.random2f(0.0, 1.0) < mut) {
    if (Math.random2f(0.0, 1.0) < 0.5) {
      2.0 => oct;
    } else {
      0.5 => oct;
    }
    acc + Math.random2f(0.15, 0.55) * mut => acc;
    if (acc > 1.0) 1.0 => acc;
    pCut + Math.random2f(-0.25, 0.55) * mut => pCut;
    if (pCut < 0.0) 0.0 => pCut;
    if (pCut > 1.0) 1.0 => pCut;
  }

  acc => accNow;
  pCut => plockCutNow;
  pFold => plockFoldNow;
  pCrush => plockCrushNow;
  sl => slideNow;
  oct => octMulNow;
  Math.max(0.15, acc) => float aMul;
  0.55 + aMul * 0.65 => accGain;

  snapRatchet(rat) => int n;
  Math.max(0.01, live_stepDur) => float stepSec;

  if (n > 1) {
    1 => envOn;
    stepSec / (n $ float) => float slice;
    for (0 => int i; i < n; i++) {
      env.keyOn();
      (slice * 0.62)::second => now;
      env.keyOff();
      (slice * 0.38)::second => now;
    }
    0 => envOn;
  } else {
    if (!(sl > 0.5 && envOn)) {
      env.keyOn();
      1 => envOn;
    }
    if (sl > 0.5) {
      (stepSec * 0.98)::second => now;
      spork ~ slideRelease(myGen);
    } else {
      (stepSec * 0.92)::second => now;
      if (myGen == hitGen) {
        env.keyOff();
        0 => envOn;
      }
    }
  }

  1.0 => accGain;
}
