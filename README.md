# PID Drive Lab

A browser simulator for grades 3–5. Students teach a SPIKE Prime robot running **Pybricks** to drive straight by tuning two numbers:

- **F, go power**: how hard both wheels push forward (0–100).
- **P, steer-back power**: how hard the robot turns back when the gyro says it is off course (0–30).

The robot drives back and forth between two tape lines. One motor is a little weaker, so with P = 0 it drifts off the path. Students tune F first, until the robot keeps up with the see-through ghost robot. Then they tune P, until it stays on the path. I and D are shown as locked.

It runs in any modern browser, Chromebooks included. There is no build step: GitHub Pages serves the files as they are.

## Drive tab (what students use)

- **3D robot** on a mat with START and FAR LINE lines (it drives out, then backs up), a blue path, a green on-track zone and yellow bumps. You can watch from three views: Follow, From above, Behind.
- **Ghost robot** that drives at the perfect speed. It restarts with your robot at every line, so "keep up with the ghost" means F is right.
- **Two cards:** "Off the path" (cm, plus a left/right lane dot) and "Ghost race" (keeping up / behind / ahead).
- **Heading laser and trail**, a red "cm off" line, and flags where the robot stopped.
- **One graph:** how far off the path, over time. Click the graph to jump to that moment.
- **Big F and P sliders** with − and + buttons. Letting go of a slider runs the robot again.
- **Missions:** watch it drift → keep up with the ghost → drive straight (★★★) → make it wiggle → tame a mystery robot (the 🎲 Mystery robot button is always under the missions). They are saved in the browser.
- **Result card** that compares with your last try ("🎉 Closer to the path than last try: 30 cm → 6 cm" or "What did you change?"), with 0–3 stars and one hint in kid language (for example "Turn F up first" or "Too much P: it wiggles!"), plus confetti.
- **My tries:** every run's F, P, cm off and stars. Tap a run to watch it again.

**Teacher settings** (a closed box at the bottom of the panel):

- live code panel;
- wheel power bars split into F and P parts;
- angle labels;
- extra graphs (heading, speed, power);
- trips, loop time, bumps, gyro noise;
- a separate F for each wheel;
- unlock I and D (or add `?unlock` to the URL);
- skip to the end, reveal the mystery robot, reset missions.

**Read to me:** 🔊 buttons read the current mission, the result card and every How it works step aloud with the device voice (speechSynthesis; works on iPad). They hide themselves if the browser has no voice.

**Share a starting point:** Teacher settings → *Copy a link with this F and P* gives a link like `?F=47&P=5`.

## How it works tab

Nine illustrated steps, each with an animation:

1. A 3D robot you can spin, with labelled hub, gyro, motors, wheels and caster.
2. Why it drifts: one wheel slower, with a toggle to make both motors equal.
3. F race: a slider against the ghost.
4. The gyro dial: drag the robot (or tap Turn left / Turn right) and read + for right, − for left.
5. P's times problem (off × P = steer), with the left and right wheel power bars and a "Bump it!" button.
6. Four robots with P = 0, 1, 5 and 16, side by side.
7. The 4-step loop, 100 times a second.
8. The tuning recipe.
9. Why I and D are locked.

## Code tab

The matching Pybricks program, which uses `F` as go power and `steer = P * error`. Paste it into code.pybricks.com. The left motor is on port A (`Direction.COUNTERCLOCKWISE`) and the right motor is on port B.

## The model

- **Wheels:** 56 mm. **Axle track:** 112 mm. These are Pybricks' DriveBase example values.
- **Motors:** about 950°/s at 100% power. They need 6% power before they start turning, and they reach a new speed with a 0.25 s lag.
- **Weaker motor:** the class robot's left motor is 2% weaker. A mystery robot gets a random side and amount.
- **Gyro:** Pybricks heading, where clockwise is positive. It has small noise and a 15 ms delay.
- **Control loop:** runs every `wait(10)`, just like the generated program.
- **Bumps:** fixed positions on the mat, so runs can be compared fairly.

With the class robot, F ≈ 47 matches the ghost. P ≈ 5 drives straight. P ≈ 12 or more wiggles. P ≈ 25 shakes so hard it barely moves. A real robot will need its own numbers: tune it the same way, F first, then P.

## iPads

Students can use it on iPads in Safari or Chrome. It needs **iPadOS 15 or newer**, and works in both portrait and landscape.

- **Portrait:** the F and P knobs sit right under the 3D view.
- **Landscape:** the knobs sit beside the 3D view.
- **Touch:** a finger swiped sideways on the 3D view turns the camera, and an up/down swipe scrolls the page. The graph and the How it works animations behave the same way.
- **Easy to tap:** buttons and sliders are larger on touch screens, and double-tap zoom is off, so quick taps on − and + don't zoom the page.
- **Battery:** the 3D view only redraws when something moves, and it draws at a lower resolution on touch screens.
- **Add to Home Screen:** in Safari, Share → Add to Home Screen opens it full screen like an app, with its own icon (`manifest.webmanifest`, `icons/`, made by `node tools/make-icons.mjs`).
- **Slow school networks:** the Google Fonts request loads in the background, so a filter that blocks it can't hold the page blank. A "Loading the robot…" message stays only if the app can't start, and then it says to update iPadOS.
- **No import maps:** three.js is loaded by relative path, so older Safari versions work too.
- **No 3D:** if a device can't run 3D (WebGL), a message appears and the cards, graph and missions still work.

**Real robots:** Pybricks can't connect to a hub from an iPad, because iOS browsers have no Web Bluetooth (see [Pybricks: what do you need?](https://pybricks.com/learn/getting-started/what-do-you-need/)). Sending code to the robot needs Chrome or Edge on a Chromebook, Windows, Mac, Linux or Android. The Code tab says so.

## Run it locally

```bash
node tools/serve.mjs 8796
```

Then open http://localhost:8796 (add `#how` to open the How it works tab). Physics checks:

```bash
npm test        (physics + Pybricks code checks)
```

## Files

| Path | What |
|---|---|
| `index.html`, `css/style.css` | the page (Nunito from Google Fonts, falls back to the system font) |
| `js/physics.js` | robot, motors, gyro, the F + P loop, scoring and kid hints |
| `js/scene.js` | three.js mat, robot model, trails, laser, labels, cameras |
| `js/charts.js` | graphs |
| `js/explain.js` | the animated How it works page |
| `js/codegen.js` | Pybricks program generator |
| `js/main.js` | sliders, missions, playback, cards, teacher settings |
| `vendor/` | three.js r160 (MIT, see `vendor/three-LICENSE.txt`) |

SPIKE™ and LEGO® are trademarks of the LEGO Group, which does not sponsor or endorse this project. Pybricks is an independent open-source project.
