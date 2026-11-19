// codegen.js: the Pybricks program that matches the simulator's settings.
// Paste into https://code.pybricks.com with a SPIKE Prime hub running Pybricks.
// F is "go power": the motor power (%) for our driving speed (feedforward).
// P is "steer-back power": extra power (%) per degree the robot is off straight.

const num = (v, d) => {
  const s = Number(v).toFixed(d);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

export function fPower(cfg) { return Math.round(cfg.kf * cfg.speed); }

export function pybricksCode(cfg) {
  const useI = cfg.ki !== 0;
  const useD = cfg.kd !== 0;
  const F = fPower(cfg);
  const FL = Math.round(cfg.kfL * cfg.speed), FR = Math.round(cfg.kfR * cfg.speed);

  const tuning = cfg.splitF
    ? `F_LEFT = ${FL}     # F for the left wheel: go power (%)
F_RIGHT = ${FR}    # F for the right wheel: go power (%)`
    : `F = ${F}     # F: go power (%) -- how hard both wheels push forward`;

  const goLines = cfg.splitF
    ? `        go_left = direction * F_LEFT       # F: go power
        go_right = direction * F_RIGHT`
    : `        go = direction * F                 # F: go power`;

  let steer = `        steer = P * error                  # P: steer back`;
  if (useI || useD) {
    steer = `        steer = P * error${useI ? ' + I * total_error' : ''}${useD ? ` + D * (error - last_error) / ${cfg.loopMs / 1000}` : ''}`;
  }
  const iLine = useI ? `        total_error += error * ${cfg.loopMs / 1000}\n` : '';
  const dTail = useD ? `        last_error = error\n` : '';
  const dcLines = cfg.splitF
    ? `        left.dc(limit(go_left + steer))
        right.dc(limit(go_right - steer))`
    : `        left.dc(limit(go + steer))
        right.dc(limit(go - steer))`;

  const globalsIn = [useI ? 'total_error' : null, useD ? 'last_error' : null].filter(Boolean);
  const globalLine = globalsIn.length ? `    global ${globalsIn.join(', ')}\n` : '';
  const stateInit = `${useI ? 'total_error = 0\n' : ''}${useD ? 'last_error = 0\n' : ''}`;

  return `# PID Drive Lab: drive back and forth between two lines with F + P.
# Numbers copied from the simulator. Paste into code.pybricks.com
# (SPIKE Prime hub running Pybricks).

from pybricks.hubs import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Direction, Icon, Port
from pybricks.tools import wait

hub = PrimeHub()
left = Motor(Port.A, Direction.COUNTERCLOCKWISE)   # left wheel
right = Motor(Port.B)                              # right wheel

# ---- Tuning (from the simulator) ----
${tuning}
P = ${num(cfg.kp, 1)}      # P: steer-back power (%) for each degree off straight
I = ${num(cfg.ki, 3)}      # I: ${useI ? 'unlocked' : 'locked at 0 for now'}
D = ${num(cfg.kd, 3)}      # D: ${useD ? 'unlocked' : 'locked at 0 for now'}

DISTANCE = ${cfg.distance}   # mm from the start line to the turn-around line
TRIPS = ${cfg.trips}         # out-and-back trips

WHEEL_DIAMETER = 56  # mm
target = DISTANCE * 360 / (3.1416 * WHEEL_DIAMETER)  # wheel degrees to the far line
${stateInit}

def limit(power):
    return max(-100, min(100, power))  # a motor can't go past 100%


def drive_leg(direction):
    """direction = 1 drives out, -1 drives back to the start."""
${globalLine}    while True:
        travelled = (left.angle() + right.angle()) / 2
        if direction == 1 and travelled >= target:
            break
        if direction == -1 and travelled <= 0:
            break

        error = 0 - hub.imu.heading()      # how far off straight (degrees)
${iLine}${goLines}
${steer}
${dcLines}
${dTail}        wait(${cfg.loopMs})

    left.brake()
    right.brake()
    wait(500)


# Keep the robot still until the gyro is ready, then start from zero.
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
