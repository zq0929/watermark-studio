# 水印工坊 · Watermark Studio

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#系统要求)
[![electron](https://img.shields.io/badge/electron-33-2f57e0.svg)](https://www.electronjs.org/)
[![build](https://github.com/zq0929/watermark-studio/actions/workflows/build.yml/badge.svg)](https://github.com/zq0929/watermark-studio/actions/workflows/build.yml)

> 本地批量给「图片」和「PDF」加平铺水印的桌面小工具，macOS 与 Windows 双端。
> 全部处理都在本机完成，不联网、不上传文件。

![界面截图](docs/screenshot.png)

## 功能

- 支持格式：`jpg / jpeg / png / webp / bmp / gif / avif` 与 `pdf`
- 文字水印：自定文字、字体（黑体/宋体/楷体）、加粗、字号、角度、不透明度、间距、颜色
- 两种排布：**平铺**（默认，斜向重复铺满整页）与 **居中**（单条大字）
- 批量处理：拖拽文件或整个文件夹进来，一次全部处理；输出防覆盖（同名自动加 `(1)`）
- 实时预览：图片按原始像素与 EXIF 方向实时预览；PDF 显示页面示意（尺寸/页数/实际处理页数）
- PDF 页码范围：`全部`、`1-3,5`、`7` 等
- 输出控制：保存到源文件旁 / 指定文件夹；文件名后缀可改（默认 `_水印`）
- 设置记忆：下次打开仍是上次的参数

## 系统要求

| 平台 | 版本 | 安装包 |
| --- | --- | --- |
| macOS | 11 Big Sur 及以上（Intel 与 Apple Silicon 均可） | `水印工坊-1.0.0-*.dmg` |
| Windows | Windows 10 / 11（64 位） | `水印工坊-1.0.0-安装程序.exe`（或免安装 `.exe`） |

## 使用

1. 打开应用，把图片或 PDF 拖进窗口（也可以点「添加文件」「添加文件夹」）。
2. 左侧选中文件 → 中间实时预览 → 右侧调参数。
3. 选好「输出位置」（默认保存到源文件所在文件夹），点「开始处理」或按 `⌘/Ctrl + Enter`。
4. 完成后点「打开输出文件夹」。

### 参数说明

| 参数 | 说明 |
| --- | --- |
| 水印文字 | 支持多行（换行即分段）；右侧预设一键填入常用用途说明 |
| 字号 | 相对页面短边的百分比，默认 3.8% —— 页面越大字越大，比例始终一致 |
| 角度 | 逆时针角度，默认 26°（斜向平铺观感最自然） |
| 不透明度 | 默认 18%，既能看清文字又不遮挡原件内容 |
| 间距 | 旋转后相邻水印块的空隙，调大更疏、调小更密 |
| 颜色 | 默认深灰 `#3b3b3b`，另有红/蓝/浅灰/黑色可选，也可自定义 |

### 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 添加文件 | `⌘/Ctrl + O` |
| 添加文件夹 | `⌘/Ctrl + Shift + O` |
| 开始处理 | `⌘/Ctrl + Enter` |
| 打开输出目录 | `⌘/Ctrl + Shift + E` |

## 已知限制

- **加密 PDF** 暂不支持（会提示后跳过该文件）。
- PDF 水印是叠加在页面上的**图片层**，不会嵌入字体，也不改变原有文字层（文字仍可复制）；因此它不是不可移除的，只用于声明用途、防止误用。
- 图片输出格式跟随源文件：`png` 保留透明通道，`jpg` 会先铺白底（避免透明区域变黑），`webp/gif/bmp/avif` 统一输出为 `png`。
- 超大图片（长边 > 14000px）会自动等比缩小后处理。
- 中文字体使用系统自带字体，未安装对应字体时会回退到系统默认中文字体。

## 下载安装

到 [Releases](https://github.com/zq0929/watermark-studio/releases) 下载对应平台的安装包；
也可以按下面的命令自行构建。

## 发布包（`dist/`）

| 文件 | 适用平台 |
| --- | --- |
| `水印工坊-1.0.0-x64.dmg` | macOS Intel 芯片 |
| `水印工坊-1.0.0-arm64.dmg` | macOS Apple Silicon（M1/M2/M3/M4） |
| `水印工坊-1.0.0-安装程序.exe` | Windows 10/11 64 位（安装版，可选安装目录） |
| `水印工坊-1.0.0-免安装.exe` | Windows 10/11 64 位（绿色免安装） |

推送 `v*` 标签或手动触发 `.github/workflows/build.yml`，GitHub Actions 会自动在
macOS / Windows 上分别打包并上传安装包（不签名）。

## 从源码运行

```bash
# 需要 Node.js 18+
npm install
npm start
```

### 打包安装包

```bash
npm run dist:mac   # 生成 dist/水印工坊-1.0.0-*.dmg（Intel + Apple Silicon）
npm run dist:win   # 生成 dist/水印工坊-1.0.0-安装程序.exe / 免安装.exe
npm run dist:all   # 两个平台一起打
```

- 未做代码签名（`identity: null`）：macOS 首次打开需**右键 → 打开**，或执行
  `xattr -dr com.apple.quarantine /Applications/水印工坊.app`；Windows 会弹 SmartScreen，
  点「更多信息 → 仍要运行」即可。正式分发建议配置自己的签名证书。
- 图标由脚本生成：`npm run icon`（Canvas 绘制，无原生依赖）。

### 自检（无需人工点界面）

```bash
npm run smoke -- --out=./.tmp-smoke
```

用隐藏窗口跑真实链路（Canvas 图片 + pdf-lib PDF + 旋转页），把产物写到 `--out` 目录并打印 JSON 结果。

## 技术实现

- **Electron 33** + 原生 HTML/CSS/JS，无打包器、无原生模块 —— 双端打包简单、体积小。
- 图片水印：`<canvas>` 绘制（Chromium 解码，自动按 EXIF 方向摆正），水印层用尺寸倍数超采样后缩小，边缘更细腻。
- PDF 水印：`pdf-lib` 生成一张**透明 PNG 覆盖层**（每个页面尺寸只生成一次），按页面 `CropBox` 铺满后用 `drawImage` 叠加；自动识别页面 `/Rotate`，让水印在**屏幕上**保持设定的角度。
- 渲染进程负责解码与绘制（避免通过 IPC 传大 Buffer），主进程只做窗口、菜单、文件读写与对话框。
- 渲染进程开启 `contextIsolation` + 沙箱，禁用 `nodeIntegration`，并用 CSP 限制脚本来源。

## 目录结构

```
水印工坊/
├─ src/
│  ├─ main/          主进程：窗口、菜单、IPC、文件读写
│  └─ renderer/      界面与引擎
│     ├─ engine/render.js   水印绘制（平铺/居中、间距、字体）
│     ├─ engine/image.js    图片处理
│     ├─ engine/pdf.js      PDF 处理
│     └─ vendor/pdf-lib.min.js
├─ scripts/make-icon.js     生成应用图标
├─ test/smoke.js            自检脚本
└─ build/icon.png           应用图标
```

## 许可

[MIT](LICENSE) © 2026 zq0929

欢迎提交 issue 与 PR，开发与打包说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。
