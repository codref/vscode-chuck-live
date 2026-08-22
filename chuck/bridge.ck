// Reference stub — ChucK Live regenerates a temp bridge from your annotations.
// Pattern: declare the same `global` names as your patch, listen on OSC, write values.
//
//   // @knob min=0 max=1
//   global float gain;
//
// Default OSC port: 9000 (setting chuckLive.oscPort)
// Address: /chuck/<name>  float (knobs) or int (buttons)

global float gain;

OscIn oin;
9000 => oin.port;
oin.addAddress("/chuck/gain,f");

OscMsg msg;
while (true) {
  oin => now;
  while (oin.recv(msg)) {
    if (msg.address == "/chuck/gain") {
      msg.getFloat(0) => gain;
    }
  }
}
