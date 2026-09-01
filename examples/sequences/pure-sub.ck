// @chuckLivePattern version=1 name=pure-sub bpm=118 scale=phrygian
// ChucK Live pattern — editable step arrays below

global float live_bpm;
global int live_step;
global float live_stepDur;
global Event live_tick;
global int live_running;
global int live_cmd;
global int live_swing;

global float ps_noteHz;
global Event ps_gate;
global float ps_accent;
global float ps_plockPit;
global float ps_plockCut;
global float ps_slide;

118 => live_bpm;
0 => live_step;
(60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur;
1 => live_running;
0 => live_swing;
5 => int nTracks;

// track 0: ps_noteHz (float) gate=ps_gate
[1,0,1,0,1,0,0,1,1,0,1,0,1,0,1,1] @=> int t0_g[];
[82.406889,82.406889,82.406889,41.203445,82.406889,97.998859,82.406889,65.406391,82.406889,82.406889,97.998859,82.406889,123.470825,82.406889,65.406391,41.203445] @=> float t0_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t0_p[];
0.000000 => float t0_swing;
0 => int t0_muted;
0 => int t0_solo;
1 => int t0_run;

// track 1: ps_accent (float) gate=ps_gate
[1,0,1,0,1,0,0,1,1,0,1,0,1,0,1,1] @=> int t1_g[];
[1.000000,0.000000,0.800000,1.000000,0.000000,0.000000,0.700000,1.000000,1.000000,0.000000,0.600000,0.000000,1.000000,0.000000,0.900000,1.000000] @=> float t1_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t1_p[];
0.000000 => float t1_swing;
0 => int t1_muted;
0 => int t1_solo;
1 => int t1_run;

// track 2: ps_plockPit (float) gate=ps_gate
[1,0,1,0,1,0,0,1,1,0,1,0,1,0,1,1] @=> int t2_g[];
[0.900000,0.000000,0.500000,1.000000,0.000000,0.000000,0.800000,0.700000,0.400000,0.000000,0.600000,0.000000,1.000000,0.000000,0.850000,1.000000] @=> float t2_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t2_p[];
0.000000 => float t2_swing;
0 => int t2_muted;
0 => int t2_solo;
1 => int t2_run;

// track 3: ps_plockCut (float) gate=ps_gate
[1,0,1,0,1,0,0,1,1,0,1,0,1,0,1,1] @=> int t3_g[];
[0.200000,0.000000,0.350000,0.700000,0.150000,0.000000,0.000000,0.500000,0.300000,0.000000,0.450000,0.000000,0.800000,0.000000,0.600000,0.900000] @=> float t3_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t3_p[];
0.000000 => float t3_swing;
0 => int t3_muted;
0 => int t3_solo;
1 => int t3_run;

// track 4: ps_slide (float) gate=ps_gate
[1,0,1,0,1,0,0,1,1,0,1,0,1,0,1,1] @=> int t4_g[];
[0.000000,0.000000,1.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,1.000000,0.000000,0.000000,0.000000,0.000000,1.000000,0.000000] @=> float t4_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t4_p[];
0.000000 => float t4_swing;
0 => int t4_muted;
0 => int t4_solo;
1 => int t4_run;

fun void updateDur() { (60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur; }
fun int anySolo() { return 0; }
fun int trackAudible(int i) {
  if (i == 0) { if (!t0_run) return 0; if (t0_muted) return 0; if (anySolo() && !t0_solo) return 0; return 1; }
  if (i == 1) { if (!t1_run) return 0; if (t1_muted) return 0; if (anySolo() && !t1_solo) return 0; return 1; }
  if (i == 2) { if (!t2_run) return 0; if (t2_muted) return 0; if (anySolo() && !t2_solo) return 0; return 1; }
  if (i == 3) { if (!t3_run) return 0; if (t3_muted) return 0; if (anySolo() && !t3_solo) return 0; return 1; }
  if (i == 4) { if (!t4_run) return 0; if (t4_muted) return 0; if (anySolo() && !t4_solo) return 0; return 1; }
  return 0;
}
fun void fireTrack(int i, int s) { if (!trackAudible(i)) return;
  if (i == 0) { if (t0_g[s] < 1) return; if (t0_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t0_p[s]) return;
    t0_v[s] => ps_noteHz;
    ps_gate.broadcast();
    return; }
  if (i == 1) { if (t1_g[s] < 1) return; if (t1_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t1_p[s]) return;
    t1_v[s] => ps_accent;
    ps_gate.broadcast();
    return; }
  if (i == 2) { if (t2_g[s] < 1) return; if (t2_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t2_p[s]) return;
    t2_v[s] => ps_plockPit;
    ps_gate.broadcast();
    return; }
  if (i == 3) { if (t3_g[s] < 1) return; if (t3_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t3_p[s]) return;
    t3_v[s] => ps_plockCut;
    ps_gate.broadcast();
    return; }
  if (i == 4) { if (t4_g[s] < 1) return; if (t4_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t4_p[s]) return;
    t4_v[s] => ps_slide;
    ps_gate.broadcast();
    return; }
}
fun void fireStep(int s) { s => live_step; live_tick.broadcast();
  fireTrack(0, s);
  fireTrack(1, s);
  fireTrack(2, s);
  fireTrack(3, s);
  fireTrack(4, s);
}
fun void clockLoop() { while (true) { updateDur(); if (live_running) { fireStep(live_step); live_stepDur::second => now; (live_step + 1) % 16 => live_step; } else { 20::ms => now; } } }
spork ~ clockLoop();
while (true) 1::second => now;
