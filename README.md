# Tailscale for fnOS

[English](README_EN.md) | 简体中文

本项目将 Tailscale 官方 Linux 客户端原生封装为 fnOS FPK 应用。生成的 FPK
直接包含 Tailscale stable 软件源提供的、未经修改的 `tailscale` 与
`tailscaled` 静态二进制文件，不依赖 Docker。

- 项目地址：<https://github.com/Steven-ZYC/Tailscale-for-fnOS>

> 这是一个由社区维护的第三方项目，与 Tailscale Inc. 及飞牛 fnOS
> 官方均无隶属或背书关系。Tailscale 是 Tailscale Inc. 的注册商标。

## 版本命名规则

FPK 完整版本及正式 GitHub 发布标签采用
`v<Tailscale版本>-fnos.<社区版本>` 格式，例如 `v1.102.2-fnos.0.4`：

- `1.102.2` 表示内置的 Tailscale 官方版本；
- `fnos.0.4` 表示本项目 fnOS 社区适配层与上层管理 UI 的版本；
- 开头的 `v` 是 Git 标签前缀，不属于 FPK 内部版本号。

## 应用行为

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
  请从本项目的 GitHub Releases 手动下载新版 FPK，或通过飞牛应用商店更新；
- 在 fnOS 中直接安装更高版本的同名 FPK 会走覆盖升级流程：旧进程先停止，
  应用文件被替换，`TRIM_PKGVAR/state` 中的节点身份、密钥与偏好会保留，升级后
  继续复用原节点。不要用较低版本覆盖较高版本；重要设备升级前仍建议备份应用数据；
- 卸载生命周期脚本不会静默删除已保存的节点身份。

## 实现边界

管理界面和 Go 后端由本项目独立实现。后端不导入 Tailscale 内部 Go 包，
只使用官方 CLI 的 `status --json`、`get`、`set`、`up`、`down`
和 `netcheck --format=json` 接口。这样可以保持较小的运行开销，也避免将
本项目绑定到 Tailscale 未承诺稳定的内部 API。

## 在 fnOS 上测试

请使用可随时还原的纯净 fnOS 虚拟机，并按照
[`docs/VM_TESTING.md`](docs/VM_TESTING.md) 完成测试。首次自动冒烟测试可以执行：

```bash
sudo ./scripts/device-smoke-test.sh /path/to/tailscale-fnos_VERSION_x86.fpk
```

脚本会安装并启动应用，检查 TUN、网络接口和 socket，测试停止清理，再次启动
以验证状态复用。Tailscale 登录和真实设备互联仍需人工验收。

## 自动跟踪上游更新

GitHub Actions 中的 `Track Tailscale stable releases` 每天在 UTC 01:17
（北京时间/香港时间 09:17）运行；UTC 04:17（12:17）会执行一次幂等的
三小时后重试。首次检查正常时，重试只会快速确认无需更新。工作流失败时会创建
或更新一个 `[automation] Tailscale stable update failed` Issue，恢复后自动关闭。
每次检查都会同时核对：

- `tailscale/tailscale` 最新正式 Release；
- Tailscale stable 软件源中的 Linux amd64 软件包。

两个来源确认同一个新版本后，工作流会更新官方摘要、构建并验证两个 FPK，
然后创建升级 Pull Request。已有更新分支但缺少 PR 时，后续运行会刷新该分支并
再次创建 PR，不会再直接退出。升级合并到 `main` 后，发布工作流会重新构建并将
FPK 保存为保留 30 天的 Actions artifact，同时创建一个 **GitHub 草稿 Release**。
只有在纯净虚拟机测试通过后，才应在 `Build draft release` 的手动运行页面勾选
`publish` 将对应草稿公开；只有公开 Release 才会被 fnOS 端的版本检测看到。

Tailscale Admin Console 只能管理节点及显示客户端版本，不能完整升级本项目的
FPK、Go 管理界面、manifest 或 fnOS 生命周期脚本。请勿将其中的远程更新或
自动更新作为本应用的升级渠道；用户应安装 GitHub Releases 或飞牛应用商店
提供的完整新版 FPK。

需要在 GitHub 仓库的 `Settings → Actions → General → Workflow permissions`
中勾选 `Allow GitHub Actions to create and approve pull requests`。若未开启，
工作流仍能验证候选版本并记录故障，但无法自动创建 PR。

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
