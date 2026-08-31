// voices/doom-vox-slot.ck — COPY THIS for an extra doom TTS phrase (independent gate).
//
// === COPY CHECKLIST (search-replace in the new file) ===
//   slot  →  your prefix   (e.g. cy, dm, rm — 2–4 letters, unique per shred)
//   SLOT.wav  →  your file  (e.g. cyber.wav under voices/samples/)
//
// Save as voices/slots/doom-YOURNAME.ck (or anywhere under voices/).
// Load master.ck → each slot .ck → cyber-fx.ck. Sequencer: one @seqGate track per slot.
//
// Full triple-mode voice: doom-vox.ck (vocoder / pitched / sample bank).

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

// @knob min=0 max=0.85 step=0.01 default=0.42
global float slot_amp;
// @knob min=0 max=1 step=0.01 default=0.5
global float slot_drive;
// @slider min=400 max=2800 step=10 default=1100
global float slot_formant;
// @slider min=200 max=5000 step=10 default=1400
global float slot_cutoff;
// @knob min=80 max=3000 step=5 default=400
global float slot_rel;

0.42 => slot_amp;
0.5 => slot_drive;
1100.0 => slot_formant;
1400.0 => slot_cutoff;
400.0 => slot_rel;

"SLOT.wav" => string slot_sample;
int sampleOk;
0 => sampleOk;

SndBuf buf;
me.dir() + "../samples/" + slot_sample => string slot_path;
// if this file lives directly in voices/ (not slots/), use:
// me.dir() + "samples/" + slot_sample => slot_path;

slot_path => buf.read;
if (buf.samples() > 0) {
  1 => sampleOk;
  0 => buf.pos;
  0 => buf.loop;
  1.0 => buf.rate;
  <<< "slot-vox: loaded", slot_path, "frames", buf.samples() >>>;
} else {
  <<< "slot-vox: missing", slot_path >>>;
}

buf => HPF hp => Gain fold => BPF form => LPF lpf => Gain crushIn => blackhole;
90 => hp.freq;
1100 => form.freq;
3.2 => form.Q;
1400 => lpf.freq;
4.5 => lpf.Q;

Step crushOut;
crushOut => ADSR env => Gain out => slot_meter => rackBus;
env.set(8::ms, 400::ms, 0.8, 400::ms);
0.0 => out.gain;
0.0 => crushOut.next;

spork ~ follow();
spork ~ crushLoop();
spork ~ onGate();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(slot_meter.last()) => float s;
    if (s > slot_meter_p) s => slot_meter_p; else slot_meter_p * d => slot_meter_p;
    1::samp => now;
  }
}

fun void crushLoop() {
  while (true) {
    crushIn.last() => float x;
    1.0 + slot_drive * (0.5 + slot_accent * 0.5) * 5.0 => float g;
    x * g => x;
    if (x > 1.0) 1.0 => x;
    if (x < -1.0) -1.0 => x;
    x => crushOut.next;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    slot_amp * (0.65 + 0.35 * slot_accent) => out.gain;
    slot_formant => form.freq;
    slot_cutoff => lpf.freq;
    1.0 + slot_drive * 4.0 => fold.gain;
    slot_rel::ms => dur r;
    env.set(8::ms, 400::ms, 0.8, r);
    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    slot_gate => now;
    spork ~ hit();
  }
}

fun void hit() {
  if (!sampleOk) {
    return;
  }
  Math.max(0.0, Math.min(1.0, slot_chop)) => float chop;
  Std.ftoi(chop * (buf.samples() - 1)) => int startPos;
  startPos => buf.pos;
  1.0 => buf.rate;

  env.keyOn();
  ((buf.samples() - startPos) $ float)::samp => now;
  env.keyOff();
  slot_rel::ms => now;
  0 => buf.pos;
}
