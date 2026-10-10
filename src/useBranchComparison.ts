import { useEffect, useMemo, useRef, useState } from "react";
import { errorOf, request } from "./api";
import type { BranchComparison, GitError, Project } from "./types";

type Choice = {
  base: string;
  target: string;
  draftBase: string;
  draftTarget: string;
};
function defaults(project: Project | null): Choice {
  const refs = project?.snapshot.refs.filter((ref) => ref.kind !== "tag") ?? [];
  const target =
    refs.find(
      (ref) => ref.fullName === "refs/heads/" + project?.snapshot.branch,
    )?.fullName ??
    refs[0]?.fullName ??
    "";
  const base =
    refs.find(
      (ref) =>
        ["refs/heads/main", "refs/heads/master"].includes(ref.fullName) &&
        ref.fullName !== target,
    )?.fullName ??
    refs.find((ref) => ref.fullName !== target)?.fullName ??
    "";
  return { base, target, draftBase: base, draftTarget: target };
}
export function useBranchComparison(project: Project | null, active: boolean) {
  const owner = project?.repoId ?? "";
  const revision = project?.snapshot.historyRevision ?? "";
  const [choices, setChoices] = useState(new Map<string, Choice>());
  const choice = choices.get(owner) ?? defaults(project);
  const pair = [owner, choice.base, choice.target].join("\0");
  const [paths, setPaths] = useState(new Map<string, string>());
  const path = paths.get(pair) ?? null;
  const [attempt, setAttempt] = useState(0);
  const key = [pair, revision, path ?? "", attempt].join("\0");
  const cache = useMemo(
    () => new Map<string, { data: BranchComparison; bytes: number }>(),
    [owner, revision],
  );
  const [state, setState] = useState<{
    key: string;
    owner: string;
    data: BranchComparison | null;
    loading: boolean;
    error: GitError | null;
  }>({ key: "", owner: "", data: null, loading: false, error: null });
  const liveOwner = useRef(owner);
  liveOwner.current = owner;
  const data = state.owner === owner ? state.data : null;
  const change = (update: Partial<Choice>) =>
    setChoices((old) => {
      const next = new Map(old);
      next.delete(owner);
      next.set(owner, { ...choice, ...update });
      while (next.size > 12) next.delete(next.keys().next().value!);
      return next;
    });
  const chooseFile = (value: string | null) =>
    setPaths((old) => {
      const next = new Map(old);
      next.delete(pair);
      if (value) next.set(pair, value);
      while (next.size > 12) next.delete(next.keys().next().value!);
      return next;
    });
  useEffect(() => {
    if (
      !active ||
      !project ||
      !choice.base ||
      !choice.target ||
      choice.base === choice.target
    )
      return;
    let live = true;
    setState((old) => ({
      ...old,
      key,
      owner,
      data: old.owner === owner ? old.data : null,
      loading: true,
      error: null,
    }));
    const read = (file: string | null) => {
      const cachedKey = [choice.base, choice.target, file ?? ""].join("\0");
      const cached = cache.get(cachedKey);
      if (cached) return Promise.resolve(cached.data);
      return request<BranchComparison>("get_branch_comparison", {
        repoId: owner,
        base: choice.base,
        target: choice.target,
        path: file,
        expectedHistoryRevision: revision,
      }).then((result) => {
        const bytes = JSON.stringify(result).length * 2;
        if (bytes <= 6 * 1024 * 1024) {
          for (const alias of new Set([
            cachedKey,
            [choice.base, choice.target, result.filePath ?? ""].join("\0"),
          ])) {
            cache.delete(alias);
            cache.set(alias, { data: result, bytes });
          }
          let total = [...cache.values()].reduce(
            (sum, entry) => sum + entry.bytes,
            0,
          );
          while (cache.size > 12 || total > 6 * 1024 * 1024) {
            const oldest = cache.keys().next().value!;
            total -= cache.get(oldest)!.bytes;
            cache.delete(oldest);
          }
        }
        return result;
      });
    };
    void read(path)
      .catch((error) => {
        if (
          path &&
          data?.base === choice.base &&
          data.target === choice.target &&
          data.revision !== revision &&
          errorOf(error).kind === "invalid"
        )
          return read(null);
        throw error;
      })
      .then((result) => {
        if (!live || liveOwner.current !== owner) return;
        setState({ key, owner, data: result, loading: false, error: null });
        if (path && path !== result.filePath) chooseFile(result.filePath);
      })
      .catch((error) => {
        if (live)
          setState((old) => ({
            ...old,
            key,
            loading: false,
            error: errorOf(error),
          }));
      });
    return () => {
      live = false;
    };
  }, [
    active,
    owner,
    revision,
    choice.base,
    choice.target,
    path,
    attempt,
    cache,
  ]);
  return {
    ...choice,
    data,
    key,
    loading:
      active &&
      !!choice.base &&
      !!choice.target &&
      choice.base !== choice.target &&
      (state.key !== key || state.loading),
    error: state.key === key ? state.error : null,
    changed:
      choice.base !== choice.draftBase || choice.target !== choice.draftTarget,
    choose: (side: "base" | "target", value: string) =>
      change(side === "base" ? { draftBase: value } : { draftTarget: value }),
    swap: () =>
      change({ draftBase: choice.draftTarget, draftTarget: choice.draftBase }),
    apply: () => {
      change({ base: choice.draftBase, target: choice.draftTarget });
      cache.clear();
      setAttempt((value) => value + 1);
    },
    inspect: (base: string, target: string) => {
      change({ base, target, draftBase: base, draftTarget: target });
      setAttempt((value) => value + 1);
    },
    chooseFile,
    retry: () => {
      cache.clear();
      setAttempt((value) => value + 1);
    },
  };
}
