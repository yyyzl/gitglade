import { useEffect, useState } from "react";

// 快速读取不显示加载占位；较慢请求只在当前区域提示，避免闪烁与整屏明暗变化。
export function ReadStatus({
  busy = true,
  requestKey,
  label,
  compact = false,
}: {
  busy?: boolean;
  requestKey: string;
  label: string;
  compact?: boolean;
}) {
  const [shown, setShown] = useState<{
    key: string;
    label: string;
    leaving: boolean;
  } | null>(null);
  const [active, setActive] = useState(document.visibilityState === "visible");
  useEffect(() => {
    const visibility = () => setActive(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    setShown((old) =>
      !active || old?.key !== requestKey
        ? null
        : old
          ? { ...old, leaving: !busy }
          : null,
    );
    if (!active) return;
    const timer = setTimeout(
      () => setShown(busy ? { key: requestKey, label, leaving: false } : null),
      busy ? (compact ? 400 : 200) : 160,
    );
    return () => clearTimeout(timer);
  }, [busy, requestKey, active, compact]);
  if (!active || shown?.key !== requestKey) return null;
  return (
    <div
      className={
        "read-status" +
        (compact ? " read-inline" : "") +
        (shown.leaving ? " read-leaving" : "")
      }
      role={shown.leaving ? undefined : "status"}
      aria-hidden={shown.leaving || undefined}
      aria-label={compact && !shown.leaving ? shown.label : undefined}
      title={compact && !shown.leaving ? shown.label : undefined}
    >
      {!compact && shown.label}
    </div>
  );
}
