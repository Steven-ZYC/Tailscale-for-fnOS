# Tailscale for fnOS

[简体中文](README.md) | [English](README_EN.md)

<img src="packaging/ICON_256.PNG" alt="Tailscale for fnOS 应用图标" width="80" />

**飞牛 fnOS 原生 Tailscale 客户端：下载 FPK、手动安装，即可通过中文界面管理 Tailnet 连接，无需 Docker。**

本项目将 Tailscale 官方 Linux stable 软件源提供的、未经修改的 `tailscale` 与 `tailscaled` 二进制文件封装为 fnOS FPK，并自行实现轻量 Go 管理后端和中文界面。

**[⬇️ 下载最新 FPK](https://github.com/Steven-ZYC/Tailscale-for-fnOS/releases/latest)** · **[📖 快速安装](#快速安装)** · **[✨ 功能介绍](#主要功能)** · **[🐛 反馈问题](https://github.com/Steven-ZYC/Tailscale-for-fnOS/issues)**

> [!IMPORTANT]
>  - 请确保系统**没有另一套 Tailscale 正在运行**。若存在其他 `tailscaled` 进程或 `tailscale0` 接口，本应用会为避免冲突而拒绝启动。
>  - 当前公开版本仍属于测试构建。
>  - 此项目由社区独立维护，**与 Tailscale Inc. 或飞牛 fnOS 官方均无隶属或背书关系**。Tailscale 是 Tailscale Inc. 的注册商标。

## 为什么使用这个版本？

- **免 Docker，原生 FPK 安装：** 可通过 fnOS 应用中心的手动安装功能安装，不需要自行创建容器或配置 Compose。
- **独立中文管理界面：** 在 fnOS 桌面打开应用，查看当前状态、设备和设置。
- **采用官方 Tailscale 二进制：** 使用 Tailscale stable 软件源的原始 Linux 程序；本项目负责 fnOS 集成与管理界面。
- **支持日常连接管理：** 浏览器授权登录、Auth Key 登录、连接与断开、退出登录、设备检索及 DERP 延迟检测等。
- **跟踪上游版本：** 自动检查 Tailscale stable 更新，并在新 FPK 发布后于管理界面提示；**不会自动安装更新**。

适合希望通过 Tailscale 从其他已授权设备访问 NAS、将 NAS 加入个人 Tailnet，或统一查看和管理跨设备连接的用户。Tailscale 在常见网络环境下通常无需手动配置公网端口映射，但实际连接仍取决于网络可达性及 Tailnet 访问控制。

## 快速安装

### 1. 下载与你的设备匹配的 FPK

前往 **[GitHub Releases（最新发布版）](https://github.com/Steven-ZYC/Tailscale-for-fnOS/releases/latest)**，下载对应架构的 `.fpk` 文件：

| fnOS 设备架构 | 下载文件后缀 | 说明 |
| --- | --- | --- |
| x86-64 / AMD64 | `_x86.fpk` | 常见 Intel / AMD 64 位 NAS |
| ARM64 / AArch64 | `_arm.fpk` | 64 位 ARM 设备 |

目前不提供 32 位 ARM 构建。下载时可以对照同一 Release 附带的 `SHA256SUMS` 校验文件完整性。

### 2. 在 fnOS 中手动安装

1. 以管理员身份登录 fnOS。
2. 打开 **应用中心 → 手动安装**，选择下载好的 `.fpk` 文件。
3. 按 fnOS 提示完成安装并启动应用。
4. 从 fnOS 桌面打开 **Tailscale** 应用。

> 请确保系统提供 `/dev/net/tun`，并且**没有另一套 Tailscale 正在运行**。若存在其他 `tailscaled` 进程或 `tailscale0` 接口，本应用会为避免冲突而拒绝启动。

### 3. 登录并开始连接

1. 在管理界面选择**浏览器授权登录**，或按需使用 **Auth Key 登录**。
2. 完成 Tailscale 身份验证，确认 NAS 出现在你的 Tailnet 设备列表中。
3. 在另一台电脑或手机安装 Tailscale，加入同一个 Tailnet。
4. 在访问权限允许的情况下，通过 NAS 的 Tailscale IP（或已启用的 MagicDNS 名称）访问相应服务。

**首次使用建议先验证设备互通**，再用于长期远程访问。Exit Node 广播等进阶功能还可能需要在 Tailscale 管理控制台进行授权。

## 主要功能

| 功能 | 本项目提供的能力 |
| --- | --- |
| 原生运行 | 基于 fnOS FPK，使用官方 `tailscaled` 和系统 TUN 网络 |
| 登录与连接 | 浏览器登录、Auth Key 登录、连接/断开与退出登录 |
| 中文管理界面 | 概览、设备、设置三个页面；管理员桌面入口 |
| 设备查看 | 按系统显示设备图标，支持搜索、在线筛选、分页与在线数量统计 |
| 网络管理 | DERP 延迟检测、设备名称调整、本机 Exit Node 广播开关 |
| 界面偏好 | 字体大小与界面缩放可调整，偏好保存在当前浏览器 |
| 版本跟踪 | 打开界面时检测 GitHub Releases 新版，也可以手动检查 |
| 覆盖升级 | 通过新版 FPK 升级时设计为保留已有节点状态和身份；升级前仍需备份验证 |

**当前版本的真实 UI 截图尚未收录到仓库。** 为避免误导，本文不使用示意图冒充实机运行截图。

## 更新方式与使用限制

- **更新需要手动执行：** 通过 [Releases](https://github.com/Steven-ZYC/Tailscale-for-fnOS/releases) 获取更高版本的完整 FPK，在 fnOS 中覆盖安装；页面提示不等于自动升级。
- **请勿使用 Tailscale Admin Console 的客户端远程更新功能升级本 FPK。** 它无法同时更新 fnOS 集成脚本和本项目界面。
- **不要降级覆盖：** 不建议以较低版本 FPK 覆盖较高版本；重要设备升级前请备份。
- **注意高权限运行：** `tailscaled` 以 root 身份运行，安装前请评估第三方网络软件风险。
- **安装状态：** 本仓库提供社区构建供测试使用，不代表应用已获飞牛或 Tailscale 官方认证。

## 问题反馈与测试

如果你已经试用，欢迎在 [GitHub Issues](https://github.com/Steven-ZYC/Tailscale-for-fnOS/issues/new) 反馈。报告问题时请尽量提供 fnOS 版本、CPU 架构、FPK 版本、复现步骤和**已脱敏**的错误信息；不要公开 Auth Key、登录链接、Cookie、节点状态或其他凭据。

测试者可参考 [fnOS 虚拟机验收清单](docs/VM_TESTING.md)，重点验证首次安装、浏览器登录、设备连通、重启、覆盖升级、卸载清理与两种 CPU 架构的兼容性。安全漏洞请遵循 [安全报告说明](SECURITY.md)，不要作为公开 Issue 发布。

## 技术说明（面向开发者）

以下保留实现细节、自动构建机制、测试方法及第三方许可证等信息，方便审阅和复现。

### 版本命名规则

FPK 完整版本及正式 GitHub 发布标签采用
`v<Tailscale版本>-fnos.<社区版本>` 格式，例如 `v1.104.2-fnos.0.6`：

- `1.104.2` 表示内置的 Tailscale 官方版本；
- `fnos.0.6` 表示本项目 fnOS 社区适配层与上层管理 UI 的版本；
- 开头的 `v` 是 Git 标签前缀，不属于 FPK 内部版本号。

### 应用行为

- 以 root 身份运行官方 `tailscaled`，从而使用内核 TUN 网络；
- 将节点状态与密钥存放在 fnOS 的 `TRIM_PKGVAR/state`，升级应用时不会被替换；
- 将 LocalAPI socket 和 PID 文件存放在 `TRIM_PKGTMP`；
- 使用本项目原创的轻量 Go CGI 后端与中文管理界面，不使用官方
  `tailscale web --cgi`；
- 管理后端不常驻，只在打开页面或执行操作时短暂运行，并通过固定参数调用
  官方 `tailscale` CLI；
- 只向 fnOS 管理员显示桌面入口；
- 支持自动打开且成功后自动关闭弹窗的浏览器登录，以及 Auth Key 登录；Auth Key 只写入权限为
  `0600` 的临时文件并在使用后立即删除；
- 支持连接/断开与账户登出；
- 设备页按操作系统显示本项目原创的内联 SVG 图标，提供搜索、在线筛选、分页
  与在线数量统计；
- 支持 DERP 延迟检测、设备名称修改以及本机 Exit Node 广播开关；
- 界面分为概览、设备、设置三页，并可分别调节字体大小和界面缩放；v0.4
  将此前字体 120% 与界面缩放 80% 重新定义为新默认 100%，v0.5 增加可键入的
  百分比输入框，并在拖动或输入完成后再应用缩放以避免滑块跳变；显示偏好只
  保存在当前浏览器，不写入 Tailscale 状态；
- 每次打开管理页面时自动通过 GitHub Releases 检测 FPK 新版本，也可在设置页
  手动重查；检测只提示下载，不在 NAS 上自行安装；
- 不执行 `tailscale update`，所有升级只通过新的 FPK 交付；
- 不支持通过 Tailscale Admin Console 的远程更新或自动更新功能升级本应用；
  请从本项目的 GitHub Releases 手动下载新版 FPK，；若日后上架飞牛应用中心，也可通过应用中心提供的更新方式操作；
- 在 fnOS 中直接安装更高版本的同名 FPK 会走覆盖升级流程：旧进程先停止，
  应用文件被替换，`TRIM_PKGVAR/state` 中的节点身份、密钥与偏好会保留，升级后
  继续复用原节点。不要用较低版本覆盖较高版本；重要设备升级前仍建议备份应用数据；
- 卸载生命周期脚本不会静默删除已保存的节点身份。

### 实现边界

管理界面和 Go 后端由本项目独立实现。后端不导入 Tailscale 内部 Go 包，
只使用官方 CLI 的 `status --json`、`get`、`set`、`up`、`down`
和 `netcheck --format=json` 接口。这样可以保持较小的运行开销，也避免将
本项目绑定到 Tailscale 未承诺稳定的内部 API。

### 在 fnOS 上测试

请使用可随时还原的纯净 fnOS 虚拟机，并按照
[`docs/VM_TESTING.md`](docs/VM_TESTING.md) 完成测试。首次自动冒烟测试可以执行：

```bash
sudo ./scripts/device-smoke-test.sh /path/to/tailscale-fnos_VERSION_x86.fpk
```

脚本会安装并启动应用，检查 TUN、网络接口和 socket，测试停止清理，再次启动
以验证状态复用。Tailscale 登录和真实设备互联仍需人工验收。

### 自动跟踪上游更新

GitHub Actions 中的 `Track Tailscale stable releases` 每天在 UTC 01:17
（北京时间/香港时间 09:17）运行；UTC 04:17（12:17）会执行一次幂等的
三小时后重试。首次检查正常时，重试只会快速确认无需更新。工作流失败时会创建
或更新一个 `[automation] Tailscale stable update failed` Issue，恢复后自动关闭。
每次检查都会同时核对：

- `tailscale/tailscale` 最新正式 Release；
- Tailscale stable 软件源中的 Linux amd64 软件包。

两个来源确认同一个新版本后，工作流会更新官方摘要、构建并验证两个 FPK，
然后创建升级 Pull Request。已有更新分支但缺少 PR 时，后续运行会刷新该分支并
再次创建 PR，不会再直接退出。经过本地验证的版本直接推送或合并到 `main` 后，
`Build fnOS release` 会再次完整校验和构建，将 FPK 保存为保留 30 天的 Actions
artifact，并自动公开对应的 GitHub Release，因此 fnOS 端可以立即检测到它。
如需仅生成草稿，可手动运行该工作流并保持 `publish` 未勾选。

Tailscale Admin Console 只能管理节点及显示客户端版本，不能完整升级本项目的
FPK、Go 管理界面、manifest 或 fnOS 生命周期脚本。请勿将其中的远程更新或
自动更新作为本应用的升级渠道；用户应安装 GitHub Releases 提供的完整新版 FPK。

需要在 GitHub 仓库的 `Settings → Actions → General → Workflow permissions`
中勾选 `Allow GitHub Actions to create and approve pull requests`。若未开启，
工作流仍能验证候选版本并记录故障，但无法自动创建 PR。

### 安全注意事项

本应用属于高权限网络软件：

- 系统必须提供 `/dev/net/tun`；
- 不得同时运行另一套 Tailscale；
- 检测到其他 `tailscaled` 或已有 `tailscale0` 时，应用会拒绝启动；
- 不要将生产 NAS 作为未隔离的自托管 GitHub Actions runner；
- 不要提交 Tailscale auth key、API key、Cookie 或生成的状态文件。

安全问题报告方式请参阅 [`SECURITY.md`](SECURITY.md)。

### 许可证与品牌资源

随包分发的 Tailscale 二进制采用 BSD-3-Clause 许可证。所需声明位于
[`packaging/LICENSES/Tailscale-BSD-3-Clause.txt`](packaging/LICENSES/Tailscale-BSD-3-Clause.txt)，
并会连同第三方及构建来源说明一起复制到每个 FPK 的 `app/LICENSES/` 中。

应用图标取自 [Tailscale 官方媒体资源包](https://tailscale.com/press)中的
官方 squircle 图标。来源和所有权说明记录在 [`assets/SOURCE.md`](assets/SOURCE.md)。

本仓库原创打包代码目前尚未选择许可证。在接受外部贡献前应先确定许可证。

### 官方参考资料

- [fnOS 应用框架](https://developer.fnnas.com/docs/core-concepts/framework/)
- [fnOS Native 应用示例](https://developer.fnnas.com/docs/examples/native/)
- [fnOS fnpack](https://developer.fnnas.com/docs/cli/fnpack/)
- [Tailscale stable 软件包](https://pkgs.tailscale.com/stable/)
- [Tailscale Linux 安装说明](https://tailscale.com/docs/install/linux)
- [Tailscale CLI 与 Web UI](https://tailscale.com/docs/reference/tailscale-cli)
