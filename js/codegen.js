// codegen.js: the Pybricks program that matches the simulator's settings.
// Paste into https://code.pybricks.com with a SPIKE Prime hub running Pybricks.

const num = (v, d) => {
  const s = Number(v).toFixed(d);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s;
};

export function pybricksCode(cfg) {
  const useI = cfg.ki !== 0;
  const useD = cfg.kd !== 0;
  const fLines = cfg.splitF
    ? `KF_LEFT = ${num(cfg.kfL, 3)}    # F for the left motor: power (%) per mm/s
KF_RIGHT = ${num(cfg.kfR, 3)}   # F for the right motor`
    : `KF = ${num(cfg.kf, 3)}     # F: power (%) per mm/s of target speed`;

  const baseLines = cfg.splitF
    ? `        base_left = direction * KF_LEFT * SPEED      # F: power for the speed we want
        base_right = direction * KF_RIGHT * SPEED`
    : `        base = direction * KF * SPEED               # F: power for the speed we want`;

  let corr = `        correction = KP * error                     # P: steer back toward straight`;
  if (useI || useD) {
    corr = `        correction = KP * error${useI ? ' + KI * integral' : ''}${useD ? ' + KD * (error - last_error) / LOOP_S' : ''}`;
  }
  const iLines = useI ? `        integral += error * LOOP_S\n` : '';
  const dTail = useD ? `        last_error = error\n` : '';
  const dcLines = cfg.splitF
    ? `        left.dc(limit(base_left + correction))
        right.dc(limit(base_right - correction))`
    : `        left.dc(limit(base + correction))
        right.dc(limit(base - correction))`;

  const globalsIn = [useI ? 'integral' : null, useD ? 'last_error' : null].filter(Boolean);
  const globalLine = globalsIn.length ? `    global ${globalsIn.join(', ')}\n` : '';
  const stateInit = `${useI ? 'integral = 0\n' : ''}${useD ? 'last_error = 0\n' : ''}`;

  return `# PID Drive Lab: drive back and forth between two lines with F + P.
# Settings copied from the simulator. Paste into code.pybricks.com
# (SPIKE Prime hub running Pybricks firmware).

from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Direction, Icon, Port
from pybricks.tools import wait

hub = PrimeHub()
left = Motor(Port.A, Direction.COUNTERCLOCKWISE)   # left wheel
right = Motor(Port.B)                              # right wheel

# ---- Tuning (from the simulator) ----
${fLines}
KP = ${num(cfg.kp, 2)}      # P: extra power (%) per degree off course
KI = ${num(cfg.ki, 3)}        # I: ${useI ? 'unlocked' : 'locked at 0 in this lab'}
KD = ${num(cfg.kd, 3)}        # D: ${useD ? 'unlocked' : 'locked at 0 in this lab'}

SPEED = ${cfg.speed}       # mm/s we want the robot to drive
DISTANCE = ${cfg.distance}  # mm between line A and line B
TRIPS = ${cfg.trips}          # out-and-back trips
LOOP_MS = ${cfg.loopMs}       # how often the loop runs
LOOP_S = LOOP_MS / 1000

WHEEL_DIAMETER = 56  # mm
target_deg = DISTANCE * 360 / (3.1416 * WHEEL_DIAMETER)  # wheel degrees to reach line B
${stateInit}

def limit(power):
    return max(-100, min(100, power))  # a motor can't go past 100%


def drive_leg(direction):
    """direction = 1 drives out to line B, -1 drives back to line A."""
${globalLine}    while True:
        travelled = (left.angle() + right.angle()) / 2
        if direction == 1 and travelled >= target_deg:
            break
        if direction == -1 and travelled <= 0:
            break

        heading = hub.imu.heading()   # + means the robot turned right
        error = 0 - heading           # + means we need to steer right
${iLines}${baseLines}
${corr}
${dcLines}
${dTail}        wait(LOOP_MS)

    left.brake()
    right.brake()
    wait(500)


# Keep the robot still until the gyro is ready, then zero everything.
hub.display.icon(Icon.PAUSE)
while not hub.imu.ready():
    wait(10)
hub.imu.reset_heading(0)
left.reset_angle(0)
right.reset_angle(0)

for trip in range(TRIPS):
    hub.display.icon(Icon.UP)
    drive_leg(1)
    hub.display.icon(Icon.DOWN)
    drive_leg(-1)

hub.display.icon(Icon.HAPPY)
`;
}
