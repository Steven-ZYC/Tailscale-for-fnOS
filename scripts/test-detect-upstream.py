#!/usr/bin/env python3
"""Offline regression tests for Linux stable-package detection."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DETECTOR = Path(os.environ.get(
    "DETECT_UPSTREAM_SCRIPT", PROJECT_ROOT / "scripts/detect-upstream.sh"
))


class DetectUpstreamTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.response = self.root / "response.json"
        self.lock = self.root / "upstream.lock"
        self.environment = os.environ.copy()
        self.environment.update({
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "UPSTREAM_LOCK_FILE": str(self.lock),
            "FAKE_PACKAGE_INDEX": str(self.response),
            "FAKE_CURL_EXIT_CODE": "0",
        })
        self.set_lock_version("1.102.3")
        mock = self.bin / "curl"
        mock.write_text(
            "#!" + sys.executable + "\n"
            "import os, pathlib, sys\n"
            "status = int(os.environ['FAKE_CURL_EXIT_CODE'])\n"
            "if status:\n"
            "    print('curl: simulated request failure', file=sys.stderr)\n"
            "    sys.exit(status)\n"
            "url = sys.argv[-1]\n"
            "if url == 'https://pkgs.tailscale.com/stable/?mode=json&os=linux':\n"
            "    print(pathlib.Path(os.environ['FAKE_PACKAGE_INDEX']).read_text())\n"
            "elif url == 'https://github.com/tailscale/tailscale/releases/latest':\n"
            "    print('https://github.com/tailscale/tailscale/releases/tag/v1.102.5')\n"
            "elif url == 'https://pkgs.tailscale.com/stable/':\n"
            "    print('tailscale_1.102.4_amd64.tgz')\n"
            "else:\n"
            "    print('unexpected URL: ' + url, file=sys.stderr)\n"
            "    sys.exit(1)\n",
            encoding="utf-8",
        )
        mock.chmod(0o755)

    def set_lock_version(self, version):
        lines = (PROJECT_ROOT / "upstream.lock").read_text().splitlines()
        self.lock.write_text("\n".join(
            "TAILSCALE_VERSION=" + version
            if line.startswith("TAILSCALE_VERSION=") else line
            for line in lines
        ) + "\n", encoding="utf-8")

    def index(self, version="1.102.4"):
        return {
            "TarballsVersion": version,
            "Tarballs": {
                arch: f"tailscale_{version}_{arch}.tgz"
                for arch in ("amd64", "arm64")
            },
            "ContainersVersion": "1.102.5",
            "Version": "1.102.5",
        }

    def run_detector(self, mode="--version-only", metadata=None, raw=None):
        if raw is None:
            raw = json.dumps(self.index() if metadata is None else metadata)
        self.response.write_text(raw, encoding="utf-8")
        return subprocess.run(
            ["bash", str(DETECTOR), mode], env=self.environment,
            capture_output=True, text=True, timeout=10, check=False,
        )

    def test_linux_packages_win_over_newer_github_and_container_releases(self):
        result = self.run_detector()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "1.102.4\n")

    def test_check_lock_reports_update_with_exit_ten(self):
        result = self.run_detector("--check-lock")
        self.assertEqual(result.returncode, 10, result.stderr)
        self.assertEqual(
            result.stdout, "update-available: current=1.102.3 latest=1.102.4\n"
        )

    def test_check_lock_reports_current_version(self):
        self.set_lock_version("1.102.4")
        result = self.run_detector("--check-lock")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "up-to-date: 1.102.4\n")

    def test_missing_or_mismatched_architecture_is_rejected(self):
        for arch in ("amd64", "arm64"):
            for filename in (None, f"tailscale_1.102.3_{arch}.tgz"):
                with self.subTest(arch=arch, filename=filename):
                    metadata = self.index()
                    if filename is None:
                        del metadata["Tarballs"][arch]
                    else:
                        metadata["Tarballs"][arch] = filename
                    result = self.run_detector(metadata=metadata)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, "")
                    self.assertIn(
                        "invalid official Linux package index", result.stderr
                    )

    def test_invalid_metadata_is_rejected(self):
        for raw in ("not JSON", "{}", "[]", '{"TarballsVersion": 123}'):
            with self.subTest(raw=raw):
                result = self.run_detector(raw=raw)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("invalid official Linux package index", result.stderr)

    def test_invalid_stable_version_is_rejected(self):
        result = self.run_detector(metadata=self.index("1.102.4-beta"))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("invalid stable version", result.stderr)

    def test_request_failure_is_not_reported_as_up_to_date(self):
        self.environment["FAKE_CURL_EXIT_CODE"] = "22"
        result = self.run_detector()
        self.assertEqual(result.returncode, 22)
        self.assertEqual(result.stdout, "")
        self.assertIn("simulated request failure", result.stderr)


if __name__ == "__main__":
    unittest.main()
