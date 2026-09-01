// voices/doom-vox-slot.ck — COPY THIS for an extra doom TTS phrase (full darkwave slot).
//
// === COPY CHECKLIST (search-replace in the new file) ===
//   slot  →  your prefix   (e.g. cy, rm — 2–4 letters, unique per shred)
//   SLOT.wav  →  your file  (e.g. cyber.wav under voices/samples/)
//
// Save as voices/slots/doom-YOURNAME.ck. Load master.ck → slot .ck → cyber-fx.ck.
// Sequencer: one @seqGate per slot. Sparse gates — one per phrase.
//
// Full triple-mode instrument (vocoder / pitched / bank): doom-vox.ck

global Gain rackBus;
global Gain slot_meter;
global float slot_meter_p;
0.0 => slot_meter_p;

// @seqGate
global Event slot_gate;
// @seq mode=raw min=0 max=1 step=0.01 default=0.55 gate=slot_gate
global float slot_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=slot_gate
global float slot_chop;
// @knob min=0.05 max=1 step=0.01 default=0.45
global float slot_chopEnd;

global int live_running;
global int live_step;

// ---- amp / mix ----
// @knob min=0 max=0.85 step=0.01 default=0.42
global float slot_amp;
// @knob min=0 max=1 step=0.01 default=0.35
global float slot_synth;
// @knob min=0 max=1 step=0.01 default=0.35
global float slot_sub;
// @knob min=40 max=220 step=1 default=82
global float slot_root;

// ---- darkwave tone ----
// @knob min=0 max=1 step=0.01 default=0.55
global float slot_drive;
// @slider min=400 max=2800 step=10 default=1100
global float slot_formant;
// @knob min=0.5 max=8 step=0.1 default=3.2
global float slot_formQ;
// @slider min=200 max=6000 step=10 default=1600
global float slot_cutoff;
// @knob min=1 max=14 step=0.1 default=4.5
global float slot_res;
// @knob min=40 max=400 step=5 default=90
global float slot_hp;
// @knob min=0 max=1 step=0.01 default=0.25
global float slot_crush;
// @knob min=1 max=32 step=1 default=8
global float slot_hold;

// ---- envelope ----
// @knob min=1 max=120 step=1 default=12
global float slot_atk;
// @knob min=80 max=8000 step=5 default=520
global float slot_dec;
// @knob min=0 max=1 step=0.01 default=0.45
global float slot_sus;
// @knob min=80 max=4000 step=5 default=400
global float slot_rel;

0.42 => slot_amp;
0.35 => slot_synth;
0.35 => slot_sub;
82.0 => slot_root;
0.0 => slot_chop;
0.45 => slot_chopEnd;
0.55 => slot_drive;
1100.0 => slot_formant;
3.2 => slot_formQ;
1600.0 => slot_cutoff;
4.5 => slot_res;
90.0 => slot_hp;
0.25 => slot_crush;
8.0 => slot_hold;
12.0 => slot_atk;
520.0 => slot_dec;
0.45 => slot_sus;
400.0 => slot_rel;

"SLOT.wav" => string slot_sample;
int sampleOk;
0 => sampleOk;

SndBuf buf;
me.dir() + "../samples/" + slot_sample => string slot_path;
slot_path => buf.read;
if (buf.samples() > 0) {
  1 => sampleOk;
  0 => buf.pos;
  0 => buf.loop;
  0.0 => buf.rate;
  <<< "slot-vox: loaded", slot_path, "frames", buf.samples() >>>;
} else {
  <<< "slot-vox: missing", slot_path >>>;
}

// ---- parallel synth (doom-vox oneshot layer) ----
SawOsc slot_saw => Gain slot_carMix;
PulseOsc slot_pulse => slot_carMix;
SinOsc slot_subOsc => slot_carMix;
0.45 => slot_pulse.width;
0.5 => slot_saw.gain;
0.35 => slot_pulse.gain;
0.4 => slot_subOsc.gain;
82.0 => slot_saw.freq;
82.0 => slot_pulse.freq;
41.0 => slot_subOsc.freq;

Gain fxIn;
Gain slot_sampG => fxIn;
slot_carMix => Gain slot_synG => fxIn;
buf => Gain srcMute => slot_sampG;
0.0 => srcMute.gain;
0.85 => slot_sampG.gain;
0.0 => slot_synG.gain;

fxIn => HPF hp => Gain fold => BPF form => LPF lpf1 => LPF lpf2 => Gain crushIn => blackhole;
1.2 => hp.Q;

Step crushOut;
Gain lev;
crushOut => lev => ADSR env => Gain out => slot_meter => rackBus;
env.set(12::ms, 520::ms, 0.45, 400::ms);
1.0 => out.gain;
0.0 => lev.gain;
0.0 => crushOut.next;

int playing;
int pending;
int abortNow;
0 => playing;
0 => pending;
0 => abortNow;

spork ~ follow();
spork ~ crushLoop();
spork ~ onGate();
spork ~ transportWatch();
spork ~ barWatch();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(slot_meter.last()) => float s;
    if (s > slot_meter_p) s => slot_meter_p; else slot_meter_p * d => slot_meter_p;
    25::ms => now;
  }
}

fun void crushLoop() {
  int holdLeft;
  0 => holdLeft;
  float held;
  0.0 => held;
  while (true) {
    crushIn.last() => float x;
    1.0 + slot_drive * (0.5 + slot_accent * 0.5) * 6.0 => float driveAmt;
    x * driveAmt => x;
    if (x > 1.0) 1.0 => x;
    if (x < -1.0) -1.0 => x;

    Std.ftoi(Math.max(1.0, slot_hold)) => int h;
    if (holdLeft <= 0) {
      h => holdLeft;
      x => held;
    }
    holdLeft - 1 => holdLeft;

    Math.max(1.0, 12.0 - slot_crush * 10.0) => float bits;
    Math.pow(2.0, bits - 1.0) => float levels;
    Math.round(held * levels) / levels => float y;
    (1.0 - slot_crush * 0.35) * y => crushOut.next;
    1::samp => now;
  }
}

fun void setCarriers(float hz) {
  Math.max(20.0, hz) => float f;
  f => slot_saw.freq;
  f => slot_pulse.freq;
  f * 0.5 => slot_subOsc.freq;
}

fun void applyMixGains() {
  slot_amp * (0.65 + 0.35 * slot_accent) => float levAmt;
  levAmt => lev.gain;
  0.85 * levAmt / Math.max(0.05, slot_amp) => slot_sampG.gain;
  slot_synth * slot_sub * 0.25 => slot_synG.gain;
}

fun void silence() {
  0.0 => srcMute.gain;
  0.0 => buf.rate;
  env.keyOff();
  0.0 => lev.gain;
  0.0 => slot_synG.gain;
  0 => buf.pos;
}

fun void follow() {
  while (true) {
    Math.max(20.0, slot_root) => float root;
    setCarriers(root);

    slot_hp => hp.freq;
    slot_formant => form.freq;
    slot_formQ => form.Q;
    slot_cutoff => lpf1.freq;
    slot_cutoff => lpf2.freq;
    slot_res => lpf1.Q;
    slot_res => lpf2.Q;
    1.0 + slot_drive * 5.0 => fold.gain;

    slot_atk::ms => dur a;
    slot_dec::ms => dur d;
    slot_rel::ms => dur r;
    env.set(a, d, slot_sus, r);

    slot_sub * 0.55 => slot_subOsc.gain;
    (1.0 - slot_synth * 0.35) * 0.55 => slot_saw.gain;
    slot_synth * 0.4 => slot_pulse.gain;

    5::ms => now;
  }
}

fun void onGate() {
  float lastTrig;
  -1.0 => lastTrig;
  while (true) {
    slot_gate => now;
    now / second => float t;
    if (lastTrig >= 0.0 && (t - lastTrig) < 0.008) {
      continue;
    }
    t => lastTrig;
    if (playing) {
      1 => pending;
    } else {
      1 => playing;
      spork ~ hit();
    }
  }
}

fun void waitPlayDur(dur playLen) {
  while (playLen > 10::ms) {
    if (abortNow) {
      return;
    }
    10::ms => now;
    playLen - 10::ms => playLen;
  }
  if (!abortNow && playLen > 0::samp) {
    playLen => now;
  }
}

fun void playPhrase() {
  buf.samples() => int total;
  if (total < 2) {
    return;
  }
  Math.max(0.0, Math.min(1.0, slot_chop)) => float startF;
  Math.max(0.05, Math.min(1.0, slot_chopEnd)) => float endF;
  if (endF <= startF) {
    Math.min(1.0, startF + 0.05) => endF;
  }
  Std.ftoi(startF * (total - 1)) => int startPos;
  Std.ftoi(endF * (total - 1)) => int stopPos;
  if (stopPos <= startPos) {
    startPos + 1 => stopPos;
  }

  startPos => buf.pos;
  1.0 => float rateNow;
  rateNow => buf.rate;
  1.0 => srcMute.gain;
  applyMixGains();
  env.keyOn();

  ((stopPos - startPos) $ float) / Math.max(0.05, rateNow) => float frames;
  frames::samp => dur playLen;
  waitPlayDur(playLen);

  0.0 => buf.rate;
  0 => buf.pos;
  0.0 => srcMute.gain;
  0.0 => slot_synG.gain;
  env.keyOff();
  if (!abortNow) {
    slot_rel::ms => now;
  }
  0.0 => lev.gain;
}

fun void transportWatch() {
  int lastRun;
  0 => lastRun;
  while (true) {
    live_running => int r;
    if (lastRun == 1 && r == 0) {
      1 => abortNow;
      0 => pending;
      silence();
      0 => playing;
    }
    r => lastRun;
    10::ms => now;
  }
}

fun void barWatch() {
  int lastStep;
  -1 => lastStep;
  while (true) {
    live_step => int s;
    if (lastStep == 15 && s == 0) {
      0 => pending;
    }
    s => lastStep;
    10::ms => now;
  }
}

fun void hit() {
  if (!sampleOk) {
    0 => playing;
    return;
  }
  0 => abortNow;
  while (true) {
    if (abortNow) {
      break;
    }
    playPhrase();
    if (abortNow) {
      break;
    }
    if (pending < 1) {
      break;
    }
    pending--;
  }
  silence();
  0 => playing;
  0 => abortNow;
}
