// Reference stub — ChucK Live regenerates a temp mod-matrix.ck on Start VM
// and whenever the shred list / mod annotations change (modGen.ts).
//
// Role: read @modSource globals + route selectors, write destination *_mod offsets.
// Route selectors (*_mod_src, *_mod_depth) are set via OSC through bridge.ck.

// Example destination apply in your patch follow() loop:
//   if (mb_pitchMod_src == 0) f * (1.0 + mb_lfoOut * 0.05) => pf;
//   else f + mb_pitchMod => pf;

// Generated mod-matrix runs applyRoutes in the main shred loop (no spork orphans).
