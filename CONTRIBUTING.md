# 参与贡献

欢迎 issue 和 pull request。

## 开发

```bash
npm install
npm start          # 本地运行
npm run smoke -- --out=./.tmp-smoke   # 无界面自检，产物写到 .tmp-smoke/
```

代码结构见 [README.md](README.md#目录结构)：

- `src/main/` 主进程（窗口、菜单、IPC、文件读写），改动后需重开应用；
- `src/renderer/engine/` 水印引擎（`render.js` 绘制、`image.js` 图片、`pdf.js` PDF），改完刷新窗口即可生效；
- 规则：不引入原生模块（保证双端免 rebuild）、渲染进程保持 `contextIsolation` + 沙箱、脚本用传统 `<script>`（CSP 限制，不能用 ESM）。

## 提交前

1. `npm run smoke` 全绿（会验证图片、PDF、页码范围、旋转页）；
2. 涉及默认参数时，附上改前/改后的效果图；
3. 提交信息用 `feat: / fix: / docs: / chore:` 前缀。

## 打包

```bash
npm run dist:mac   # macOS：dmg + zip（x64 / arm64）
npm run dist:win   # Windows：nsis 安装版 + 免安装版
```
