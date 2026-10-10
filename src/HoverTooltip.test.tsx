// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoverTooltip } from "./HoverTooltip";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settle = () => act(() => vi.advanceTimersByTime(200));

it("浮层脱离滚动裁切，显示原文，并限制在窗口内", () => {
  vi.stubGlobal("innerWidth", 1100);
  vi.stubGlobal("innerHeight", 760);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("hover-tooltip")
        ? ({ width: 400, height: 100 } as DOMRect)
        : ({ left: 1000, top: 700, bottom: 724 } as DOMRect);
    },
  );
  const text = "feat: 完整提交标题 <script>alert(1)</script>";
  const { container } = render(
    <div style={{ overflow: "hidden" }}>
      <button title={text}>
        <span>feat: 完整…</span>
      </button>
      <HoverTooltip />
    </div>,
  );
  const trigger = screen.getByRole("button");
  fireEvent.pointerOver(trigger.firstChild!);
  settle();
  const tip = screen.getByRole("tooltip");
  expect(container.contains(tip)).toBe(false);
  expect(tip.textContent).toBe(text);
  expect(tip.querySelector("script")).toBeNull();
  expect(tip.style.left).toBe("688px");
  expect(tip.style.top).toBe("592px");
  expect(tip.style.pointerEvents).toBe("none");
  expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
  expect(trigger.hasAttribute("title")).toBe(false);
});

it("浮层内部可操作，列表滚动后关闭并恢复原生说明", () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
  render(
    <div data-testid="list">
      <button title="完整文件路径">文件…</button>
      <HoverTooltip />
    </div>,
  );
  const trigger = screen.getByRole("button");
  fireEvent.pointerOver(trigger);
  settle();
  const tip = screen.getByRole("tooltip");
  expect(tip.style.pointerEvents).toBe("auto");
  fireEvent.pointerOut(trigger, { relatedTarget: tip });
  fireEvent.pointerOver(tip);
  fireEvent.pointerDown(tip);
  fireEvent.scroll(tip);
  settle();
  expect(screen.getByRole("tooltip")).toBe(tip);
  fireEvent.scroll(screen.getByTestId("list"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(trigger.title).toBe("完整文件路径");
  expect(trigger.hasAttribute("aria-describedby")).toBe(false);
});

it("键盘聚焦可查看，Escape 只关闭提示", () => {
  const underlying = vi.fn();
  render(
    <div onKeyDown={underlying}>
      <button title="完整分支名称">分支…</button>
      <HoverTooltip />
    </div>,
  );
  const trigger = screen.getByRole("button");
  act(() => trigger.focus());
  settle();
  expect(screen.getByRole("tooltip").textContent).toBe("完整分支名称");
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(underlying).not.toHaveBeenCalled();
});

it("迟到的悬停和显示中的内容更新都不会留下旧提示", async () => {
  render(
    <>
      <button title="旧提交">提交…</button>
      <HoverTooltip />
    </>,
  );
  const trigger = screen.getByRole("button");
  fireEvent.pointerOver(trigger);
  trigger.title = "新提交";
  settle();
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.pointerOver(trigger);
  settle();
  expect(screen.getByRole("tooltip").textContent).toBe("新提交");
  await act(async () => {
    trigger.title = "下一提交";
  });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(trigger.title).toBe("下一提交");
});

it("在内外层提示之间移动时仍能展示外层完整内容", () => {
  render(
    <>
      <div title="完整提交标题" data-testid="parent">
        <button title="复制提交信息">复制</button>
      </div>
      <HoverTooltip />
    </>,
  );
  fireEvent.pointerOver(screen.getByRole("button"));
  settle();
  expect(screen.getByRole("tooltip").textContent).toBe("复制提交信息");
  fireEvent.pointerOver(screen.getByTestId("parent"));
  settle();
  expect(screen.getByRole("tooltip").textContent).toBe("完整提交标题");
});

it("列表刷新移除来源后不保留旧内容浮层", () => {
  const view = (present: boolean) => (
    <>
      {present && <button title="已移除的提交">提交…</button>}
      <HoverTooltip />
    </>
  );
  const { rerender } = render(view(true));
  fireEvent.pointerOver(screen.getByRole("button"));
  settle();
  expect(screen.getByRole("tooltip")).toBeTruthy();
  rerender(view(false));
  expect(screen.queryByRole("tooltip")).toBeNull();
});
