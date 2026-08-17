# Clean fnOS virtual-machine test plan

Use a disposable fnOS VM. Do not put a production NAS or its data in scope.

## VM prerequisites

- Match one package architecture: x86_64 first, then arm64 on real hardware or an
  arm64 VM.
- Expose `/dev/net/tun` to the guest.
- Take a VM snapshot before installing the FPK.
- Confirm no other `tailscaled` process or `tailscale0` interface exists.
- Keep the test VM on a network where adding a Tailscale node is acceptable.

## First-install test

1. Copy the matching `.fpk` and `scripts/device-smoke-test.sh` to the VM.
2. Sign in to fnOS as an administrator.
3. Run `sudo ./scripts/device-smoke-test.sh /path/to/package.fpk`.
4. Open the Tailscale desktop icon.
5. Confirm the page is the original Tailscale for fnOS dashboard, not
   `tailscale web --cgi`.
6. Test both login paths separately: browser authorization on one fresh state,
   then Auth Key on another fresh state. Confirm the Auth Key is absent from
   process arguments, logs, and the package temporary directory afterwards.
7. Confirm connect/disconnect, device counts, peer names, DERP latency, and
   hostname changes are reflected in both the UI and `tailscale status --json`.
8. Enable Exit Node advertisement, approve it in the Tailscale admin console,
   and route another device through fnOS; then disable it again.
9. From another tailnet device, connect to the fnOS Tailscale IP.
10. From fnOS, connect to another tailnet device by IP and MagicDNS name.

## Management UI acceptance

1. Start browser login and confirm one click opens the Tailscale authorization
   page. After authorization succeeds, confirm the login dialog closes by itself.
   If pop-ups are blocked, confirm a manual fallback link is shown.
2. Open Overview, Devices, and Settings from the fnOS desktop window and confirm
   each page loads without a full-page navigation or HTTP error.
3. Populate a Tailnet with more than eight devices, then verify search, the
   online-only filter, and previous/next pagination.
4. Confirm Windows, macOS, iOS, Android, Linux, BSD, and the local fnOS node use
   distinct system icons when those operating systems are present.
5. Confirm the v0.4 display default matches v0.3 at 120% font and 80% interface
   zoom. Test the full 70-160% font and 50-160% interface ranges, reload the
   window, and confirm both values persist. Restore the defaults before continuing.
6. Use `tailscale status` in SSH to record the current node identity. Choose
   **退出登录** in Settings, confirm the warning, and verify the UI returns to
   NeedsLogin. Log in again and confirm a valid node appears in the Tailnet.

## Restart and lifecycle test

- Restart the app from App Center and confirm the Tailscale IP is unchanged.
- Reboot fnOS and confirm the node reconnects without another login.
- Stop the app and confirm `tailscale0`, package PID, and package socket disappear.
- Start the app and confirm the same node identity returns.

## Upgrade test

1. Install the previous FPK and complete login.
2. Record `tailscale status --json`, the Tailscale IP, and the state-file digest.
3. Install the new FPK through App Center or `appcenter-cli install-fpk`.
4. Confirm the app version changed while the node identity, IP, and preferences
   remained intact.
5. Confirm the web UI, inbound connectivity, outbound connectivity, DNS, and
   Taildrop behavior.

## Failure and cleanup test

- Temporarily hide `/dev/net/tun`; startup must fail with a clear App Center error.
- Start another `tailscaled`; this package must refuse to create a conflicting
  daemon.
- Uninstall the package and check for leftover processes, `tailscale0`, routes,
  firewall rules, and sockets.
- Decide separately whether fnOS should retain or delete package data; the package
  lifecycle scripts never silently delete the saved node identity.

## Release gate

Only publish the draft GitHub Release after both x86 and arm packages pass the
app lifecycle and upgrade tests on clean systems.
