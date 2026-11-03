import { beforeEach, describe, expect, it } from 'vitest';
import { prefs } from './setup-mocks.js';
import * as api from '../src/js/api.js';
import defaults from '../src/data/basic-list.json';

const drill = { id: 0, name: 'Moje', ball: 1, spin: 3, power: 3, landType: 0, ballTime: 9, numType: 1, times: 20, points: [{ x: 5, y: 2 }] };
const records = async (q) => (await api.getBasicList(q)).data.records;

beforeEach(() => prefs.clear());

describe('drills', () => {
  it('starts with the bundled drills', async () => {
    expect(await records()).toHaveLength(defaults.length);
  });

  it('does not lose concurrent saves', async () => {
    const saved = await Promise.all(Array.from({ length: 20 }, (_, i) => api.saveBasicDrill({ ...drill, name: `d${i}` })));
    expect(new Set(saved.map((s) => s.data.id)).size).toBe(20);
    expect(await records()).toHaveLength(defaults.length + 20);
  });

  it('updates, favourites and deletes', async () => {
    const { data } = await api.saveBasicDrill(drill);
    await api.saveBasicDrill({ ...drill, id: data.id, name: 'Nové' });
    await api.setBasicFavourite(data.id, 1);
    expect((await records()).find((d) => d.id === data.id)).toMatchObject({ name: 'Nové', isFavourite: 1, uid: 123 });
    await api.deleteBasicDrill(data.id);
    expect((await records()).some((d) => d.id === data.id)).toBe(false);
  });

  it('reports a missing drill instead of pretending success', async () => {
    await expect(api.saveBasicDrill({ ...drill, id: 999999 })).rejects.toThrow('not found');
    await expect(api.deleteBasicDrill(999999)).rejects.toThrow('not found');
  });

  it('filters by source, name and ball', async () => {
    await api.saveBasicDrill(drill);
    expect(await records({ patternType: 1 })).toHaveLength(1);
    expect((await records({ patternType: 0 })).length).toBe(defaults.length);
    expect(await records({ name: 'MOJ' })).toHaveLength(1);
    expect((await records({ ball: 0 })).every((d) => d.ball === 0)).toBe(true);
  });

  it('puts the last played drill first, whatever its position', async () => {
    const last = defaults.at(-1);
    await api.logSession({ drillType: 'basic', pid: last.id, stime: 2000000000, startTime: '2033-05-18T03:33:20.000Z' });
    expect((await records())[0].id).toBe(last.id);
  });

  it('ignores a session log for an unsaved drill', async () => {
    await api.logSession({ drillType: 'basic', pid: 0, stime: 1, startTime: 'x' });
    expect(await records()).toHaveLength(defaults.length);
  });
});

describe('backup', () => {
  it('round-trips drills', async () => {
    await api.saveBasicDrill(drill);
    const backup = await api.exportBackup();
    prefs.clear();
    await api.importBackup(backup);
    expect(await records({ patternType: 1 })).toHaveLength(1);
  });

  it.each([
    ['not JSON', 'nope'],
    ['JSON of another shape', '{"evil": 1}'],
    ['wrong format mark', '{"format":"x","basic":[],"advance":[]}'],
    ['basic is not a list', '{"format":"pinfinity-backup","basic":{},"advance":[]}'],
    ['drill out of range', JSON.stringify({ format: 'pinfinity-backup', advance: [], basic: [{ id: 1, name: 'x', ball: 9, spin: 0, power: 0, times: 1, ballTime: 9, points: [{ x: 1, y: 1 }] }] })],
    ['point out of range', JSON.stringify({ format: 'pinfinity-backup', advance: [], basic: [{ id: 1, name: 'x', ball: 1, spin: 0, power: 0, times: 1, ballTime: 9, points: [{ x: 99, y: 1 }] }] })],
    ['duplicate ids', JSON.stringify({ format: 'pinfinity-backup', advance: [{ id: 1, name: 'a', ballList: [] }, { id: 1, name: 'b', ballList: [] }], basic: [] })],
  ])('rejects %s and keeps the current drills', async (_label, text) => {
    await api.saveBasicDrill(drill);
    await expect(api.importBackup(text)).rejects.toThrow();
    expect(await records({ patternType: 1 })).toHaveLength(1);
  });

  it('accepts every bundled drill', async () => {
    await expect(api.importBackup(await api.exportBackup())).resolves.toBeTruthy();
  });
});
