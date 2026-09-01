// voices/doom-vox.ck — doom / darkwave voice into rackBus.
// Samples: voices/samples/*.wav — list filenames in dv_sampleNames[] below.
// Generate: ChucK: Generate Voice Sample → save into samples/ → add name to array → dv_sample knob (no new shred).
// Reload shred only after editing the array or regenerating a file in use.
//
// Load: oscillators/master.ck → doom-vox.ck → fx/cyber-fx.ck (or dac-out / bus-fx)
//
// Modes (dv_mode):
//   0 = FFT vocoder (voice modulates saw/pulse carriers at dv_noteHz)
//   1 = pitched sample + synth layer (rate tracks note / root)
//   2 = phrase one-shot (chop start; synth as low drone)
//
// Sequencer: dv_noteHz, dv_accent, dv_chop — all gate=dv_gate

global Gain rackBus;
global Gain dv_meter;
global float dv_meter_p;
0.0 => dv_meter_p;

// ---- sequencer ----
// @seq mode=midi min=28 max=72 step=1 default=40 gate=dv_gate
global float dv_noteHz;
// @seq mode=raw min=0 max=1 step=0.01 default=0.55 gate=dv_gate
global float dv_accent;
// @seq mode=raw min=0 max=1 step=0.01 default=0 gate=dv_gate
global float dv_chop;
// @knob min=0.05 max=1 step=0.01 default=0.45
global float dv_chopEnd;
// @seqGate
global Event dv_gate;

global float live_stepDur;
0.125 => live_stepDur;

global int live_step;

global int live_running;

// ---- mode / sample ----
// WAV bank — add a filename after each Generate Voice Sample (same folder).
["doom-vox.wav", "cyber.wav"] @=> string dv_sampleNames[];
// @knob min=0 max=1 step=1 default=1
global float dv_sample;           // pick active WAV (live — no shred reload)
// @knob min=0 max=2 step=1 default=2
global float dv_mode;             // 0 vocoder | 1 pitched | 2 oneshot
// @knob min=40 max=220 step=1 default=82
global float dv_root;             // reference Hz for pitched rate
// @knob min=0 max=1 step=1 default=1
global float dv_loop;             // 1 = loop sample while playing (modes 0/1)

// ---- amp / mix ----
// @knob min=0 max=0.85 step=0.01 default=0.42
global float dv_amp;
// @knob min=0 max=1 step=0.01 default=0.55
global float dv_synth;            // carrier / parallel synth amount
// @knob min=0 max=1 step=0.01 default=0.35
global float dv_sub;

// ---- darkwave tone ----
// @knob min=0 max=1 step=0.01 default=0.55
global float dv_drive;
// @slider min=400 max=2800 step=10 default=1100
global float dv_formant;
// @knob min=0.5 max=8 step=0.1 default=3.2
global float dv_formQ;
// @slider min=200 max=6000 step=10 default=1600
global float dv_cutoff;
// @knob min=1 max=14 step=0.1 default=4.5
global float dv_res;
// @knob min=40 max=400 step=5 default=90
global float dv_hp;
// @knob min=0 max=1 step=0.01 default=0.25
global float dv_crush;
// @knob min=1 max=32 step=1 default=8
global float dv_hold;

// ---- envelope ----
// @knob min=1 max=120 step=1 default=12
global float dv_atk;
// @knob min=80 max=8000 step=5 default=2000
global float dv_dec;              // sustain hold floor (ms); oneshot also waits for sample end
// @knob min=0 max=1 step=0.01 default=0.85
global float dv_sus;
// @knob min=80 max=4000 step=5 default=400
global float dv_rel;

2.0 => dv_mode;                   // default oneshot; switch to 0/1 after TTS
1.0 => dv_sample;
82.0 => dv_root;
1.0 => dv_loop;
0.42 => dv_amp;
0.55 => dv_synth;
0.35 => dv_sub;
0.55 => dv_drive;
1100.0 => dv_formant;
3.2 => dv_formQ;
1600.0 => dv_cutoff;
4.5 => dv_res;
90.0 => dv_hp;
0.25 => dv_crush;
8.0 => dv_hold;
12.0 => dv_atk;
2000.0 => dv_dec;
0.85 => dv_sus;
400.0 => dv_rel;
82.41 => dv_noteHz;
0.55 => dv_accent;
0.0 => dv_chop;
0.45 => dv_chopEnd;

int sampleOk;
0 => sampleOk;
int lastSampleIdx;
-1 => lastSampleIdx;

// ---- sample ----
SndBuf buf;

fun int loadSampleIdx(int idx) {
  if (idx < 0 || idx >= dv_sampleNames.size()) {
    0 => sampleOk;
    return 0;
  }
  dv_sampleNames[idx] => string name;
  if (name == "") {
    <<< "doom-vox: empty sample slot", idx >>>;
    0 => sampleOk;
    return 0;
  }
  me.dir() + "samples/" + name => string samplePath;
  samplePath => buf.read;
  if (buf.samples() > 0) {
    1 => sampleOk;
    0 => buf.pos;
    0 => buf.loop;
    0.0 => buf.rate;
    <<< "doom-vox: loaded", samplePath, "frames", buf.samples() >>>;
    return 1;
  }
  <<< "doom-vox: missing", samplePath, "— Generate Voice Sample or check dv_sampleNames" >>>;
  0 => sampleOk;
  return 0;
}

Std.ftoi(dv_sample) => int initIdx;
loadSampleIdx(initIdx);
initIdx => lastSampleIdx;

// ---- carriers ----
SawOsc saw => Gain carMix;
PulseOsc pulse => carMix;
SinOsc sub => carMix;
0.45 => pulse.width;
0.5 => saw.gain;
0.35 => pulse.gain;
0.4 => sub.gain;

// ---- mode gains into FX ----
Gain fxIn;
Gain vocG => fxIn;
Gain sampG => fxIn;
Gain synG => fxIn;

// sample → pitched / oneshot path (+ vocoder modulator)
buf => Gain srcMute;
srcMute => sampG;
srcMute => FFT fftMod => blackhole;
0.0 => srcMute.gain;
// carriers → parallel synth
carMix => synG;
carMix => FFT fftCar => blackhole;
IFFT ifft => vocG;

1024 => int FFT_SIZE;
FFT_SIZE => fftMod.size;
FFT_SIZE => fftCar.size;
FFT_SIZE / 4 => int HOP_SIZE;
Windowing.hann(FFT_SIZE) => fftMod.window;
Windowing.hann(FFT_SIZE) => fftCar.window;
Windowing.hann(FFT_SIZE) => ifft.window;
complex Z[FFT_SIZE / 2];

0.0 => vocG.gain;
0.0 => sampG.gain;
0.0 => synG.gain;

// ---- shared darkwave FX ----
fxIn => HPF hp => Gain fold => BPF form => LPF lpf1 => LPF lpf2 => Gain crushIn => blackhole;
90.0 => hp.freq;
1.2 => hp.Q;
1100.0 => form.freq;
3.2 => form.Q;
1600.0 => lpf1.freq;
1600.0 => lpf2.freq;
4.5 => lpf1.Q;
4.5 => lpf2.Q;

Step crushOut;
Gain lev;
crushOut => lev => ADSR env => Gain out => dv_meter => rackBus;
env.set(12::ms, 520::ms, 0.45, 700::ms);
1.0 => out.gain;
0.0 => lev.gain;
0.0 => crushOut.next;

int gated;
0 => gated;
int playing;
int pending;
int abortNow;
int voiceLinked;
0 => playing;
0 => pending;
0 => abortNow;
0 => voiceLinked;
float playRate;
1.0 => playRate;

spork ~ follow();
spork ~ crushLoop();
spork ~ vocoderLoop();
spork ~ onGate();
spork ~ transportWatch();
spork ~ barWatch();
spork ~ _ckLivePeak();
1 => voiceLinked;
while (true) 20::ms => now;

fun int voiceSilent() {
  return (!gated && !playing && env.value() < 0.001);
}

fun void voiceUnlink() {
  if (voiceLinked) {
    out =< dv_meter;
    fxIn =< blackhole;
    carMix =< synG;
    carMix =< fftCar;
    srcMute =< fftMod;
    buf =< srcMute;
    0 => voiceLinked;
  }
}

fun void voiceLink() {
  if (!voiceLinked) {
    buf => srcMute;
    srcMute => fftMod => blackhole;
    carMix => synG;
    carMix => fftCar => blackhole;
    fxIn => blackhole;
    out => dv_meter;
    1 => voiceLinked;
  }
}

fun void _ckLivePeak() {
  Math.pow(0.001, 1.0 / (0.05 * 40.0)) => float d;
  while (true) {
    Math.fabs(dv_meter.last()) => float s;
    if (s > dv_meter_p) s => dv_meter_p; else dv_meter_p * d => dv_meter_p;
    25::ms => now;
  }
}

fun void crushLoop() {
  int holdLeft;
  0 => holdLeft;
  float held;
  0.0 => held;
  while (true) {
    if (voiceSilent()) {
      0.0 => crushOut.next;
      25::ms => now;
      continue;
    }
    crushIn.last() => float x;
    1.0 + dv_drive * (0.5 + dv_accent * 0.5) * 6.0 => float driveAmt;
    x * driveAmt => x;
    if (x > 1.0) 1.0 => x;
    if (x < -1.0) -1.0 => x;

    Std.ftoi(Math.max(1.0, dv_hold)) => int h;
    if (holdLeft <= 0) {
      h => holdLeft;
      x => held;
    }
    holdLeft - 1 => holdLeft;

    Math.max(1.0, 12.0 - dv_crush * 10.0) => float bits;
    Math.pow(2.0, bits - 1.0) => float levels;
    Math.round(held * levels) / levels => float y;
    (1.0 - dv_crush * 0.35) * y => crushOut.next;
    1::samp => now;
  }
}

fun void vocoderLoop() {
  while (true) {
    if (voiceSilent()) {
      25::ms => now;
      continue;
    }
    if (sampleOk && Std.ftoi(dv_mode) == 0) {
      fftMod.upchuck();
      fftCar.upchuck();
      for (0 => int i; i < Z.size(); i++) {
        (fftMod.cval(i) $ polar).mag * fftCar.cval(i) => Z[i];
      }
      ifft.transform(Z);
    }
    HOP_SIZE::samp => now;
  }
}

fun void setCarriers(float hz) {
  Math.max(20.0, hz) => float f;
  f => saw.freq;
  f => pulse.freq;
  f * 0.5 => sub.freq;
}

fun void applyModeGains() {
  Std.ftoi(dv_mode) => int m;
  dv_amp * (0.65 + 0.35 * dv_accent) => float levAmt;
  levAmt => lev.gain;

  if (m == 0) {
    // vocoder wet + a little carrier bleed
    0.85 * levAmt / Math.max(0.05, dv_amp) => vocG.gain;
    0.0 => sampG.gain;
    dv_synth * 0.12 => synG.gain;
  } else if (m == 1) {
    0.0 => vocG.gain;
    0.7 => sampG.gain;
    dv_synth * 0.55 => synG.gain;
  } else {
    0.0 => vocG.gain;
    0.85 => sampG.gain;
    dv_synth * dv_sub * 0.25 => synG.gain;
  }
}

fun void silence() {
  0.0 => srcMute.gain;
  0.0 => buf.rate;
  env.keyOff();
  0.0 => lev.gain;
  0 => gated;
  0.0 => vocG.gain;
  0.0 => sampG.gain;
  0.0 => synG.gain;
  0 => buf.pos;
  0.0 => crushOut.next;
  voiceUnlink();
}

fun void follow() {
  while (true) {
    if (voiceSilent()) {
      voiceUnlink();
      0.0 => crushOut.next;
      25::ms => now;
      continue;
    }
    voiceLink();
    Std.ftoi(dv_sample) => int si;
    if (si != lastSampleIdx) {
      loadSampleIdx(si);
      si => lastSampleIdx;
    }

    Std.ftoi(dv_mode) => int m;
    dv_noteHz => float hz;
    setCarriers(hz);

    dv_hp => hp.freq;
    dv_formant => form.freq;
    dv_formQ => form.Q;
    dv_cutoff => lpf1.freq;
    dv_cutoff => lpf2.freq;
    dv_res => lpf1.Q;
    dv_res => lpf2.Q;
    1.0 + dv_drive * 5.0 => fold.gain;

    dv_atk::ms => dur a;
    dv_dec::ms => dur d;
    dv_rel::ms => dur r;
    env.set(a, d, dv_sus, r);

    dv_sub * 0.55 => sub.gain;
    (1.0 - dv_synth * 0.35) * 0.55 => saw.gain;
    dv_synth * 0.4 => pulse.gain;

    if (sampleOk && (playing || gated)) {
      if (m == 1) {
        Math.max(20.0, dv_root) => float root;
        (hz / root) => playRate;
        playRate => buf.rate;
        Std.ftoi(dv_loop) => buf.loop;
      } else if (m == 0) {
        1.0 => playRate;
        1.0 => buf.rate;
        Std.ftoi(dv_loop) => buf.loop;
      } else {
        Math.max(20.0, dv_root) => float root;
        Math.pow(hz / root, 0.35) => playRate;
        playRate => buf.rate;
        0 => buf.loop;
      }
    } else {
      0.0 => buf.rate;
      0.0 => srcMute.gain;
    }

    if (gated) {
      applyModeGains();
    }

    5::ms => now;
  }
}

fun void waitAbortable(dur remain) {
  while (remain > 10::ms) {
    if (abortNow) {
      return;
    }
    10::ms => now;
    remain - 10::ms => remain;
  }
  if (!abortNow && remain > 0::samp) {
    remain => now;
  }
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

fun void onGate() {
  float lastTrig;
  -1.0 => lastTrig;
  while (true) {
    dv_gate => now;
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

fun void hit() {
  if (!sampleOk) {
    0 => playing;
    return;
  }
  voiceLink();
  0 => abortNow;
  while (true) {
    if (abortNow) {
      break;
    }
    Std.ftoi(dv_mode) => int m;
    buf.samples() => int total;
    Math.max(0.0, Math.min(1.0, dv_chop)) => float startF;
    Math.max(0.05, Math.min(1.0, dv_chopEnd)) => float endF;
    if (endF <= startF) {
      Math.min(1.0, startF + 0.05) => endF;
    }
    Std.ftoi(startF * (total - 1)) => int startPos;
    Std.ftoi(endF * (total - 1)) => int stopPos;
    if (stopPos <= startPos) {
      startPos + 1 => stopPos;
    }
    startPos => buf.pos;

    float rateNow;
    1.0 => rateNow;
    if (m == 1) {
      Math.max(20.0, dv_root) => float root;
      dv_noteHz / root => rateNow;
    } else if (m == 2) {
      Math.max(20.0, dv_root) => float root;
      Math.pow(dv_noteHz / root, 0.35) => rateNow;
    }
    Math.max(0.05, Math.fabs(rateNow)) => rateNow;
    rateNow => buf.rate;
    rateNow => playRate;

    1.0 => srcMute.gain;
    1 => gated;
    applyModeGains();
    env.keyOn();

    if (m == 2 || (m == 1 && Std.ftoi(dv_loop) == 0)) {
      if (total > 1 && stopPos > startPos) {
        ((stopPos - startPos) $ float) / Math.max(0.05, Math.fabs(rateNow)) => float frames;
        frames::samp => dur playLen;
        waitAbortable(playLen);
        0.0 => buf.rate;
        0 => buf.pos;
        0.0 => srcMute.gain;
      } else {
        waitAbortable((dv_atk + dv_dec)::ms);
      }
    } else {
      Math.max(live_stepDur * 0.85, (dv_atk + dv_dec) * 0.001)::second => dur hold;
      waitAbortable(hold);
    }

    env.keyOff();
    if (!abortNow) {
      dv_rel::ms => now;
    }
    0 => gated;
    0.0 => vocG.gain;
    0.0 => sampG.gain;
    0.0 => synG.gain;
    0.0 => lev.gain;

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
