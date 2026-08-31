// voices/slots/doom-cyber.ck — slot wrapper: cyber phrase (copy doom-vox-slot.ck to add more)
// Sequencer: cy_gate (+ cy_accent / cy_chop optional)

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

// @knob min=0 max=0.85 step=0.01 default=0.42
global float cy_amp;
// @knob min=0 max=1 step=0.01 default=0.5
global float cy_drive;
// @slider min=400 max=2800 step=10 default=1100
global float cy_formant;
// @slider min=200 max=5000 step=10 default=1400
global float cy_cutoff;
// @knob min=80 max=3000 step=5 default=400
global float cy_rel;

0.42 => cy_amp;
0.5 => cy_drive;
1100.0 => cy_formant;
1400.0 => cy_cutoff;
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
  1.0 => buf.rate;
  <<< "cy-vox: loaded", cy_path, "frames", buf.samples() >>>;
} else {
  <<< "cy-vox: missing", cy_path >>>;
}

buf => HPF hp => Gain fold => BPF form => LPF lpf => Gain crushIn => blackhole;
90 => hp.freq;
1100 => form.freq;
3.2 => form.Q;
1400 => lpf.freq;
4.5 => lpf.Q;

Step crushOut;
crushOut => ADSR env => Gain out => cy_meter => rackBus;
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
    Math.fabs(cy_meter.last()) => float s;
    if (s > cy_meter_p) s => cy_meter_p; else cy_meter_p * d => cy_meter_p;
    1::samp => now;
  }
}

fun void crushLoop() {
  while (true) {
    crushIn.last() => float x;
    1.0 + cy_drive * (0.5 + cy_accent * 0.5) * 5.0 => float g;
    x * g => x;
    if (x > 1.0) 1.0 => x;
    if (x < -1.0) -1.0 => x;
    x => crushOut.next;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    cy_amp * (0.65 + 0.35 * cy_accent) => out.gain;
    cy_formant => form.freq;
    cy_cutoff => lpf.freq;
    1.0 + cy_drive * 4.0 => fold.gain;
    cy_rel::ms => dur r;
    env.set(8::ms, 400::ms, 0.8, r);
    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    cy_gate => now;
    spork ~ hit();
  }
}

fun void hit() {
  if (!sampleOk) {
    return;
  }
  Math.max(0.0, Math.min(1.0, cy_chop)) => float chop;
  Std.ftoi(chop * (buf.samples() - 1)) => int startPos;
  startPos => buf.pos;
  1.0 => buf.rate;

  env.keyOn();
  ((buf.samples() - startPos) $ float)::samp => now;
  env.keyOff();
  cy_rel::ms => now;
  0 => buf.pos;
}
