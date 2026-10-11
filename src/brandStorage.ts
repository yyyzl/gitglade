/** Copy preferences when the legacy and current app share a WebView origin. */
export function migrateLegacyPreferences(): void {
  try {
    const storage = window.localStorage;
    // Snapshot keys before writing: Storage enumeration can change on insertion.
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith("oil-git.")) keys.push(key);
    }
    for (const key of keys) {
      try {
        const destination = "gitglade." + key.slice("oil-git.".length);
        if (storage.getItem(destination) !== null) continue;
        const value = storage.getItem(key);
        if (value !== null) storage.setItem(destination, value);
      } catch {
        // A blocked or full store must not prevent the app from starting.
      }
    }
  } catch {
    // Storage may be unavailable, including in restricted WebViews.
  }
}
