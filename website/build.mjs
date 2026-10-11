import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function releaseMetadata(releases, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository");
  const base = `https://github.com/${repository}`;
  const result = {
    version: null,
    url: `${base}/releases/latest`,
    mac: null,
    windows: null,
    checksums: null,
  };
  for (const release of releases) {
    if (
      release.draft ||
      release.prerelease ||
      !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)
    )
      continue;
    const version = release.tag_name.replace(/^v/, "");
    const prefix = `${base}/releases/download/${encodeURIComponent(release.tag_name)}/`;
    const assets = (release.assets ?? []).filter(
      (asset) =>
        asset.state === "uploaded" &&
        asset.size > 0 &&
        asset.browser_download_url === prefix + encodeURIComponent(asset.name),
    );
    const mac = assets.find((asset) =>
      ["GitGlade", "gitglade"].some(
        (brand) => asset.name === `${brand}_${version}_universal.dmg`,
      ),
    );
    const windows = assets.find((asset) =>
      ["GitGlade", "gitglade"].some(
        (brand) => asset.name === `${brand}_${version}_x64-setup.exe`,
      ),
    );
    if (!mac && !windows) continue;
    return {
      version,
      url: `${base}/releases/tag/${encodeURIComponent(release.tag_name)}`,
      mac: mac ?? null,
      windows: windows ?? null,
      checksums:
        assets.find((asset) => asset.name === "SHA256SUMS.txt") ?? null,
    };
  }
  return result;
}

export async function getReleases(repository) {
  // Build-time only. Never expose the token or depend on an API call in the browser.
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases?per_page=100`,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok)
    throw new Error(`GitHub release lookup failed (${response.status})`);
  const releases = await response.json();
  if (!Array.isArray(releases))
    throw new Error("Unexpected GitHub release response");
  return releases;
}

export async function build({
  repository = process.env.GITHUB_REPOSITORY || "yyyzl/gitglade",
  releases,
  output = join(root, "dist"),
} = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository");
  const metadata = releaseMetadata(
    releases ?? (await getReleases(repository)),
    repository,
  );
  const base = `https://github.com/${repository}`;
  const button = (asset, label) =>
    asset
      ? `<a class="button primary" href="${escapeHtml(asset.browser_download_url)}">Download ${label} <span aria-hidden="true">↗</span></a><p class="asset-note">${escapeHtml(asset.name)} · ${(asset.size / 1048576).toFixed(1)} MB</p>`
      : `<p class="unavailable">Installer not published yet</p><a class="text-link" href="${base}/releases">Check releases <span aria-hidden="true">↗</span></a>`;
  const replacements = {
    REPOSITORY_URL: base,
    RELEASE_URL: metadata.url,
    RELEASE_STATUS: metadata.version
      ? `GitGlade ${escapeHtml(metadata.version)}`
      : "The first GitGlade release is on its way",
    RELEASE_NOTE: metadata.version
      ? "Installers below come directly from this project’s GitHub release."
      : "The GitGlade rebrand is being prepared. Earlier oil-git downloads keep their original name; they are not GitGlade installers.",
    MAC_DOWNLOAD: button(metadata.mac, "for macOS"),
    WINDOWS_DOWNLOAD: button(metadata.windows, "for Windows"),
    CHECKSUMS: metadata.checksums
      ? `<a class="text-link" href="${escapeHtml(metadata.checksums.browser_download_url)}">Download SHA256 checksums ↗</a>`
      : "Installer checksums will appear here when published with a GitGlade release.",
  };
  let html = await readFile(join(root, "index.html"), "utf8");
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in replacements)) throw new Error(`Unknown placeholder ${key}`);
    return replacements[key];
  });
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "index.html"), html);
  await cp(join(root, "assets"), join(output, "assets"), { recursive: true });
  await writeFile(join(output, ".nojekyll"), "");
  await writeFile(
    join(output, "release.json"),
    JSON.stringify({ repository, ...metadata }, null, 2) + "\n",
  );
  return metadata;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const offline = process.argv.includes("--offline");
  await build({ ...(offline ? { releases: [] } : {}) });
  console.log(
    `Built website/dist${offline ? " (offline preview; no release claims)" : ""}`,
  );
}
