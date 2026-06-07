import type { StateStorage } from "zustand/middleware";

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getPersistStorage(): StateStorage {
  return getBrowserStorage() ?? noopStorage;
}

export function readStorageItem(key: string): string | null {
  return getBrowserStorage()?.getItem(key) ?? null;
}

export function writeStorageItem(key: string, value: string): void {
  getBrowserStorage()?.setItem(key, value);
}

export function removeStorageItem(key: string): void {
  getBrowserStorage()?.removeItem(key);
}
