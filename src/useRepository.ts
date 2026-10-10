import { useState, useRef, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { request, errorOf, RequestGate } from "./api";
import type { Project, Snapshot, Commit, HistoryPage, GitError } from "./types";
import { useI18n } from "./i18n";
type Recent = { path: string; name: string };
type Launch = { path: string; view: "changes" | "history" };
type History = {
  commits: Commit[];
  snapshot: Snapshot | null;
  reference: string;
  requestedReference: string;
  requestId: number;
  revision: string;
  hasMore: boolean;
  loading: boolean;
  error: GitError | null;
  failedRequest: { reference: string; append: boolean } | null;
};
const empty: History = {
  commits: [],
  snapshot: null,
  reference: "all",
  requestedReference: "all",
  requestId: 0,
  revision: "",
  hasMore: false,
  loading: false,
  error: null,
  failedRequest: null,
};

export function useRepository() {
  const { t } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [identity, setIdentity] = useState<Recent | null>(null);
  const identityRef = useRef<Recent | null>(null);
  const worktreeHistory = useRef(new Map<string, History>());
  const [recents, setRecents] = useState<Recent[]>([]);
  const [recentError, setRecentError] = useState<GitError | null>(null);
  const [forgettingRecent, setForgettingRecent] = useState(false);
  const [gitStatus, setGitStatus] = useState<{
    loading: boolean;
    version?: string;
    error?: GitError;
  }>({ loading: true });
  const [openError, setOpenError] = useState<GitError | null>(null);
  const [snapshotError, setSnapshotError] = useState<GitError | null>(null);
  const failedOpen = useRef<{
    path: string;
    view?: string;
    forgotten: Set<string>;
    withinProject: boolean;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<History>(empty);
  const [reference, setReference] = useState("all");
  const [viewRequest, setViewRequest] = useState<{
    repoId: string;
    view: string;
    serial: number;
  } | null>(null);
  const current = useRef<Project | null>(null),
    historyRef = useRef(empty),
    desired = useRef("all");
  const openGate = useRef(new RequestGate()),
    stateGate = useRef(new RequestGate()),
    historyGate = useRef(new RequestGate());
  const recentRevision = useRef(0),
    recentAction = useRef(0),
    recentWriteQueue = useRef<Promise<void>>(Promise.resolve()),
    pendingRecentWrites = useRef(0);
  const recentOpenIntent = useRef(new Set<string>());
  const flight = useRef<string | null>(null),
    refreshAgain = useRef(false);
  const hasOpenIntent = useRef(false);
  const gitReady = useRef(false);
  const setHistoryValue = (value: History) => {
    historyRef.current = value;
    setHistory(value);
  };
  const loadHistory = useCallback(
    async (
      ref: string,
      append = false,
      target = current.current,
      requestId = historyGate.current.next(),
    ) => {
      if (!target) return;
      desired.current = ref;
      const previous = historyRef.current;
      const offset = append ? previous.commits.length : 0;
      setHistoryValue({
        ...previous,
        requestedReference: ref,
        requestId,
        loading: true,
        error: null,
        failedRequest: null,
      });
      try {
        const page = await request<HistoryPage>("get_history", {
          repoId: target.repoId,
          reference: ref,
          offset,
          expected: target.snapshot.historyRevision,
        });
        if (
          !historyGate.current.accepts(requestId) ||
          current.current?.repoId !== target.repoId
        )
          return;
        setReference(ref);
        setHistoryValue({
          commits: append
            ? [...previous.commits, ...page.commits]
            : page.commits,
          snapshot: target.snapshot,
          reference: ref,
          requestedReference: ref,
          requestId,
          revision: page.revision,
          hasMore: page.hasMore,
          loading: false,
          error: null,
          failedRequest: null,
        });
      } catch (e) {
        if (
          !historyGate.current.accepts(requestId) ||
          current.current?.repoId !== target.repoId
        )
          return;
        desired.current = previous.reference;
        setReference(previous.reference);
        setHistoryValue({
          ...previous,
          requestedReference: ref,
          requestId,
          loading: false,
          error: errorOf(e),
          failedRequest: { reference: ref, append },
        });
      }
    },
    [],
  );
  const refresh = useCallback(
    async (showBusy = false, reason: "change" | "poll" = "change") => {
      const target = current.current;
      if (!target) return;
      if (flight.current === target.repoId) {
        if (reason !== "poll") refreshAgain.current = true;
        return;
      }
      flight.current = target.repoId;
      const ticket = stateGate.current.next();
      if (showBusy || reason !== "poll") setRefreshing(true);
      try {
        const snapshot = await request<Snapshot>("get_snapshot", {
          repoId: target.repoId,
        });
        if (
          !stateGate.current.accepts(ticket) ||
          current.current?.repoId !== target.repoId
        )
          return;
        const changed =
          target.snapshot.historyRevision !== snapshot.historyRevision;
        const next = { repoId: target.repoId, snapshot };
        current.current = next;
        setProject(next);
        setSnapshotError(null);
        if (
          !changed &&
          historyRef.current.snapshot?.historyRevision ===
            snapshot.historyRevision
        )
          setHistoryValue({ ...historyRef.current, snapshot });
        const valid =
          desired.current === "all" ||
          desired.current === "HEAD" ||
          snapshot.refs.some((r) => r.fullName === desired.current);
        if (
          changed ||
          !valid ||
          historyRef.current.error?.kind === "staleHistory"
        )
          void loadHistory(valid ? desired.current : "all", false, next);
      } catch (e) {
        if (stateGate.current.accepts(ticket)) setSnapshotError(errorOf(e));
      } finally {
        if (stateGate.current.accepts(ticket)) {
          flight.current = null;
          setRefreshing(false);
          if (refreshAgain.current) {
            refreshAgain.current = false;
            void refresh();
          }
        }
      }
    },
    [loadHistory],
  );
  const openPath = useCallback(
    async (
      path: string,
      view?: string,
      retryIntent?: Set<string>,
      withinProject = false,
    ) => {
      hasOpenIntent.current = true;
      setRecentError(null);
      const forgottenForThisOpen = retryIntent ?? new Set<string>();
      recentOpenIntent.current = forgottenForThisOpen;
      const ticket = openGate.current.next();
      setOpening(true);
      failedOpen.current = {
        path,
        view,
        forgotten: forgottenForThisOpen,
        withinProject,
      };
      setOpenError(null);
      try {
        const opened = await request<Project>("open_repository", { path });
        if (!openGate.current.accepts(ticket)) return;
        const original = withinProject
          ? identityRef.current!
          : { path: opened.snapshot.path, name: opened.snapshot.name };
        let next = opened;
        if (!withinProject && !view) {
          let saved: string | null = null;
          try {
            saved = localStorage.getItem("oil-git.worktree." + original.path);
          } catch {
            /* 设置不可用时仍能读取项目。 */
          }
          const tree = opened.snapshot.worktrees.find(
            (tree) => tree.path === saved && tree.available && !tree.bare,
          );
          if (tree && tree.path !== opened.snapshot.path) {
            try {
              next = await request<Project>("open_repository", {
                path: tree.path,
              });
            } catch {
              // 已移除或不可读的上次工作树回退到项目目录。
            }
            if (!openGate.current.accepts(ticket)) return;
          }
        }
        const previous = current.current;
        if (previous) {
          worktreeHistory.current.delete(previous.snapshot.path);
          worktreeHistory.current.set(previous.snapshot.path, {
            ...historyRef.current,
            loading: false,
            error: null,
            failedRequest: null,
          });
          while (worktreeHistory.current.size > 12)
            worktreeHistory.current.delete(
              worktreeHistory.current.keys().next().value!,
            );
        }
        const cached = withinProject
          ? worktreeHistory.current.get(next.snapshot.path)
          : undefined;
        const wanted = withinProject
          ? (cached?.reference ?? desired.current)
          : "all";
        const ref =
          wanted === "all" ||
          wanted === "HEAD" ||
          next.snapshot.refs.some((item) => item.fullName === wanted)
            ? wanted
            : "all";
        stateGate.current.invalidate();
        historyGate.current.invalidate();
        flight.current = null;
        refreshAgain.current = false;
        setRefreshing(false);
        current.current = next;
        setProject(next);
        identityRef.current = original;
        setIdentity(original);
        try {
          localStorage.setItem(
            "oil-git.worktree." + original.path,
            next.snapshot.path,
          );
        } catch {
          /* 当前观察仍然有效，设置留在本次会话。 */
        }
        failedOpen.current = null;
        setSnapshotError(null);
        desired.current = ref;
        setReference(ref);
        setHistoryValue(
          cached?.revision === next.snapshot.historyRevision &&
            cached.reference === ref
            ? { ...cached, snapshot: next.snapshot }
            : { ...empty, reference: ref, requestedReference: ref },
        );
        setViewRequest(
          view ? { repoId: next.repoId, view, serial: ticket } : null,
        );
        if (
          !cached ||
          cached.revision !== next.snapshot.historyRevision ||
          cached.reference !== ref
        )
          void loadHistory(ref, false, next);
        const activation = recentWriteQueue.current.then(async () => {
          if (!withinProject && opened.repoId !== next.repoId)
            await request("activate_repository", {
              repoId: opened.repoId,
              remember: !forgottenForThisOpen.has(original.path),
            });
          return request("activate_repository", {
            repoId: next.repoId,
            remember:
              !withinProject &&
              opened.repoId === next.repoId &&
              !forgottenForThisOpen.has(original.path),
          });
        });
        recentWriteQueue.current = activation.then(
          () => undefined,
          () => undefined,
        );
        void activation
          .catch(() => {
            /* 定时补查仍然有效。 */
          })
          .then(() => {
            const revision = recentRevision.current;
            return request<Recent[]>("recent_repositories").then((recent) => {
              if (
                openGate.current.accepts(ticket) &&
                revision === recentRevision.current
              )
                setRecents(recent);
            });
          })
          .catch(() => {
            /* 最近项目未更新时保留列表；仓库本身已经成功打开。 */
          });
      } catch (e) {
        if (openGate.current.accepts(ticket)) setOpenError(errorOf(e));
      } finally {
        if (openGate.current.accepts(ticket)) setOpening(false);
      }
    },
    [loadHistory],
  );
  const switchWorktree = useCallback(
    async (path: string) => {
      const target = current.current;
      if (!target) return;
      if (path === target.snapshot.path) {
        openGate.current.invalidate();
        failedOpen.current = null;
        setOpening(false);
        setOpenError(null);
        return;
      }
      const tree = target.snapshot.worktrees.find((item) => item.path === path);
      if (!tree?.available || tree.bare) {
        openGate.current.invalidate();
        failedOpen.current = null;
        setOpening(false);
        setOpenError({
          kind: "path",
          message: "工作树目录不可用。",
          messageKey: "unavailableWorktree",
        });
        return;
      }
      await openPath(path, undefined, undefined, true);
    },
    [openPath],
  );
  const forgetRecent = useCallback(async (path: string) => {
    if (!path.trim()) {
      setRecentError({
        kind: "path",
        messageKey: "path",
        message: "最近项目路径无效。",
      });
      return false;
    }
    hasOpenIntent.current = true;
    const action = ++recentAction.current;
    const openedBeforeRemoval = recentOpenIntent.current;
    setRecentError(null);
    pendingRecentWrites.current++;
    setForgettingRecent(true);

    const operation = recentWriteQueue.current.then(() =>
      request<Recent[]>("forget_recent_repository", { path }),
    );
    recentWriteQueue.current = operation.then(
      () => undefined,
      () => undefined,
    );
    try {
      const recent = await operation;
      openedBeforeRemoval.add(path);
      recentRevision.current++;
      setRecents(recent);
      if (action === recentAction.current) setRecentError(null);
      return true;
    } catch (error) {
      if (action === recentAction.current) setRecentError(errorOf(error));
      return false;
    } finally {
      pendingRecentWrites.current--;
      setForgettingRecent(pendingRecentWrites.current > 0);
    }
  }, []);
  const choose = useCallback(async () => {
    hasOpenIntent.current = true;
    setRecentError(null);
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title: t("打开 Git 项目"),
      });
      if (typeof path === "string") await openPath(path);
    } catch (e) {
      failedOpen.current = null;
      setOpenError(errorOf(e));
    }
  }, [openPath, t]);
  const checkGit = useCallback(async () => {
    setGitStatus({ loading: true });
    try {
      const version = await request<string>("check_git");
      gitReady.current = true;
      setGitStatus({ loading: false, version });
      const launch = await request<Launch | null>("take_launch_request");
      const revision = recentRevision.current;
      const recent = await request<Recent[]>("recent_repositories");
      if (!hasOpenIntent.current && revision === recentRevision.current)
        setRecents(recent);
      if (!current.current && !hasOpenIntent.current) {
        if (launch) void openPath(launch.path, launch.view);
        else if (recent[0]) void openPath(recent[0].path);
      }
    } catch (e) {
      setGitStatus({ loading: false, error: errorOf(e) });
    }
  }, [openPath]);
  useEffect(() => {
    void checkGit();
    return () => {
      openGate.current.invalidate();
      stateGate.current.invalidate();
      historyGate.current.invalidate();
    };
  }, [checkGit]);
  useEffect(() => {
    if (opening) return;
    const target = failedOpen.current;
    const retryOpen = openError?.kind === "changing" && !!target;
    if (!retryOpen && (snapshotError?.kind !== "changing" || refreshing))
      return;
    // 连续写入不是读取失败；等仓库稍微稳定后重新取一致的快照。
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible")
        timer = setTimeout(() => {
          if (retryOpen && target)
            void openPath(
              target.path,
              target.view,
              target.forgotten,
              target.withinProject,
            );
          else void refresh();
        }, 750);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [openError, opening, openPath, snapshotError, refreshing, refresh]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Agent 常在其他窗口修改项目；可见的观察窗口仍接收真实变化通知。
    listen<string>("repository-invalidated", (e) => {
      if (
        document.visibilityState === "visible" &&
        e.payload === current.current?.repoId
      )
        void refresh();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus())
        void refresh(false, "poll");
    }, 3000);
    const focus = () => {
      if (document.visibilityState === "visible" && document.hasFocus())
        void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      disposed = true;
      unlisten?.();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<Launch>("open-request", (e) => {
      if (gitReady.current) {
        void request("take_launch_request");
        void openPath(e.payload.path, e.payload.view);
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openPath]);
  return {
    project,
    identity,
    recents,
    recentError,
    forgettingRecent,
    gitStatus,
    error: openError
      ? openError.kind === "changing"
        ? null
        : openError
      : snapshotError?.kind === "changing"
        ? null
        : snapshotError,
    opening,
    refreshing,
    syncing:
      opening ||
      refreshing ||
      snapshotError?.kind === "changing" ||
      openError?.kind === "changing",
    history,
    reference,
    viewRequest,
    choose,
    openPath,
    switchWorktree,
    forgetRecent,
    refresh,
    checkGit,
    retryError: () => {
      if (openError) {
        const target = failedOpen.current;
        if (target)
          void openPath(
            target.path,
            target.view,
            target.forgotten,
            target.withinProject,
          );
        else void choose();
      } else void refresh(true);
    },
    filter: (ref: string) => {
      const requestId = historyGate.current.next();
      void loadHistory(ref, false, current.current, requestId);
      return requestId;
    },
    retryHistory: () => {
      const view = historyRef.current;
      void loadHistory(
        view.failedRequest?.reference ?? view.reference,
        view.failedRequest?.append ?? false,
      );
    },
    more: () => {
      const view = historyRef.current;
      if (
        !view.loading &&
        !view.error &&
        view.hasMore &&
        view.reference === desired.current
      )
        void loadHistory(view.reference, true);
    },
  };
}
