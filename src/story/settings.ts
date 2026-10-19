import type { IslandSettings } from '../island/island.js';
import type { StoryWorld } from './sequence.js';

export interface SettingsStore {
  read(): string | null;
  write(text: string): void;
}

interface IniValues {
  Background: number;
  Clouds: number;
  Waves: number;
  NumDays: number;
  Introduction: number;
  CurrentYear: number;
  CurrentMonth: number;
  CurrentDay: number;
  StartTime: number;
}

const STORAGE_KEY = 'SCRANTIC.INI';
const DEFAULTS: IniValues = {
  Background: 1, Clouds: 1, Waves: 1, NumDays: 0, Introduction: 0, CurrentYear: 0, CurrentMonth: 0, CurrentDay: 0, StartTime: 900,
};

const int8 = (value: number) => (value << 24) >> 24;
const int16 = (value: number) => (value << 16) >> 16;

export function localSettingsStore(): SettingsStore {
  return {
    read: () => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    write: (text) => {
      try {
        localStorage.setItem(STORAGE_KEY, text);
      } catch {
        return;
      }
    },
  };
}

function parse(text: string | null): Partial<IniValues> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Partial<IniValues>) : {};
  } catch {
    return {};
  }
}

export function loadSettings(store: SettingsStore, world: StoryWorld, island: IslandSettings): void {
  const values = { ...DEFAULTS, ...parse(store.read()) };
  island.background = values.Background !== 0;
  island.clouds = values.Clouds !== 0;
  island.waves = values.Waves !== 0;
  world.days = {
    numDays: int8(values.NumDays),
    introduction: int8(values.Introduction),
    year: int16(values.CurrentYear),
    month: int16(values.CurrentMonth),
    day: int16(values.CurrentDay),
  };
  world.startTime = int16(values.StartTime);
}

export function saveSettings(store: SettingsStore, world: StoryWorld, island: IslandSettings): void {
  const values: IniValues = {
    Background: Number(island.background),
    Clouds: Number(island.clouds),
    Waves: Number(island.waves),
    NumDays: world.days.numDays,
    Introduction: world.days.introduction,
    CurrentYear: world.days.year,
    CurrentMonth: world.days.month,
    CurrentDay: world.days.day,
    StartTime: world.startTime,
  };
  store.write(JSON.stringify(values));
}
