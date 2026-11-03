import { vi } from 'vitest';

export const prefs = new Map();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: prefs.has(key) ? prefs.get(key) : null }),
    set: async ({ key, value }) => { prefs.set(key, value); },
  },
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => true),
    requestEnable: vi.fn(async () => {}),
    requestDevice: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    getServices: vi.fn(),
    startNotifications: vi.fn(async () => {}),
    write: vi.fn(async () => {}),
    writeWithoutResponse: vi.fn(async () => {}),
  },
}));
