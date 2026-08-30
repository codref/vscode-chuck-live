// voices/modem.ck — dial-up / DTMF / FSK texture into rackBus.
// Load order: master.ck → modem.ck → cyber-fx.ck
//
// Sequencer: md_gate, md_digit (0–15 DTMF index)

global Gain rackBus;
global Gain md_meter;
global float md_meter_p;
0.0 => md_meter_p;

// @seqGate
global Event md_gate;
// @seq mode=raw min=0 max=15 step=1 default=0 gate=md_gate
global float md_digit;

// @button
global Event md_connect;

// @knob min=0 max=0.6 step=0.01 default=0.28
global float md_level;
// @knob min=0 max=1 step=0.01 default=0.5
global float md_dtmf;
// @knob min=0 max=1 step=0.01 default=0.45
global float md_fsk;
// @knob min=0 max=1 step=0.01 default=0.35
global float md_noise;
// @knob min=5 max=120 step=1 default=22
global float md_baud;
// @knob min=800 max=6000 step=20 default=2800
global float md_bpf;
// @knob min=0 max=0.5 step=0.01 default=0.15
global float md_tone;
// @slider min=800 max=4000 step=10 default=2200
global float md_tele;
// @knob min=0.5 max=6 step=0.1 default=2.2
global float md_teleQ;
// @slider min=2000 max=12000 step=50 default=6500
global float md_hiss;

// @modSource label=FSK bipolar=0
global float md_fskOut;

0.28 => md_level;
0.5 => md_dtmf;
0.45 => md_fsk;
0.35 => md_noise;
22.0 => md_baud;
2800.0 => md_bpf;
0.15 => md_tone;
2200.0 => md_tele;
2.2 => md_teleQ;
6500.0 => md_hiss;
0.0 => md_fskOut;

SinOsc dtmfA => Gain dtmfG => Gain md_mix;
SinOsc dtmfB => dtmfG;
SinOsc dialA => Gain toneG => md_mix;
SinOsc dialB => toneG;
SinOsc fskOsc => Gain fskG => md_mix;
Noise scramble => BPF scrambleBp => Gain noiseG => md_mix;
PulseOsc data => BPF dataBp => Gain dataG => md_mix;

md_mix => HPF rumble => BPF telecom => LPF hiss => Gain out => md_meter => rackBus;

180 => rumble.freq;
1.0 => rumble.Q;
2200 => telecom.freq;
2.2 => telecom.Q;
6500 => hiss.freq;
1.0 => hiss.Q;
2800 => scrambleBp.freq;
2.5 => scrambleBp.Q;
1800 => dataBp.freq;
2.0 => dataBp.Q;

350.0 => dialA.freq;
440.0 => dialB.freq;
1070.0 => fskOsc.freq;
0.35 => data.width;

0.0 => out.gain;
0.0 => dtmfG.gain;
0.0 => toneG.gain;
0.0 => fskG.gain;
0.0 => noiseG.gain;
0.0 => dataG.gain;

// DTMF row/col frequencies (Hz)
[697.0, 770.0, 852.0, 941.0] @=> float dtmfRow[];
[1209.0, 1336.0, 1477.0, 1633.0] @=> float dtmfCol[];

spork ~ follow();
spork ~ onGate();
spork ~ onConnect();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float d;
  while (true) {
    Math.fabs(md_meter.last()) => float s;
    if (s > md_meter_p) s => md_meter_p; else md_meter_p * d => md_meter_p;
    1::samp => now;
  }
}

fun void follow() {
  while (true) {
    md_level => out.gain;
    md_dtmf * 0.4 => dtmfG.gain;
    md_tone * 0.25 => toneG.gain;
    md_fsk * 0.35 => fskG.gain;
    md_noise * 0.3 => noiseG.gain;
    md_tele => telecom.freq;
    md_teleQ => telecom.Q;
    md_hiss => hiss.freq;
    md_bpf => scrambleBp.freq;
    5::ms => now;
  }
}

fun void onGate() {
  while (true) {
    md_gate => now;
    spork ~ modemBurst();
  }
}

fun void onConnect() {
  while (true) {
    md_connect => now;
    spork ~ connectSequence();
  }
}

fun void playDigit(int d) {
  d % 16 => int idx;
  idx / 4 => int row;
  idx % 4 => int col;
  dtmfRow[row] => dtmfA.freq;
  dtmfCol[col] => dtmfB.freq;
  md_dtmf * 0.5 => dtmfG.gain;
  120::ms => now;
  0.0 => dtmfG.gain;
}

fun void modemBurst() {
  Std.ftoi(md_digit) => int d;
  playDigit(d);
  spork ~ fskBurst(400);
  spork ~ scrambleHit();
}

fun void fskBurst(int durMs) {
  md_fsk * 0.4 => fskG.gain;
  0 => int bit;
  1070.0 => float mark;
  1270.0 => float space;
  (1000.0 / Math.max(5.0, md_baud))::ms => dur bitDur;
  durMs::ms => dur total;
  now + total => time end;
  while (now < end) {
    if (bit) mark => fskOsc.freq; else space => fskOsc.freq;
    bit => md_fskOut;
    1 - bit => bit;
    bitDur => now;
  }
  0.0 => fskG.gain;
  0.0 => md_fskOut;
}

fun void scrambleHit() {
  Math.random2f(md_bpf * 0.7, md_bpf * 1.3) => scrambleBp.freq;
  md_noise * 0.45 => noiseG.gain;
  Math.random2f(40.0, 120.0)::ms => now;
  0.0 => noiseG.gain;
}

fun void connectSequence() {
  md_tone * 0.35 => toneG.gain;
  800::ms => now;
  spork ~ fskBurst(1200);
  400::ms => now;
  spork ~ scrambleHit();
  scrambleHit();
  200::ms => now;
  0.0 => toneG.gain;
}
