// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { migrateLegacyPreferences } from "./brandStorage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("copies every legacy preference without changing its original value", () => {
  const preferences = {
    theme: "green",
    language: "zh-CN",
    "sidebar-width": "330",
    "detail-width": "440",
    "diff-split-ratio": "0.7",
    "worktree./projects/中文 project": "/trees/topic",
  };
  for (const [key, value] of Object.entries(preferences)) {
    localStorage.setItem("oil-git." + key, value);
  }
  localStorage.setItem("unrelated.theme", "light");
  migrateLegacyPreferences();
  for (const [key, value] of Object.entries(preferences)) {
    expect(localStorage.getItem("gitglade." + key)).toBe(value);
    expect(localStorage.getItem("oil-git." + key)).toBe(value);
  }
  expect(localStorage.getItem("unrelated.theme")).toBe("light");
  expect(localStorage.length).toBe(Object.keys(preferences).length * 2 + 1);
});

it("preserves existing preferences, including empty values, across repeated runs", () => {
  localStorage.setItem("oil-git.theme", "green");
  localStorage.setItem("gitglade.theme", "light");
  localStorage.setItem("oil-git.language", "zh-CN");
  localStorage.setItem("gitglade.language", "");
  migrateLegacyPreferences();
  migrateLegacyPreferences();
  expect(localStorage.getItem("gitglade.theme")).toBe("light");
  expect(localStorage.getItem("gitglade.language")).toBe("");
  expect(localStorage.getItem("oil-git.theme")).toBe("green");
});

it("does nothing when legacy preferences are absent", () => {
  migrateLegacyPreferences();
  expect(localStorage.length).toBe(0);
});

it("does not block startup when storage access is denied", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("Storage denied");
  });
  expect(() => migrateLegacyPreferences()).not.toThrow();
});

it("preserves legacy data and continues after a failed write", () => {
  localStorage.setItem("oil-git.theme", "green");
  localStorage.setItem("oil-git.language", "en");
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === "gitglade.theme") throw new Error("Quota exceeded");
    write.call(this, key, value);
  });
  expect(() => migrateLegacyPreferences()).not.toThrow();
  expect(localStorage.getItem("oil-git.theme")).toBe("green");
  expect(localStorage.getItem("gitglade.theme")).toBeNull();
  expect(localStorage.getItem("gitglade.language")).toBe("en");
});
