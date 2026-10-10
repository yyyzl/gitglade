import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Dropdown } from "./Dropdown";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";
import { SourceEditor } from "./WorkingChanges";
import { ReadStatus } from "./ReadStatus";
import { ErrorMessage } from "./ErrorMessage";
import { useI18n } from "./i18n";
import type { Project } from "./types";
import type { useBranchComparison } from "./useBranchComparison";

export function BranchComparison({
  project,
  view,
  active,
  sidebar,
}: {
  project: Project;
  view: ReturnType<typeof useBranchComparison>;
  active: boolean;
  sidebar: HTMLElement | null;
}) {
  const { t } = useI18n();
  const options = project.snapshot.refs
    .filter((ref) => ref.kind !== "tag")
    .map((ref) => ({
      value: ref.fullName,
      label: ref.name,
      group: t(ref.kind === "remote" ? "远端记录" : "本地分支"),
    }));
  const name = (ref: string) =>
    project.snapshot.refs.find((item) => item.fullName === ref)?.name ??
    ref.replace(/^refs\/(heads|remotes)\//, "");
  const data = view.data;
  const list = useRef<HTMLDivElement>(null);
  const scrolls = useRef(new Map<string, number>());
  const scrollKey = [project.repoId, data?.base, data?.target].join("\0");
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    element.scrollTop = scrolls.current.get(scrollKey) ?? 0;
    return () => {
      scrolls.current.delete(scrollKey);
      scrolls.current.set(scrollKey, element.scrollTop);
      while (scrolls.current.size > 12)
        scrolls.current.delete(scrolls.current.keys().next().value!);
    };
  }, [scrollKey, sidebar]);
  const same = data?.base === view.base && data.target === view.target;
  const current = data?.files.find((file) => file.path === data.filePath);
  const files = (
    <div className="branch-navigation">
      <div className="branch-controls">
        <header>
          <strong>{t("比较分支")}</strong>
        </header>
        <label>{t("基准 · 左侧")}</label>
        <Dropdown
          value={view.draftBase}
          options={options}
          onChange={(value) => view.choose("base", value)}
          label={t("选择基准分支")}
          searchable
          icon="branch"
        />
        <label>{t("目标 · 右侧")}</label>
        <Dropdown
          value={view.draftTarget}
          options={options}
          onChange={(value) => view.choose("target", value)}
          label={t("选择目标分支")}
          searchable
          icon="branch"
        />
        <div className="branch-actions">
          <button onClick={view.swap}>{t("交换方向")}</button>
          <button
            className="primary"
            onClick={view.apply}
            disabled={
              !view.draftBase ||
              !view.draftTarget ||
              view.draftBase === view.draftTarget
            }
          >
            {t("比较分支")}
          </button>
        </div>
        <p>
          {view.changed ? t("选择尚未应用") : t("目标分支相对于基准分支的变更")}
        </p>
        <small>{t("远端分支来自本地保存的记录")}</small>
      </div>
      <header className="sidebar-heading">
        <h2>{t("变更文件")}</h2>
        <span>{t("{count} 个文件", { count: data?.files.length ?? 0 })}</span>
      </header>
      <div className="file-list" ref={list}>
        {data?.files.map((file) => (
          <button
            className={
              "file-row " + (data.filePath === file.path ? "active" : "")
            }
            key={file.path}
            title={file.path + (file.oldPath ? " ← " + file.oldPath : "")}
            aria-label={file.path}
            aria-pressed={data.filePath === file.path}
            disabled={!same}
            onClick={() => view.chooseFile(file.path)}
          >
            <FileIcon path={file.path} />
            <span className="file-name">
              <span>{file.path.split("/").pop()}</span>
              <small>
                {file.oldPath
                  ? t("原路径：{path}", { path: file.oldPath })
                  : file.path.slice(0, file.path.lastIndexOf("/") + 1)}
              </small>
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
            >
              {file.status[0]}
            </span>
          </button>
        ))}
        {data && !data.files.length && (
          <p className="detail-message">{t("两个分支没有文件差异")}</p>
        )}
      </div>
    </div>
  );
  return (
    <div className="branch-reader">
      {sidebar && createPortal(files, sidebar)}
      {data && (
        <div className="branch-context">
          <span>{t("正在查看")}</span>
          <strong title={data.base + " · " + data.baseCommit}>
            {name(data.base)}
          </strong>
          <span>→</span>
          <strong title={data.target + " · " + data.targetCommit}>
            {name(data.target)}
          </strong>
        </div>
      )}
      <ReadStatus
        busy={view.loading}
        requestKey={view.key}
        label={data ? t("正在更新差异…") : t("正在读取差异…")}
      />
      {view.error && (
        <div className="history-error" role="status">
          <ErrorMessage error={view.error} />
          {data && (
            <span>
              {t("对比未更新，当前保留上次结果。")}
              {t("请求：{value}", {
                value: name(view.base) + " → " + name(view.target),
              })}
            </span>
          )}
          <button onClick={view.retry}>{t("重试")}</button>
        </div>
      )}
      {data?.filePath ? (
        <SourceEditor
          files={[]}
          file={{ path: data.filePath, mode: "branches" }}
          diff={data.diff}
          error={null}
          retry={view.retry}
          active={active}
          comparison={[
            t("基准：{value}", { value: name(data.base) }),
            t("目标：{value}", { value: name(data.target) }),
          ]}
          origin={{
            repoId: project.repoId,
            mode: "branches",
            path: data.filePath,
            beforePath: current?.oldPath ?? data.filePath,
            beforeCommit: data.baseCommit,
            afterCommit: data.targetCommit,
            historyRevision: data.revision,
          }}
        />
      ) : (
        <div className="editor-empty">
          <Icon name="branch" size={25} />
          <p>
            {data ? t("两个分支没有文件差异") : t("选择两个分支，查看文件差异")}
          </p>
        </div>
      )}
    </div>
  );
}
