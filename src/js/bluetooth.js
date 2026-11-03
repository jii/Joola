/**
 * Native Bluetooth communication with the Joola Infinity table tennis robot.
 * Uses BLE GATT with a proprietary frame format.
 */
import { BleClient } from '@capacitor-community/bluetooth-le';
import { logger as console } from './diag.js';

/** Error with a stable code that the UI can translate. */
export class RobotError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RobotError';
    this.code = code;
  }
}

const MAX_SINGLE_POINT_COUNT = 32767;  // 16-bit signed field; the original app's "endless" value
const MAX_CYCLE_COUNT = 255;           // cycle counts travel in a single trailer byte
const RANDOM_FLAG = 0x80;
const LAND_RANDOM = 2;
const LAND_FIVE_RANDOM = 3;
const CONNECT_TIMEOUT_MS = 10000;
const MAX_CONNECT_ATTEMPTS = 3;
const HANDSHAKE_DELAY_MS = 300;  // the original app pauses this long between commands

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const byUuid = (list, uuid) => list.find((item) => item.uuid.toLowerCase() === uuid);

// ── BLE UUIDs ────────────────────────────────────────────────
const SERVICE_UUID     = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHAR_UUID        = '0000ffe1-0000-1000-8000-00805f9b34fb';
const ALT_SERVICE_UUID = '0000fee7-0000-1000-8000-00805f9b34fb';
const ALT_CHAR_WRITE   = '0000fec8-0000-1000-8000-00805f9b34fb';
const ALT_CHAR_NOTIFY  = '0000fec7-0000-1000-8000-00805f9b34fb';

// ── Frame constants ──────────────────────────────────────────
const FRAME_START = 0x68;
const FRAME_END   = 0x16;
const FRAME_FIXED = 0x01;

// ── Command IDs ──────────────────────────────────────────────
// Cmd byte sits at frame offset 11. Sub-action (when present) is in payload[0].
const CMD_CONNECT     = 0x89;  // payload {0x00}
const CMD_DISCONNECT  = 0x99;  // payload {0x00}
const CMD_PATTERN     = 0x01;  // payload = drill bytes
const CMD_CONTROL     = 0x03;  // payload {0x00}=STOP, {0x01}=START_CALIBRATION
const CMD_GET_INFO    = 0x05;  // empty payload; robot replies with firmware version (cmd 0x85)

const CTRL_STOP        = 0x00;
const CTRL_CALIBRATION = 0x01;

const CMD_NAMES = {
  [CMD_CONNECT]:    'CONNECT',
  [CMD_DISCONNECT]: 'DISCONNECT',
  [CMD_PATTERN]:    'PATTERN',
  [CMD_CONTROL]:    'CONTROL',
  [CMD_GET_INFO]:   'GET_INFO',
};

// ── Grid position mapping ────────────────────────────────────
// x is the cell number 1–15, directly mapping to cells A1–A15 in
// the 3×5 visual grid (row 0: A1–A5, row 1: A6–A10, row 2: A11–A15).
// y is a robot depth parameter (1=short, 2=medium, 3=long) and does
// NOT determine the visual row — it is sent directly to the robot.

export function cellToPoint(cellIndex) {
  return { x: cellIndex + 1, y: 2 }; // default depth: medium (2)
}

export function pointToCell(x, y) {
  const cellIndex = x - 1;
  if (cellIndex < 0 || cellIndex > 14) return -1;
  return cellIndex;
}

// ── CRC-CCITT (polynomial 0x1021, init 0x0000) ─────────────
// Lookup table extracted from the original Joola robot APK
const CRC_TABLE = [
  0, 4129, 8258, 12387, 16516, 20645, 24774, 28903, 33032, 37161, 41290, 45419, 49548, 53677, 57806, 61935,
  4657, 528, 12915, 8786, 21173, 17044, 29431, 25302, 37689, 33560, 45947, 41818, 54205, 50076, 62463, 58334,
  9314, 13379, 1056, 5121, 25830, 29895, 17572, 21637, 42346, 46411, 34088, 38153, 58862, 62927, 50604, 54669,
  13907, 9842, 5649, 1584, 30423, 26358, 22165, 18100, 46939, 42874, 38681, 34616, 63455, 59390, 55197, 51132,
  18628, 22757, 26758, 30887, 2112, 6241, 10242, 14371, 51660, 55789, 59790, 63919, 35144, 39273, 43274, 47403,
  23285, 19156, 31415, 27286, 6769, 2640, 14899, 10770, 56317, 52188, 64447, 60318, 39801, 35672, 47931, 43802,
  27814, 31879, 19684, 23749, 11298, 15363, 3168, 7233, 60846, 64911, 52716, 56781, 44330, 48395, 36200, 40265,
  32407, 28342, 24277, 20212, 15891, 11826, 7761, 3696, 65439, 61374, 57309, 53244, 48923, 44858, 40793, 36728,
  37256, 33193, 45514, 41451, 53516, 49453, 61774, 57711, 4224, 161, 12482, 8419, 20484, 16421, 28742, 24679,
  33721, 37784, 41979, 46042, 49981, 54044, 58239, 62302, 689, 4752, 8947, 13010, 16949, 21012, 25207, 29270,
  46570, 42443, 38312, 34185, 62830, 58703, 54572, 50445, 13538, 9411, 5280, 1153, 29798, 25671, 21540, 17413,
  42971, 47098, 34713, 38840, 59231, 63358, 50973, 55100, 9939, 14066, 1681, 5808, 26199, 30326, 17941, 22068,
  55628, 51565, 63758, 59695, 39368, 35305, 47498, 43435, 22596, 18533, 30726, 26663, 6336, 2273, 14466, 10403,
  52093, 56156, 60223, 64286, 35833, 39896, 43963, 48026, 19061, 23124, 27191, 31254, 2801, 6864, 10931, 14994,
  64814, 60687, 56684, 52557, 48554, 44427, 40424, 36297, 31782, 27655, 23652, 19525, 15522, 11395, 7392, 3265,
  61215, 65342, 53085, 57212, 44955, 49082, 36825, 40952, 28183, 32310, 20053, 24180, 11923, 16050, 3793, 7920,
];

function crcCCITT(data) {
  let crc = 0;
  for (const b of data) {
    crc = (CRC_TABLE[((crc >> 8) ^ b) & 0xFF] ^ (crc << 8)) & 0xFFFF;
  }
  return crc;
}

// ── Hex string to bytes ─────────────────────────────────────
function hexToBytes(hex) {
  const padded = hex.length % 2 ? '0' + hex : hex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.substr(i * 2, 2), 16);
  }
  return bytes;
}

// ── Frame builder ────────────────────────────────────────────
function buildFrame(deviceId, cmdType, payload) {
  // deviceId: 16-char hex string, hex-decoded to 8 bytes
  const devBytes = hexToBytes(deviceId.padEnd(16, '0').slice(0, 16));
  const len = payload.length;
  // Header: start(1) + fixed(1) + devId(8) + start(1) + cmd(1) + len(2) = 14
  const frame = new Uint8Array(14 + len + 3); // +crc(2) +end(1)
  let i = 0;
  frame[i++] = FRAME_START;
  frame[i++] = FRAME_FIXED;
  frame.set(devBytes, i); i += 8;
  frame[i++] = FRAME_START;
  frame[i++] = cmdType & 0xFF;
  frame[i++] = (len >> 8) & 0xFF;  // length high byte (big-endian)
  frame[i++] = len & 0xFF;         // length low byte
  frame.set(payload, i); i += len;
  const crc = crcCCITT(frame.subarray(0, i));
  frame[i++] = (crc >> 8) & 0xFF;   // CRC high byte (big-endian)
  frame[i++] = crc & 0xFF;           // CRC low byte
  frame[i++] = FRAME_END;

  const cmdName = CMD_NAMES[cmdType] ?? `0x${cmdType.toString(16).padStart(2, '0')}`;
  console.debug(`[BT] buildFrame cmd=${cmdName} payloadLen=${len} totalLen=${frame.length} crc=0x${crc.toString(16).padStart(4, '0')} frame=${Array.from(frame).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

  return frame;
}

// ── Robot connection class ───────────────────────────────────
const singlePointTiming = (ballTime) => Math.trunc(Math.max(0, 19 - ballTime) * 3.5);

function singlePointCount(drill) {
  if (drill.times === -1) return MAX_SINGLE_POINT_COUNT;
  if (drill.numType !== 0) return drill.times;
  return Math.trunc((Math.max(0, 19 - drill.ballTime) * 3.5 + 30) * drill.times * 0.5);
}

// `times` counts 30-second blocks when numType is 0.
function ballsForTime(drill) {
  return Math.trunc((drill.times * 30) / (drill.ballTime * 0.08 + 1.1));
}

function multiPointCycles(drill, numPoints, isRandom) {
  const balls = drill.numType === 0 ? ballsForTime(drill) : drill.times;
  if (balls === -1) return MAX_CYCLE_COUNT;
  // Random drills count single balls, the others count rounds through all points.
  return Math.max(1, isRandom ? balls : Math.trunc(balls / numPoints));
}

function intervalFields(drill) {
  if (drill.intervalTrain !== 1) return [0, 0];
  const groups = drill.ballList;
  const roundSeconds = groups.reduce((sum, g) => sum + g.ballTime * 0.08 + 0.6, 0) + (drill.repeatDelay ?? 0) * 0.2;
  const runSeconds = (drill.trainRunTime ?? 0) * 30;
  const rounds = roundSeconds >= runSeconds ? 1 : Math.trunc(runSeconds / roundSeconds) + 1;
  return [rounds, drill.trainPauseTime ?? 0];
}

function deviceIdFromName(name) {
  // J-XXXXXXXXXXXXXXXX: 16 hex characters that decode to the frame's 8 device ID bytes
  if (!name?.startsWith('J-')) throw new RobotError('NO_DEVICE_NAME');
  return name.substring(2, 18).padEnd(16, '0');
}

export class RobotConnection {
  constructor() {
    this.bleDeviceId = null;
    this.deviceName = null;
    this.service = null;
    this.writeCharacteristic = null;
    this.writeWithResponse = false;
    this.connected = false;
    this.deviceId = '0000000000000000';
    this.firmwareVersion = null;
    this.onStatusChange = null;  // callback(status: 'connected'|'disconnected'|'connecting')
    this.onResponse = null;      // callback(parsedFrame: object)
    this._status = 'disconnected';
    this._rxBuffer = [];         // accumulates incoming notification bytes
    this._rxComplete = false;
    this.baseConf = [];          // populated by app.js from the bundled base-conf
  }

  async connect() {
    this._setStatus('connecting');
    try {
      const device = await this._chooseDevice();
      this.bleDeviceId = device.deviceId;
      this.deviceName = device.name ?? null;
      this.deviceId = deviceIdFromName(this.deviceName);
      console.log(`[BT] Device selected: "${this.deviceName}" id=${this.deviceId}`);

      await this._openGatt();

      // Same order as the original app: firmware query, then the handshake.
      await this._send(CMD_GET_INFO, new Uint8Array(0));
      await wait(HANDSHAKE_DELAY_MS);
      console.log('[BT] Sending handshake (CMD_CONNECT)…');
      await this._send(CMD_CONNECT, new Uint8Array([0]));

      this.connected = true;
      this._setStatus('connected');
      console.log('[BT] Connection established');
    } catch (err) {
      console.error(`[BT] Connection failed: ${err.message}`);
      if (this.bleDeviceId) await BleClient.disconnect(this.bleDeviceId).catch(() => {});
      this.connected = false;
      this._setStatus('disconnected');
      throw err;
    }
  }

  async _chooseDevice() {
    try {
      await BleClient.initialize({ androidNeverForLocation: true });
    } catch (err) {
      throw new RobotError('BT_PERMISSION', err.message);
    }
    if (!(await BleClient.isEnabled())) {
      try {
        await BleClient.requestEnable();
      } catch (err) {
        throw new RobotError('BT_OFF', err.message);
      }
    }
    console.log('[BT] Requesting Bluetooth device (filter: namePrefix "J-")…');
    try {
      return await BleClient.requestDevice({
        namePrefix: 'J-',
        optionalServices: [SERVICE_UUID, ALT_SERVICE_UUID],
      });
    } catch (err) {
      const cancelled = /cancel/i.test(err.message ?? '');
      throw new RobotError(cancelled ? 'CANCELLED' : 'NOT_FOUND', err.message);
    }
  }

  async _openGatt() {
    // The link can drop during service discovery; retry before giving up.
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
      try {
        console.log(`[BT] Connecting to GATT server (attempt ${attempt}/${MAX_CONNECT_ATTEMPTS})…`);
        await BleClient.connect(this.bleDeviceId, () => this._onLinkLost(), { timeout: CONNECT_TIMEOUT_MS });
        await this._setupCharacteristics();
        return;
      } catch (err) {
        console.warn(`[BT] GATT setup failed: ${err.message}`);
        await BleClient.disconnect(this.bleDeviceId).catch(() => {});
        if (attempt === MAX_CONNECT_ATTEMPTS) throw err;
        await wait(500);
      }
    }
  }

  async _setupCharacteristics() {
    const services = await BleClient.getServices(this.bleDeviceId);
    console.log(`[BT] Services: ${services.map((s) => s.uuid).join(', ')}`);
    const primary = byUuid(services, SERVICE_UUID);
    const alt = byUuid(services, ALT_SERVICE_UUID);
    const service = primary ?? alt;
    if (!service) throw new RobotError('NO_SERVICE');

    const writeUuid = primary ? CHAR_UUID : ALT_CHAR_WRITE;
    const notifyUuid = primary ? CHAR_UUID : ALT_CHAR_NOTIFY;
    const write = byUuid(service.characteristics, writeUuid);
    const notify = byUuid(service.characteristics, notifyUuid);
    if (!write) throw new RobotError('NO_SERVICE');

    this.service = service.uuid;
    this.writeCharacteristic = write.uuid;
    this.writeWithResponse = !write.properties.writeWithoutResponse;
    console.log(`[BT] Using ${primary ? 'primary' : 'alternative'} service, writeWithResponse=${this.writeWithResponse}`);

    if (notify?.properties.notify) {
      await BleClient.startNotifications(this.bleDeviceId, service.uuid, notify.uuid, (value) => this._onNotification(value));
      console.debug('[BT] Notifications enabled');
    } else {
      console.warn('[BT] Notifications not available');
    }
  }

  _onLinkLost() {
    console.warn('[BT] GATT server disconnected');
    this.connected = false;
    if (this._status !== 'connecting') this._setStatus('disconnected');
  }

  async disconnect() {
    console.log('[BT] Disconnecting…');
    if (this.connected) {
      await this._send(CMD_DISCONNECT, new Uint8Array([0])).catch((err) => {
        console.warn(`[BT] Failed to send disconnect frame: ${err.message}`);
      });
      await BleClient.disconnect(this.bleDeviceId).catch((err) => {
        console.warn(`[BT] Disconnect failed: ${err.message}`);
      });
    }
    this.connected = false;
    this._setStatus('disconnected');
  }

  /**
   * Send a basic drill pattern to the robot and start playing.
   * @param {object} drill - The drill object from the API
   */
  async sendBasicDrill(drill) {
    console.log(`[BT] Sending basic drill: ${drill.points?.length ?? 0} point(s), ball=${drill.ball} spin=${drill.spin} power=${drill.power} ballTime=${drill.ballTime} times=${drill.times} landType=${drill.landType}`);
    const payload = this._encodeBasicPattern(drill);
    console.debug(`[BT] Encoded payload (${payload.length} bytes): ${Array.from(payload).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    await this._send(CMD_PATTERN, payload);
  }

  /**
   * Send an advance drill, a list of ball groups with their own settings.
   * @param {object} drill - The advance drill from the API
   */
  async sendAdvanceDrill(drill) {
    console.log(`[BT] Sending advance drill: ${drill.ballList?.length ?? 0} ball group(s), repeatNum=${drill.repeatNum} repeatDelay=${drill.repeatDelay}`);
    const payload = this._encodeAdvancePattern(drill);
    console.debug(`[BT] Encoded payload (${payload.length} bytes): ${Array.from(payload).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    await this._send(CMD_PATTERN, payload);
  }

  async stop() {
    console.log('[BT] Sending stop command');
    await this._send(CMD_CONTROL, new Uint8Array([CTRL_STOP]));
  }

  // ── Internal ─────────────────────────────────────────────

  _lookupMotorParams(ball, spin, power, landarea) {
    const entry = this.baseConf.find(
      e => e.ball === ball && e.spin === spin && e.power === power && e.landarea === landarea
    );
    if (!entry) {
      console.warn(`[BT] No base-conf entry for ball=${ball} spin=${spin} power=${power} landarea=${landarea}`);
    }
    return entry ?? null;
  }

  _motorParams(ball, spin, power, landarea) {
    const params = this._lookupMotorParams(ball, spin, power, landarea);
    if (!params) throw new RobotError('NO_MOTOR_PARAMS');
    return params;
  }

  // Byte layout taken from the original app (2.1.1):
  //  0-4  m1speed, m2speed, xaxis, yaxis, zaxis
  //  5-6  balls at this point (big-endian)
  //  7    single-point timing, bit 7 = random
  //  8    ball time
  //  9    number of points in a random group, otherwise 1
  //  10   landing mode
  //  11   mode flag
  _writePoint(buf, off, params, { count, timing, ballTime, points, mode, flag }) {
    buf[off + 0] = params.m1speed & 0xFF;
    buf[off + 1] = params.m2speed & 0xFF;
    buf[off + 2] = params.xaxis & 0xFF;
    buf[off + 3] = params.yaxis & 0xFF;
    buf[off + 4] = params.zaxis & 0xFF;
    buf[off + 5] = (count >> 8) & 0xFF;
    buf[off + 6] = count & 0xFF;
    buf[off + 7] = timing & 0xFF;
    buf[off + 8] = ballTime & 0xFF;
    buf[off + 9] = points & 0xFF;
    buf[off + 10] = mode & 0xFF;
    buf[off + 11] = flag & 0xFF;
  }

  _encodeBasicPattern(drill) {
    const points = drill.points || [];
    if (points.length === 0) throw new RobotError('NO_POINTS');
    const isRandom = drill.landType === LAND_RANDOM;
    const singlePoint = points.length === 1;
    const ballTime = drill.ballTime ?? 9;
    const count = singlePoint ? singlePointCount(drill) : 1;
    const cycles = singlePoint ? 1 : multiPointCycles(drill, points.length, isRandom);
    const timing = singlePoint ? singlePointTiming(ballTime) : (isRandom ? RANDOM_FLAG : 0);
    if (count > MAX_SINGLE_POINT_COUNT || cycles > MAX_CYCLE_COUNT) throw new RobotError('COUNT_RANGE');

    const buf = new Uint8Array(points.length * 12 + 4);
    points.forEach((p, i) => {
      this._writePoint(buf, i * 12, this._motorParams(drill.ball, drill.spin, drill.power, p.x), {
        count,
        timing,
        ballTime: singlePoint ? 0 : ballTime,
        points: 1,
        mode: isRandom ? LAND_RANDOM : 0,
        flag: isRandom ? 1 : 0,
      });
    });
    buf[points.length * 12] = cycles;
    return buf;
  }

  _encodeAdvancePattern(drill) {
    const groups = drill.ballList || [];
    const total = groups.reduce((sum, group) => sum + (group.points?.length ?? 0), 0);
    if (total === 0) throw new RobotError('NO_POINTS');
    if (drill.repeatNum < 1 || drill.repeatNum > MAX_CYCLE_COUNT) throw new RobotError('COUNT_RANGE');

    const buf = new Uint8Array(total * 12 + 4);
    let off = 0;
    for (const group of groups) {
      const pointCount = group.points?.length ?? 0;
      const isRandom = group.random === 1;
      (group.points ?? []).forEach((p, i) => {
        const firstOfFive = pointCount > 1 && group.landType === LAND_FIVE_RANDOM && i === 0;
        this._writePoint(buf, off, this._motorParams(group.ball, group.spin, group.power, p.x), {
          count: 1,
          timing: isRandom ? RANDOM_FLAG : 0,
          ballTime: group.ballTime,
          points: pointCount > 1 ? pointCount : 1,
          mode: firstOfFive ? 1 : 0,
          flag: isRandom ? 0 : 1,
        });
        off += 12;
      });
    }
    const [intervalRounds, pauseTime] = intervalFields(drill);
    buf[off] = drill.repeatNum;
    buf[off + 1] = drill.repeatDelay ?? 0;
    buf[off + 2] = intervalRounds;
    buf[off + 3] = pauseTime;
    return buf;
  }

  async _send(cmd, payload) {
    if (!this.writeCharacteristic) throw new RobotError('NOT_CONNECTED');
    const cmdName = CMD_NAMES[cmd] ?? `0x${cmd.toString(16).padStart(2, '0')}`;
    const frame = buildFrame(this.deviceId, cmd, payload);

    // BLE has a max write size (usually 20 bytes), chunk if needed
    const MTU = 20;
    const numChunks = Math.ceil(frame.length / MTU);
    console.debug(`[BT] _send cmd=${cmdName} frameLen=${frame.length} chunks=${numChunks}`);
    for (let i = 0; i < frame.length; i += MTU) {
      const chunk = frame.slice(i, Math.min(i + MTU, frame.length));
      const chunkIndex = Math.floor(i / MTU);
      console.debug(`[BT]   chunk[${chunkIndex}/${numChunks}] len=${chunk.length} data=${Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      await this._writeChunk(chunk);
    }
    console.debug(`[BT] _send cmd=${cmdName} done`);
  }

  _writeChunk(chunk) {
    const value = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const write = this.writeWithResponse ? 'write' : 'writeWithoutResponse';
    return BleClient[write](this.bleDeviceId, this.service, this.writeCharacteristic, value);
  }

  // ── Response reassembly & parsing ──────────────────────────

  _onNotification(dataView) {
    const chunk = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    console.debug(`[BT] Notification chunk len=${chunk.length} data=${Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    const first = chunk[0];
    const last = chunk[chunk.length - 1];

    // Frame start: clear buffer and begin accumulation
    if (first === FRAME_START) {
      this._rxBuffer = [];
      this._rxComplete = false;
      for (const b of chunk) this._rxBuffer.push(b);
      if (last === FRAME_END) this._rxComplete = true;
    } else if (last === FRAME_END) {
      for (const b of chunk) this._rxBuffer.push(b);
      this._rxComplete = true;
    } else {
      for (const b of chunk) this._rxBuffer.push(b);
    }

    if (!this._rxComplete) return;

    const frame = new Uint8Array(this._rxBuffer);
    this._rxBuffer = [];
    this._rxComplete = false;

    console.debug(`[BT] Complete response frame (${frame.length} bytes): ${Array.from(frame).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    const parsed = this._parseFrame(frame);
    if (parsed) {
      this.onResponse?.(parsed);
    }
  }

  _parseFrame(frame) {
    // Minimum frame: 14 header + 2 CRC + 1 end = 17 bytes
    if (frame.length < 17) {
      console.warn(`[BT] Response frame too short (${frame.length} bytes)`);
      return null;
    }

    const payloadLen = (frame[12] << 8) | frame[13]; // big-endian length
    if (frame.length - 17 !== payloadLen) {
      console.warn(`[BT] Response frame length mismatch: expected ${payloadLen + 17}, got ${frame.length}`);
      return null;
    }

    // Extract fields
    const deviceId = Array.from(frame.subarray(2, 10)).map(b => b.toString(16).padStart(2, '0')).join('');
    const cmd = frame[11];
    const cmdName = CMD_NAMES[cmd & 0xFF] ?? `0x${(cmd & 0xFF).toString(16).padStart(2, '0')}`;
    const payload = frame.subarray(14, 14 + payloadLen);
    const crcReceived = (frame[frame.length - 3] << 8) | frame[frame.length - 2];
    const crcData = frame.subarray(0, 14 + payloadLen);
    const crcComputed = crcCCITT(crcData);

    if (crcReceived !== crcComputed) {
      console.warn(`[BT] Response CRC mismatch: received=0x${crcReceived.toString(16).padStart(4, '0')} computed=0x${crcComputed.toString(16).padStart(4, '0')}`);
    }

    const status = frame[10];
    const parsed = { cmd, cmdName, status, deviceId, payloadLen, payload };
    console.log(`[BT] Response: cmd=${cmdName} status=0x${status.toString(16).padStart(2, '0')} payloadLen=${payloadLen} crcOk=${crcReceived === crcComputed}`);

    // Version info (status byte 0x85 = -123 signed)
    if ((frame[11] & 0xFF) === 0x85 && payloadLen === 4) {
      const ver = `${payload[0]}${payload[1]}.${payload[2]}${payload[3]}`;
      console.log(`[BT] Robot firmware version: ${ver}`);
      parsed.firmwareVersion = ver;
      this.firmwareVersion = ver;
    }

    return parsed;
  }

  _setStatus(status) {
    console.log(`[BT] Status → ${status}`);
    this._status = status;
    this.onStatusChange?.(status);
  }
}
