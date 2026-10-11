import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = (file) =>
  fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("package, installer, and crate versions and identities agree", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const app = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(pkg.name, "gitglade");
  assert.equal(pkg.version, "0.1.1");
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(app.version, pkg.version);
  assert.equal(app.productName, "GitGlade");
  assert.equal(app.identifier, "io.github.yyyzl.gitglade");
  assert.match(
    read("src-tauri/Cargo.toml"),
    /name = "gitglade"\nversion = "0\.1\.1"/,
  );
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "gitglade"\nversion = "0\.1\.1"/,
  );
  assert.equal(app.bundle.resources["../skills/gitglade/"], "skills/gitglade/");
});

test("release workflow consumes the renamed installer artifacts", () => {
  const workflow = read(".github/workflows/build.yml");
  assert.match(workflow, /installers-windows-x64/);
  assert.match(workflow, /installers-macos-universal/);
  assert.match(workflow, /pattern: "installers-\*"/);
  assert.doesNotMatch(workflow, /windows-x64-test|mac-universal-test/);
  assert.ok(workflow.includes("GitGlade_${version}_universal.dmg"));
  assert.ok(workflow.includes("GitGlade_${version}_x64-setup.exe"));
  assert.match(workflow, /uses: \.\/\.github\/workflows\/pages.yml/);
});

test("original legal attribution and cross-version update lock remain", () => {
  assert.match(
    read("LICENSE"),
    /Copyright \(c\) 2026 Zhihuang Lin \(oil-oil\)/,
  );
  assert.match(
    read("src-tauri/src/git/branches.rs"),
    /directory.join\("oil-git-update.lock"\)/,
  );
});

const shellTest = process.platform === "win32" ? test.skip : test;
shellTest(
  "launchers honor new paths and safe legacy aliases without starting upstream",
  () => {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "gitglade-launcher-"),
    );
    try {
      const app = path.join(temporary, "GitGlade with spaces.app");
      const binary = path.join(app, "Contents", "MacOS", "gitglade");
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
        mode: 0o755,
      });
      const env = {
        ...process.env,
        HOME: temporary,
        GITGLADE_APP: app,
        OIL_GIT_APP: "",
      };
      const launch = (name, overrides = {}) =>
        spawnSync(
          "/bin/sh",
          [
            new URL(`../bin/${name}`, import.meta.url).pathname,
            "inspect",
            "a path",
            "--json",
          ],
          { env: { ...env, ...overrides }, encoding: "utf8" },
        );
      for (const name of ["gitglade", "oil-git"]) {
        const result = launch(name);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, "inspect\na path\n--json\n");
      }
      const legacy = launch("gitglade", { GITGLADE_APP: "", OIL_GIT_APP: app });
      assert.equal(legacy.status, 0, legacy.stderr);
      const upstream = path.join(temporary, "oil-git.app");
      fs.mkdirSync(path.join(upstream, "Contents", "MacOS"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(upstream, "Contents", "MacOS", "oil-git"),
        "#!/bin/sh\necho WRONG_APP\n",
        { mode: 0o755 },
      );
      const rejected = launch("gitglade", {
        GITGLADE_APP: upstream,
        OIL_GIT_APP: "",
      });
      assert.notEqual(rejected.status, 0);
      assert.doesNotMatch(rejected.stdout, /WRONG_APP/);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  },
);

test("release intent is version-locked and manual publication requires main", () => {
  const workflow = read(".github/workflows/build.yml");
  const inline = workflow
    .match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .replace(/^          /gm, "");
  const validate = (event, ref, input) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", inline], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: event,
        GITHUB_REF: ref,
        RELEASE_INPUT: input,
        GITHUB_SHA: "tested-commit",
      },
      encoding: "utf8",
    });
  assert.equal(validate("workflow_dispatch", "refs/heads/main", "").status, 0);
  assert.equal(
    validate("workflow_dispatch", "refs/heads/main", "v0.1.1").status,
    0,
  );
  assert.equal(validate("push", "refs/tags/v0.1.1", "").status, 0);
  for (const [event, ref, input] of [
    ["workflow_dispatch", "refs/heads/topic", "v0.1.1"],
    ["workflow_dispatch", "refs/heads/main", "v0.1.0"],
    ["workflow_dispatch", "refs/heads/main", "v0.1.2"],
    ["workflow_dispatch", "refs/heads/main", "v00.1.1"],
    ["workflow_dispatch", "refs/heads/main", "0.1.1"],
    ["push", "refs/tags/v0.1.0", ""],
  ])
    assert.notEqual(
      validate(event, ref, input).status,
      0,
      `${event} ${ref} ${input}`,
    );
  assert.match(workflow, /needs: release-plan/);
  assert.match(workflow, /needs: check/);
  assert.match(workflow, /needs: bundle/);
  assert.match(workflow, /needs: installed/);
  assert.ok(workflow.includes("inputs.release_version != ''"));
  assert.ok(
    workflow.includes('-f "ref=refs/tags/$RELEASE_TAG" -f "sha=$RELEASE_SHA"'),
  );
  assert.ok(workflow.includes('"$tagged_sha" != "$RELEASE_SHA"'));
  assert.match(workflow, /--repo "\$GH_REPO" --verify-tag/);
});
