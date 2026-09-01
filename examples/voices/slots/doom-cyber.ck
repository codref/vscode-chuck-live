// voices/slots/doom-cyber.ck — full darkwave phrase slot (cyber.wav)
// Sequencer: cy_gate — sparse gates (one per phrase). Phrase longer than step spacing queues once max.

global Gain rackBus;
global Gain cy_meter;
global float cy_meter_p;
0.0 => cy_meter_p;

// @seqGate
global Event cy_gate;
// @seq mode=raw min=0 max=1 step=0.01 default=0.55 gate=cy_gate
global float cy_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=cy_gate
global float cy_chop;
// @knob min=0.05 max=1 step=0.01 default=0.45
global float cy_chopEnd;

global int live_running;
global int live_step;

// ---- amp / mix ----
// @knob min=0 max=0.85 step=0.01 default=0.42
global float cy_amp;
// @knob min=0 max=1 step=0.01 default=0.35
global float cy_synth;
// @knob min=0 max=1 step=0.01 default=0.35
global float cy_sub;
// @knob min=40 max=220 step=1 default=82
global float cy_root;

// ---- darkwave tone ----
// @knob min=0 max=1 step=0.01 default=0.55
global float cy_drive;
// @slider min=400 max=2800 step=10 default=1100
global float cy_formant;
// @knob min=0.5 max=8 step=0.1 default=3.2
global float cy_formQ;
// @slider min=200 max=6000 step=10 default=1600
global float cy_cutoff;
// @knob min=1 max=14 step=0.1 default=4.5
global float cy_res;
// @knob min=40 max=400 step=5 default=90
global float cy_hp;
// @knob min=0 max=1 step=0.01 default=0.25
global float cy_crush;
// @knob min=1 max=32 step=1 default=8
global float cy_hold;

// ---- envelope ----
// @knob min=1 max=120 step=1 default=12
global float cy_atk;
// @knob min=80 max=8000 step=5 default=520
global float cy_dec;
// @knob min=0 max=1 step=0.01 default=0.45
global float cy_sus;
// @knob min=80 max=4000 step=5 default=400
global float cy_rel;

0.42 => cy_amp;
0.35 => cy_synth;
0.35 => cy_sub;
82.0 => cy_root;
0.0 => cy_chop;
0.45 => cy_chopEnd;
0.55 => cy_drive;
1100.0 => cy_formant;
3.2 => cy_formQ;
1600.0 => cy_cutoff;
4.5 => cy_res;
90.0 => cy_hp;
0.25 => cy_crush;
8.0 => cy_hold;
12.0 => cy_atk;
520.0 => cy_dec;
0.45 => cy_sus;
400.0 => cy_rel;

"cyber.wav" => string cy_sample;
int sampleOk;
0 => sampleOk;

SndBuf buf;
me.dir() + "../samples/" + cy_sample => string cy_path;
cy_path => buf.read;
if (buf.samples() > 0) {
  1 => sampleOk;
  0 => buf.pos;
  0 => buf.loop;
  0.0 => buf.rate;
  <<< "cy-vox: loaded", cy_path, "frames", buf.samples() >>>;
} else {
  <<< "cy-vox: missing", cy_path >>>;
}

// ---- parallel synth (doom-vox oneshot layer) ----
SawOsc cy_saw => Gain cy_carMix;
PulseOsc cy_pulse => cy_carMix;
SinOsc cy_subOsc => cy_carMix;
0.45 => cy_pulse.width;
0.5 => cy_saw.gain;
0.35 => cy_pulse.gain;
0.4 => cy_subOsc.gain;
82.0 => cy_saw.freq;
82.0 => cy_pulse.freq;
41.0 => cy_subOsc.freq;

Gain fxIn;
Gain cy_sampG => fxIn;
cy_carMix => Gain cy_synG => fxIn;
buf => Gain srcMute => cy_sampG;
0.0 => srcMute.gain;
0.85 => cy_sampG.gain;
0.0 => cy_synG.gain;

fxIn => HPF hp => Gain fold => BPF form => LPF lpf1 => LPF lpf2 => Gain crushIn => blackhole;
1.2 => hp.Q;

Step crushOut;
Gain lev;
crushOut => lev => ADSR env => Gain out => cy_meter => rackBus;
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
    Math.fabs(cy_meter.last()) => float s;
    if (s > cy_meter_p) s => cy_meter_p; else cy_meter_p * d => cy_meter_p;
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
    1.0 + cy_drive * (0.5 + cy_accent * 0.5) * 6.0 => float driveAmt;
    x * driveAmt => x;
    if (x > 1.0) 1.0 => x;
    if (x < -1.0) -1.0 => x;

    Std.ftoi(Math.max(1.0, cy_hold)) => int h;
    if (holdLeft <= 0) {
      h => holdLeft;
      x => held;
    }
    holdLeft - 1 => holdLeft;

    Math.max(1.0, 12.0 - cy_crush * 10.0) => float bits;
    Math.pow(2.0, bits - 1.0) => float levels;
    Math.round(held * levels) / levels => float y;
    (1.0 - cy_crush * 0.35) * y => crushOut.next;
    1::samp => now;
  }
}

fun void setCarriers(float hz) {
  Math.max(20.0, hz) => float f;
  f => cy_saw.freq;
  f => cy_pulse.freq;
  f * 0.5 => cy_subOsc.freq;
}

fun void applyMixGains() {
  cy_amp * (0.65 + 0.35 * cy_accent) => float levAmt;
  levAmt => lev.gain;
  0.85 * levAmt / Math.max(0.05, cy_amp) => cy_sampG.gain;
  cy_synth * cy_sub * 0.25 => cy_synG.gain;
}

fun void silence() {
  0.0 => srcMute.gain;
  0.0 => buf.rate;
  env.keyOff();
  0.0 => lev.gain;
  0.0 => cy_synG.gain;
  0 => buf.pos;
}

fun void follow() {
  while (true) {
    Math.max(20.0, cy_root) => float root;
    setCarriers(root);

    cy_hp => hp.freq;
    cy_formant => form.freq;
    cy_formQ => form.Q;
    cy_cutoff => lpf1.freq;
    cy_cutoff => lpf2.freq;
    cy_res => lpf1.Q;
    cy_res => lpf2.Q;
    1.0 + cy_drive * 5.0 => fold.gain;

    cy_atk::ms => dur a;
    cy_dec::ms => dur d;
    cy_rel::ms => dur r;
    env.set(a, d, cy_sus, r);

    cy_sub * 0.55 => cy_subOsc.gain;
    (1.0 - cy_synth * 0.35) * 0.55 => cy_saw.gain;
    cy_synth * 0.4 => cy_pulse.gain;

    5::ms => now;
  }
}

fun void onGate() {
  float lastTrig;
  -1.0 => lastTrig;
  while (true) {
    cy_gate => now;
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
  Math.max(0.0, Math.min(1.0, cy_chop)) => float startF;
  Math.max(0.05, Math.min(1.0, cy_chopEnd)) => float endF;
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
  0.0 => cy_synG.gain;
  env.keyOff();
  if (!abortNow) {
    cy_rel::ms => now;
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
