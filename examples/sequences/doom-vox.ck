// @chuckLivePattern version=1 name=doom-vox bpm=118 scale=phrygian
// ChucK Live pattern — editable step arrays below

global float live_bpm;
global int live_step;
global float live_stepDur;
global Event live_tick;
global int live_running;
global int live_cmd;
global int live_swing;

global float dv_noteHz;
global Event dv_gate;
global float dv_accent;
global float dv_chop;

118 => live_bpm;
0 => live_step;
(60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur;
1 => live_running;
0 => live_swing;
3 => int nTracks;

// track 0: dv_noteHz (float) gate=dv_gate
[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0] @=> int t0_g[];
[82.406889,82.406889,82.406889,82.406889,61.735413,61.735413,97.998859,97.998859,82.406889,82.406889,41.203445,41.203445,123.470825,82.406889,61.735413,82.406889] @=> float t0_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t0_p[];
0.000000 => float t0_swing;
0 => int t0_muted;
0 => int t0_solo;
1 => int t0_run;

// track 1: dv_accent (float) gate=dv_gate
[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0] @=> int t1_g[];
[1.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.700000,0.000000,0.000000,0.000000,0.000000,0.000000,0.850000,0.000000,0.000000,0.000000] @=> float t1_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t1_p[];
0.000000 => float t1_swing;
0 => int t1_muted;
0 => int t1_solo;
1 => int t1_run;

// track 2: dv_chop (float) gate=dv_gate
[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0] @=> int t2_g[];
[0.000000,0.000000,0.000000,0.000000,0.200000,0.200000,0.350000,0.350000,0.000000,0.000000,0.500000,0.500000,0.150000,0.150000,0.400000,0.400000] @=> float t2_v[];
[1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000] @=> float t2_p[];
0.000000 => float t2_swing;
0 => int t2_muted;
0 => int t2_solo;
1 => int t2_run;

fun void updateDur() { (60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur; }
fun int anySolo() { return 0; }
fun int trackAudible(int i) {
  if (i == 0) { if (!t0_run) return 0; if (t0_muted) return 0; if (anySolo() && !t0_solo) return 0; return 1; }
  if (i == 1) { if (!t1_run) return 0; if (t1_muted) return 0; if (anySolo() && !t1_solo) return 0; return 1; }
  if (i == 2) { if (!t2_run) return 0; if (t2_muted) return 0; if (anySolo() && !t2_solo) return 0; return 1; }
  return 0;
}
fun void fireTrack(int i, int s) { if (!trackAudible(i)) return;
  if (i == 0) { if (t0_g[s] < 1) return; if (t0_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t0_p[s]) return;
    t0_v[s] => dv_noteHz;
    dv_gate.broadcast();
    return; }
  if (i == 1) { if (t1_g[s] < 1) return; if (t1_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t1_p[s]) return;
    t1_v[s] => dv_accent;
    dv_gate.broadcast();
    return; }
  if (i == 2) { if (t2_g[s] < 1) return; if (t2_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t2_p[s]) return;
    t2_v[s] => dv_chop;
    dv_gate.broadcast();
    return; }
}
fun void fireStep(int s) { s => live_step; live_tick.broadcast();
  fireTrack(0, s);
  fireTrack(1, s);
  fireTrack(2, s);
}
fun void clockLoop() { while (true) { updateDur(); if (live_running) { fireStep(live_step); live_stepDur::second => now; (live_step + 1) % 16 => live_step; } else { 20::ms => now; } } }
spork ~ clockLoop();
while (true) 1::second => now;
