# Security policy

This package runs privileged networking software on fnOS. Treat lifecycle,
CGI, download, update, and release-pipeline changes as security-sensitive.

## Reporting

Do not open a public issue for vulnerabilities that expose credentials, node
state, authentication URLs, LocalAPI access, or root command execution. Contact
the maintainer, Steven Zhang Yancheng, privately through the repository's GitHub
Security Advisory feature after the repository is published.

Vulnerabilities in Tailscale itself should be reported through Tailscale's
official security process: https://tailscale.com/security

## Supported builds

Only the latest published fnOS packaging revision for the latest pinned stable
Tailscale version is intended to receive fixes during initial development.

## Secrets

Never commit or upload:

- Tailscale auth keys or API keys
- `tailscaled.state` or any `TRIM_PKGVAR/state` content
- login URLs or session cookies
- fnOS administrator credentials
- private SSH keys used to reach a test VM
