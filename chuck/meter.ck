// Reference stub — ChucK Live regenerates a temp meter.ck on Start VM
// and whenever the shred list changes (meterGen.ts → chuck-live-meter.ck).
//
// Role: send level data back to the extension for Rack VU LEDs.
//   • Master VU: dac L/R peak → first two floats of OSC /chuck/vu
//   • Module LEDs: each bus .ck should declare a meter tap (see examples).
//
// Module pattern (copy into your patch):
//   global Gain sine_meter;
//   global float sine_meter_p;
//   … audio … => sine_meter => rackBus;
//   spork ~ _ckLivePeak();   // writes sine_meter_p from sine_meter.last()
//
// Extra /chuck/vu floats after L/R are those peak globals, rack order = shred order.
// Default meter port: 9001 (setting chuckLive.meterPort)

0.0 => float peakL;           // left master peak (not a global — local to this shred)
0.0 => float peakR;           // right master peak
// Exponential decay coefficient — ~50 ms release at 44.1 kHz
Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float decay;

fun void trackL() {
  while (true) {
    Math.fabs(dac.chan(0).last()) => float s;   // sample at built-in dac output
    if (s > peakL) s => peakL; else peakL * decay => peakL;   // peak hold + fall
    1::samp => now;                             // per-sample tracking
  }
}

fun void trackR() {
  while (true) {
    Math.fabs(dac.chan(1).last()) => float s;
    if (s > peakR) s => peakR; else peakR * decay => peakR;
    1::samp => now;
  }
}

spork ~ trackL();               // parallel peak followers for L and R
spork ~ trackR();

OscOut xmit;                    // outbound OSC to the extension UI
xmit.dest("127.0.0.1", 9001);   // chuckLive.meterPort

while (true) {
  xmit.start("/chuck/vu");      // bundle: [peakL, peakR, …module peaks from globals]
  xmit.add(peakL);
  xmit.add(peakR);
  // Generated meter.ck adds xmit.add(sine_meter_p) etc. for each loaded module.
  xmit.send();
  25::ms => now;                // ~40 Hz UI refresh — smooth enough, light on CPU
}
