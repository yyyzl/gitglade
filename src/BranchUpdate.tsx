import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { errorOf, request } from "./api";
import { Dropdown } from "./Dropdown";
import { ErrorMessage } from "./ErrorMessage";
import { Icon } from "./Icon";
import { useI18n } from "./i18n";
import type { BranchUpdate as Update, GitError, Project } from "./types";

export function BranchUpdate({
  project,
  refresh,
  onBusy,
  onCompare,
  onWorkspace,
  disabled = false,
}: {
  project: Project;
  refresh: () => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  onCompare: (base: string, target: string) => void;
  onWorkspace: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const refs = project.snapshot.refs.filter(
    (ref) => ref.kind === "remote" && !ref.fullName.endsWith("/HEAD"),
  );
  const [source, setSource] = useState(
    refs.find((ref) => ref.name === project.snapshot.upstream)?.fullName ?? "",
  );
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{
    phase: "idle" | "checking" | "ready" | "updating" | "done" | "error";
    plan: Update | null;
    error: GitError | null;
    count: number;
  }>({ phase: "idle", plan: null, error: null, count: 0 });
  const previousBranch = useRef(project.snapshot.branch);
  const lastAction = useRef<"check" | "update">("check");
  const serial = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    live = useRef(true),
    owner = useRef(project.repoId);
  owner.current = project.repoId;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      serial.current++;
    };
  }, []);
  const busy = state.phase === "checking" || state.phase === "updating";
  useEffect(() => {
    if (disabled && !busy) setOpen(false);
  }, [disabled, busy]);
  useEffect(() => {
    if (!busy && previousBranch.current !== project.snapshot.branch) {
      previousBranch.current = project.snapshot.branch;
      setSource(
        refs.find((ref) => ref.name === project.snapshot.upstream)?.fullName ??
          "",
      );
      setState({ phase: "idle", plan: null, error: null, count: 0 });
      setOpen(false);
    }
  }, [project.snapshot.branch, busy]);
  const plan = state.plan;
  const stale =
    state.phase === "ready" &&
    !!plan &&
    (project.snapshot.head !== plan.head ||
      project.snapshot.branch !== plan.branch ||
      project.snapshot.refs.find((ref) => ref.fullName === plan.source)
        ?.hash !== plan.target);
  const close = () => {
    if (!busy) {
      setOpen(false);
      trigger.current?.focus();
    }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          '.dropdown-popup[data-kind="branch-update-source"]',
        )
      )
        return;
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (
          event.target instanceof Element &&
          event.target.closest(
            '.dropdown-popup[data-kind="branch-update-source"]',
          )
        )
          return;
        event.stopImmediatePropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, busy]);
  const check = async () => {
    if (busy || disabled) return;
    const ticket = ++serial.current;
    lastAction.current = "check";
    const repoId = project.repoId;
    setState((old) => ({ ...old, phase: "checking", plan: null, error: null }));
    onBusy(true);
    try {
      const result = await request<Update>("check_branch_update", {
        repoId,
        source: source || null,
      });
      await refresh();
      if (live.current && owner.current === repoId && serial.current === ticket)
        setState({ phase: "ready", plan: result, error: null, count: 0 });
    } catch (error) {
      if (live.current && serial.current === ticket)
        setState((old) => ({
          ...old,
          phase: "error",
          plan: null,
          error: errorOf(error),
        }));
    } finally {
      onBusy(false);
    }
  };
  const update = async () => {
    if (!plan || plan.status !== "ready" || stale || busy || disabled) return;
    const repoId = project.repoId;
    const ticket = ++serial.current;
    lastAction.current = "update";
    setState((old) => ({ ...old, phase: "updating", error: null }));
    onBusy(true);
    try {
      const result = await request<Update>("fast_forward_branch", {
        repoId,
        expected: plan,
      });
      if (
        result.status !== "upToDate" ||
        result.head !== plan.target ||
        result.branch !== plan.branch
      ) {
        throw {
          kind: "updateFailed",
          message: "无法确认快进更新的完成状态，请重新读取仓库。",
        };
      }
      await refresh();
      if (live.current && owner.current === repoId && serial.current === ticket)
        setState({
          phase: "done",
          plan: result,
          error: null,
          count: plan.behind,
        });
    } catch (error) {
      await refresh();
      if (live.current && serial.current === ticket)
        setState((old) => ({
          ...old,
          phase: "error",
          plan: null,
          error: errorOf(error),
        }));
    } finally {
      onBusy(false);
    }
  };
  const inspect = () => {
    if (plan) {
      onCompare("refs/heads/" + plan.branch, plan.source);
      setOpen(false);
    }
  };
  const status = stale ? "stale" : plan?.status;
  const messages: Record<string, string> = {
    ready: "可以快进更新",
    dirty: "工作区还有更改，暂不能更新",
    diverged: "分支已分叉，无法快进",
    ahead: "本地分支领先远端，保留本地提交",
    upToDate: "已是最新",
    operation: "工作树正在进行 Git 操作，暂不能更新",
    stale: "仓库状态已变化，请重新检查",
  };
  return (
    <>
      <button
        className="branch-update-trigger"
        ref={trigger}
        disabled={!project.snapshot.branch || busy || disabled}
        title={
          !project.snapshot.branch
            ? t("当前为分离 HEAD，无法更新本地分支。")
            : t("更新分支")
        }
        onClick={() => {
          setOpen((value) => !value);
          setState({ phase: "idle", plan: null, error: null, count: 0 });
        }}
      >
        <Icon name="refresh" size={15} />
        {t(busy ? "正在处理…" : "更新分支")}
      </button>
      {open &&
        createPortal(
          <div
            className="branch-update-panel"
            role="dialog"
            aria-label={t("更新本地分支")}
            ref={panel}
          >
            <header>
              <div>
                <small title={project.snapshot.path}>
                  {project.snapshot.path.split(/[\\/]/).pop()}
                </small>
                <h2>{t("更新本地分支")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={close}
                disabled={busy}
                aria-label={t("关闭更新面板")}
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            <dl>
              <dt>{t("本地分支")}</dt>
              <dd title={project.snapshot.branch ?? ""}>
                {project.snapshot.branch}
              </dd>
            </dl>
            <label>{t("远端来源")}</label>
            <Dropdown
              value={source}
              options={refs.map((ref) => ({
                value: ref.fullName,
                label: ref.name,
              }))}
              onChange={(value) => {
                setSource(value);
                setState({ phase: "idle", plan: null, error: null, count: 0 });
              }}
              label={t("选择远端来源")}
              className="branch-update-source"
              icon="branch"
              searchable
              disabled={busy}
            />
            <div className="branch-update-body" aria-live="polite">
              {state.phase === "idle" && <p>{t("先检查远端的最新提交")}</p>}
              {busy && (
                <p>
                  <span className="branch-spinner" />
                  {t(
                    state.phase === "checking"
                      ? "正在检查远端"
                      : "正在快进更新",
                  )}
                </p>
              )}
              {state.phase === "error" && state.error && (
                <div className="branch-update-error" role="alert">
                  <strong>
                    <Icon name="warning" size={16} />
                    {t(
                      lastAction.current === "update"
                        ? "更新结果未确认"
                        : "远端检查失败",
                    )}
                  </strong>
                  <ErrorMessage error={state.error} />
                </div>
              )}
              {state.phase === "done" && (
                <p className="branch-success">
                  <Icon name="check" size={16} />
                  {t("已快进 {count} 个提交", { count: state.count })}
                </p>
              )}
              {state.phase === "ready" && plan && (
                <>
                  <strong
                    className={
                      status === "ready" || status === "upToDate"
                        ? "branch-success"
                        : "branch-warning"
                    }
                  >
                    {t(messages[status ?? "stale"])}
                  </strong>
                  {plan.ahead > 0 || plan.behind > 0 ? (
                    <p>
                      {t("本地独有 {ahead} 个提交，远端独有 {behind} 个提交", {
                        ahead: plan.ahead,
                        behind: plan.behind,
                      })}
                    </p>
                  ) : null}
                  {status === "ready" && (
                    <ul>
                      {plan.commits.map((commit) => (
                        <li
                          key={commit.hash}
                          title={commit.subject + "\n" + commit.hash}
                        >
                          {commit.subject}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(status === "diverged" || status === "ahead") && (
                    <p>{t("本次没有更新分支，本地提交已保留。")}</p>
                  )}
                  {status === "dirty" && (
                    <button
                      onClick={() => {
                        onWorkspace();
                        setOpen(false);
                      }}
                    >
                      {t("查看工作区")} →
                    </button>
                  )}
                  {status === "ready" ||
                  status === "diverged" ||
                  status === "ahead" ? (
                    <button onClick={inspect}>
                      {t(status === "ready" ? "查看更新差异" : "查看分支差异")}{" "}
                      →
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <footer>
              <small>{t("仅快进更新 · 保留本地提交")}</small>
              {state.phase === "ready" && status === "ready" ? (
                <button className="primary" onClick={() => void update()}>
                  {t("更新本地分支")}
                </button>
              ) : !busy ? (
                <button
                  className={state.phase === "done" ? "" : "primary"}
                  onClick={() =>
                    state.phase === "done" ? close() : void check()
                  }
                >
                  {t(
                    state.phase === "done"
                      ? "完成"
                      : state.phase === "idle"
                        ? "检查远端更新"
                        : "重新检查",
                  )}
                </button>
              ) : (
                <button disabled>{t("正在处理…")}</button>
              )}
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}
