# Tailscale for fnOS

[English](README_EN.md) | 简体中文

本项目将 Tailscale 官方 Linux 客户端原生封装为 fnOS FPK 应用。生成的 FPK
直接包含 Tailscale stable 软件源提供的、未经修改的 `tailscale` 与
`tailscaled` 静态二进制文件，不依赖 Docker。

- 项目地址：<https://github.com/Steven-ZYC/Tailscale-for-fnOS>

> 这是一个由社区维护的第三方项目，与 Tailscale Inc. 及飞牛 fnOS
> 官方均无隶属或背书关系。Tailscale 是 Tailscale Inc. 的注册商标。

## 当前版本与架构

当前项目里程碑为 **v0.1（测试版）**，对应当前 FPK 的 fnOS 修订号
`fnos.0.1`。FPK 完整版本还包含所捆绑的 Tailscale 版本，例如
`1.102.2-fnos.0.1`。

[`upstream.lock`](upstream.lock) 记录当前锁定的 Tailscale 版本、amd64 与
arm64 SHA-256、fnOS 打包修订号，以及锁定的 `fnpack` 工具摘要。

构建过程会生成两个安装包：

- `x86`：适用于 x86_64/amd64 fnOS 设备；
- `arm`：适用于 arm64/aarch64 fnOS 设备。

目前不提供 32 位 ARM 安装包。

## 应用行为

- 以 root 身份运行官方 `tailscaled`，从而使用内核 TUN 网络；
- 将节点状态与密钥存放在 fnOS 的 `TRIM_PKGVAR/state`，升级应用时不会被替换；
- 将 LocalAPI socket 和 PID 文件存放在 `TRIM_PKGTMP`；
- 使用本项目原创的轻量 Go CGI 后端与中文管理界面，不使用官方
  `tailscale web --cgi`；
- 管理后端不常驻，只在打开页面或执行操作时短暂运行，并通过固定参数调用
  官方 `tailscale` CLI；
- 只向 fnOS 管理员显示桌面入口；
- 支持浏览器授权链接和 Auth Key 两种登录方式，Auth Key 只写入权限为
  `0600` 的临时文件并在使用后立即删除；
- 支持连接/断开、设备列表与在线统计、DERP 延迟检测、设备名称修改以及本机
  Exit Node 广播开关；
- 通过 GitHub Releases 检测 FPK 新版本，只提示下载，不在 NAS 上自行更新；
- 不执行 `tailscale update`，所有升级只通过新的 FPK 交付；
- 卸载生命周期脚本不会静默删除已保存的节点身份。

## 实现边界

管理界面和 Go 后端由本项目独立实现。后端不导入 Tailscale 内部 Go 包，
只使用官方 CLI 的 `status --json`、`get`、`set`、`up`、`down`
和 `netcheck --format=json` 接口。这样可以保持较小的运行开销，也避免将
本项目绑定到 Tailscale 未承诺稳定的内部 API。

## 获取源码

```bash
git clone https://github.com/Steven-ZYC/Tailscale-for-fnOS.git
cd Tailscale-for-fnOS
```

## 在 WSL2 Ubuntu 中构建

从 PowerShell 调用已经检出的项目：

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd "/mnt/d/path/to/Tailscale-for-fnOS" && make build'
```

如果 Ubuntu 尚未安装 `make`，可以直接运行脚本：

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd "/mnt/d/path/to/Tailscale-for-fnOS" && ./scripts/validate.sh && ./scripts/install-fnpack.sh && ./scripts/build-all.sh'
```

也可以在 Ubuntu shell 中执行：

```bash
cd /path/to/Tailscale-for-fnOS
make build
```

构建过程将：

1. 检查 manifest、JSON、PNG 尺寸、Shell 语法和锁定摘要；
2. 下载锁定版本的 fnOS 官方 `fnpack` 并验证 SHA-256；
3. 下载 Tailscale 官方 amd64 与 arm64 stable 归档；
4. 确认官方在线 `.sha256` 与 `upstream.lock` 一致；
5. 在 `dist/` 下生成两个 FPK、`SHA256SUMS` 和 `provenance.json`。

整个过程不使用 `curl | sh` 或 Docker。原创管理程序使用 Go 标准库静态编译，
并由同一套源码交叉构建为 Linux amd64 和 arm64 二进制。

常用命令：

```bash
make validate
make test
make detect-upstream
make build-x86
make build-arm
make build
make clean
```

## 在 fnOS 上测试

请使用可随时还原的纯净 fnOS 虚拟机，并按照
[`docs/VM_TESTING.md`](docs/VM_TESTING.md) 完成测试。首次自动冒烟测试可以执行：

```bash
sudo ./scripts/device-smoke-test.sh /path/to/tailscale-fnos_VERSION_x86.fpk
```

脚本会安装并启动应用，检查 TUN、网络接口和 socket，测试停止清理，再次启动
以验证状态复用。Tailscale 登录和真实设备互联仍需人工验收。

## 自动跟踪上游更新

GitHub Actions 中的 `Track Tailscale stable releases` 每小时第 17 分钟运行，
同时核对：

- `tailscale/tailscale` 最新正式 Release；
- Tailscale stable 软件源中的 Linux amd64 软件包。

两个来源确认同一个新版本后，工作流会更新官方摘要、构建并验证两个 FPK，
然后创建升级 Pull Request。升级合并到 `main` 后，发布工作流会创建一个
**GitHub 草稿 Release**。只有在纯净虚拟机测试通过后才应手动公开发布。

需要在 GitHub 仓库设置中允许 GitHub Actions 创建 Pull Request。若未开启，
工作流仍能验证候选版本，但无法自动创建 PR。

## 安全注意事项

本应用属于高权限网络软件：

- 系统必须提供 `/dev/net/tun`；
- 不得同时运行另一套 Tailscale；
- 检测到其他 `tailscaled` 或已有 `tailscale0` 时，应用会拒绝启动；
- 不要将生产 NAS 作为未隔离的自托管 GitHub Actions runner；
- 不要提交 Tailscale auth key、API key、Cookie 或生成的状态文件。

安全问题报告方式请参阅 [`SECURITY.md`](SECURITY.md)。

## 许可证与品牌资源

随包分发的 Tailscale 二进制采用 BSD-3-Clause 许可证。所需声明位于
[`packaging/LICENSES/Tailscale-BSD-3-Clause.txt`](packaging/LICENSES/Tailscale-BSD-3-Clause.txt)，
并会连同第三方及构建来源说明一起复制到每个 FPK 的 `app/LICENSES/` 中。

应用图标取自 [Tailscale 官方媒体资源包](https://tailscale.com/press)中的
官方 squircle 图标。来源和所有权说明记录在 [`assets/SOURCE.md`](assets/SOURCE.md)。

本仓库原创打包代码目前尚未选择许可证。在接受外部贡献前应先确定许可证。

## 官方参考资料

- [fnOS 应用框架](https://developer.fnnas.com/docs/core-concepts/framework/)
- [fnOS Native 应用示例](https://developer.fnnas.com/docs/examples/native/)
- [fnOS fnpack](https://developer.fnnas.com/docs/cli/fnpack/)
- [Tailscale stable 软件包](https://pkgs.tailscale.com/stable/)
- [Tailscale Linux 安装说明](https://tailscale.com/docs/install/linux)
- [Tailscale CLI 与 Web UI](https://tailscale.com/docs/reference/tailscale-cli)
