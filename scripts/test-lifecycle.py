#!/usr/bin/env python3
"""Exercise lifecycle ownership and PID recovery with disposable native processes."""

import errno
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import tempfile
import time
import unittest


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PACKAGE_COMMANDS = Path(os.environ.get(
    "LIFECYCLE_COMMANDS_DIR", PROJECT_ROOT / "packaging/cmd"
))


class LifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which("cc") or shutil.which("gcc")
        if compiler is None:
            raise RuntimeError("cc or gcc is required for lifecycle regression tests")
        temporary = tempfile.TemporaryDirectory(prefix="fnos-process-fixture-")
        cls.addClassCleanup(temporary.cleanup)
        cls.fixture = Path(temporary.name) / "fixture"
        source = cls.fixture.with_suffix(".c")
        source.write_text(
            '#include <string.h>\n#include <unistd.h>\n#include <stdlib.h>\n'
            '#include <stdio.h>\n#include <sys/socket.h>\n#include <sys/un.h>\n'
            'int main(int argc, char **argv) {\n'
            '  for (int i = 1; i < argc; i++)\n'
            '    if (strcmp(argv[i], "--cleanup") == 0) return 0;\n'
            '  if (getenv("FNOS_FIXTURE_CREATE_SOCKET")) {\n'
            '    struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;\n'
            '    for (int i = 1; i < argc; i++)\n'
            '      if (strncmp(argv[i], "--socket=", 9) == 0)\n'
            '        strncpy(address.sun_path, argv[i] + 9, sizeof(address.sun_path) - 1);\n'
            '    int fd = socket(AF_UNIX, SOCK_STREAM, 0);\n'
            '    if (fd < 0 || bind(fd, (struct sockaddr *)&address, sizeof(address))) return 2;\n'
            '    const char *record = getenv("FNOS_FIXTURE_PIDFILE");\n'
            '    if (record) { FILE *file = fopen(record, "w");\n'
            '      if (file) { fprintf(file, "%ld", (long)getpid()); fclose(file); } }\n'
            '  }\n'
            '  for (;;) pause();\n'
            '}\n',
            encoding="utf-8",
        )
        subprocess.run([compiler, str(source), "-o", str(cls.fixture)], check=True)
        probe = subprocess.Popen([str(cls.fixture)])
        try:
            visible = False
            for _ in range(100):
                try:
                    visible = os.readlink(f"/proc/{probe.pid}/exe") == str(cls.fixture)
                except FileNotFoundError:
                    pass
                if visible:
                    break
                time.sleep(0.01)
            if not visible:
                message = "this runtime does not expose child PIDs through /proc"
                if os.environ.get("GITHUB_ACTIONS") == "true":
                    raise RuntimeError(message)
                raise unittest.SkipTest(message + "; run tests on a Linux host")
        finally:
            cls.reap(probe)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="fnos-life-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.destination = self.root / "target"
        self.variable = self.root / "var"
        self.temporary = self.root / "tmp"
        (self.destination / "bin").mkdir(parents=True)
        (self.variable / "state").mkdir(parents=True)
        self.temporary.mkdir()
        self.binary = self.destination / "bin/tailscaled"
        shutil.copy2(self.fixture, self.binary)
        self.pidfile = self.temporary / "tailscaled.pid"
        self.socket_path = self.temporary / "tailscaled.sock"
        self.environment = os.environ.copy()
        self.environment.update({
            "TRIM_APPDEST": str(self.destination),
            "TRIM_PKGVAR": str(self.variable),
            "TRIM_PKGTMP": str(self.temporary),
        })
        self.identity = self.variable / "state/node-identity-placeholder"
        self.identity.write_text("preserved test identity\n", encoding="utf-8")

    def spawn(self, *, binary=None, statedir=None, socket_path=None, tun="tailscale0"):
        process = subprocess.Popen([
            str(binary or self.binary),
            "--statedir=" + str(statedir or self.variable / "state"),
            "--socket=" + str(socket_path or self.socket_path),
            "--tun=" + tun,
            "--port=0",
        ])
        self.addCleanup(self.reap, process)
        # Wait for exec so /proc/PID/exe names the fixture, not its launcher.
        expected = str(Path(binary or self.binary).resolve())
        actual = None
        for _ in range(100):
            self.assertIsNone(process.poll())
            try:
                actual = os.readlink(f"/proc/{process.pid}/exe")
                if actual == expected:
                    return process
            except FileNotFoundError:
                pass
            time.sleep(0.01)
        self.fail(f"process fixture did not finish exec: expected={expected}, actual={actual}")

    @staticmethod
    def reap(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    def run_command(self, command, script="main"):
        arguments = ["bash", str(PACKAGE_COMMANDS / script)]
        if command is not None:
            arguments.append(command)
        return subprocess.run(
            arguments, env=self.environment, capture_output=True,
            text=True, timeout=25, check=False,
        )

    def test_status_recovers_missing_pid_without_stopping_daemon(self):
        process = self.spawn()
        result = self.run_command("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.pidfile.read_text().strip(), str(process.pid))
        self.assertEqual(stat.S_IMODE(self.pidfile.stat().st_mode), 0o600)
        self.assertIsNone(process.poll())

    def test_recovery_normalizes_fnos_symlink_paths(self):
        process = self.spawn()
        aliases = self.root / "aliases"
        aliases.mkdir()
        for name, path in (
            ("target", self.destination), ("var", self.variable),
            ("tmp", self.temporary),
        ):
            (aliases / name).symlink_to(path, target_is_directory=True)
        self.environment.update({
            "TRIM_APPDEST": str(aliases / "target"),
            "TRIM_PKGVAR": str(aliases / "var"),
            "TRIM_PKGTMP": str(aliases / "tmp"),
        })
        result = self.run_command("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.pidfile.read_text().strip(), str(process.pid))

    def test_recovery_recognizes_replaced_executable(self):
        process = self.spawn()
        replacement = self.binary.with_suffix(".replacement")
        shutil.copy2(self.fixture, replacement)
        os.replace(replacement, self.binary)
        self.assertTrue(os.readlink(f"/proc/{process.pid}/exe").endswith(" (deleted)"))
        result = self.run_command("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.pidfile.read_text().strip(), str(process.pid))

    def test_cached_foreign_pid_is_replaced_with_verified_owned_pid(self):
        foreign = self.spawn(statedir=self.root / "other-state")
        owned = self.spawn()
        self.pidfile.write_text(str(foreign.pid) + "\n", encoding="utf-8")
        result = self.run_command("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.pidfile.read_text().strip(), str(owned.pid))
        self.assertIsNone(foreign.poll())

    def test_pid_with_matching_executable_but_foreign_arguments_is_rejected(self):
        for difference in (
            {"statedir": self.root / "other-state"},
            {"socket_path": self.root / "other.sock"},
            {"tun": "userspace-networking"},
        ):
            with self.subTest(difference=difference):
                process = self.spawn(**difference)
                self.pidfile.write_text(str(process.pid) + "\n", encoding="utf-8")
                result = self.run_command("status")
                self.assertEqual(result.returncode, 3, result.stderr)
                self.assertFalse(self.pidfile.exists())
                self.assertIsNone(process.poll())
                self.reap(process)

    def test_foreign_executable_is_not_adopted(self):
        other = self.root / "other"
        other.mkdir()
        binary = other / "tailscaled"
        shutil.copy2(self.fixture, binary)
        process = self.spawn(binary=binary)
        self.pidfile.write_text(str(process.pid) + "\n", encoding="utf-8")
        result = self.run_command("status")
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertFalse(self.pidfile.exists())
        self.assertIsNone(process.poll())

    def test_ambiguous_owned_daemons_are_not_adopted_or_stopped(self):
        first = self.spawn()
        second = self.spawn()
        self.socket_path.touch()
        status = self.run_command("status")
        stop = self.run_command("stop")
        self.assertEqual(status.returncode, 3, status.stderr)
        self.assertEqual(stop.returncode, 1, stop.stderr)
        self.assertFalse(self.pidfile.exists())
        self.assertTrue(self.socket_path.exists())
        self.assertIsNone(first.poll())
        self.assertIsNone(second.poll())

    def test_start_with_missing_management_socket_preserves_connectivity(self):
        process = self.spawn()
        result = self.run_command("start")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("management socket is missing", result.stderr)
        self.assertEqual(self.pidfile.read_text().strip(), str(process.pid))
        self.assertIsNone(process.poll())

    def test_start_recovers_healthy_daemon_without_restarting(self):
        process = self.spawn()
        try:
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        except OSError as error:
            if error.errno in (errno.EPERM, errno.EACCES):
                self.skipTest("local socket creation is restricted in this environment")
            raise
        self.addCleanup(server.close)
        server.bind(str(self.socket_path))
        result = self.run_command("start")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(process.poll())
        self.assertEqual(self.pidfile.read_text().strip(), str(process.pid))
        self.assertEqual(stat.S_IMODE(self.socket_path.stat().st_mode), 0o600)

    def test_upgrade_callback_keeps_live_runtime_records(self):
        process = self.spawn()
        self.pidfile.write_text(str(process.pid) + "\n", encoding="utf-8")
        # A placeholder is enough to verify that the callback does not unlink it.
        self.socket_path.touch()
        result = self.run_command(None, script="upgrade_callback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.pidfile.read_text().strip(), str(process.pid))
        self.assertTrue(self.socket_path.exists())
        self.assertIsNone(process.poll())
        self.assertEqual(self.identity.read_text(), "preserved test identity\n")

    def test_start_restores_exit_forwarding_through_manager(self):
        process = self.spawn()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(str(self.socket_path))
        marker = self.root / "restore-call"
        manager = self.destination / "bin/tailscale-fnos"
        manager.write_text(
            '#!/bin/sh\n'
            f'printf "%s|%s|%s" "$1" "$TRIM_PKGVAR" "$TRIM_PKGTMP" > "{marker}"\n',
            encoding="utf-8",
        )
        manager.chmod(0o700)
        result = self.run_command("start")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), f"restore-exit-node|{self.variable}|{self.temporary}")
        self.assertIsNone(process.poll())

    def test_start_reports_forwarding_restore_failure_without_killing_daemon(self):
        process = self.spawn()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(str(self.socket_path))
        manager = self.destination / "bin/tailscale-fnos"
        manager.write_text('#!/bin/sh\nexit 1\n', encoding="utf-8")
        manager.chmod(0o700)
        result = self.run_command("start")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("Unable to restore Exit Node IP forwarding", result.stderr)
        self.assertIsNone(process.poll())

    def test_new_start_cleans_up_daemon_when_forwarding_restore_fails(self):
        # Substitute host prerequisites only; exercise the complete startup and
        # cleanup flow with disposable binaries and an actual UNIX socket.
        source = (PACKAGE_COMMANDS / "main").read_text(encoding="utf-8")
        source = source.replace("/dev/net/tun", "/dev/null")
        source = source.replace('if [ "$(id -u)" -ne 0 ]; then', 'if false; then')
        command = self.root / "startup-main"
        command.write_text(source, encoding="utf-8")
        shutil.copy2(self.fixture, self.destination / "bin/tailscale")
        manager = self.destination / "bin/tailscale-fnos"
        manager.write_text('#!/bin/sh\nexit 1\n', encoding="utf-8")
        manager.chmod(0o700)
        record = self.root / "started-pid"
        self.environment.update({
            "FNOS_FIXTURE_CREATE_SOCKET": "1",
            "FNOS_FIXTURE_PIDFILE": str(record),
        })
        result = self.run_command("start", script=command)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("Unable to restore Exit Node IP forwarding", result.stderr)
        self.assertTrue(record.exists(), "startup must reach the launched daemon")
        self.assertFalse(Path(f"/proc/{record.read_text()}/exe").exists())
        self.assertFalse(self.pidfile.exists())
        self.assertFalse(self.socket_path.exists())

    def test_upgrade_init_stops_owned_daemon_even_without_pid(self):
        process = self.spawn()
        self.socket_path.touch()
        result = self.run_command(None, script="upgrade_init")
        self.assertEqual(result.returncode, 0, result.stderr)
        process.wait(timeout=5)
        self.assertFalse(self.pidfile.exists())
        self.assertFalse(self.socket_path.exists())
        self.assertEqual(self.identity.read_text(), "preserved test identity\n")

    def test_stop_preserves_foreign_process_and_socket(self):
        process = self.spawn(statedir=self.root / "other-state")
        self.pidfile.write_text(str(process.pid) + "\n", encoding="utf-8")
        self.socket_path.touch()
        result = self.run_command("stop")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(process.poll())
        self.assertTrue(self.socket_path.exists())


if __name__ == "__main__":
    unittest.main()
