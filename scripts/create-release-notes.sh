#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

load_lock
output_file="${1:-${PROJECT_ROOT}/dist/RELEASE_NOTES.md}"
package_version="${TAILSCALE_VERSION}-fnos.${FNOS_PACKAGE_REVISION}"

cat > "$output_file" <<EOF
# Tailscale for fnOS ${package_version}

- **UI 改进：** 优化概览、设置分组、文字对比度和窄窗口布局，README 新增界面图片。
- **Exit Node 改进：** 启用时检查连接、出口广播与 IP 转发，支持失败回滚和重启恢复，状态与授权提示更清晰。

通过 Tailscale 连接飞牛后台升级时，服务重启可能导致页面暂时断开或提示连接错误，这是正常情况；稍等网络恢复后刷新即可。fnOS 只支持升级，请安装更高版本的 FPK。

内置官方 Tailscale ${TAILSCALE_VERSION}，提供 x86-64（x86）与 ARM64（arm）安装包。可用 \`SHA256SUMS\` 校验下载，构建信息见 \`provenance.json\`。

社区测试构建，与 Tailscale Inc. 或飞牛 fnOS 官方无隶属或背书关系。Tailscale 是 Tailscale Inc. 的注册商标。
EOF
