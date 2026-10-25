# Tailscale for fnOS

[简体中文](README.md) | [English](README_EN.md)

<img src="packaging/ICON_256.PNG" alt="Tailscale for fnOS application icon" width="80" />

**A native Tailscale client for Feiniu fnOS: download the FPK and install it manually to manage Tailnet connections through a Chinese-language interface, without Docker.**

This project packages the unmodified `tailscale` and `tailscaled` binaries provided by the official Tailscale Linux stable package repository into an fnOS FPK, with an independently implemented lightweight Go management backend and Chinese-language interface.

**[⬇️ Download the latest FPK](https://github.com/Steven-ZYC/Tailscale-for-fnOS/releases/latest)** · **[📖 Quick installation](#quick-installation)** · **[✨ Features](#main-features)** · **[🐛 Report an issue](https://github.com/Steven-ZYC/Tailscale-for-fnOS/issues)**

> [!IMPORTANT]
>  - Make sure **no other Tailscale installation is running** on the system. If another `tailscaled` process or a `tailscale0` interface exists, this application will refuse to start to avoid conflicts.
>  - The current public version is still a test build.
>  - This project is independently maintained by the community and **is not affiliated with or endorsed by either Tailscale Inc. or the official Feiniu fnOS team**. Tailscale is a registered trademark of Tailscale Inc.

## Why use this version?

- **No Docker, native FPK installation:** Install through the manual installation feature in fnOS App Center, without creating containers or configuring Compose yourself.
- **Independent Chinese-language management interface:** Open the application from the fnOS desktop to view the current status, devices, and settings.
- **Official Tailscale binaries:** Uses the original Linux programs from the Tailscale stable package repository; this project provides the fnOS integration and management interface.
- **Everyday connection management:** Browser authorization login, Auth Key login, connect and disconnect, logout, device search, DERP latency checks, and more.
- **Upstream version tracking:** Automatically checks for Tailscale stable updates and notifies you in the management interface after a new FPK is released; **updates are not installed automatically**.

Suitable for users who want to access their NAS from other authorized devices through Tailscale, add their NAS to a personal Tailnet, or view and manage connections across devices in one place. In common network environments, Tailscale usually does not require manual public port forwarding, but actual connectivity still depends on network reachability and Tailnet access controls.

## Quick installation

### 1. Download the FPK that matches your device

Go to **[GitHub Releases (latest release)](https://github.com/Steven-ZYC/Tailscale-for-fnOS/releases/latest)** and download the `.fpk` file for the corresponding architecture:

| fnOS device architecture | Download filename suffix | Description |
| --- | --- | --- |
| x86-64 / AMD64 | `_x86.fpk` | Common Intel / AMD 64-bit NAS devices |
| ARM64 / AArch64 | `_arm.fpk` | 64-bit ARM devices |

32-bit ARM builds are not currently provided. You can verify the downloaded file's integrity against the `SHA256SUMS` file attached to the same Release.

### 2. Install manually in fnOS

1. Sign in to fnOS as an administrator.
2. Open **App Center → Manual installation** and select the downloaded `.fpk` file.
3. Follow the fnOS prompts to complete the installation and start the application.
4. Open the **Tailscale** application from the fnOS desktop.

> Make sure the system provides `/dev/net/tun` and **no other Tailscale installation is running**. If another `tailscaled` process or a `tailscale0` interface exists, this application will refuse to start to avoid conflicts.

### 3. Log in and connect

1. Select **Browser authorization login** in the management interface, or use **Auth Key login** as needed.
2. Complete Tailscale authentication and confirm that the NAS appears in your Tailnet device list.
3. Install Tailscale on another computer or phone and join the same Tailnet.
4. Where access permissions allow, access the corresponding services through the NAS's Tailscale IP (or its MagicDNS name, if enabled).

**For first-time use, verify connectivity between devices first** before relying on it for long-term remote access. Advanced features such as Exit Node advertisement may also require approval in the Tailscale admin console.

## Main features

| Feature | What this project provides |
| --- | --- |
| Native operation | An fnOS FPK using the official `tailscaled` and system TUN networking |
| Login and connection | Browser login, Auth Key login, connect/disconnect, and logout |
| Chinese-language management interface | Three pages: Overview, Devices, and Settings; an administrator desktop entry |
| Device viewing | Device icons by operating system, with search, online filtering, pagination, and online device counts |
| Network management | DERP latency checks, device name changes, and a switch for advertising the local device as an Exit Node |
| Interface preferences | Adjustable font size and interface zoom, with preferences saved in the current browser |
| Version tracking | Checks GitHub Releases for new versions when the interface opens, with manual checks also available |
| In-place upgrades | Upgrading through a newer FPK is designed to preserve existing node state and identity; back up and verify before upgrading |

**Actual UI screenshots of the current version have not yet been added to the repository.** To avoid misleading readers, this document does not present mockups as screenshots of the application running on a real device.

## Updating and usage limitations

- **Updates must be performed manually:** Obtain a complete FPK with a higher version from [Releases](https://github.com/Steven-ZYC/Tailscale-for-fnOS/releases) and install it over the existing application in fnOS; an on-screen notification does not mean an automatic upgrade.
- **Do not use the client remote update feature in the Tailscale Admin Console to upgrade this FPK.** It cannot update the fnOS integration scripts and this project's interface at the same time.
- **Do not install an older version over a newer one:** Installing a lower-version FPK over a higher version is not recommended; back up important devices before upgrading.
- **Be aware of elevated privileges:** `tailscaled` runs as root. Assess the risks of third-party networking software before installation.
- **Installation status:** This repository provides community builds for testing and does not indicate that the application has been officially certified by Feiniu or Tailscale.

## Feedback and testing

If you have tried the application, feedback is welcome through [GitHub Issues](https://github.com/Steven-ZYC/Tailscale-for-fnOS/issues/new). When reporting a problem, please provide the fnOS version, CPU architecture, FPK version, steps to reproduce, and **redacted** error information where possible; do not publicly disclose Auth Keys, login URLs, Cookies, node state, or other credentials.

Testers can refer to the [fnOS virtual-machine acceptance checklist](docs/VM_TESTING.md), focusing on first installation, browser login, device connectivity, restart, in-place upgrades, uninstall cleanup, and compatibility with both CPU architectures. For security vulnerabilities, follow the [security reporting instructions](SECURITY.md) instead of opening a public Issue.

## Technical notes (for developers)

The following sections retain implementation details, automated build mechanisms, testing methods, third-party licenses, and other information to support review and reproduction.

### Version naming rules

Complete FPK versions and formal GitHub release tags use the
`v<Tailscale-version>-fnos.<community-version>` format, for example `v1.104.2-fnos.0.6`:

- `1.104.2` indicates the bundled official Tailscale version;
- `fnos.0.6` indicates the version of this project's fnOS community integration layer and upper-level management UI;
- The leading `v` is a Git tag prefix and is not part of the internal FPK version.

### Application behavior

- Runs the official `tailscaled` as root to use kernel TUN networking;
- Stores node state and keys in fnOS `TRIM_PKGVAR/state`, which is not replaced when the application is upgraded;
- Stores the LocalAPI socket and PID files in `TRIM_PKGTMP`;
- Uses this project's original lightweight Go CGI backend and Chinese-language management interface, instead of the official
  `tailscale web --cgi`;
- The management backend does not run persistently. It runs briefly only when a page is opened or an action is performed, invoking
  the official `tailscale` CLI with fixed arguments;
- Shows the desktop entry only to fnOS administrators;
- Supports browser login with a pop-up that opens automatically and closes automatically after successful login, as well as Auth Key login; Auth Keys are written only to
  temporary files with `0600` permissions and deleted immediately after use;
- Supports connect/disconnect and account logout;
- The Devices page displays this project's original inline SVG icons by operating system and provides search, online filtering, pagination,
  and online device counts;
- Supports DERP latency checks, device name changes, and a switch for advertising the local device as an Exit Node;
- The interface has three pages: Overview, Devices, and Settings, with separate adjustments for font size and interface zoom; v0.4
  redefined the previous 120% font size and 80% interface zoom as the new 100% defaults, while v0.5 added editable
  percentage fields and applies zoom only after dragging or typing is complete to avoid slider jumps; display preferences are saved only
  in the current browser and are not written to Tailscale state;
- Automatically checks GitHub Releases for new FPK versions each time the management page opens, with a manual recheck also available
  on the Settings page; checks only provide a download notification and do not install updates on the NAS;
- Does not execute `tailscale update`; all upgrades are delivered through new FPKs;
- Does not support upgrading this application through remote updates or automatic updates in the Tailscale Admin Console;
  please manually download a newer FPK from this project's GitHub Releases; if the application is listed in Feiniu App Center in the future, you can also use the update method provided by App Center;
- Installing a higher-version FPK with the same application name directly in fnOS follows the in-place upgrade process: old processes are stopped first,
  application files are replaced, and the node identity, keys, and preferences in `TRIM_PKGVAR/state` are preserved, allowing the upgraded application
  to continue using the same node. Do not install a lower version over a higher one; backing up application data before upgrading important devices is still recommended;
- Uninstall lifecycle scripts do not silently delete the saved node identity.

### Implementation boundaries

The management interface and Go backend are independently implemented by this project. The backend does not import Tailscale's internal Go packages,
and uses only the official CLI's `status --json`, `get`, `set`, `up`, `down`,
and `netcheck --format=json` interfaces. This keeps runtime overhead low and avoids
binding this project to Tailscale's internal APIs, whose stability is not guaranteed.

### Testing on fnOS

Use a clean fnOS virtual machine that can be restored at any time, and follow
[`docs/VM_TESTING.md`](docs/VM_TESTING.md) to complete testing. For the first automated smoke test, run:

```bash
sudo ./scripts/device-smoke-test.sh /path/to/tailscale-fnos_VERSION_x86.fpk
```

The script installs and starts the application, checks TUN, network interfaces, and the socket, tests cleanup after stopping, and starts the application again
to verify state reuse. Tailscale login and actual connectivity between devices still require manual acceptance testing.

### Automatic upstream update tracking

The `Track Tailscale stable releases` GitHub Actions workflow runs daily at UTC 01:17
(09:17 Beijing/Hong Kong time); an idempotent retry runs three hours later
at UTC 04:17 (12:17). When the first check succeeds, the retry only performs a quick confirmation that no update is needed. If the workflow fails, it creates
or updates an Issue titled `[automation] Tailscale stable update failed`, which is automatically closed after recovery.
Each check verifies both of the following:

- The latest formal Release from `tailscale/tailscale`;
- The Linux amd64 package in the Tailscale stable package repository.

Once both sources confirm the same new version, the workflow updates the official checksums, builds and verifies both FPKs,
and then creates an upgrade Pull Request. If an update branch already exists but has no PR, subsequent runs refresh that branch and
try to create the PR again instead of exiting immediately. After a locally validated version is pushed directly or merged into `main`,
`Build fnOS release` performs full validation and builds again, saves the FPKs as Actions artifacts
retained for 30 days, and automatically publishes the corresponding GitHub Release so that fnOS can detect it immediately.
To generate only a draft, run that workflow manually and leave `publish` unchecked.

The Tailscale Admin Console can only manage nodes and display client versions; it cannot fully upgrade this project's
FPK, Go management interface, manifest, or fnOS lifecycle scripts. Do not use its remote update or
automatic update features as an upgrade channel for this application; users should install the complete newer FPK provided by GitHub Releases.

In the GitHub repository's `Settings → Actions → General → Workflow permissions`,
enable `Allow GitHub Actions to create and approve pull requests`. If this is not enabled,
the workflow can still validate candidate versions and record failures, but cannot create PRs automatically.

### Security considerations

This application is networking software that runs with elevated privileges:

- The system must provide `/dev/net/tun`;
- Another Tailscale installation must not run at the same time;
- The application refuses to start if it detects another `tailscaled` or an existing `tailscale0`;
- Do not use a production NAS as an unisolated self-hosted GitHub Actions runner;
- Do not commit Tailscale auth keys, API keys, Cookies, or generated state files.

See [`SECURITY.md`](SECURITY.md) for instructions on reporting security issues.

### Licenses and brand assets

The bundled Tailscale binaries are licensed under BSD-3-Clause. The required notice is in
[`packaging/LICENSES/Tailscale-BSD-3-Clause.txt`](packaging/LICENSES/Tailscale-BSD-3-Clause.txt)
and is copied into each FPK's `app/LICENSES/` directory together with third-party and build provenance notices.

The application icon is the official squircle icon from the [official Tailscale media kit](https://tailscale.com/press).
Source and ownership details are recorded in [`assets/SOURCE.md`](assets/SOURCE.md).

No license has been selected yet for this repository's original packaging code. A license should be determined before accepting external contributions.

### Official references

- [fnOS application framework](https://developer.fnnas.com/docs/core-concepts/framework/)
- [fnOS Native application example](https://developer.fnnas.com/docs/examples/native/)
- [fnOS fnpack](https://developer.fnnas.com/docs/cli/fnpack/)
- [Tailscale stable packages](https://pkgs.tailscale.com/stable/)
- [Tailscale Linux installation instructions](https://tailscale.com/docs/install/linux)
- [Tailscale CLI and Web UI](https://tailscale.com/docs/reference/tailscale-cli)
