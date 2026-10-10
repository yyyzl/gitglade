// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useContentMotion } from "./useContentMotion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("只在新对象到齐后过渡，连续切换接续当前帧；刷新、隐藏和减少动态效果不重播", () => {
  let reduced = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  const original = Element.prototype.animate;
  const cancel = vi.fn();
  const animate = vi.fn<Element["animate"]>(
    () => ({ cancel }) as unknown as Animation,
  );
  Element.prototype.animate = animate;
  const order = ["a", "b", "c"];
  function Harness({
    file,
    active = true,
    owner = "repo",
  }: {
    file: string;
    active?: boolean;
    owner?: string;
  }) {
    const content = useContentMotion(file, owner, active, order);
    return (
      <div
        ref={content}
        style={{ transform: "translateY(2px)", opacity: 0.98 }}
      >
        {file}
      </div>
    );
  }
  try {
    const view = render(<Harness file="a" />);
    view.rerender(<Harness file="a" />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Harness file="b" />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: "translateY(5px)", opacity: "0.94" },
      { transform: "translateY(0)", opacity: "1" },
    ]);
    view.rerender(<Harness file="a" />);
    expect(animate.mock.calls[1][0]).toEqual([
      { transform: "translateY(2px)", opacity: "0.98" },
      { transform: "translateY(0)", opacity: "1" },
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
    view.rerender(<Harness file="a" active={false} />);
    expect(cancel).toHaveBeenCalledTimes(2);
    view.rerender(<Harness file="a" />);
    expect(animate).toHaveBeenCalledTimes(2);
    reduced = true;
    act(() => listeners.forEach((listener) => listener()));
    view.rerender(<Harness file="c" />);
    expect(animate).toHaveBeenCalledTimes(2);
    reduced = false;
    view.rerender(<Harness file="a" owner="other-repo" />);
    expect(animate).toHaveBeenCalledTimes(2);
    view.rerender(<Harness file="a" />);
    view.rerender(<Harness file="b" />);
    animate.mock.results[2].value.onfinish?.({} as AnimationPlaybackEvent);
    view.rerender(<Harness file="a" />);
    expect(animate.mock.calls[3][0]).toEqual([
      { transform: "translateY(-5px)", opacity: "0.94" },
      { transform: "translateY(0)", opacity: "1" },
    ]);
    view.unmount();
    expect(listeners.size).toBe(0);
  } finally {
    Element.prototype.animate = original;
  }
});
