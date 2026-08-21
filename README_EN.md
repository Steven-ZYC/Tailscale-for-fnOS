# Tailscale for fnOS

English | [简体中文](README.md)

Native fnOS packaging for the official Tailscale Linux client. The generated
FPK files contain the unmodified official `tailscale` and `tailscaled` static
binaries from Tailscale's stable package server. Docker is not required.

- Repository: <https://github.com/Steven-ZYC/Tailscale-for-fnOS>

> This is a community-maintained third-party package. It is not affiliated with
> or endorsed by Tailscale Inc. or the fnOS vendor. Tailscale is a registered
> trademark of Tailscale Inc.

## Version naming

Complete FPK versions and formal GitHub release tags use
`v<Tailscale-version>-fnos.<community-version>`, for example
`v1.102.2-fnos.0.4`:

- `1.102.2` is the bundled official Tailscale version;
- `fnos.0.4` is the version of this project's fnOS community integration and
  upper management UI;
- the leading `v` is a Git tag prefix and is not part of the internal FPK version.

## Package behavior

- Runs the official `tailscaled` daemon as root for kernel TUN networking.
- Stores node state and keys in fnOS `TRIM_PKGVAR/state`, outside the replaceable
  application target directory.
- Stores the LocalAPI socket and PID in `TRIM_PKGTMP`.
- Uses this project's original lightweight Go CGI manager and Chinese management
  UI instead of `tailscale web --cgi`.
- The manager is not a resident daemon. It runs only for page/API requests and
  invokes the official `tailscale` CLI with fixed, validated arguments.
- Restricts the desktop entry to fnOS administrators.
- Supports automatic browser login with login-dialog completion detection and
  Auth Key login. Auth Keys are passed through a
  mode-`0600` temporary file and deleted immediately after use.
- Provides connect/disconnect and account logout.
- Shows project-original inline SVG icons by operating system, with device
  search, online filtering, pagination, and online counts.
- Provides DERP latency checks, hostname changes, and local Exit Node
  advertisement controls.
- Splits the interface into Overview, Devices, and Settings pages. v0.4 rebases
  the previous 120% font and 80% interface zoom as the new 100% defaults. v0.5
  adds editable percentage fields and applies scaling only after dragging or
  typing is complete to prevent range-thumb jumps. Display preferences remain
  local to the current browser.
- Automatically checks GitHub Releases whenever the manager page opens, with a
  manual recheck in Settings. It only displays a notification and never installs
  an update by itself.
- Does not run `tailscale update`; updates are delivered only as new FPK files.
- Does not support upgrading this app through Tailscale Admin Console remote or
  automatic updates. Download a new FPK manually from GitHub Releases or update
  it through the fnOS App Center.
- Installing a newer FPK with the same package identity uses the fnOS in-place
  upgrade lifecycle: the old process is stopped, application files are replaced,
  and the node identity, keys, and preferences under `TRIM_PKGVAR/state` survive.
  Do not overwrite a newer installation with an older FPK, and back up important
  application data before upgrading a critical device.
- Does not silently delete the saved node identity during uninstall hooks.

## Test on fnOS

Use a disposable clean VM and follow [`docs/VM_TESTING.md`](docs/VM_TESTING.md).
The first automated smoke test is:

```bash
sudo ./scripts/device-smoke-test.sh /path/to/tailscale-fnos_VERSION_x86.fpk
```

The script installs the package, starts it, checks TUN/interface/socket state,
stops it to test cleanup, then starts it again. Login and real peer connectivity
remain interactive acceptance tests.

## Automated updates

`Track Tailscale stable releases` runs at 01:17 UTC (09:17 in Hong Kong/Beijing)
and performs an idempotent retry three hours later at 04:17 UTC (12:17). A
successful primary run makes the retry a cheap no-op. A failure creates or
updates an `[automation] Tailscale stable update failed` issue, which is closed
automatically after recovery. Each run cross-checks:

- the latest full release in `tailscale/tailscale`; and
- the Linux amd64 package shown by Tailscale's stable package server.

When both sources agree on a newer version, the workflow refreshes official
digests, builds both FPK packages, and opens an update pull request. If a branch
was left behind without a PR, a later run refreshes it and retries PR creation.
Merging the update to `main` rebuilds the packages, stores a 30-day Actions
artifact, and creates a **draft GitHub Release**. After the clean-VM test gate
passes, manually run `Build draft release` with `publish` selected. Only a public
Release is visible to the update check running on fnOS.

Tailscale Admin Console can manage the node and display its client version, but
it cannot upgrade this project's complete FPK, Go management UI, manifest, or
fnOS lifecycle scripts. Do not use its remote or automatic update controls as
the upgrade channel for this app. Install the complete new FPK from GitHub
Releases or the fnOS App Center instead.

In `Settings → Actions → General → Workflow permissions`, enable
`Allow GitHub Actions to create and approve pull requests`. If that permission
is disabled, the workflow still validates the candidate and records the
incident, but it cannot open the PR.

## Important security notes

This is privileged networking software:

- `/dev/net/tun` must be available.
- Another Tailscale installation must not be running concurrently.
- The app deliberately refuses startup when it sees another `tailscaled` or an
  existing `tailscale0` interface.
- Do not use a production NAS as an unprotected self-hosted Actions runner.
- Never commit Tailscale auth keys, API keys, cookies, or generated state files.

See [`SECURITY.md`](SECURITY.md) for reporting guidance.

## Licensing and brand assets

The redistributed Tailscale binaries are licensed under BSD-3-Clause. The
required notice is included at
[`packaging/LICENSES/Tailscale-BSD-3-Clause.txt`](packaging/LICENSES/Tailscale-BSD-3-Clause.txt)
and copied into every FPK under `app/LICENSES/`, together with the third-party
and build-source notices.

The application icon is the official Tailscale squircle from
[Tailscale's media kit](https://tailscale.com/press). Its source and ownership
notice are recorded in [`assets/SOURCE.md`](assets/SOURCE.md).

No license has yet been selected for this repository's original packaging code.
Choose one before accepting external contributions.

## Official references

- [fnOS application framework](https://developer.fnnas.com/docs/core-concepts/framework/)
- [fnOS Native application example](https://developer.fnnas.com/docs/examples/native/)
- [fnOS `fnpack`](https://developer.fnnas.com/docs/cli/fnpack/)
- [Tailscale stable packages](https://pkgs.tailscale.com/stable/)
- [Tailscale Linux installation](https://tailscale.com/docs/install/linux)
- [Tailscale CLI and Web UI](https://tailscale.com/docs/reference/tailscale-cli)
