import { useCallback, useLayoutEffect, useRef } from "react";

const noOrder: readonly string[] = [];

// 只跟随已到齐的对象；刷新同一对象不重播，连续切换从当前帧接上。
export function useContentMotion<T extends HTMLElement = HTMLDivElement>(
  key: string | null,
  scope: string,
  active: boolean,
  order: readonly string[] = noOrder,
  initial = false,
) {
  const content = useRef<T>(null);
  const previous = useRef<{ key: string; scope: string } | null>(null);
  const animation = useRef<Animation | null>(null);
  const stop = useCallback(() => {
    animation.current?.cancel();
    animation.current = null;
  }, []);
  useLayoutEffect(() => {
    if (!active || !key) {
      stop();
      return;
    }
    const from = previous.current;
    previous.current = { key, scope };
    if (from?.key === key && from.scope === scope) return;
    const element = content.current;
    if (
      !element?.animate ||
      document.visibilityState !== "visible" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      ((!from || from.scope !== scope) && !initial)
    ) {
      stop();
      return;
    }
    const before = from?.scope === scope ? order.indexOf(from.key) : -1;
    const after = order.indexOf(key);
    const offset = before >= 0 && after >= 0 ? (after < before ? -5 : 5) : 0;
    const style = animation.current ? getComputedStyle(element) : null;
    const start = style
      ? { transform: style.transform, opacity: style.opacity }
      : { transform: `translateY(${offset}px)`, opacity: "0.94" };
    stop();
    animation.current = element.animate(
      [start, { transform: "translateY(0)", opacity: "1" }],
      {
        duration: 180,
        easing:
          getComputedStyle(element).getPropertyValue("--ease").trim() ||
          "cubic-bezier(0.2, 0.75, 0.25, 1)",
      },
    );
    const motion = animation.current;
    motion.onfinish = () => {
      if (animation.current === motion) animation.current = null;
    };
  }, [key, scope, active, order, initial, stop]);
  useLayoutEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const pause = () => {
      if (preference?.matches || document.visibilityState !== "visible") stop();
    };
    preference?.addEventListener("change", pause);
    document.addEventListener("visibilitychange", pause);
    return () => {
      preference?.removeEventListener("change", pause);
      document.removeEventListener("visibilitychange", pause);
      stop();
    };
  }, [stop]);
  return content;
}
