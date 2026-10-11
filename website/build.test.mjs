import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { releaseMetadata, escapeHtml, build } from "./build.mjs";
const repo = "yyyzl/gitglade";
const asset = (name, overrides = {}) => ({
  name,
  size: 10485760,
  state: "uploaded",
  browser_download_url: `https://github.com/${repo}/releases/download/v0.1.1/${name}`,
  ...overrides,
});
const release = (overrides = {}) => ({
  tag_name: "v0.1.1",
  draft: false,
  prerelease: false,
  assets: [
    asset("GitGlade_0.1.1_universal.dmg"),
    asset("GitGlade_0.1.1_x64-setup.exe"),
    asset("SHA256SUMS.txt"),
  ],
  ...overrides,
});
test("no release keeps stable safe fallback with no invented installer", () => {
  const value = releaseMetadata([], repo);
  assert.equal(value.url, `https://github.com/${repo}/releases/latest`);
  assert.equal(value.mac, null);
  assert.equal(value.windows, null);
});
test("legacy oil-git assets are never relabeled GitGlade", () => {
  assert.equal(
    releaseMetadata(
      [release({ assets: [asset("oil-git_0.1.1_universal.dmg")] })],
      repo,
    ).version,
    null,
  );
});
test("published exact brand/version/platform names become pinned downloads", () => {
  const result = releaseMetadata([release()], repo);
  assert.equal(result.version, "0.1.1");
  assert.equal(result.mac.name, "GitGlade_0.1.1_universal.dmg");
  assert.equal(result.windows.name, "GitGlade_0.1.1_x64-setup.exe");
  assert.equal(result.checksums.name, "SHA256SUMS.txt");
});
test("partial upload exposes only the actually uploaded platform", () => {
  const result = releaseMetadata(
    [release({ assets: [asset("GitGlade_0.1.1_universal.dmg")] })],
    repo,
  );
  assert.ok(result.mac);
  assert.equal(result.windows, null);
  assert.equal(result.checksums, null);
});
test("drafts, prereleases, malformed versions, foreign URLs, empty and uploading assets rejected", () => {
  for (const invalid of [
    release({ draft: true }),
    release({ prerelease: true }),
    release({ tag_name: "v0.1.1-rc.1" }),
    release({
      assets: [
        asset("GitGlade_0.1.1_universal.dmg", {
          browser_download_url: "https://evil.invalid/fake.dmg",
        }),
      ],
    }),
    release({ assets: [asset("GitGlade_0.1.1_universal.dmg", { size: 0 })] }),
    release({
      assets: [asset("GitGlade_0.1.1_universal.dmg", { state: "new" })],
    }),
  ])
    assert.equal(releaseMetadata([invalid], repo).version, null);
});
test("old repo name and lowercase package prefix work before rename", () => {
  const oldRepo = "yyyzl/oil-git";
  const name = "gitglade_0.1.1_universal.dmg";
  assert.ok(
    releaseMetadata(
      [
        release({
          assets: [
            asset(name, {
              browser_download_url: `https://github.com/${oldRepo}/releases/download/v0.1.1/${name}`,
            }),
          ],
        }),
      ],
      oldRepo,
    ).mac,
  );
});
test("invalid repository cannot inject links or API paths", () => {
  assert.throws(() => releaseMetadata([], "x/../../bad"));
  assert.equal(escapeHtml("<\"&'>"), "&lt;&quot;&amp;&#39;&gt;");
});
test("generated site works without JS and only includes owned pinned downloads", async () => {
  const output = await mkdtemp(join(tmpdir(), "gitglade-web-"));
  try {
    await build({ repository: repo, releases: [release()], output });
    const html = await readFile(join(output, "index.html"), "utf8");
    assert.ok(!html.includes("{{"));
    assert.ok(!html.includes("<script"));
    assert.ok(
      html.includes(
        `https://github.com/${repo}/releases/download/v0.1.1/GitGlade_0.1.1_universal.dmg`,
      ),
    );
    assert.ok(!html.includes("oil-oil.github.io"));
    assert.ok(!html.includes("oil-oil/oil-git"));
    for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))
      assert.ok((await readFile(join(output, match[1]))).length);
    const ids = new Set(
      [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]),
    );
    for (const match of html.matchAll(/href="#([^"]+)"/g))
      assert.ok(ids.has(match[1]), `Missing anchor ${match[1]}`);
    await build({ repository: repo, releases: [], output });
    const pending = await readFile(join(output, "index.html"), "utf8");
    assert.ok(pending.includes("Installer not published yet"));
    assert.ok(!pending.includes("/releases/download/"));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
