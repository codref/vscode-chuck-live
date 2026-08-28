// Reference stub — ChucK Live regenerates a temp bridge from your annotations.
// On Start VM (and when annotations change), bridgeGen.ts writes
//   $TMPDIR/chuck-live-bridge.ck
// and loads it as a managed shred. Edit THIS file only as documentation;
// the running bridge is always auto-generated.
//
// Pattern in your patch:
//   1. Declare `global` with the same name in your .ck file AND the bridge.
//   2. Put `// @knob` / `// @slider` / `// @button` on the line above the global.
//   3. In your patch, spork a `follow()` loop that copies globals → UGen params.
//
//   // @knob min=0 max=1
//   global float gain;
//
// OSC wiring (defaults):
//   Port: 9000  (VS Code setting chuckLive.oscPort)
//   Knobs/sliders:  /chuck/<name>  float
//   Buttons:        /chuck/<name>  int  → Event.broadcast() in bridge
//
// Always included — sequencer / transport bus (reserved live_* prefix).
// Your patch can read these; the Sequencer + transport shred write them:
//   live_bpm, live_step, live_stepDur, live_tick, live_running, live_cmd, live_swing

// ---- transport bus globals (shared with transport.ck and your patches) ----

global float live_bpm;        // master tempo — Sequencer header BPM
global int live_step;         // current 16th index 0–15 (Sync ON)
global float live_stepDur;    // seconds per 16th = 60 / bpm / 4
global Event live_tick;       // broadcast each master step — patches can `live_tick => now`
global int live_running;      // 1 while transport clock is running
global int live_cmd;          // host pulse: 1 = arm run (transport shred consumes it)
global int live_swing;        // 1 = global swing enabled for odd steps

// Example user annotation — merged from all loaded .ck files in real bridge:
global float gain;

// Transport bus owned by transport shred + host OSC — do not assign here.

// ---- OSC input: extension Knobs / Sequencer → globals ----

OscIn oin;
9000 => oin.port;                           // listen on loopback (see chuckLive.oscPort)
// Register address patterns: path + comma + type tag (f=float, i=int)
oin.addAddress("/chuck/live_bpm,f");
oin.addAddress("/chuck/live_step,f");
oin.addAddress("/chuck/live_stepDur,f");
oin.addAddress("/chuck/live_tick,i");       // int message triggers broadcast, not a stored value
oin.addAddress("/chuck/live_running,f");
oin.addAddress("/chuck/live_cmd,i");
oin.addAddress("/chuck/live_swing,i");
oin.addAddress("/chuck/gain,f");            // one entry per @knob/@slider in your patches

OscMsg msg;
while (true) {
  oin => now;                               // block until any registered OSC packet arrives
  while (oin.recv(msg)) {                   // drain the queue (burst-safe)
    if (msg.address == "/chuck/live_bpm") {
      msg.getFloat(0) => live_bpm;
      // keep step duration in sync when BPM changes mid-groove
      (60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur;
    }
    if (msg.address == "/chuck/live_step") Std.ftoi(msg.getFloat(0)) => live_step;
    if (msg.address == "/chuck/live_stepDur") msg.getFloat(0) => live_stepDur;
    if (msg.address == "/chuck/live_tick") live_tick.broadcast();   // no arg — just a pulse
    if (msg.address == "/chuck/live_running") Std.ftoi(msg.getFloat(0)) => live_running;
    if (msg.address == "/chuck/live_cmd") Std.ftoi(msg.getInt(0)) => live_cmd;
    if (msg.address == "/chuck/live_swing") Std.ftoi(msg.getInt(0)) => live_swing;
    if (msg.address == "/chuck/gain") {
      msg.getFloat(0) => gain;              // Knobs panel moved a slider
    }
  }
}
// Bridge shred never exits — it is the control surface's ChucK-side receiver.
