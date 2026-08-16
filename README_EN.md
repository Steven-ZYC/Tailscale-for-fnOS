# Tailscale for fnOS

English | [简体中文](README.md)

Native fnOS packaging for the official Tailscale Linux client. The generated
FPK files contain the unmodified official `tailscale` and `tailscaled` static
binaries from Tailscale's stable package server. Docker is not required.

- Repository: <https://github.com/Steven-ZYC/Tailscale-for-fnOS>

> This is a community-maintained third-party package. It is not affiliated with
> or endorsed by Tailscale Inc. or the fnOS vendor. Tailscale is a registered
> trademark of Tailscale Inc.

## Current pinned release

The current project milestone is **v0.1 (test release)**, represented by the
`fnos.0.1` package revision. The complete FPK version also includes the bundled
Tailscale version, for example `1.102.2-fnos.0.1`.

See [`upstream.lock`](upstream.lock) for the exact Tailscale version, amd64 and
arm64 SHA-256 digests, the fnOS package revision, and the pinned `fnpack` tool
digest.

The build produces two packages:

- `x86`: fnOS x86 platform with Tailscale's amd64 binaries;
- `arm`: fnOS ARM platform with Tailscale's arm64 binaries.

No 32-bit ARM package is currently produced.

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
- Supports both browser-link and Auth Key login. Auth Keys are passed through a
  mode-`0600` temporary file and deleted immediately after use.
- Provides connect/disconnect and account logout.
- Shows project-original inline SVG icons by operating system, with device
  search, online filtering, pagination, and online counts.
- Provides DERP latency checks, hostname changes, and local Exit Node
  advertisement controls.
- Splits the interface into Overview, Devices, and Settings pages. Font size and
  interface zoom preferences are stored only in the current browser.
- Checks GitHub Releases for newer FPK packages and only displays a notification;
  it never self-updates the NAS installation.
- Does not run `tailscale update`; updates are delivered only as new FPK files.
- Does not silently delete the saved node identity during uninstall hooks.

## Get the source

```bash
git clone https://github.com/Steven-ZYC/Tailscale-for-fnOS.git
cd Tailscale-for-fnOS
```

## Build in WSL2 Ubuntu

From PowerShell, with an existing checkout:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd "/mnt/d/path/to/Tailscale-for-fnOS" && make build'
```

If `make` is not installed in Ubuntu, use the scripts directly:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd "/mnt/d/path/to/Tailscale-for-fnOS" && ./scripts/validate.sh && ./scripts/install-fnpack.sh && ./scripts/build-all.sh'
```

Or from an Ubuntu shell:

```bash
cd /path/to/Tailscale-for-fnOS
make build
```

The build process:

1. Validates manifests, JSON, PNG sizes, shell syntax, and pinned digests.
2. Downloads the pinned official fnOS `fnpack` binary and verifies its digest.
3. Downloads official Tailscale amd64 and arm64 stable archives.
4. Confirms the live official `.sha256` files still match `upstream.lock`.
5. Generates two FPK files, `SHA256SUMS`, and `provenance.json` under `dist/`.

No `curl | sh` or Docker is used. The original manager is statically compiled
from standard-library-only Go source for Linux amd64 and arm64.

Useful commands:

```bash
make validate
make test
make detect-upstream
make build-x86
make build-arm
make build
make clean
```

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

`Track Tailscale stable releases` runs hourly at minute 17 and cross-checks:

- the latest full release in `tailscale/tailscale`; and
- the Linux amd64 package shown by Tailscale's stable package server.

When both sources agree on a newer version, the workflow refreshes official
digests, builds both FPK packages, and opens an update pull request. Merging the
update to `main` creates a **draft GitHub Release**. Publish that draft only after
the clean-VM test gate passes.

Repository settings must allow GitHub Actions to create pull requests for the
automated update PR step. If that permission is disabled, the workflow still
validates the candidate but cannot open the PR.

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
