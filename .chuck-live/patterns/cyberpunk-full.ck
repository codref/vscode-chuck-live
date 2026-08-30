// @chuckLivePattern version=1 name=cyberpunk-full bpm=118 scale=phrygian
// ChucK Live pattern — editable step arrays below

global float live_bpm;
global int live_step;
global float live_stepDur;
global Event live_tick;
global int live_running;
global int live_cmd;
global int live_swing;

global Event cy_kick;
global Event cy_hat;
global Event cy_snare;
global Event cy_glitch;
global Event dk_bass;
global float ab_noteHz;
global Event ab_gate;
global float ab_accent;
global Event md_gate;
global float md_digit;

118 => live_bpm;
0 => live_step;
(60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur;
1 => live_running;
0 => live_swing;
9 => int nTracks;

// track 0: cy_kick (gate)
[1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0] @=> int t0_g[];
[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] @=> float t0_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t0_p[];
0.000000 => float t0_swing;
0 => int t0_muted;
0 => int t0_solo;
1 => int t0_run;

// track 1: cy_hat (gate)
[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] @=> int t1_g[];
[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] @=> float t1_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t1_p[];
0.000000 => float t1_swing;
0 => int t1_muted;
0 => int t1_solo;
1 => int t1_run;

// track 2: cy_snare (gate)
[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] @=> int t2_g[];
[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] @=> float t2_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t2_p[];
0.000000 => float t2_swing;
0 => int t2_muted;
0 => int t2_solo;
1 => int t2_run;

// track 3: cy_glitch (gate)
[0,0,1,0,0,0,0,1,0,0,1,0,0,1,0,0] @=> int t3_g[];
[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] @=> float t3_v[];
[1.000000,1.000000,0.700000,1.000000,1.000000,1.000000,0.700000,1.000000,1.000000,1.000000,0.700000,1.000000,1.000000,0.700000,1.000000,1.000000] @=> float t3_p[];
0.000000 => float t3_swing;
0 => int t3_muted;
0 => int t3_solo;
1 => int t3_run;

// track 4: dk_bass (gate)
[1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0] @=> int t4_g[];
[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] @=> float t4_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t4_p[];
0.000000 => float t4_swing;
0 => int t4_muted;
0 => int t4_solo;
1 => int t4_run;

// track 5: ab_noteHz (float) gate=ab_gate
[1,1,1,0,1,1,1,0,1,1,1,1,1,1,1,1] @=> int t5_g[];
[82.406889,97.998859,82.406889,0.000000,110.000000,97.998859,82.406889,0.000000,123.470825,110.000000,97.998859,82.406889,130.812783,123.470825,97.998859,82.406889] @=> float t5_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t5_p[];
0.000000 => float t5_swing;
0 => int t5_muted;
0 => int t5_solo;
1 => int t5_run;

// track 6: ab_accent (float) gate=ab_gate
[1,1,1,0,1,1,1,0,1,1,1,1,1,1,1,1] @=> int t6_g[];
[1.000000,0.000000,0.700000,0.000000,1.000000,0.000000,0.500000,0.000000,1.000000,0.000000,0.600000,0.000000,1.000000,0.000000,0.800000,0.500000] @=> float t6_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t6_p[];
0.000000 => float t6_swing;
0 => int t6_muted;
0 => int t6_solo;
1 => int t6_run;

// track 7: md_gate (gate)
[1,0,0,1,0,1,0,0,1,1,0,1,0,0,1,0] @=> int t7_g[];
[0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] @=> float t7_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t7_p[];
0.000000 => float t7_swing;
0 => int t7_muted;
0 => int t7_solo;
1 => int t7_run;

// track 8: md_digit (float) gate=md_gate
[1,0,0,1,0,1,0,0,1,1,0,1,0,0,1,0] @=> int t8_g[];
[0.000000,0.000000,0.000000,1.000000,0.000000,2.000000,0.000000,0.000000,3.000000,4.000000,0.000000,5.000000,0.000000,0.000000,6.000000,0.000000] @=> float t8_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t8_p[];
0.000000 => float t8_swing;
0 => int t8_muted;
0 => int t8_solo;
1 => int t8_run;

fun void updateDur() { (60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur; }
fun int anySolo() { return 0; }
fun int trackAudible(int i) {
  if (i == 0) { if (!t0_run) return 0; if (t0_muted) return 0; if (anySolo() && !t0_solo) return 0; return 1; }
  if (i == 1) { if (!t1_run) return 0; if (t1_muted) return 0; if (anySolo() && !t1_solo) return 0; return 1; }
  if (i == 2) { if (!t2_run) return 0; if (t2_muted) return 0; if (anySolo() && !t2_solo) return 0; return 1; }
  if (i == 3) { if (!t3_run) return 0; if (t3_muted) return 0; if (anySolo() && !t3_solo) return 0; return 1; }
  if (i == 4) { if (!t4_run) return 0; if (t4_muted) return 0; if (anySolo() && !t4_solo) return 0; return 1; }
  if (i == 5) { if (!t5_run) return 0; if (t5_muted) return 0; if (anySolo() && !t5_solo) return 0; return 1; }
  if (i == 6) { if (!t6_run) return 0; if (t6_muted) return 0; if (anySolo() && !t6_solo) return 0; return 1; }
  if (i == 7) { if (!t7_run) return 0; if (t7_muted) return 0; if (anySolo() && !t7_solo) return 0; return 1; }
  if (i == 8) { if (!t8_run) return 0; if (t8_muted) return 0; if (anySolo() && !t8_solo) return 0; return 1; }
  return 0;
}
fun void fireTrack(int i, int s) { if (!trackAudible(i)) return;
  if (i == 0) { if (t0_g[s] < 1) return; if (t0_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t0_p[s]) return;
    cy_kick.broadcast();
    return; }
  if (i == 1) { if (t1_g[s] < 1) return; if (t1_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t1_p[s]) return;
    cy_hat.broadcast();
    return; }
  if (i == 2) { if (t2_g[s] < 1) return; if (t2_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t2_p[s]) return;
    cy_snare.broadcast();
    return; }
  if (i == 3) { if (t3_g[s] < 1) return; if (t3_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t3_p[s]) return;
    cy_glitch.broadcast();
    return; }
  if (i == 4) { if (t4_g[s] < 1) return; if (t4_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t4_p[s]) return;
    dk_bass.broadcast();
    return; }
  if (i == 5) { if (t5_g[s] < 1) return; if (t5_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t5_p[s]) return;
    t5_v[s] => ab_noteHz;
    ab_gate.broadcast();
    return; }
  if (i == 6) { if (t6_g[s] < 1) return; if (t6_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t6_p[s]) return;
    t6_v[s] => ab_accent;
    ab_gate.broadcast();
    return; }
  if (i == 7) { if (t7_g[s] < 1) return; if (t7_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t7_p[s]) return;
    md_gate.broadcast();
    return; }
  if (i == 8) { if (t8_g[s] < 1) return; if (t8_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t8_p[s]) return;
    t8_v[s] => md_digit;
    md_gate.broadcast();
    return; }
}
fun void fireStep(int s) { s => live_step; live_tick.broadcast();
  fireTrack(0, s);
  fireTrack(1, s);
  fireTrack(2, s);
  fireTrack(3, s);
  fireTrack(4, s);
  fireTrack(5, s);
  fireTrack(6, s);
  fireTrack(7, s);
  fireTrack(8, s);
}
fun void clockLoop() { while (true) { updateDur(); if (live_running) { fireStep(live_step); live_stepDur::second => now; (live_step + 1) % 16 => live_step; } else { 20::ms => now; } } }
spork ~ clockLoop();
while (true) 1::second => now;
