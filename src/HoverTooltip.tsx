import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { target: HTMLElement; text: string };

export function HoverTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const current = useRef<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const titlesBeforeHover = useRef(new WeakMap<HTMLElement, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    current.current = null;
    setTip(null);
  };

  useEffect(() => {
    const enter = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      clearTimeout(timer.current);
      if (bubble.current?.contains(node)) return;
      let target = node instanceof HTMLElement ? node : node.parentElement;
      while (
        target &&
        !target.hasAttribute("title") &&
        !titlesBeforeHover.current.has(target)
      )
        target = target.parentElement;
      const text = target
        ? (target.getAttribute("title") ??
          titlesBeforeHover.current.get(target))
        : null;
      if (target === current.current?.target && text === current.current.text)
        return;
      if (!target || !text || target.closest("[inert], [hidden]")) {
        hide();
        return;
      }
      if (event.type === "focusin" && !target.matches(":focus-visible")) return;
      const next = { target, text };
      hide();
      timer.current = setTimeout(
        () => {
          if (!target.isConnected || target.title !== next.text) return;
          current.current = next;
          setTip(next);
        },
        event.type === "focusin" ? 0 : 200,
      );
    };
    const leave = (event: Event) => {
      const related = (event as MouseEvent | FocusEvent).relatedTarget;
      if (
        related instanceof Node &&
        (current.current?.target.contains(related) ||
          bubble.current?.contains(related))
      )
        return;
      clearTimeout(timer.current);
      timer.current = setTimeout(hide, 120);
    };
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !bubble.current?.contains(event.target)
      )
        hide();
    };
    const down = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !bubble.current?.contains(event.target)
      )
        hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !current.current) return;
      if (
        event.target instanceof Node &&
        current.current.target.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
      hide();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerup", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", down);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerup", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    const box = bubble.current;
    if (!tip || !box) return;
    if (!tip.target.isConnected || tip.target.title !== tip.text) {
      hide();
      return;
    }
    const anchor = tip.target.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    box.style.pointerEvents =
      box.scrollHeight > box.clientHeight ? "auto" : "none";
    box.style.left =
      Math.max(12, Math.min(anchor.left, innerWidth - size.width - 12)) + "px";
    box.style.top =
      Math.max(
        12,
        anchor.bottom + size.height + 8 <= innerHeight - 12
          ? anchor.bottom + 8
          : anchor.top - size.height - 8,
      ) + "px";
    const titles: [HTMLElement, string][] = [];
    for (
      let element: HTMLElement | null = tip.target;
      element;
      element = element.parentElement
    ) {
      const title = element.getAttribute("title");
      if (title !== null) {
        titles.push([element, title]);
        titlesBeforeHover.current.set(element, title);
        element.removeAttribute("title");
      }
    }
    const description = tip.target.getAttribute("aria-describedby");
    const describedBy = [description, "oil-git-tooltip"]
      .filter(Boolean)
      .join(" ");
    tip.target.setAttribute("aria-describedby", describedBy);
    const observer = new MutationObserver(() => {
      const title = tip.target.getAttribute("title");
      if (title !== null && title !== tip.text) hide();
    });
    observer.observe(tip.target, {
      attributes: true,
      attributeFilter: ["title"],
    });
    return () => {
      observer.disconnect();
      for (const [element, title] of titles) {
        titlesBeforeHover.current.delete(element);
        if (!element.hasAttribute("title"))
          element.setAttribute("title", title);
      }
      if (tip.target.getAttribute("aria-describedby") === describedBy) {
        if (description === null)
          tip.target.removeAttribute("aria-describedby");
        else tip.target.setAttribute("aria-describedby", description);
      }
    };
  });

  return tip?.target.isConnected
    ? createPortal(
        <div
          className="hover-tooltip"
          id="oil-git-tooltip"
          role="tooltip"
          ref={bubble}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}
