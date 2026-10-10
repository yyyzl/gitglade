import { useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { FileIcon } from "./FileIcon";
import { ReadStatus } from "./ReadStatus";
import { useCommitView } from "./useCommitView";
import { SourceEditor } from "./WorkingChanges";
import { useCommitMotion } from "./useCommitMotion";
import type { GitError, Project, Selection } from "./types";
import { useI18n } from "./i18n";
import { ErrorMessage } from "./ErrorMessage";

export type DetailState = {
  ready: boolean;
  loading: boolean;
  error: GitError | null;
};
export function Details({
  project,
  selection,
  onClose,
  active: shown = true,
  onStateChange,
  subject,
  keepPrevious = true,
  commits = [],
  filesTarget,
}: {
  project: Project;
  selection: Selection;
  onClose: () => void;
  active?: boolean;
  subject?: string;
  keepPrevious?: boolean;
  commits?: readonly { hash: string }[];
  onStateChange?: (state: DetailState) => void;
  filesTarget?: HTMLElement | null;
}) {
  const { t } = useI18n();
  const view = useCommitView(project, selection, shown);
  const data =
    view.data &&
    (keepPrevious ||
      (selection?.kind === "commit" &&
        view.data.detail.hash === selection.hash))
      ? view.data
      : null;
  const stash = selection?.kind === "stashes";
  const folders = useMemo(() => {
    const groups = new Map<
      string,
      NonNullable<typeof data>["detail"]["files"]
    >();
    for (const file of data?.detail.files ?? []) {
      const folder = file.path.includes("/")
        ? file.path.slice(0, file.path.lastIndexOf("/"))
        : "";
      const group = groups.get(folder);
      if (group) group.push(file);
      else groups.set(folder, [file]);
    }
    return [...groups];
  }, [data?.detail.files]);
  const ready = stash || !!data || !!view.error;
  const content = useCommitMotion(
    stash ? null : (data?.detail.hash ?? null),
    commits,
    shown && !!selection,
  );
  useLayoutEffect(() => {
    onStateChange?.({ ready, loading: view.loading, error: view.error });
  }, [ready, view.loading, view.error, onStateChange]);
  if (!selection) return null;
  const sameCommit =
    selection.kind === "commit" && data?.detail.hash === selection.hash;
  const files = data && !stash && (
    <section className="commit-files" aria-label={t("变更文件列表")}>
      <header className="sidebar-heading">
        <h2>{t("本次提交的文件")}</h2>
        <span>{t("{count} 个文件", { count: data.detail.files.length })}</span>
        <button
          className="icon-button"
          onClick={onClose}
          title={t("关闭详情 · Esc")}
          aria-label={t("关闭详情")}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="file-list">
        {!data.detail.files.length && (
          <p className="detail-message">{t("相对比较基准没有文件变化。")}</p>
        )}
        {folders.map(([folder, entries]) => (
          <div className="commit-file-group" key={folder}>
            {folder && (
              <div className="commit-folder" title={folder}>
                <Icon name="folder" size={14} />
                <span className="ref-prefix">{folder.slice(0, -18)}</span>
                <span className="ref-suffix">{folder.slice(-18)}</span>
              </div>
            )}
            {entries.map((file) => {
              const name = file.path.split("/").pop()!;
              return (
                <button
                  className={
                    "file-row " + (data.filePath === file.path ? "active" : "")
                  }
                  key={file.path}
                  aria-label={file.path}
                  aria-pressed={data.filePath === file.path}
                  title={file.path + (file.oldPath ? " ← " + file.oldPath : "")}
                  disabled={!sameCommit}
                  onClick={() => view.choose(file.path)}
                >
                  <FileIcon path={file.path} />
                  <span className="file-name">
                    <span className="file-basename">
                      <span className="ref-prefix">{name.slice(0, -12)}</span>
                      <span className="ref-suffix">{name.slice(-12)}</span>
                    </span>
                    {file.oldPath && (
                      <small title={file.oldPath}>
                        {t("原路径：{path}", { path: file.oldPath })}
                      </small>
                    )}
                  </span>
                  <span
                    className={
                      "source-status " +
                      (file.status[0] === "A"
                        ? "added"
                        : file.status[0] === "D"
                          ? "deleted"
                          : "")
                    }
                    title={
                      (
                        {
                          A: t("新增"),
                          D: t("删除"),
                          M: t("修改"),
                          R: t("重命名"),
                          T: t("类型变化"),
                        } as Record<string, string>
                      )[file.status[0]] || file.status
                    }
                  >
                    {file.status[0]}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
  return (
    <aside
      className="details"
      aria-label={t("所选对象详情")}
      data-ready={ready}
    >
      {ready && (
        <div
          className="detail-content"
          ref={content}
          key={stash ? "stashes" : (data?.detail.hash ?? "error")}
        >
          {stash ? (
            <>
              <header className="details-header">
                <h2>{t("临时保存")}</h2>
                <button
                  className="icon-button"
                  onClick={onClose}
                  aria-label={t("关闭详情")}
                >
                  <Icon name="close" />
                </button>
              </header>
              <div className="stash-list">
                {project.snapshot.stashes.map((item) => (
                  <div className="stash-item" key={item.reference}>
                    <code>{item.reference}</code>
                    <p>{item.subject}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {filesTarget ? createPortal(files, filesTarget) : files}
              <ReadStatus
                busy={view.loading}
                requestKey={view.requestKey}
                label={sameCommit ? t("正在更新差异…") : t("正在读取提交…")}
              />
              {view.error && (
                <div className="detail-message error-text" role="status">
                  {data && t("未更新，保留上次读取结果。")}
                  {data &&
                    !sameCommit &&
                    selection.kind === "commit" &&
                    t("读取 {old} 失败，当前显示 {new} 的内容。", {
                      old: selection.hash.slice(0, 8),
                      new: data.detail.hash.slice(0, 8),
                    })}
                  <ErrorMessage error={view.error} />
                  <button onClick={view.retry}>{t("重试")}</button>
                </div>
              )}
              {data?.filePath ? (
                <SourceEditor
                  files={[]}
                  file={{ path: data.filePath, mode: "commit" }}
                  diff={data.diff}
                  error={null}
                  retry={view.retry}
                  commit={data.detail}
                  active={shown}
                  origin={{
                    repoId: project.repoId,
                    path: data.filePath,
                    mode: "commit",
                    commit: data.detail.hash,
                    historyRevision: data.revision,
                  }}
                />
              ) : data ? (
                <div className="editor-empty">
                  <p>{t("相对比较基准没有文件变化。")}</p>
                </div>
              ) : (
                <div className="editor-empty">
                  <p>{subject ?? t("无法读取提交")}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
