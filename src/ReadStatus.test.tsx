// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ReadStatus } from "./ReadStatus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("标题旁指示等待 400ms，短读取不闪现；完成立即停止宣称忙碌并柔和退出", () => {
  vi.useFakeTimers();
  const view = render(
    <ReadStatus compact busy requestKey="A" label="正在读取 A.ts" />,
  );
  act(() => vi.advanceTimersByTime(350));
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(
    <ReadStatus compact busy={false} requestKey="A" label="A 已读完" />,
  );
  act(() => vi.advanceTimersByTime(400));
  expect(document.querySelector(".read-inline")).toBeNull();
  view.rerender(
    <ReadStatus compact busy requestKey="B" label="正在读取 B.ts" />,
  );
  act(() => vi.advanceTimersByTime(400));
  const indicator = screen.getByRole("status", { name: "正在读取 B.ts" });
  expect(indicator.textContent).toBe("");
  view.rerender(
    <ReadStatus compact busy={false} requestKey="B" label="B 已读完" />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(indicator.classList.contains("read-leaving")).toBe(true);
  act(() => vi.advanceTimersByTime(160));
  expect(document.querySelector(".read-inline")).toBeNull();
});
it("隐藏窗口停止读取提示，恢复可见后重新等待，完成时移除", () => {
  vi.useFakeTimers();
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  let visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  try {
    const view = render(
      <ReadStatus busy requestKey="file" label="正在读取差异…" />,
    );
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toBeTruthy();
    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.queryByRole("status")).toBeNull();
    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toBeTruthy();
    view.rerender(
      <ReadStatus busy={false} requestKey="file" label="正在读取差异…" />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  } finally {
    if (original) Object.defineProperty(document, "visibilityState", original);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});
it("快速完成的读取不闪现占位，慢读取就近提示且随请求切换清除", () => {
  vi.useFakeTimers();
  const view = render(
    <ReadStatus busy requestKey="first" label="正在读取差异…" />,
  );
  act(() => vi.advanceTimersByTime(100));
  view.rerender(
    <ReadStatus busy={false} requestKey="first" label="正在读取差异…" />,
  );
  act(() => vi.advanceTimersByTime(300));
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<ReadStatus busy requestKey="second" label="正在读取差异…" />);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole("status").textContent).toBe("正在读取差异…");
  view.rerender(<ReadStatus busy requestKey="third" label="正在读取差异…" />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(
    <ReadStatus busy={false} requestKey="third" label="正在读取差异…" />,
  );
  act(() => vi.advanceTimersByTime(300));
  expect(screen.queryByRole("status")).toBeNull();
});

it("同一文件的新版本从零开始等待提示延迟", () => {
  vi.useFakeTimers();
  const view = render(
    <ReadStatus
      busy
      requestKey="file.txt\0unstaged\0one\00"
      label="正在更新差异…"
    />,
  );
  act(() => vi.advanceTimersByTime(190));
  view.rerender(
    <ReadStatus
      busy
      requestKey="file.txt\0unstaged\0two\00"
      label="正在更新差异…"
    />,
  );
  act(() => vi.advanceTimersByTime(190));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => vi.advanceTimersByTime(10));
  expect(screen.getByRole("status").textContent).toBe("正在更新差异…");
});
