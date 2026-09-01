// drums/cyber/snare-digital.ck — digital clap + snap into rackBus.
// Load master first; sequence cy_snare.

global Gain rackBus;
global Gain cy_snare_meter;
global float cy_snare_meter_p;
0.0 => cy_snare_meter_p;

// @seqGate
global Event cy_snare;

// @knob min=0 max=0.7 step=0.01 default=0.38
global float cy_snare_amp;
// @knob min=20 max=180 step=5 default=70
global float cy_snare_dec;
// @slider min=400 max=6000 step=20 default=2200
global float cy_snare_snap;
// @knob min=0 max=1 step=0.01 default=0.65
global float cy_snare_tight;
// @knob min=200 max=800 step=5 default=350
global float cy_snare_hp;

0.38 => cy_snare_amp;
70.0 => cy_snare_dec;
2200.0 => cy_snare_snap;
0.65 => cy_snare_tight;
350.0 => cy_snare_hp;

Noise n1 => BPF bp => Gain clapG => Gain mix;
Noise n2 => bp;
Noise n3 => bp;
SinOsc snap => ADSR snapEnv => Gain snapG => mix;
mix => HPF hp => Gain g => cy_snare_meter => rackBus;

bp.set(2200, 1.8);
snapEnv.set(0.5::ms, 25::ms, 0.0, 20::ms);
350 => hp.freq;
1.0 => hp.Q;
1000.0 => snap.freq;
0.0 => g.gain;
0.0 => clapG.gain;
0.35 => snapG.gain;

spork ~ onSnare();
spork ~ follow();
spork ~ _ckLivePeak();
while (true) 20::ms => now;

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(cy_snare_meter.last()) => float s;
    if (s > cy_snare_meter_p) s => cy_snare_meter_p; else cy_snare_meter_p * d => cy_snare_meter_p;
    25::ms => now;
  }
}

fun void follow() {
  while (true) {
    cy_snare_amp => g.gain;
    cy_snare_snap => bp.freq;
    cy_snare_hp => hp.freq;
    cy_snare_dec::ms => dur d;
    snapEnv.set(0.5::ms, d * 0.35, 0.0, 20::ms);
    5::ms => now;
  }
}

fun void onSnare() {
  while (true) {
    cy_snare => now;
    spork ~ clapHit();
  }
}

fun void clapHit() {
  0 => int spread;
  if (cy_snare_tight < 0.35) 5 => spread;
  else if (cy_snare_tight < 0.7) 3 => spread;
  else 2 => spread;

  spork ~ tap(0);
  spork ~ tap(spread);
  spork ~ tap(spread * 2);

  snapEnv.keyOn();
  cy_snare_dec::ms => now;
  snapEnv.keyOff();
}

fun void tap(int delayMs) {
  delayMs::ms => now;
  0.5 => clapG.gain;
  8::ms => now;
  0.0 => clapG.gain;
}
