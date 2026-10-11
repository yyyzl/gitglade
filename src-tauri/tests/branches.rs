use gitglade_lib::git::{Git, LineOriginRequest};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;

struct Fixture {
    temp: TempDir,
    repo: PathBuf,
    peer: PathBuf,
    git: Git,
}
impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        let peer = root.join("远端 with space");
        let repo = root.join("本地 with space");
        fs::create_dir(&peer).unwrap();
        let git = Git::discover().unwrap().0;
        command(&git, &peer, &["init", "-b", "main"]);
        command(&git, &peer, &["config", "core.autocrlf", "false"]);
        command(&git, &peer, &["config", "user.name", "分支验证"]);
        command(
            &git,
            &peer,
            &["config", "user.email", "test@example.invalid"],
        );
        fs::write(peer.join("first.txt"), "before\n").unwrap();
        command(&git, &peer, &["add", "."]);
        command(&git, &peer, &["commit", "-m", "initial"]);
        command(
            &git,
            &root,
            &["clone", peer.to_str().unwrap(), repo.to_str().unwrap()],
        );
        command(&git, &repo, &["config", "core.autocrlf", "false"]);
        command(&git, &repo, &["config", "user.name", "分支验证"]);
        command(
            &git,
            &repo,
            &["config", "user.email", "test@example.invalid"],
        );
        Self {
            temp,
            repo,
            peer,
            git,
        }
    }
    fn peer_commit(&self) {
        fs::write(self.peer.join("first.txt"), "remote latest\n").unwrap();
        command(&self.git, &self.peer, &["add", "."]);
        command(&self.git, &self.peer, &["commit", "-m", "remote update"]);
    }
    fn inspect(&self) -> gitglade_lib::git::BranchUpdate {
        self.git.check_branch_update(&self.repo, None).unwrap()
    }
}
fn command(git: &Git, repo: &Path, args: &[&str]) -> String {
    let output = Command::new(&git.binary)
        // Keep fixture setup deterministic across host Git configurations:
        // no CRLF checkout conversion or detached maintenance/index writes.
        .args([
            "-c",
            "core.autocrlf=false",
            "-c",
            "gc.auto=0",
            "-c",
            "maintenance.auto=false",
            "-C",
        ])
        .arg(repo)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().into()
}
fn fingerprint(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn collect(base: &Path, at: &Path, result: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in fs::read_dir(at).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                collect(base, &path, result)
            } else {
                result.push((
                    path.strip_prefix(base).unwrap().into(),
                    fs::read(path).unwrap(),
                ))
            }
        }
    }
    let mut result = vec![];
    collect(root, root, &mut result);
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}

#[test]
fn direct_comparison_is_read_only_and_handles_rename_reverse_binary_and_stale_refs() {
    let fixture = Fixture::new();
    let git = &fixture.git;
    let repo = &fixture.repo;
    command(git, repo, &["checkout", "-b", "feature/公式"]);
    command(git, repo, &["mv", "first.txt", "重命名.txt"]);
    fs::write(repo.join("new.txt"), "new\n").unwrap();
    fs::write(repo.join("image.png"), b"\x89PNG\r\n\x1a\n\0image").unwrap();
    command(git, repo, &["add", "."]);
    command(git, repo, &["commit", "-m", "rename and add"]);
    let before = fingerprint(repo);
    let data = git
        .compare_branches(
            repo,
            "refs/heads/main",
            "refs/heads/feature/公式",
            Some("重命名.txt"),
            None,
        )
        .unwrap();
    assert_eq!(data.files.len(), 3);
    assert_eq!(
        data.files
            .iter()
            .find(|f| f.path == "重命名.txt")
            .unwrap()
            .old_path
            .as_deref(),
        Some("first.txt")
    );
    assert_eq!(data.file_path.as_deref(), Some("重命名.txt"));
    for side in ["before", "after"] {
        let origin = git
            .line_origin(
                repo,
                &LineOriginRequest {
                    mode: "branches".into(),
                    path: "重命名.txt".into(),
                    commit: None,
                    side: side.into(),
                    line: 1,
                    history_revision: Some(data.revision.clone()),
                    changes_revision: None,
                    before_commit: Some(data.base_commit.clone()),
                    after_commit: Some(data.target_commit.clone()),
                    before_path: Some("first.txt".into()),
                },
            )
            .unwrap();
        assert_eq!(origin.subject, "initial");
        assert_eq!(origin.hash.as_deref(), Some(data.base_commit.as_str()));
    }
    let binary = git
        .compare_branches(
            repo,
            &data.base,
            &data.target,
            Some("image.png"),
            Some(&data.revision),
        )
        .unwrap();
    assert!(binary.diff.unwrap().preview.unwrap().after.is_some());
    let reverse = git
        .compare_branches(repo, &data.target, &data.base, None, None)
        .unwrap();
    assert!(reverse
        .files
        .iter()
        .any(|f| f.path == "new.txt" && f.status == "D"));
    assert_eq!(
        git.compare_branches(repo, &data.base, &data.base, None, None)
            .unwrap()
            .files
            .len(),
        0
    );
    assert_eq!(fingerprint(repo), before);
    command(git, repo, &["branch", "new-ref"]);
    assert_eq!(
        git.compare_branches(repo, &data.base, &data.target, None, Some(&data.revision))
            .err()
            .unwrap()
            .kind,
        "staleHistory"
    );
    assert!(git
        .compare_branches(repo, "--bad", &data.target, None, None)
        .is_err());
}

#[test]
fn checks_fetch_only_then_confirmed_fast_forward_preserves_other_refs_and_untracked_files_and_skips_hooks(
) {
    let fixture = Fixture::new();
    fixture.peer_commit();
    let before_head = command(&fixture.git, &fixture.repo, &["rev-parse", "HEAD"]);
    let before_index = fs::read(fixture.repo.join(".git/index")).unwrap();
    fs::write(fixture.repo.join("personal.txt"), "keep this\n").unwrap();
    let plan = fixture.inspect();
    assert_eq!(plan.status, "ready");
    assert_eq!(plan.behind, 1);
    assert_eq!(plan.ahead, 0);
    assert_eq!(
        command(&fixture.git, &fixture.repo, &["rev-parse", "HEAD"]),
        before_head
    );
    assert_eq!(
        fs::read(fixture.repo.join(".git/index")).unwrap(),
        before_index
    );
    assert_eq!(
        fs::read_to_string(fixture.repo.join("first.txt")).unwrap(),
        "before\n"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let hook = fixture.repo.join(".git/hooks/post-merge");
        fs::write(&hook, "#!/bin/sh\nprintf bad > hook-ran\n").unwrap();
        fs::set_permissions(hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let after = fixture
        .git
        .fast_forward_branch(&fixture.repo, &plan)
        .unwrap();
    assert_eq!(after.head, plan.target);
    assert_eq!(after.status, "upToDate");
    assert_eq!(
        fs::read_to_string(fixture.repo.join("first.txt")).unwrap(),
        "remote latest\n"
    );
    assert_eq!(
        fs::read_to_string(fixture.repo.join("personal.txt")).unwrap(),
        "keep this\n"
    );
    assert!(!fixture.repo.join("hook-ran").exists());
    assert!(!fixture.repo.join(".git/oil-git-update.lock").exists());
}

#[test]
fn diverged_dirty_and_changed_conditions_never_update_local_branch() {
    let fixture = Fixture::new();
    fixture.peer_commit();
    let plan = fixture.inspect();
    fs::write(fixture.repo.join("first.txt"), "local edit\n").unwrap();
    assert_eq!(fixture.inspect().status, "dirty");
    assert!(fixture
        .git
        .fast_forward_branch(&fixture.repo, &plan)
        .is_err());
    command(&fixture.git, &fixture.repo, &["add", "."]);
    command(&fixture.git, &fixture.repo, &["commit", "-m", "local only"]);
    let diverged = fixture.inspect();
    assert_eq!(diverged.status, "diverged");
    assert_eq!(diverged.ahead, 1);
    assert_eq!(diverged.behind, 1);
    let bytes = fingerprint(&fixture.repo);
    assert!(fixture
        .git
        .fast_forward_branch(&fixture.repo, &diverged)
        .is_err());
    assert_eq!(fingerprint(&fixture.repo), bytes);
    let other = Fixture::new();
    other.peer_commit();
    let plan = other.inspect();
    command(&other.git, &other.repo, &["checkout", "-b", "other"]);
    assert_eq!(
        other
            .git
            .fast_forward_branch(&other.repo, &plan)
            .err()
            .unwrap()
            .kind,
        "updateStale"
    );
    let _ = &fixture.temp;
}

#[test]
fn detached_source_failures_and_target_changes_are_not_reported_as_success() {
    let fixture = Fixture::new();
    fixture.peer_commit();
    let plan = fixture.inspect();
    assert!(fixture
        .git
        .check_branch_update(&fixture.repo, Some("--evil"))
        .is_err());
    fs::write(fixture.peer.join("first.txt"), "another remote version\n").unwrap();
    command(&fixture.git, &fixture.peer, &["add", "."]);
    command(
        &fixture.git,
        &fixture.peer,
        &["commit", "-m", "another remote update"],
    );
    let newer = fixture.inspect();
    assert_ne!(newer.target, plan.target);
    assert_eq!(
        fixture
            .git
            .fast_forward_branch(&fixture.repo, &plan)
            .err()
            .unwrap()
            .kind,
        "updateStale"
    );
    command(&fixture.git, &fixture.repo, &["checkout", "--detach"]);
    assert_eq!(
        fixture
            .git
            .check_branch_update(&fixture.repo, None)
            .err()
            .unwrap()
            .kind,
        "updateSource"
    );
    assert_eq!(
        fixture
            .git
            .check_branch_update(&fixture.repo, Some("refs/remotes/origin/main"))
            .err()
            .unwrap()
            .kind,
        "updateDetached"
    );
    command(&fixture.git, &fixture.repo, &["checkout", "main"]);
    command(
        &fixture.git,
        &fixture.repo,
        &[
            "remote",
            "set-url",
            "origin",
            fixture.temp.path().join("missing remote").to_str().unwrap(),
        ],
    );
    let before = command(&fixture.git, &fixture.repo, &["rev-parse", "HEAD"]);
    assert!(fixture
        .git
        .check_branch_update(&fixture.repo, None)
        .is_err());
    assert_eq!(
        command(&fixture.git, &fixture.repo, &["rev-parse", "HEAD"]),
        before
    );
}

#[test]
fn updating_a_linked_worktree_does_not_move_the_main_worktree_branch() {
    let fixture = Fixture::new();
    let linked = fixture.temp.path().join("另一个工作树");
    command(
        &fixture.git,
        &fixture.repo,
        &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
    );
    command(
        &fixture.git,
        &fixture.repo,
        &["branch", "--set-upstream-to=origin/main", "feature"],
    );
    let linked = dunce::canonicalize(linked).unwrap();
    fixture.peer_commit();
    let plan = fixture.git.check_branch_update(&linked, None).unwrap();
    assert_eq!(plan.branch, "feature");
    fixture.git.fast_forward_branch(&linked, &plan).unwrap();
    assert_eq!(
        command(&fixture.git, &fixture.repo, &["rev-parse", "HEAD"]),
        plan.head
    );
    assert_eq!(
        fs::read_to_string(fixture.repo.join("first.txt")).unwrap(),
        "before\n"
    );
    assert_eq!(
        fs::read_to_string(linked.join("first.txt")).unwrap(),
        "remote latest\n"
    );
}

#[test]
fn ignored_files_and_content_filters_cannot_be_silently_overwritten_or_executed() {
    let fixture = Fixture::new();
    fs::write(fixture.repo.join(".git/info/exclude"), "personal.dat\n").unwrap();
    fs::write(fixture.repo.join("personal.dat"), "private content\n").unwrap();
    fs::write(fixture.peer.join("personal.dat"), "remote content\n").unwrap();
    command(&fixture.git, &fixture.peer, &["add", "."]);
    command(&fixture.git, &fixture.peer, &["commit", "-m", "add file"]);
    let plan = fixture.inspect();
    assert_eq!(plan.status, "ready");
    assert!(fixture
        .git
        .fast_forward_branch(&fixture.repo, &plan)
        .is_err());
    assert_eq!(
        command(&fixture.git, &fixture.repo, &["rev-parse", "HEAD"]),
        plan.head
    );
    assert_eq!(
        fs::read_to_string(fixture.repo.join("personal.dat")).unwrap(),
        "private content\n"
    );
    let filtered = Fixture::new();
    fs::write(filtered.peer.join(".gitattributes"), "*.dat filter=lfs\n").unwrap();
    fs::write(
        filtered.peer.join("asset.dat"),
        "pointer or converted file\n",
    )
    .unwrap();
    command(&filtered.git, &filtered.peer, &["add", "."]);
    command(
        &filtered.git,
        &filtered.peer,
        &["commit", "-m", "filtered file"],
    );
    let plan = filtered.inspect();
    assert_eq!(
        filtered
            .git
            .fast_forward_branch(&filtered.repo, &plan)
            .err()
            .unwrap()
            .kind,
        "updateFilter"
    );
    assert_eq!(
        command(&filtered.git, &filtered.repo, &["rev-parse", "HEAD"]),
        plan.head
    );
    assert!(!filtered.repo.join("asset.dat").exists());
}
