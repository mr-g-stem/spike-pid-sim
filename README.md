# PID Drive Lab

A browser simulator for tuning **F (feedforward)** and **P (proportional)** on a SPIKE Prime driving base running **Pybricks**.

The robot drives back and forth between two tape lines. One motor is a little weaker, so with P = 0 it drifts off the path. Students tune F first, so the robot drives at the speed they asked for. Then they tune P, so the gyro steers it back. I and D are shown but locked at 0.

Runs in any modern browser, Chromebooks included. There is no build step: GitHub Pages serves the files as they are.

## What students see

- **A 3D robot**: hub with a light matrix and port letters, motors, spinning wheels, caster, cables. It drives on a mat with distance rulers, cm-off rulers at each line, green (±2 cm) and amber (±5 cm) zones, and bumps.
- **Heading laser** (orange) vs **straight ahead** (green dashes), with the heading error drawn as a wedge between them.
- **Red drift line** from the perfect path to the robot, labelled in cm.
- **See-through perfect robot** driving at exactly the target speed. If yours falls behind, F is too low.
- **Curved arrow on the hub**: which way P is steering, and how hard.
- **Inside the program, right now**: the loop's lines with live numbers (`base = F × SPEED`, `corr = P × error`, `left.dc(...)`).
- **Motor bars**: each wheel's power split into its F part and its P part.
- **Graphs**: heading, speed vs target, motor power, with the last run faded behind. Click a graph to jump to that moment.
- **Result card**: 0–3 stars, plus one coaching hint after each run (F first, then P).
- **Run log**: every run's F, P, distance off the path, wobble and speed. Click a run to watch it again.
- **Pybricks code** tab: the matching program, ready to paste into code.pybricks.com.

Camera views: Follow, Behind, Top, Side (drag to orbit, scroll to zoom). Keys: space = play/pause, R = run.

Teacher mode: add `?unlock` to the URL to unlock the I and D sliders.

## The model

- **Wheels:** 56 mm. **Axle track:** 112 mm. These are the same values as Pybricks' DriveBase example.
- **Motors:** about 950°/s at 100% power with the robot's weight on them. They need 6% power before they start turning, and they reach a new speed with a 0.25 s lag.
- **Weaker motor:** the class robot's left motor is 2% weaker. **Mystery robot** picks a random side and amount.
- **Gyro:** Pybricks heading, where clockwise is positive. It has small noise and a 15 ms delay.
- **Control loop:** runs every `wait(10)`, just like the generated program.
- **Bumps:** fixed positions on the mat, so runs can be compared fairly.

The sim gets the shape of the behaviour right: drift with P = 0, shaking when P is too big, crawling when F is too low. The exact numbers will differ on a real robot. Tune the real robot the same way: F first, then P.

## Run it locally

```bash
node tools/serve.mjs 8796
```

Then open http://localhost:8796. Physics checks:

```bash
node tests/physics.test.mjs
```

## Files

| Path | What |
|---|---|
| `index.html`, `css/style.css` | the page |
| `js/physics.js` | robot, motors, gyro, the F + P loop, scoring and coach hints |
| `js/scene.js` | three.js mat, robot model, trails, laser, labels, cameras |
| `js/charts.js` | the three graphs |
| `js/codegen.js` | Pybricks program generator |
| `js/main.js` | sliders, playback, HUD, run log |
| `vendor/` | three.js r160 (MIT, see `vendor/three-LICENSE.txt`) |

SPIKE™ and LEGO® are trademarks of the LEGO Group, which does not sponsor or endorse this project. Pybricks is an independent open-source project.
