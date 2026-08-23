// Reference stub — ChucK Live regenerates a temp meter.ck on Start VM.
// Taps dac L/R peaks and sends OSC /chuck/vu (two floats) to the extension.
//
// Default meter port: 9001 (setting chuckLive.meterPort)
// Address: /chuck/vu ,ff

0.0 => float peakL;
0.0 => float peakR;
Math.pow(0.001, 1.0 / (0.05 * 44100.0)) => float decay;

fun void trackL() {
  while (true) {
    Math.fabs(dac.chan(0).last()) => float s;
    if (s > peakL) s => peakL; else peakL * decay => peakL;
    1::samp => now;
  }
}

fun void trackR() {
  while (true) {
    Math.fabs(dac.chan(1).last()) => float s;
    if (s > peakR) s => peakR; else peakR * decay => peakR;
    1::samp => now;
  }
}

spork ~ trackL();
spork ~ trackR();

OscOut xmit;
xmit.dest("127.0.0.1", 9001);

while (true) {
  xmit.start("/chuck/vu");
  xmit.add(peakL);
  xmit.add(peakR);
  xmit.send();
  25::ms => now;
}
