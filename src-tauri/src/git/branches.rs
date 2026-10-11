use super::*;
use std::fs::OpenOptions;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparison {
    pub base: String,
    pub target: String,
    pub base_commit: String,
    pub target_commit: String,
    pub revision: String,
    pub files: Vec<CommitFile>,
    pub file_path: Option<String>,
    pub diff: Option<Diff>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchUpdate {
    pub branch: String,
    pub source: String,
    pub head: String,
    pub target: String,
    pub ahead: usize,
    pub behind: usize,
    pub status: String,
    pub commits: Vec<Commit>,
}

struct UpdateLock(PathBuf);
impl Drop for UpdateLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

impl Git {
    fn branch_revision(&self, repo: &Path, name: &str) -> Result<String> {
        if !name.starts_with("refs/heads/") && !name.starts_with("refs/remotes/") {
            return Err(Error::new("invalid", "请选择本地分支或远端记录。"));
        }
        if !self
            .refs(repo)?
            .iter()
            .any(|reference| reference.full_name == name)
        {
            return Err(Error::new(
                "missingReference",
                "这个分支或远端记录已被移除。",
            ));
        }
        let hash = self.text(
            repo,
            &[
                "rev-parse",
                "--verify",
                "--end-of-options",
                &format!("{name}^{{commit}}"),
            ],
            false,
        )?;
        Self::validate_commit_id(&hash)?;
        Ok(hash)
    }

    pub fn compare_branches(
        &self,
        repo: &Path,
        base: &str,
        target: &str,
        path: Option<&str>,
        expected: Option<&str>,
    ) -> Result<BranchComparison> {
        self.reject_partial_clone(repo)?;
        let revision = self.history_revision(repo)?;
        if expected.is_some_and(|value| value != revision) {
            return Err(Error::new("staleHistory", "分支记录已变化，请重新比较。"));
        }
        let base_commit = self.branch_revision(repo, base)?;
        let target_commit = self.branch_revision(repo, target)?;
        let output = self.run(
            repo,
            &[
                "diff-tree",
                "--no-commit-id",
                "-r",
                "--find-renames",
                "--name-status",
                "-z",
                &base_commit,
                &target_commit,
                "--",
            ],
            READ_LIMIT,
            false,
        )?;
        if output.truncated {
            return Err(Error::new(
                "tooLarge",
                "分支变更过大，无法完整读取文件列表。",
            ));
        }
        let fields: Vec<_> = output
            .bytes
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
            .collect();
        let mut files = vec![];
        let mut index = 0;
        while index + 1 < fields.len() {
            let status = String::from_utf8_lossy(fields[index]).to_string();
            let first = String::from_utf8_lossy(fields[index + 1]).to_string();
            index += 2;
            let (path, old_path) = if status.starts_with('R') || status.starts_with('C') {
                let next = fields
                    .get(index)
                    .ok_or_else(|| Error::new("read", "分支文件列表不完整。"))?;
                index += 1;
                (String::from_utf8_lossy(next).to_string(), Some(first))
            } else {
                (first, None)
            };
            files.push(CommitFile {
                path,
                old_path,
                status,
            });
        }
        let file_path = match path {
            Some(path) => {
                validate_relative(path)?;
                if !files.iter().any(|file| file.path == path) {
                    return Err(Error::new("invalid", "该比较中没有这个变更文件。"));
                }
                Some(path.to_owned())
            }
            None => files.first().map(|file| file.path.clone()),
        };
        let diff = if let Some(path) = &file_path {
            // 只复用两棵树的读取链；此内部比较基准不作为真实父提交返回给界面。
            let mut detail = self.commit_inner(repo, &target_commit)?;
            detail.commit.parents = vec![base_commit.clone()];
            detail.files = files.clone();
            Some(self.commit_diff_with_lfs(repo, &detail, path)?)
        } else {
            None
        };
        if self.history_revision(repo)? != revision {
            return Err(Error::new("staleHistory", "分支记录已变化，请重新比较。"));
        }
        Ok(BranchComparison {
            base: base.into(),
            target: target.into(),
            base_commit,
            target_commit,
            revision,
            files,
            file_path,
            diff,
        })
    }

    fn update_lock(&self, repo: &Path) -> Result<UpdateLock> {
        if self.repository_root(repo)? != repo {
            return Err(Error::new(
                "notRepository",
                "工作树路径已变化，请重新打开项目。",
            ));
        }
        let directory =
            PathBuf::from(self.text(repo, &["rev-parse", "--git-common-dir"], false)?);
        let directory = if directory.is_absolute() {
            directory
        } else {
            repo.join(directory)
        };
        // Keep the shared lock name for safe coexistence with pre-rebrand releases.
        let lock = directory.join("oil-git-update.lock");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
            .map_err(|error| {
                Error::new(
                    "updateBusy",
                    format!("该仓库正在更新，或上次更新锁尚未清除：{error}"),
                )
            })?;
        Ok(UpdateLock(lock))
    }

    fn update_source(&self, repo: &Path, source: &str) -> Result<(String, String)> {
        if !source.starts_with("refs/remotes/") || source.ends_with("/HEAD") {
            return Err(Error::new("invalid", "请选择明确的远端分支作为更新来源。"));
        }
        self.branch_revision(repo, source)?;
        let remotes = self.text(repo, &["remote"], false)?;
        let mut names: Vec<_> = remotes.lines().collect();
        names.sort_by_key(|name| std::cmp::Reverse(name.len()));
        for remote in names {
            if !source.starts_with(&format!("refs/remotes/{remote}/")) {
                continue;
            }
            let specifications = self.text(
                repo,
                &["config", "--get-all", &format!("remote.{remote}.fetch")],
                true,
            )?;
            for specification in specifications.lines() {
                let Some((from, to)) = specification.trim_start_matches('+').split_once(':') else {
                    continue;
                };
                let matched = if let Some((prefix, suffix)) = to.split_once('*') {
                    source
                        .strip_prefix(prefix)
                        .and_then(|value| value.strip_suffix(suffix))
                        .map(|value| from.replace('*', value))
                } else if to == source {
                    Some(from.to_owned())
                } else {
                    None
                };
                if let Some(from) = matched.filter(|from| from.starts_with("refs/heads/")) {
                    return Ok((remote.into(), from));
                }
            }
        }
        Err(Error::new(
            "updateSource",
            "无法确定此远端记录对应的获取规则。",
        ))
    }

    fn update_is_dirty(&self, repo: &Path, target: &str) -> Result<bool> {
        let files = self.files(repo)?;
        if files
            .iter()
            .any(|file| !file.untracked && (file.staged || file.unstaged || file.conflict))
        {
            return Ok(true);
        }
        if files.iter().any(|file| file.untracked) {
            let tree = self.run(
                repo,
                &["ls-tree", "-r", "--name-only", "-z", target],
                READ_LIMIT,
                false,
            )?;
            if tree.truncated {
                return Err(Error::new(
                    "tooLarge",
                    "目标文件列表过大，无法确认工作区安全。",
                ));
            }
            for raw in tree
                .bytes
                .split(|byte| *byte == 0)
                .filter(|part| !part.is_empty())
            {
                let tracked = String::from_utf8_lossy(raw);
                for file in files.iter().filter(|file| file.untracked) {
                    let untracked = file.path.trim_end_matches('/');
                    if tracked == untracked
                        || tracked.starts_with(&format!("{untracked}/"))
                        || untracked.starts_with(&format!("{tracked}/"))
                    {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }

    fn update_plan(&self, repo: &Path, source: &str) -> Result<BranchUpdate> {
        self.reject_partial_clone(repo)?;
        let branch = self.text(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"], true)?;
        if branch.is_empty() {
            return Err(Error::new(
                "updateDetached",
                "当前为分离 HEAD，无法更新本地分支。",
            ));
        }
        let head = self.text(repo, &["rev-parse", "--verify", "HEAD"], false)?;
        Self::validate_commit_id(&head)?;
        let target = self.branch_revision(repo, source)?;
        let counts = self.text(
            repo,
            &[
                "rev-list",
                "--left-right",
                "--count",
                &format!("{head}...{target}"),
            ],
            false,
        )?;
        let values: Vec<_> = counts.split_whitespace().collect();
        if values.len() != 2 {
            return Err(Error::new("read", "无法读取分支领先与落后数量。"));
        }
        let ahead = values[0]
            .parse()
            .map_err(|_| Error::new("read", "分支提交数量无效。"))?;
        let behind = values[1]
            .parse()
            .map_err(|_| Error::new("read", "分支提交数量无效。"))?;
        let operation = self
            .git_paths(
                repo,
                &[
                    "rebase-merge",
                    "rebase-apply",
                    "MERGE_HEAD",
                    "CHERRY_PICK_HEAD",
                    "REVERT_HEAD",
                ],
            )?
            .iter()
            .any(|path| path.exists());
        let status = if operation {
            "operation"
        } else if self.update_is_dirty(repo, &target)? {
            "dirty"
        } else if ahead > 0 && behind > 0 {
            "diverged"
        } else if ahead > 0 {
            "ahead"
        } else if behind == 0 {
            "upToDate"
        } else {
            "ready"
        };
        let commits = if behind > 0 {
            self.text(
                repo,
                &[
                    "log",
                    "-12",
                    "--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%s",
                    &format!("{head}..{target}"),
                    "--",
                ],
                false,
            )?
            .lines()
            .filter_map(parse_commit)
            .collect()
        } else {
            vec![]
        };
        Ok(BranchUpdate {
            branch,
            source: source.into(),
            head,
            target,
            ahead,
            behind,
            status: status.into(),
            commits,
        })
    }

    pub fn check_branch_update(&self, repo: &Path, source: Option<&str>) -> Result<BranchUpdate> {
        let _lock = self.update_lock(repo)?;
        self.reject_partial_clone(repo)?;
        let source = match source {
            Some(source) => source.to_owned(),
            None => self.text(
                repo,
                &["rev-parse", "--symbolic-full-name", "@{upstream}"],
                true,
            )?,
        };
        if source.is_empty() {
            return Err(Error::new(
                "updateSource",
                "未设置上游，请选择本次更新的远端来源。",
            ));
        }
        let (remote, from) = self.update_source(repo, &source)?;
        let before = self.update_plan(repo, &source)?;
        let specification = format!("+{from}:{source}");
        self.run_update(
            repo,
            &[
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                "--no-write-fetch-head",
                "--no-auto-maintenance",
                "--",
                &remote,
                &specification,
            ],
        )
        .map_err(|error| Error::new("updateFetch", error.message))?;
        let after = self.update_plan(repo, &source)?;
        if before.head != after.head || before.branch != after.branch {
            return Err(Error::new(
                "updateStale",
                "本地分支在检查期间发生变化，请重新检查。",
            ));
        }
        Ok(after)
    }

    fn check_update_filters(&self, repo: &Path, head: &str, target: &str) -> Result<()> {
        let files = self.run(
            repo,
            &[
                "diff-tree",
                "--no-commit-id",
                "-r",
                "--name-only",
                "-z",
                head,
                target,
                "--",
            ],
            READ_LIMIT,
            false,
        )?;
        if files.truncated {
            return Err(Error::new(
                "tooLarge",
                "更新文件列表过大，无法确认过滤器安全。",
            ));
        }
        for revision in [head, target] {
            let output = self.run_with_input(
                repo,
                &[
                    "check-attr",
                    "--source",
                    revision,
                    "-z",
                    "--stdin",
                    "filter",
                ],
                READ_LIMIT,
                false,
                Some(&files.bytes),
            )?;
            if output.truncated {
                return Err(Error::new(
                    "tooLarge",
                    "更新属性列表过大，无法确认过滤器安全。",
                ));
            }
            let fields: Vec<_> = output.bytes.split(|byte| *byte == 0).collect();
            if fields
                .as_chunks::<3>()
                .0
                .iter()
                .any(|record| !matches!(record[2], b"unspecified" | b"unset"))
            {
                return Err(Error::new(
                    "updateFilter",
                    "本次更新包含需要 Git LFS 或内容过滤器转换的文件，请在 Git 工具中更新。",
                ));
            }
        }
        Ok(())
    }

    pub fn fast_forward_branch(
        &self,
        repo: &Path,
        expected: &BranchUpdate,
    ) -> Result<BranchUpdate> {
        let _lock = self.update_lock(repo)?;
        self.update_source(repo, &expected.source)?;
        let current = self.update_plan(repo, &expected.source)?;
        if current.head != expected.head
            || current.branch != expected.branch
            || current.target != expected.target
            || current.status != "ready"
        {
            return Err(Error::new(
                "updateStale",
                "更新条件已变化，本次没有更新；请重新检查。",
            ));
        }
        self.check_update_filters(repo, &current.head, &current.target)?;
        self.run_update(
            repo,
            &[
                "merge",
                "--ff-only",
                "--no-overwrite-ignore",
                "--no-edit",
                "--no-stat",
                &current.target,
            ],
        )
        .map_err(|error| Error::new("updateFailed", error.message))?;
        let after = self.update_plan(repo, &current.source)?;
        if after.branch != current.branch
            || after.head != current.target
            || after.status != "upToDate"
        {
            return Err(Error::new(
                "updateFailed",
                "无法确认快进更新的完成状态，请重新读取仓库。",
            ));
        }
        Ok(after)
    }
}
