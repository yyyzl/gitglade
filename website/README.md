# GitGlade website

A small, dependency-free static introduction and download site. The public page defaults to Simplified Chinese, including accessible labels, release states, and download controls; its primary help link opens the Chinese usage guide. Source lives here, separate from the desktop app. No analytics, third-party fonts, browser API requests, or simulated screenshots are shipped.

## Build and preview

Requires Node.js 22 (the CI version); no npm install is necessary.

```sh
node --test website/build.test.mjs
node website/build.mjs --offline
python3 -m http.server 8080 --directory website/dist
```

Offline mode intentionally shows the unpublished-installers state. For a real release-aware build:

```sh
GITHUB_REPOSITORY=yyyzl/gitglade node website/build.mjs
```

`GITHUB_TOKEN` is optional locally and is supplied by Actions. It stays server-side. The build reads up to 100 releases from the official GitHub API, skips drafts and prereleases, and chooses the newest published release containing an exact GitGlade branded asset matching its semantic version. It accepts `GitGlade_<version>_universal.dmg` and `GitGlade_<version>_x64-setup.exe` (also lowercase `gitglade`). It only publishes nonempty, uploaded assets whose URL exactly matches this repository and release tag. The other platform remains unavailable if its asset is missing. `SHA256SUMS.txt` is linked only when present in the same release.

Earlier oil-git releases never become GitGlade download buttons. If there is no matching release, the site explains the pending rebrand and links to the repository's releases. A failed API lookup fails the build, preserving the previous deployment instead of silently publishing unreliable metadata. `release.json` in the output records the chosen source and assets for inspection. Assets are pinned to a specific release, never guessed future URLs.

## GitHub Pages setup

Do this only when publication is authorized:

1. In this repository's Settings → Pages, choose **GitHub Actions** as the source.
2. Review the `github-pages` environment's deployment protection rules. Allow deployments from `main` and, if calling from the release workflow, the approved release tags. Keep any required approvals.
3. Run **GitGlade website** from the Actions tab, or push a website change to `main`.
4. Use the URL returned by the successful Pages deployment. Before a rename, the expected project URL is `https://yyyzl.github.io/oil-git/`; after renaming to `gitglade`, it is `https://yyyzl.github.io/gitglade/`. These are expected destinations, not evidence that either site is live.
5. Verify both platform downloads and the checksums against the published release. All source, help, and release links derive from `GITHUB_REPOSITORY`, so renaming does not leave upstream or old-owner links behind. Resources use relative paths and work under a project subpath.

The workflow builds and tests pull requests without deploying them. Main-branch website pushes, manually triggered runs, and human-published/edited/deleted releases refresh production. Jobs use only `contents: read`; the deployment job additionally needs `pages: write` and `id-token: write` and uses the `github-pages` environment. Official checkout, setup-node, configure-pages, upload-pages-artifact, and deploy-pages actions handle delivery.

### Release workflow integration

GitHub suppresses most new workflow events created using `GITHUB_TOKEN`, so a release published by automation must explicitly call the reusable Pages workflow **after all installer/checksum uploads finish**:

```yaml
website:
  needs: release
  permissions:
    contents: read
    pages: write
    id-token: write
  uses: ./.github/workflows/pages.yml
```

Use the actual release job name in `needs`. The caller must allow these permissions; reusable workflows cannot elevate them. The site checks out `main`, while the download resolver reads published assets. An explicit **GitGlade website** manual run also safely refreshes links after asset edits. There is no timed polling or client-side release discovery.

References: [Custom GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [workflow trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

## Verification scope

Tests cover no releases, legacy-brand exclusion, version-pinned assets, partial/missing uploads, drafts/prereleases, malformed versions and URLs, repository rename, HTML escaping, generated local asset paths, anchor targets, and a no-JavaScript output. These checks do not establish that macOS or Windows installers run successfully. Desktop release acceptance is separate.

The site uses semantic landmarks, visible keyboard focus, a skip link, descriptive platform controls, reduced-motion support, and responsive single-column layouts. Decorative workflow drawings are explicitly labeled as diagrams. Browser viewport/keyboard review must be recorded separately when performed.
