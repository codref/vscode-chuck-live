// Reference stub — ChucK Live regenerates chuck-live-transport.ck from the Sequencer.
// transportGen.ts writes $TMPDIR/chuck-live-transport.ck whenever Sync is ON and
// patterns / BPM / run state change. This stub shows only the shared `live_*` bus;
// the real generated file also contains your pattern data and a clockLoop().
//
// Role when Sequencer **Sync** is ON (default):
//   • Owns the 16th-note clock inside ChucK (not the webview timer).
//   • Each step: updates live_step, broadcasts live_tick, writes float tracks,
//     broadcasts gate Events (dk_kick, mb_gate, …).
//   • Sends OSC /chuck/live_playhead → extension mirrors the playhead UI.
//
// Role when Sync is OFF:
//   • Transport shred stays idle; the host fires per-track OSC directly.
//
// Patches can follow the grid without parsing patterns themselves:
//   global float live_stepDur;
//   global Event live_tick;
//   live_tick => now;                        // wait for next 16th
//   (0.9 * live_stepDur)::second => now;     // hold note ~90% of a step

// Same globals as bridge.ck — one VM, one namespace, all shreds see these.

global float live_bpm;
global int live_step;
global float live_stepDur;
global Event live_tick;
global int live_running;
global int live_cmd;
global int live_swing;

120.0 => live_bpm;
0 => live_step;
(60.0 / live_bpm / 4.0) => live_stepDur;
0 => live_running;
0 => live_cmd;
0 => live_swing;

// Generated transport also sporks clockLoop() which:
//   applyCmd() → updateDur() → if running: fireStep(), sendPlayhead(), advance step
// See src/transportGen.ts for the full template.
//
// Stub keeps the shred slot documented; real clock is in the temp file.
while (true) 1::second => now;
