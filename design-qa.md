# 九思助手标识改造：视觉 QA

- Source visual truth: `design/brand/jiusi-logo-source.png`（第 1 方案母版，1254 × 1254 px）；用户提供的 Dock 对比截图 `/var/folders/0p/c3dck_fj5154vt776pykjzlw0000gn/T/codex-clipboard-7c9dadc9-11de-4a6e-818c-a866306714b5.png` 和产品内截图 `/var/folders/0p/c3dck_fj5154vt776pykjzlw0000gn/T/codex-clipboard-f1ae24fd-19c3-44bd-8f79-86dd2bf49f17.png`。
- Rendered implementation: `resources/icon-mac.png` / `resources/icon.icns`（macOS，1024 × 1024 px），`src/renderer/assets/logo.png`（产品内无底块透明字形，1024 × 1024 px）。
- Implementation screenshot / comparison captures: `/private/tmp/jiusi-macos-size-comparison.png`（新旧 macOS 可见面积，1024 × 512 px）。本次在 1280 × 720 px 本地生产预览中通过 Computer Use 检查了浅色、深色侧栏；两张实时截图在会话内展示，未保存为文件。先前的 `/private/tmp/jiusi-ui-background-comparison.png` 仅记录已弃用的浅薄荷底和白底方案。
- State and density: macOS Dock 对比以相同的 1024 px 资源画布和 512 px 展示尺寸检查；产品内 Logo 仍使用 40 × 40 CSS px 位置，图像按同一比例展示，无布局缩放。

## Findings

无剩余可操作的 P0/P1/P2 差异。

1. Dock 尺寸：原图可见边界为 890 × 884 px / 1024 px 画布；用户截图里约 102 × 101 px，对比相邻应用约 96 × 96 px。macOS 专版将完整图形缩至 94%，可见边界变为 837 × 831 px，按相同 Dock 缩放推算约为 96 × 95 px。新旧图同画布并排复核，字形及中心火花负形没有改变。开发模式 Dock 使用 `resources/icon-mac.png`，安装版使用同图导出的 ICNS。
2. 产品内背景：浅薄荷底、纯白底都与至少一种主题面板产生可见色块。现已只导出透明字形，并在组件中用原始 PNG 的 alpha 通道作为遮罩，浅色主题显示深松绿、深色主题显示浅薄荷绿；两种主题的面板底色都直接透过字形外侧和中心负形，没有方形底块。40 px 图标位和字形比例保持不变。

逐项复核：标识不含字体或文案，侧栏标题字号、字重、换行和位置未改；布局、间距与控件路径未改；产品内颜色来自 `--color-brand-mark` 主题变量，无渐变、光晕或透明边缘白边；Windows、Linux、网站图标及分享图保留原比例和配色。

## Comparison history

- 初版导出：macOS 与通用图标共用 890 px 宽的画面；产品内图标与系统图标共用浅薄荷底。用户的两张截图分别揭示 Dock 可见面积偏大和产品内底色不协调。
- 第一次修正：macOS 单独缩至 94% 并同步开发 Dock PNG / ICNS / iconset；产品内单独导出白底。用户随后指出浅色仍有色差、深色出现白色方块，白底方案判为不合格。
- 第二次修正：产品内改为真正透明的字形 alpha 遮罩，并引入浅/深主题字形颜色。重新检查生产预览的浅色与深色页面截图，两个主题中均无底块或低对比问题。

## Residual test gap

Desktop Dock 接口无法提供当前 Dock 的实时截图，因此 96 px 是依据原用户截图尺寸和资源可见边界作出的估算；macOS 安装包及 Windows 安装包也未在对应系统上启动验收。资源格式、路径和构建检查由自动测试覆盖。

final result: passed
