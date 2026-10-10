// @vitest-environment jsdom
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  renderHook,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { BranchUpdate } from "./BranchUpdate";
import { useBranchComparison } from "./useBranchComparison";
import { request } from "./api";
import type {
  BranchComparison,
  BranchUpdate as Update,
  Project,
} from "./types";
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  request: vi.fn(),
}));
const a = "a".repeat(40),
  b = "b".repeat(40);
const project: Project = {
  repoId: "repo",
  snapshot: {
    path: "/fixture",
    name: "fixture",
    head: a,
    branch: "main",
    refs: [
      { name: "main", fullName: "refs/heads/main", hash: a, kind: "branch" },
      {
        name: "feature",
        fullName: "refs/heads/feature",
        hash: b,
        kind: "branch",
      },
      {
        name: "origin/main",
        fullName: "refs/remotes/origin/main",
        hash: b,
        kind: "remote",
      },
    ],
    files: [],
    historyRevision: "one",
    changesRevision: "one",
    upstream: "origin/main",
    ahead: 0,
    behind: 1,
    operation: null,
    worktrees: [],
    stashes: [],
  },
};
const plan: Update = {
  branch: "main",
  source: "refs/remotes/origin/main",
  head: a,
  target: b,
  ahead: 0,
  behind: 1,
  status: "ready",
  commits: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = {
  project,
  refresh: vi.fn(async () => {}),
  onBusy: vi.fn(),
  onCompare: vi.fn(),
  onWorkspace: vi.fn(),
};

it("检查与确认是两个独立动作，严格模式下成功与失败信息都在对应主题语义区", async () => {
  vi.mocked(request).mockImplementation(async (command) =>
    command === "check_branch_update"
      ? plan
      : ({ ...plan, head: b, ahead: 0, behind: 0, status: "upToDate" } as any),
  );
  render(
    <StrictMode>
      <BranchUpdate {...props} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "更新分支" }));
  fireEvent.click(screen.getByRole("button", { name: "检查远端更新" }));
  await screen.findByText("可以快进更新");
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "更新本地分支" }));
  await screen.findByText("已快进 1 个提交");
  expect(request).toHaveBeenLastCalledWith("fast_forward_branch", {
    repoId: "repo",
    expected: plan,
  });
  expect(
    screen.getByText("已快进 1 个提交").classList.contains("branch-success"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("button", { name: "更新分支" }));
  vi.mocked(request).mockRejectedValueOnce({
    kind: "updateFetch",
    message: "connection refused",
  });
  fireEvent.click(screen.getByRole("button", { name: "检查远端更新" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("alert").classList.contains("branch-update-error"),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "更新本地分支" })).toBeNull();
});

it("分叉与旧检查结果不能执行更新，查看差异预填本地与远端并复用入口", async () => {
  vi.mocked(request).mockResolvedValue({
    ...plan,
    status: "diverged",
    ahead: 2,
  });
  const view = render(<BranchUpdate {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更新分支" }));
  fireEvent.click(screen.getByRole("button", { name: "检查远端更新" }));
  await screen.findByText("分支已分叉，无法快进");
  expect(screen.queryByRole("button", { name: "更新本地分支" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看分支差异 →" }));
  expect(props.onCompare).toHaveBeenCalledWith(
    "refs/heads/main",
    "refs/remotes/origin/main",
  );
  vi.mocked(request).mockResolvedValue(plan);
  fireEvent.click(screen.getByRole("button", { name: "更新分支" }));
  fireEvent.click(screen.getByRole("button", { name: "检查远端更新" }));
  await screen.findByText("可以快进更新");
  view.rerender(
    <BranchUpdate
      {...props}
      project={{ ...project, snapshot: { ...project.snapshot, head: b } }}
    />,
  );
  await screen.findByText("仓库状态已变化，请重新检查");
  expect(screen.queryByRole("button", { name: "更新本地分支" })).toBeNull();
});

it("远端来源菜单的 portal 不会关闭更新面板", async () => {
  render(<BranchUpdate {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "更新分支" }));
  fireEvent.click(screen.getByRole("button", { name: "选择远端来源" }));
  const option = await screen.findByRole("option", { name: "origin/main" });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  expect(screen.getByRole("dialog", { name: "更新本地分支" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "检查远端更新" })).toBeTruthy();
});

it("分支比较的仓库与文件请求乱序不能覆盖最新选择，失败保留已显示对象", async () => {
  const pending: {
    args: Record<string, unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  vi.mocked(request).mockImplementation(
    ((_command, args) =>
      new Promise<unknown>((resolve, reject) =>
        pending.push({ args: args ?? {}, resolve, reject }),
      )) as typeof request,
  );
  const data: BranchComparison = {
    base: "refs/heads/main",
    target: "refs/heads/feature",
    baseCommit: a,
    targetCommit: b,
    revision: "one",
    files: [
      { path: "one.ts", oldPath: null, status: "M" },
      { path: "two.ts", oldPath: null, status: "A" },
    ],
    filePath: "one.ts",
    diff: {
      patch: "@@ -1 +1 @@\n-before\n+after",
      truncated: false,
      binary: false,
      note: null,
      conflict: null,
    },
  };
  const hook = renderHook(({ p, active }) => useBranchComparison(p, active), {
    initialProps: { p: project, active: true },
  });
  expect(pending).toHaveLength(1);
  await act(async () => pending[0].resolve(data));
  expect(hook.result.current.data?.filePath).toBe("one.ts");
  act(() => hook.result.current.chooseFile("two.ts"));
  expect(pending).toHaveLength(2);
  act(() => hook.result.current.chooseFile("one.ts"));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => pending[1].resolve({ ...data, filePath: "two.ts" }));
  expect(hook.result.current.data?.filePath).toBe("one.ts");
  act(() => {
    hook.result.current.swap();
    hook.result.current.apply();
  });
  // 显式应用下一次渲染的草稿，避免测试闭包覆盖上一动作。
  act(() => hook.result.current.apply());
  await waitFor(() => expect(pending.length).toBeGreaterThan(2));
  await act(async () =>
    pending.at(-1)!.reject({ kind: "git", message: "failed" }),
  );
  expect(hook.result.current.error).toBeTruthy();
  expect(hook.result.current.data?.base).toBe(data.base);
  hook.rerender({ p: { ...project, repoId: "other" }, active: true });
  expect(hook.result.current.data).toBeNull();
  const last = pending.at(-1)!;
  hook.rerender({ p: project, active: false });
  await act(async () => last.resolve({ ...data, filePath: "two.ts" }));
  expect(hook.result.current.data?.filePath).not.toBe("two.ts");
});
