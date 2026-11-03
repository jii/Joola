import { beforeEach, describe, expect, it, vi } from 'vitest';
import './setup-mocks.js';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { RobotConnection, RobotError } from '../src/js/bluetooth.js';
import drills from '../src/data/basic-list.json';
import advanceDrills from '../src/data/advance-list.json';
import baseConf from '../src/data/base-conf.json';
import original from './fixtures/original-frames.json';

const FFE0 = '0000ffe0-0000-1000-8000-00805f9b34fb';
const FFE1 = '0000ffe1-0000-1000-8000-00805f9b34fb';
const FEE7 = '0000fee7-0000-1000-8000-00805f9b34fb';
const FEC8 = '0000fec8-0000-1000-8000-00805f9b34fb';
const FEC7 = '0000fec7-0000-1000-8000-00805f9b34fb';

const props = (over = {}) => ({ writeWithoutResponse: true, notify: true, ...over });
const primaryServices = [{ uuid: FFE0, characteristics: [{ uuid: FFE1, properties: props() }] }];
const altServices = [{
  uuid: FEE7,
  characteristics: [
    { uuid: FEC8, properties: props({ notify: false }) },
    { uuid: FEC7, properties: props({ writeWithoutResponse: false }) },
  ],
}];

const hex = (view) => Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex');
const written = (fn = BleClient.writeWithoutResponse) => fn.mock.calls.map((c) => hex(c[3]));

function connectedRobot() {
  const robot = new RobotConnection();
  robot.deviceId = '00A331D33F040001';
  robot.baseConf = baseConf;
  robot.bleDeviceId = 'AA:BB';
  robot.service = FFE0;
  robot.writeCharacteristic = FFE1;
  robot.connected = true;
  return robot;
}

beforeEach(() => {
  vi.clearAllMocks();
  BleClient.isEnabled.mockResolvedValue(true);
  BleClient.connect.mockResolvedValue();
  BleClient.requestDevice.mockResolvedValue({ deviceId: 'AA:BB', name: 'J-00A331D33F040001' });
  BleClient.getServices.mockResolvedValue(primaryServices);
});

const payloadOf = (robot, drill) => robot._encodeBasicPattern(drill);
const conf = (ball, spin, power, landarea) => baseConf.find((e) => e.ball === ball && e.spin === spin && e.power === power && e.landarea === landarea);
const motors = (e) => [e.m1speed, e.m2speed, e.xaxis, e.yaxis, e.zaxis];

describe('compatibility with the validated web client', () => {
  // The original app always sends 1 in byte 9 and only 0 or 2 in byte 10, so those two
  // bytes of every point are normalised before comparing with the pinfinity frames.
  const normalise = (hex, n) => {
    const bytes = Buffer.from(hex, 'hex');
    const payload = bytes.subarray(14, -3);
    for (let i = 0; i < n; i++) {
      payload[i * 12 + 9] = 1;
      if (payload[i * 12 + 10] === 1) payload[i * 12 + 10] = 0;
    }
    return payload.toString('hex');
  };

  it.each(drills.map((d) => [d.name, d]))('%s', async (_name, drill) => {
    await connectedRobot().sendBasicDrill(drill);
    const n = drill.points.length;
    expect(normalise(written().join(''), n)).toBe(normalise(original[drill.id].join(''), n));
  });

  it('stop frame', async () => {
    await connectedRobot().stop();
    expect(written()).toEqual(original.stop);
  });
});

describe('basic encoding of the original app', () => {
  const base = { ball: 1, spin: 3, power: 3, landType: 0, ballTime: 9, numType: 1, times: 20, points: [{ x: 5, y: 1 }] };

  it('single point: 16-bit count, timing, one cycle', () => {
    const p = payloadOf(connectedRobot(), { ...base, times: 300 });
    expect([...p]).toEqual([...motors(conf(1, 3, 3, 5)), 1, 44, 35, 0, 1, 0, 0, 1, 0, 0, 0]);
  });

  it('sequence: cycles in the trailer, ball time in byte 8', () => {
    const p = payloadOf(connectedRobot(), { ...base, landType: 1, times: 30, points: [{ x: 5, y: 3 }, { x: 11, y: 1 }, { x: 13, y: 2 }] });
    expect([...p.subarray(5, 12)]).toEqual([0, 1, 0, 9, 1, 0, 0]);
    expect(p[36]).toBe(10);
  });

  it('random: flag, mode 2 and the ball count in the trailer', () => {
    const p = payloadOf(connectedRobot(), { ...base, landType: 2, times: 30, points: [{ x: 5, y: 1 }, { x: 11, y: 2 }] });
    expect([...p.subarray(5, 12)]).toEqual([0, 1, 0x80, 9, 1, 2, 1]);
    expect(p[24]).toBe(30);
  });

  it('time mode on a single point', () => {
    const p = payloadOf(connectedRobot(), { ...base, numType: 0, times: 2 });
    expect((p[5] << 8) | p[6]).toBe(Math.trunc((10 * 3.5 + 30) * 2 * 0.5));
  });

  it('time mode on a sequence', () => {
    const p = payloadOf(connectedRobot(), { ...base, numType: 0, times: 2, points: [{ x: 5, y: 2 }, { x: 11, y: 2 }] });
    expect(p[24]).toBe(Math.trunc(Math.trunc(60 / (9 * 0.08 + 1.1)) / 2));
  });
});

describe('advance encoding of the original app', () => {
  const group = { ball: 1, spin: 3, power: 3, landType: 0, ballTime: 14, random: 0, points: [{ x: 7, y: 2 }] };

  it('single group with repeat settings in the trailer', () => {
    const p = connectedRobot()._encodeAdvancePattern({ repeatNum: 10, repeatDelay: 1, intervalTrain: 0, ballList: [group] });
    expect([...p]).toEqual([...motors(conf(1, 3, 3, 7)), 0, 1, 0, 14, 1, 0, 1, 10, 1, 0, 0]);
  });

  it('marks the first point of a five-random group', () => {
    const points = [{ x: 7, y: 2 }, { x: 11, y: 2 }, { x: 13, y: 2 }];
    const p = connectedRobot()._encodeAdvancePattern({ repeatNum: 1, repeatDelay: 0, ballList: [{ ...group, landType: 3, points }] });
    expect([p[9], p[10], p[21], p[22]]).toEqual([3, 1, 3, 0]);
  });

  it('random group sets bit 7 and clears the last flag', () => {
    const p = connectedRobot()._encodeAdvancePattern({ repeatNum: 1, repeatDelay: 0, ballList: [{ ...group, random: 1 }] });
    expect([p[7], p[11]]).toEqual([0x80, 0]);
  });

  it('computes interval rounds', () => {
    const drill = { repeatNum: 5, repeatDelay: 0, intervalTrain: 1, trainRunTime: 2, trainPauseTime: 3, ballList: [{ ...group, ballTime: 5 }] };
    const p = connectedRobot()._encodeAdvancePattern(drill);
    expect([p[14], p[15]]).toEqual([Math.trunc(60 / 1) + 1, 3]);
  });

  it.each(advanceDrills.map((d) => [d.name, d]))('encodes %s', async (_name, drill) => {
    await connectedRobot().sendAdvanceDrill(drill);
    const points = drill.ballList.reduce((n, g) => n + g.points.length, 0);
    expect(written().join('').length / 2).toBe(points * 12 + 4 + 17);
  });
});

describe('drills that must not reach the robot', () => {
  const single = { ball: 1, spin: 3, power: 3, landType: 0, ballTime: 9, numType: 1, times: 20, points: [{ x: 5, y: 2 }] };
  const code = async (drill) => {
    const err = await connectedRobot().sendBasicDrill(drill).catch((e) => e);
    expect(err).toBeInstanceOf(RobotError);
    expect(BleClient.writeWithoutResponse).not.toHaveBeenCalled();
    return err.code;
  };

  it('refuses unknown motor settings instead of sending zeros', async () => {
    expect(await code({ ...single, ball: 9 })).toBe('NO_MOTOR_PARAMS');
  });
  it('refuses a cycle count that does not fit one byte', async () => {
    expect(await code({ ...single, times: 600, points: [{ x: 5, y: 2 }, { x: 11, y: 2 }], landType: 2 })).toBe('COUNT_RANGE');
  });
  it('refuses a drill without points', async () => {
    expect(await code({ ...single, points: [] })).toBe('NO_POINTS');
  });
  it('plays one cycle when fewer balls than points are set', () => {
    const payload = connectedRobot()._encodeBasicPattern({ ...single, times: 1, points: [{ x: 5, y: 2 }, { x: 11, y: 2 }] });
    expect(payload[24]).toBe(1);
  });
});

describe('connection', () => {
  it('connects on the primary service and sends GET_INFO before CONNECT', async () => {
    const robot = new RobotConnection();
    const statuses = [];
    robot.onStatusChange = (s) => statuses.push(s);
    await robot.connect();
    const frames = written();
    expect(frames).toHaveLength(2);
    expect(frames[0].slice(22, 24)).toBe('05');
    expect(frames[1].slice(22, 24)).toBe('89');
    expect(frames[0].slice(4, 20)).toBe('00a331d33f040001');
    expect(BleClient.startNotifications.mock.calls[0].slice(1, 3)).toEqual([FFE0, FFE1]);
    expect(robot.connected).toBe(true);
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('falls back to the alternative service', async () => {
    BleClient.getServices.mockResolvedValue(altServices);
    const robot = new RobotConnection();
    await robot.connect();
    expect(BleClient.writeWithoutResponse.mock.calls[0].slice(1, 3)).toEqual([FEE7, FEC8]);
    expect(BleClient.startNotifications.mock.calls[0].slice(1, 3)).toEqual([FEE7, FEC7]);
  });

  it('uses a confirmed write when the robot has no write-without-response', async () => {
    BleClient.getServices.mockResolvedValue([{ uuid: FFE0, characteristics: [{ uuid: FFE1, properties: props({ writeWithoutResponse: false }) }] }]);
    await new RobotConnection().connect();
    expect(BleClient.write).toHaveBeenCalled();
    expect(BleClient.writeWithoutResponse).not.toHaveBeenCalled();
  });

  it('retries a dropped link', async () => {
    BleClient.connect.mockRejectedValueOnce(new Error('dropped'));
    const robot = new RobotConnection();
    await robot.connect();
    expect(BleClient.connect).toHaveBeenCalledTimes(2);
    expect(robot.connected).toBe(true);
  });

  it('asks to enable Bluetooth when it is off', async () => {
    BleClient.isEnabled.mockResolvedValue(false);
    BleClient.requestEnable.mockRejectedValueOnce(new Error('requestEnable failed.'));
    await expect(new RobotConnection().connect()).rejects.toMatchObject({ code: 'BT_OFF' });
  });

  it('reports a cancelled chooser as CANCELLED', async () => {
    BleClient.requestDevice.mockRejectedValue(new Error('requestDevice cancelled.'));
    await expect(new RobotConnection().connect()).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('refuses a device without a robot name', async () => {
    BleClient.requestDevice.mockResolvedValue({ deviceId: 'AA:BB' });
    await expect(new RobotConnection().connect()).rejects.toMatchObject({ code: 'NO_DEVICE_NAME' });
  });

  it('goes offline when the link is lost', async () => {
    const robot = new RobotConnection();
    const statuses = [];
    await robot.connect();
    robot.onStatusChange = (s) => statuses.push(s);
    BleClient.connect.mock.calls[0][1]();
    expect(robot.connected).toBe(false);
    expect(statuses).toEqual(['disconnected']);
  });

});

describe('notifications', () => {
  it('reassembles a split frame from a view with an offset and reads the firmware version', async () => {
    const robot = connectedRobot();
    robot.writeCharacteristic = FFE1;
    const seen = [];
    robot.onResponse = (f) => seen.push(f);
    const frame = [0x68, 1, 0, 0xa3, 0x31, 0xd3, 0x3f, 4, 0, 1, 0x68, 0x85, 0, 4, 0, 1, 1, 4, 0, 0, 0x16];
    const padded = new Uint8Array([0xff, ...frame]);
    robot._onNotification(new DataView(padded.buffer, 1, 20 - 5));
    robot._onNotification(new DataView(padded.buffer, 16, 6));
    expect(seen).toHaveLength(1);
    expect(seen[0].cmd).toBe(0x85);
    expect(robot.firmwareVersion).toBe('01.14');
  });
});
