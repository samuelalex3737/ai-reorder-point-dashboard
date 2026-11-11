/**
 * Browser persistence (IndexedDB) for weeks added in the dashboard and the model version log.
 * Data never leaves the device. Every call is guarded: private windows or blocked storage
 * simply mean nothing is remembered between visits.
 */
import { del, get, set } from "idb-keyval";
import type { WeekRow } from "../types";

export interface VersionEntry {
  version: number;
  dataVersion: number;
  modelNonce: number;
  at: string;
  trigger: string;
  rows: number;
  lastWeek: string;
  bestModel: string;
  wape: number;
  sigmaD: number;
  rop: number | null;
  lstm: string;
}

export interface PersistedSku {
  added: WeekRow[];
  cursor: number;
  dataVersion: number;
  versions: VersionEntry[];
}

export type PersistedState = Record<string, PersistedSku>;

const KEY = "reorder-intelligence-v1";

export async function loadPersisted(): Promise<PersistedState | null> {
  try {
    const v = (await get(KEY)) as PersistedState | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function savePersisted(state: PersistedState): Promise<void> {
  try {
    await set(KEY, state);
  } catch {
    // Storage unavailable: the session still works, it just is not remembered.
  }
}

export async function clearPersisted(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    // Nothing stored or storage unavailable.
  }
}
