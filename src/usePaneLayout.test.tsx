// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { useRef } from "react";
import { usePaneLayout } from "./usePaneLayout";
let resize: () => void,
  width = 1280;
beforeEach(() => {
  localStorage.clear();
  width = 1280;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        resize = fn;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId = 1;
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Harness() {
  const shell = useRef<HTMLDivElement>(null);
  const layout = usePaneLayout(shell);
  return (
    <div ref={shell} data-testid="shell" data-dragging={layout.dragging}>
      <div role="separator" aria-label="侧栏" {...layout.handle("sidebar")} />
      <div role="separator" aria-label="详情" {...layout.handle("detail")} />
    </div>
  );
}
it("键盘调整两处分界，窗口缩窄再放大恢复原偏好", () => {
  render(<Harness />);
  const sidebar = screen.getByLabelText("侧栏"),
    detail = screen.getByLabelText("详情"),
    shell = screen.getByTestId("shell");
  fireEvent.keyDown(detail, { key: "ArrowLeft" });
  expect(shell.style.getPropertyValue("--detail-width")).toBe("440px");
  fireEvent.keyDown(sidebar, { key: "End" });
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("880px");
  expect(shell.style.getPropertyValue("--detail-width")).toBe("260px");
  width = 720;
  act(() => resize());
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("320px");
  expect(shell.dataset.compactDetails).toBe("true");
  width = 1280;
  act(() => resize());
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("880px");
  expect(shell.style.getPropertyValue("--detail-width")).toBe("260px");
  width = 1680;
  act(() => resize());
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("880px");
  expect(shell.style.getPropertyValue("--detail-width")).toBe("440px");
  expect(localStorage.getItem("oil-git.sidebar-width")).toBe("880");
  expect(localStorage.getItem("oil-git.detail-width")).toBe("440");
});
it("侧栏可拖过 520px，最大宽度随窗口变化并保留差异阅读空间", () => {
  render(<Harness />);
  const handle = screen.getByLabelText("侧栏"),
    shell = screen.getByTestId("shell");
  fireEvent.pointerDown(handle, { button: 0, clientX: 360 });
  fireEvent.pointerMove(handle, { clientX: 800 });
  fireEvent.pointerUp(handle);
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("800px");
  expect(handle.getAttribute("aria-valuenow")).toBe("800");
  expect(handle.getAttribute("aria-valuemax")).toBe("880");
  expect(localStorage.getItem("oil-git.sidebar-width")).toBe("800");
  fireEvent.pointerDown(handle, { button: 0, clientX: 800 });
  fireEvent.pointerMove(handle, { clientX: 2000 });
  fireEvent.pointerUp(handle);
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("880px");
  expect(width - Number(handle.getAttribute("aria-valuenow"))).toBe(400);
});
it("连续拖拽可结束，取消与失焦不保存临时宽度", () => {
  render(<Harness />);
  const handle = screen.getByLabelText("侧栏"),
    shell = screen.getByTestId("shell");
  fireEvent.pointerDown(handle, { button: 0, clientX: 360 });
  fireEvent.pointerMove(handle, { clientX: 460 });
  fireEvent.pointerUp(handle);
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("460px");
  expect(localStorage.getItem("oil-git.sidebar-width")).toBe("460");
  fireEvent.pointerDown(handle, { button: 0, clientX: 460 });
  fireEvent.pointerMove(handle, { clientX: 540 });
  fireEvent.pointerCancel(handle);
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("460px");
  expect(localStorage.getItem("oil-git.sidebar-width")).toBe("460");
  fireEvent.pointerDown(handle, { button: 0, clientX: 460 });
  fireEvent.pointerMove(handle, { clientX: 390 });
  fireEvent.blur(window);
  expect(shell.dataset.dragging).toBe("false");
  expect(shell.style.getPropertyValue("--sidebar-width")).toBe("460px");
});
