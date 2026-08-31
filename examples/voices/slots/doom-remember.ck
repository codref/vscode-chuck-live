// voices/slots/doom-remember.ck — slot wrapper: doom-vox.wav phrase
// Sequencer: rm_gate

global Gain rackBus;
global Gain rm_meter;
global float rm_meter_p;
0.0 => rm_meter_p;

// @seqGate
global Event rm_gate;
// @seq mode=raw min=0 max=1 step=0.01 default=0.6 gate=rm_gate
global float rm_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=rm_gate
global float rm_chop;

// @knob min=0 max=0.85 step=0.01 default=0.4
global float rm_amp;
// @knob min=0 max=1 step=0.01 default=0.45
global float rm_drive;
// @slider min=400 max=2800 step=10 default=900
global float rm_formant;
// @slider min=200 max=5000 step=10 default=1200
global float rm_cutoff;
// @knob min=80 max=3000 step=5 default=500
global float rm_rel;

0.4 => rm_amp;
0.45 => rm_drive;
900.0 => rm_formant;
1200.0 => rm_cutoff;
500.0 => rm_rel;

"doom-vox.wav" => string rm_sample;
int sampleOk;
0 => sampleOk;

SndBuf buf;
me.dir() + "../samples/" + rm_sample => string rm_path;
rm_path => buf.read;
if (buf.samples() > 0) {
  1 => sampleOk;
  0 => buf.pos;
  0 => buf.loop;
  1.0 => buf.rate;
  <<< "rm-vox: loaded", rm_path, "frames", buf.samples() >>>;
} else {
  <<< "rm-vox: missing", rm_path >>>;
}

buf => HPF hp => Gain fold => BPF form => LPF lpf => Gain crushIn => blackhole;
90 => hp.freq;
900 => form.freq;
3.2 => form.Q;
1200 => lpf.freq;
4.5 => lpf.Q;

Step crushOut;
crushOut => ADSR env => Gain out => rm_meter => rackBus;
env.set(8::ms, 400::ms, 0.8, 500::ms);
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
    Math.fabs(rm_meter.last()) => float s;
    if (s > rm_meter_p) s => rm_meter_p; else rm_meter_p * d => rm_meter_p;
    1::samp => now;
  }
}

fun void crushLoop() {
  while (true) {
    crushIn.last() => float x;
    1.0 + rm_drive * (0.5 + rm_accent * 0.5) * 5.0 => float g;
    x * g => x;
    if (x > 1.0) 1.0 => x;
    if (x < -1.0) -1.0 => x;
    x => crushOut.next;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    rm_amp * (0.65 + 0.35 * rm_accent) => out.gain;
    rm_formant => form.freq;
    rm_cutoff => lpf.freq;
    1.0 + rm_drive * 4.0 => fold.gain;
    rm_rel::ms => dur r;
    env.set(8::ms, 400::ms, 0.8, r);
    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    rm_gate => now;
    spork ~ hit();
  }
}

fun void hit() {
  if (!sampleOk) {
    return;
  }
  Math.max(0.0, Math.min(1.0, rm_chop)) => float chop;
  Std.ftoi(chop * (buf.samples() - 1)) => int startPos;
  startPos => buf.pos;
  1.0 => buf.rate;

  env.keyOn();
  ((buf.samples() - startPos) $ float)::samp => now;
  env.keyOff();
  rm_rel::ms => now;
  0 => buf.pos;
}
