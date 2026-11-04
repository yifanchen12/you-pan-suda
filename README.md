<h1 align="center">邮盘速达</h1>

<p align="center"><strong>把老师发来的网盘链接，变成能挑选、能下载的课程文件。</strong></p>
<p align="center">粘贴分享链接 → 勾选文件 → 选择保存位置。也可以把链接收进资料库，按课程查找。</p>
<p align="center"><img alt="Windows 源码运行" src="https://img.shields.io/badge/platform-Windows%20%E6%BA%90%E7%A0%81%E8%BF%90%E8%A1%8C-0078D4"> <img alt="Electron 44" src="https://img.shields.io/badge/Electron-44-47848F"> <img alt="MIT" src="https://img.shields.io/badge/license-MIT-628570"></p>

老师把教材放在不同网盘，群消息里的链接很快被新消息盖住。邮盘速达把“找链接、看文件、保存到电脑”放在同一个入口。**夸克分享**可以在应用里直接列出文件；其他网盘可接入单独运行的解析服务。应用默认使用内置下载器，无须安装 Gopeed 或 GDownload。

目前提供**源码运行**，没有可直接双击安装的发布包。链接解析与下载模块通过了本地测试；完整界面流程仍需在实际使用时验收。

## 它能帮你做什么

| 你想做的事 | 邮盘速达如何处理 |
| --- | --- |
| 下载老师发的夸克资料 | 粘贴分享链接，展开文件列表，勾选后下载；不必先保存资料卡 |
| 找回以前的课程链接 | 按课程建立本地资料卡，搜索名称或筛选网盘 |
| 下载普通文件直链 | 交给内置下载器；支持 Range 的文件可用最多 4 路分段 |
| 使用自己的下载器 | 可选 Gopeed REST API 或 GDownload Aria2 RPC；二者接收已解析的文件直链 |

## 快速开始

先安装 [Node.js 22.12 或更新版本](https://nodejs.org/)；项目使用的 Electron 44 要求这一版本范围。下载本仓库源码并解压，在项目目录打开终端运行：

```powershell
npm install
npm start
```

Windows 完成 `npm install` 后，也可双击 `启动邮盘速达.cmd`。首次安装依赖需要联网。macOS、Linux 尚未做实机验收。

1. 打开“下载加速”页，把分享文案或链接粘进输入框，点击“查看文件”或“下载”。
2. 在文件列表勾选需要的内容，点击“下载选中”。内置下载器会让你选择一次保存文件夹，随后依次下载；已有同名文件不会被覆盖。
3. 如果粘贴的是普通文件直链，点击“下载”后直接选择文件保存位置。

夸克分享使用访客接口。部分文件可能受夸克的账号或访客下载限制。其他网盘需要先运行 [NFD Parser](https://github.com/qaiu/netdisk-fast-download) 本机解析服务；若主动选择社区解析服务，应用会在发送链接和提取码前再次确认。能否列出文件取决于解析服务支持范围。

## 可选：接入 Gopeed 或 GDownload

这两个程序**不负责解析邮盘速达里的分享链接**：邮盘速达先取得文件直链，再把下载任务交给它们。两者都要另行安装并保持运行；默认内置下载器无需这些步骤。外部接口未启动时，应用会切回内置下载器。

### Gopeed

1. 从 [Gopeed 官方 Releases](https://github.com/GopeedLab/gopeed/releases/latest) 安装稳定版并启动。
2. 按[官方 API 教程](https://gopeed.com/docs/dev-api)，在“设置 → 高级”把通信协议设为 **TCP**，监听地址设为 `127.0.0.1`，端口设为 `9999`。如设置了 API Token，请自行保管。**重启 Gopeed** 使设置生效。
3. 在邮盘速达顶部选择“Gopeed”，本机接口填写 `http://127.0.0.1:9999`；设置了 Token 才填“接口密钥”。文件保存位置由 Gopeed 自身设置决定。

Gopeed 提供 [REST API](https://gopeed.com/api-reference)，本项目使用其创建任务、查询进度和暂停接口。未在这台电脑上完成 Gopeed 实机联调；接口调用有本地模拟测试。

### GDownload

1. 从 [GDownload 官方 Releases](https://github.com/cool2528/GDownload/releases) 安装并启动。
2. 在 GDownload“设置 → 高级”找到 **Aria2 RPC**。核对监听端口，默认是 `16888`；查看 RPC 密钥。修改端口或密钥后按界面提示重启应用。[设置页源码](https://github.com/cool2528/GDownload/blob/main/src/App/ui/Resource/qml/Browser/Aria2RpcSettingPage.qml)列出了这些字段。
3. 在邮盘速达顶部选择“GDownload”，本机接口填写 `http://127.0.0.1:16888`，或换成实际端口；把 RPC 密钥填进“接口密钥”。密钥只在当前运行期间使用，不写入资料卡或配置文件。

本项目只调用 GDownload 的 **Aria2 RPC**，不调用它的网盘插件。GDownload 的[夸克插件](https://github.com/cool2528/GDownload/blob/main/docs/plugin-guides/quark-netdisk.md)是另一套需要登录 Cookie 的流程；**不要把 Cookie 填到邮盘速达的接口密钥框里**。GDownload 也尚未在这台电脑上完成实机联调，当前只有本地模拟测试。

## 使用中遇到问题

| 情况 | 处理方式 |
| --- | --- |
| 选择 Gopeed 后提示无法连接 `127.0.0.1:9999` | Gopeed 没启动或未开启 TCP API；可直接改选“邮盘速达内置” |
| 选择 GDownload 后接口拒绝任务 | 核对 Aria2 RPC 端口与密钥，修改设置后重启 GDownload |
| 其他网盘无法列出文件 | 检查 NFD Parser 是否运行；社区服务需要你主动选择并确认发送链接 |
| 夸克文件可以列出但下载被拒绝 | 该文件可能超出访客下载权限；本项目不读取你的登录 Cookie |
| 分段下载没有更快 | 服务器、网络和账号权限也会限制速度；4 路连接不保证提速 |

## 本地数据与验证

资料卡保存在 Electron 用户数据目录的 `resources.json`，项目没有自己的服务器。内置下载器使用 `.part` 临时文件；分段时记录进度并核对文件大小和 `Content-Range`。外部下载器各自管理任务和保存位置。

```powershell
npm test
```

测试覆盖链接识别、文件夹展开、请求头传递、内置分段下载、同名文件保护和本机下载器接口。测试使用模拟响应及临时文件；**不能替代 Gopeed、GDownload 和完整界面的实机验收**。本项目仅用于下载你有权获取的课程资料。源码按 [MIT 许可证](LICENSE)发布，Gopeed、GDownload 与 NFD Parser 各自遵循其许可证。

欢迎通过 [Issues](https://github.com/yifanchen12/you-pan-suda/issues)反馈网盘类型、操作步骤和错误信息；不要附上 Cookie、接口密钥或私人分享链接。
