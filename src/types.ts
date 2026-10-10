export type GitError = { kind: string; message: string; messageKey?: string };
export type Reference = {
  name: string;
  fullName: string;
  hash: string;
  kind: "branch" | "remote" | "tag";
};
export type FileState = {
  path: string;
  oldPath: string | null;
  xy: string;
  untracked: boolean;
  conflict: boolean;
  staged: boolean;
  unstaged: boolean;
};
export type Worktree = {
  id: string;
  path: string;
  branch: string;
  current: boolean;
  available: boolean;
  bare: boolean;
  detached?: boolean;
};
export type Snapshot = {
  path: string;
  name: string;
  branch: string | null;
  head: string | null;
  refs: Reference[];
  files: FileState[];
  historyRevision: string;
  changesRevision: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  operation: string | null;
  worktrees: Worktree[];
  stashes: { reference: string; subject: string }[];
};
export type Project = { repoId: string; snapshot: Snapshot };
export type Commit = {
  hash: string;
  parents: string[];
  author: string;
  authorEmail?: string;
  committer?: string;
  committerEmail?: string;
  date: string;
  subject: string;
};
export type HistoryPage = {
  commits: Commit[];
  offset: number;
  hasMore: boolean;
  revision: string;
};
export type CommitFile = {
  path: string;
  oldPath: string | null;
  status: string;
};
export type CommitDetail = Commit & { files: CommitFile[]; comparison: string };
export type ConflictLine = { line: number; text: string };
export type PreviewSide = {
  size: number;
  mime: string;
  kind: "image" | "audio" | "video" | "binary";
  dataUrl: string | null;
  width: number | null;
  height: number | null;
  hex: string;
  hexTruncated: boolean;
  note: string | null;
};
export type FilePreview = {
  before: PreviewSide | null;
  after: PreviewSide | null;
  conflict: boolean;
};
export type Diff = {
  patch: string;
  noteKey?: string;
  lfs?: null | {
    conflict?: boolean;
    before: { oid: string; size: number } | null;
    after: { oid: string; size: number } | null;
    beforeState?: "pointer" | "regular" | "missing" | "unsupported";
    afterState?: "pointer" | "regular" | "missing" | "unsupported";
  };
  truncated: boolean;
  binary: boolean;
  preview?: FilePreview;
  encoding?: string;
  note: string | null;
  conflict: null | {
    kind: string;
    note: string | null;
    blocks: {
      startLine: number;
      endLine: number;
      ours: ConflictLine[];
      base: ConflictLine[];
      theirs: ConflictLine[];
      incoming: string;
    }[];
  };
};
export type Selection =
  | { kind: "stashes" }
  | { kind: "commit"; hash: string }
  | null;
export type DiffMode =
  | "unstaged"
  | "staged"
  | "conflict"
  | "commit"
  | "branches";
export type DiffOrigin = {
  repoId: string;
  path: string;
  mode: DiffMode;
  commit?: string;
  historyRevision?: string;
  changesRevision?: string;
  beforeCommit?: string;
  afterCommit?: string;
  beforePath?: string;
};
export type BranchComparison = {
  base: string;
  target: string;
  baseCommit: string;
  targetCommit: string;
  revision: string;
  files: CommitFile[];
  filePath: string | null;
  diff: Diff | null;
};
export type BranchUpdate = {
  branch: string;
  source: string;
  head: string;
  target: string;
  ahead: number;
  behind: number;
  status: "ready" | "dirty" | "diverged" | "ahead" | "upToDate" | "operation";
  commits: Commit[];
};
export type LineOrigin = {
  hash: string | null;
  author: string;
  email: string;
  timestamp: number | null;
  subject: string;
  originalLine: number;
  line: number;
  path: string;
};
