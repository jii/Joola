/**
 * Local data layer. Replaces the pinfinity backend: drills live in the phone
 * and every write goes through one queue, so writes can never overwrite
 * each other.
 */
import { Preferences } from '@capacitor/preferences';
import defaultBasic from '../data/basic-list.json';
import defaultAdvance from '../data/advance-list.json';
import baseConf from '../data/base-conf.json';

const DEFAULTS = { basic: defaultBasic, advance: defaultAdvance };
const CUSTOM_UID = 123;
const BACKUP_FORMAT = 'pinfinity-backup';

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

const storageKey = (kind) => `drills.${kind}`;

async function load(kind) {
  const { value } = await Preferences.get({ key: storageKey(kind) });
  if (value === null || value === undefined) return structuredClone(DEFAULTS[kind]);
  return JSON.parse(value);
}

async function store(kind, drills) {
  await Preferences.set({ key: storageKey(kind), value: JSON.stringify(drills) });
}

function update(kind, change) {
  return enqueue(async () => {
    const drills = await load(kind);
    const result = change(drills);
    await store(kind, drills);
    return result;
  });
}

function findDrill(drills, id) {
  const drill = drills.find((d) => d.id === id);
  if (!drill) throw new Error(`Drill ${id} not found`);
  return drill;
}

function saveDrill(kind, input) {
  return update(kind, (drills) => {
    const now = new Date().toISOString();
    if (!input.id) {
      const id = drills.reduce((max, d) => Math.max(max, d.id), 0) + 1;
      const doc = {
        ...input, id, uid: CUSTOM_UID,
        isFavourite: input.isFavourite ?? 0,
        createDate: now, updateDate: now,
        subTime: 0, collectFlag: 0,
        lastPlayDate: Math.floor(Date.now() / 1000), lastPlayDateUTC: now,
      };
      drills.push(doc);
      return { data: doc };
    }
    const doc = findDrill(drills, input.id);
    Object.assign(doc, input, { uid: CUSTOM_UID, updateDate: now });
    return { data: doc };
  });
}

function deleteDrill(kind, id) {
  return update(kind, (drills) => {
    drills.splice(drills.indexOf(findDrill(drills, id)), 1);
  });
}

function setFavourite(kind, id, favourite) {
  return update(kind, (drills) => { findDrill(drills, id).isFavourite = favourite; });
}

function byLastPlayed(a, b) {
  return (b.lastPlayDate ?? 0) - (a.lastPlayDate ?? 0);
}

function matchesName(drill, name) {
  return !name || drill.name.toLowerCase().includes(name.toLowerCase());
}

function matchesPattern(drill, patternType) {
  if (patternType === 0) return drill.uid === 0;
  if (patternType === 1) return drill.uid !== 0;
  return true;
}

// ── Basic drills ─────────────────────────────────────────────

export async function getBasicList({ patternType = -1, name = '', ball = -1, spin = -1 } = {}) {
  const drills = await enqueue(() => load('basic'));
  const records = drills
    .filter((d) => matchesPattern(d, patternType) && matchesName(d, name))
    .filter((d) => (ball === -1 || d.ball === ball) && (spin === -1 || d.spin === spin))
    .sort(byLastPlayed);
  return { data: { records, totalCount: records.length } };
}

export const saveBasicDrill = (drill) => saveDrill('basic', drill);
export const deleteBasicDrill = (id) => deleteDrill('basic', id);
export const setBasicFavourite = (id, favourite) => setFavourite('basic', id, favourite);

// ── Advance drills ───────────────────────────────────────────

export async function getAdvanceList({ patternType = -1, name = '' } = {}) {
  const drills = await enqueue(() => load('advance'));
  const records = drills
    .filter((d) => matchesPattern(d, patternType) && matchesName(d, name))
    .sort(byLastPlayed);
  return { data: { records, totalCount: records.length } };
}

export const saveAdvanceDrill = (drill) => saveDrill('advance', drill);
export const deleteAdvanceDrill = (id) => deleteDrill('advance', id);
export const setAdvanceFavourite = (id, favourite) => setFavourite('advance', id, favourite);

// ── Config & session log ─────────────────────────────────────

export async function getBaseConf() {
  return { data: baseConf };
}

export async function logSession({ drillType, pid, stime, startTime }) {
  if (!pid || !(drillType in DEFAULTS)) return;
  await update(drillType, (drills) => {
    const drill = drills.find((d) => d.id === pid);
    if (!drill) return;
    drill.lastPlayDate = stime;
    drill.lastPlayDateUTC = startTime;
  });
}

// ── Backup ───────────────────────────────────────────────────

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function assertCommonFields(drill, label) {
  if (typeof drill !== 'object' || drill === null || Array.isArray(drill)) {
    throw new Error(`${label}: not an object`);
  }
  if (!isInt(drill.id, 1, Number.MAX_SAFE_INTEGER)) throw new Error(`${label}: invalid id`);
  if (typeof drill.name !== 'string' || !drill.name.trim()) throw new Error(`${label}: invalid name`);
}

function assertBasicDrill(drill, label) {
  assertCommonFields(drill, label);
  const valid = isInt(drill.ball, 0, 2) && isInt(drill.spin, 0, 4) && isInt(drill.power, 0, 3)
    && isInt(drill.times, 1, 999) && isInt(drill.ballTime, 0, 21) && Array.isArray(drill.points)
    && drill.points.length > 0
    && drill.points.every((p) => isInt(p?.x, 1, 15) && isInt(p?.y, 1, 3));
  if (!valid) throw new Error(`${label}: invalid drill values`);
}

function assertAdvanceDrill(drill, label) {
  assertCommonFields(drill, label);
  if (!Array.isArray(drill.ballList)) throw new Error(`${label}: invalid ballList`);
}

function assertList(list, name, assertDrill) {
  if (!Array.isArray(list)) throw new Error(`${name}: not a list`);
  list.forEach((drill, i) => assertDrill(drill, `${name}[${i}]`));
  if (new Set(list.map((d) => d.id)).size !== list.length) throw new Error(`${name}: duplicate ids`);
}

export async function exportBackup() {
  const [basic, advance] = await enqueue(() => Promise.all([load('basic'), load('advance')]));
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, basic, advance }, null, 1);
}

/** Validates the whole backup first, so a bad file leaves the current drills untouched. */
export async function importBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file');
  }
  if (backup?.format !== BACKUP_FORMAT) throw new Error('Not a Pinfinity backup');
  assertList(backup.basic, 'basic', assertBasicDrill);
  assertList(backup.advance, 'advance', assertAdvanceDrill);
  await enqueue(async () => {
    await store('basic', backup.basic);
    await store('advance', backup.advance);
  });
  return { imported: ['basic', 'advance'] };
}
