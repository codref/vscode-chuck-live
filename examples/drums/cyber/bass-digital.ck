// drums/cyber/bass-digital.ck — low-bit cyber sub boom into rackBus.
// Same pitch-drop weight as drums/bass.ck, but square + crush / downsample grit.
// Load master first; sequence cy_bass. Pair with cy_kick for punch + digital weight.
//
// Mod matrix: ENV source + Pitch / Drive / Crush destinations.

global Gain rackBus;
global Gain cy_bass_meter;
global float cy_bass_meter_p;
0.0 => cy_bass_meter_p;

// @seqGate
global Event cy_bass;

// @knob min=0 max=0.95 step=0.01 default=0.72
global float cy_bass_amp;
// @knob min=28 max=80 step=1 default=40
// @modTarget label=Pitch unit=hz
global float cy_bass_freq;
// @knob min=80 max=900 step=5 default=420
global float cy_bass_dec;
// @knob min=0 max=1 step=0.01 default=0.55
// @modTarget label=Drive
global float cy_bass_drive;
// @knob min=0 max=1 step=0.01 default=0.7
global float cy_bass_pulse;       // 0 = sine sub, 1 = square body
// @knob min=1 max=8 step=1 default=4
// @modTarget label=Crush
global float cy_bass_bits;        // bit depth (lower = crunchier)
// @knob min=1 max=64 step=1 default=12
global float cy_bass_rate;        // hold samples (higher = more alias / lo-fi)
// @knob min=0 max=1 step=0.01 default=0.35
global float cy_bass_click;       // digital onset blip

// @modSource label=ENV bipolar=0
global float cy_bass_envOut;

global float cy_bass_freq_mod;
global int cy_bass_freq_mod_src;
global float cy_bass_freq_mod_depth;

global float cy_bass_drive_mod;
global int cy_bass_drive_mod_src;
global float cy_bass_drive_mod_depth;

global float cy_bass_bits_mod;
global int cy_bass_bits_mod_src;
global float cy_bass_bits_mod_depth;

0.72 => cy_bass_amp;
40.0 => cy_bass_freq;
420.0 => cy_bass_dec;
0.55 => cy_bass_drive;
0.7 => cy_bass_pulse;
4.0 => cy_bass_bits;
12.0 => cy_bass_rate;
0.35 => cy_bass_click;
0 => cy_bass_freq_mod_src;
0.0 => cy_bass_freq_mod_depth;
0 => cy_bass_drive_mod_src;
0.0 => cy_bass_drive_mod_depth;
0 => cy_bass_bits_mod_src;
0.0 => cy_bass_bits_mod_depth;

float fLand;
40.0 => fLand;
float bitsEff;
4.0 => bitsEff;
int voiceLinked;
0 => voiceLinked;

SinOsc sub => Gain oscMix;
PulseOsc sqr => oscMix;
0.5 => sqr.width;

oscMix => ADSR env => Gain drive => Gain crushIn => blackhole;
Step crushOut => LPF soft => Gain g => cy_bass_meter => rackBus;

PulseOsc click => BPF clickF => ADSR clickEnv => Gain clickG => cy_bass_meter;
clickF.set(1800, 3.0);
clickEnv.set(0.3::ms, 12::ms, 0.0, 8::ms);
0.0 => clickG.gain;
0.4 => click.gain;

env.set(2::ms, 420::ms, 0.0, 70::ms);
90.0 => soft.freq;
1.6 => soft.Q;
0.0 => g.gain;
1.0 => oscMix.gain;
0.0 => crushOut.next;

spork ~ onBass();
spork ~ follow();
spork ~ crushLoop();
spork ~ _ckLivePeak();
1 => voiceLinked;
while (true) 20::ms => now;

fun int voiceSilent() {
  return (env.value() < 0.001 && clickEnv.value() < 0.001);
}

fun void voiceUnlink() {
  if (voiceLinked) {
    g =< cy_bass_meter;
    clickG =< cy_bass_meter;
    crushIn =< blackhole;
    0 => voiceLinked;
  }
}

fun void voiceLink() {
  if (!voiceLinked) {
    crushIn => blackhole;
    g => cy_bass_meter;
    clickG => cy_bass_meter;
    1 => voiceLinked;
  }
}

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(cy_bass_meter.last()) => float s;
    if (s > cy_bass_meter_p) s => cy_bass_meter_p; else cy_bass_meter_p * d => cy_bass_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    if (voiceSilent()) {
      voiceUnlink();
      0.0 => crushOut.next;
      0.0 => g.gain;
      0.0 => clickG.gain;
      25::ms => now;
      continue;
    }
    voiceLink();
    env.value() => cy_bass_envOut;
    cy_bass_amp => g.gain;
    1.0 - cy_bass_pulse => sub.gain;
    cy_bass_pulse => sqr.gain;
    cy_bass_click * 0.45 => clickG.gain;

    if (cy_bass_freq_mod_src == 0) {
      cy_bass_freq => fLand;
    } else {
      Math.max(28.0, Math.min(120.0, cy_bass_freq + cy_bass_freq_mod * 40.0)) => fLand;
    }

    if (cy_bass_drive_mod_src == 0) {
      1.0 + cy_bass_drive * 4.0 => drive.gain;
    } else {
      Math.max(0.0, Math.min(1.0, cy_bass_drive + cy_bass_drive_mod)) => float drv;
      1.0 + drv * 4.0 => drive.gain;
    }

    if (cy_bass_bits_mod_src == 0) {
      cy_bass_bits => bitsEff;
    } else {
      // lower bits = crunchier; mod swings ±3 bits around the knob
      Math.max(1.0, Math.min(8.0, cy_bass_bits + cy_bass_bits_mod * 3.0)) => bitsEff;
    }

    cy_bass_dec::ms => dur d;
    env.set(2::ms, d, 0.0, 70::ms);
    5::ms => now;
  }
}

// Sample-hold + bit quantize — classic lo-bit without a dedicated crush UGen.
fun void crushLoop() {
  while (true) {
    if (voiceSilent()) {
      0.0 => crushOut.next;
      25::ms => now;
      continue;
    }
    Math.max(1.0, Math.min(8.0, bitsEff)) => float bits;
    Math.pow(2.0, bits) => float levels;
    Math.max(1.0, cy_bass_rate) $ int => int hold;
    Math.floor(crushIn.last() * levels + 0.5) / levels => float q;
    q => crushOut.next;
    hold::samp => now;
  }
}

fun void onBass() {
  while (true) {
    cy_bass => now;
    spork ~ bassHit();
  }
}

fun void bassHit() {
  voiceLink();
  fLand * 3.2 => float f0;
  f0 => sub.freq;
  f0 => sqr.freq;
  env.keyOn();
  if (cy_bass_click > 0.01) {
    clickEnv.keyOn();
    fLand * 8.0 => click.freq;
  }
  spork ~ drop(f0);
  cy_bass_dec::ms => now;
  env.keyOff();
  clickEnv.keyOff();
}

fun void drop(float f0) {
  for (0 => int i; i < 44; i++) {
    f0 * Math.pow(0.935, i) => float f;
    if (f < fLand) fLand => f;
    f => sub.freq;
    f => sqr.freq;
    6::ms => now;
  }
  fLand => sub.freq;
  fLand => sqr.freq;
}
