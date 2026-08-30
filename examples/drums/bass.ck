// drums/bass.ck — 808-style sub boom into rackBus.
// Load master first; sequence dk_bass. Pair with kick.ck for punch + weight.
//
// IMPORTANT: the Event listener must NOT block for the full decay — otherwise
// later seq steps are missed and a long boom feels "late" vs the playhead.
// Pattern: `dk_bass => now` then immediately `spork ~ bassHit()` and loop.
//
// Mod matrix: ENV source + Pitch / Drive destinations (cross-route with voices).

global Gain rackBus;
global Gain bass_meter;
global float bass_meter_p;
0.0 => bass_meter_p;

// @seqGate
global Event dk_bass;             // sequencer gate track (pads only, no pitch)

// @knob min=0 max=0.95 step=0.01 default=0.75
global float dk_bass_amp;
// @knob min=28 max=80 step=1 default=42
// @modTarget label=Pitch unit=hz
global float dk_bass_freq;        // sub landing pitch (Hz)
// @knob min=80 max=900 step=5 default=480
global float dk_bass_dec;         // boom length in ms
// @knob min=0 max=1 step=0.01 default=0.35
// @modTarget label=Drive
global float dk_bass_drive;       // pre-LPF saturation

// @modSource label=ENV bipolar=0
global float dk_bass_envOut;

global float dk_bass_freq_mod;
global int dk_bass_freq_mod_src;
global float dk_bass_freq_mod_depth;

global float dk_bass_drive_mod;
global int dk_bass_drive_mod_src;
global float dk_bass_drive_mod_depth;

0.75 => dk_bass_amp;
42.0 => dk_bass_freq;
480.0 => dk_bass_dec;
0.35 => dk_bass_drive;
0 => dk_bass_freq_mod_src;
0.0 => dk_bass_freq_mod_depth;
0 => dk_bass_drive_mod_src;
0.0 => dk_bass_drive_mod_depth;

float fLand;
42.0 => fLand;

SinOsc sub => ADSR env => Gain drive => LPF soft => Gain g => bass_meter => rackBus;
SinOsc body => env;               // second osc shares same envelope
// short click so the seq step is audible on the playhead (sub onset is slow)
Noise click => BPF clickF => ADSR clickEnv => Gain clickG => rackBus;

env.set(2::ms, 480::ms, 0.0, 80::ms);
clickEnv.set(0.5::ms, 18::ms, 0.0, 20::ms);
clickF.set(600, 2.0);
0.22 => clickG.gain;
90.0 => soft.freq;
1.4 => soft.Q;
0.0 => g.gain;
1.0 => sub.gain;
0.55 => body.gain;

spork ~ onBass();                 // non-blocking gate dispatcher
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(bass_meter.last()) => float s;
    if (s > bass_meter_p) s => bass_meter_p; else bass_meter_p * d => bass_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    env.value() => dk_bass_envOut;
    dk_bass_amp => g.gain;

    if (dk_bass_freq_mod_src == 0) {
      dk_bass_freq => fLand;
    } else {
      Math.max(28.0, Math.min(120.0, dk_bass_freq + dk_bass_freq_mod * 40.0)) => fLand;
    }

    if (dk_bass_drive_mod_src == 0) {
      1.0 + dk_bass_drive * 2.5 => drive.gain;
    } else {
      Math.max(0.0, Math.min(1.0, dk_bass_drive + dk_bass_drive_mod)) => float drv;
      1.0 + drv * 2.5 => drive.gain;
    }

    dk_bass_dec::ms => dur d;
    env.set(2::ms, d, 0.0, 80::ms);
    5::ms => now;
  }
}

fun void onBass() {
  while (true) {
    dk_bass => now;               // wait for sequencer gate only
    // return to waiting immediately so every seq step can trigger
    spork ~ bassHit();            // actual sound runs in its own shred
  }
}

fun void bassHit() {
  fLand * 3.5 => float f0;   // start much higher for 808 sweep
  f0 => sub.freq;
  f0 * 1.01 => body.freq;           // slight detune for thickness
  env.keyOn();
  clickEnv.keyOn();
  spork ~ drop(f0);                 // long pitch glide in parallel
  dk_bass_dec::ms => now;
  env.keyOff();
  clickEnv.keyOff();
}

fun void drop(float f0) {
  // longer, deeper pitch fall than kick.ck — room-shaking boom
  for (0 => int i; i < 48; i++) {
    f0 * Math.pow(0.94, i) => float f;
    if (f < fLand) fLand => f;   // don't go below modulated landing pitch
    f => sub.freq;
    f * 1.01 => body.freq;
    6::ms => now;
  }
  fLand => sub.freq;
  fLand * 1.01 => body.freq;
}
