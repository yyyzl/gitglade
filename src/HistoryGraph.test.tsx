// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HistoryGraph } from "./HistoryGraph";
import { HoverTooltip } from "./HoverTooltip";
import type { Snapshot, Reference } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("同一提交的多个引用有明确数量，主标签与其余名称均可完整查看", () => {
  const commit = {
    hash: "a",
    subject: "修改",
    author: "作者",
    date: "2026-10-10",
    parents: [],
  };
  const refs: Reference[] = [
    {
      hash: "a",
      kind: "branch",
      fullName: "refs/heads/feature",
      name: "feature/20261010_31543477_example_long_branch",
    },
    {
      hash: "a",
      kind: "remote",
      fullName: "refs/remotes/origin/feature",
      name: "origin/feature/20261010_31543477_example_long_branch",
    },
    {
      hash: "a",
      kind: "tag",
      fullName: "refs/tags/publish/0.0.22",
      name: "publish/0.0.22",
    },
  ];
  const snapshot = { head: null, refs } as Snapshot;
  const props = {
    commits: [commit],
    snapshot,
    selected: null,
    onSelect: vi.fn(),
    locate: 0,
    resetKey: "repo",
  };
  const { container, rerender } = render(
    <>
      <HistoryGraph {...props} />
      <HoverTooltip />
    </>,
  );
  expect(container.querySelectorAll(".ref")).toHaveLength(1);
  const primary = screen.getByText(refs[0].name);
  fireEvent.pointerOver(primary);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole("tooltip").textContent).toBe(refs[0].name);
  const rest = screen.getByText("+2");
  fireEvent.pointerOver(rest);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole("tooltip").textContent).toBe(
    `${refs[1].name}\n${refs[2].name}`,
  );
  expect(props.onSelect).not.toHaveBeenCalled();
  rerender(
    <>
      <HistoryGraph
        {...props}
        snapshot={{ ...snapshot, refs: refs.slice(0, 1) }}
      />
      <HoverTooltip />
    </>,
  );
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.queryByText("+2")).toBeNull();
  expect(screen.getByText(refs[0].name).title).toBe(refs[0].name);
});
