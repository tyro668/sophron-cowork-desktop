# 九思助手标识

应用提供两套可选标识：第 1 稿「九思印记」和第 3 稿「协作折页」。后者保留左右对称折页与中央 Y 形留白，并整理为无噪点的矢量母版。

- `jiusi-logo-source.png`：应用图标母版。
- `jiusi-tray-mark-source.png`：同字形的单色托盘母版。
- `jiusi-fold-source.svg`：第 3 稿的可编辑矢量母版；`jiusi-fold-generated-reference.png` 是据原探索稿生成并保留的视觉参考。
- `logo-concepts/`：探索稿，不参与构建。

运行 `python3 scripts/generate-brand-icons.py`（需要 Pillow 和 `rsvg-convert`）统一导出两套运行时图标，及默认标识的网站、favicon 和分享图。产品内侧栏使用没有底块的透明字形，颜色由浅色/深色主题中的 `--color-brand-mark` 决定；macOS Dock 版本将图形缩至 94%，留出与其他应用相近的外边距。设置 → 通用可以即时切换侧栏、Dock、窗口和托盘标识，并持久化选择。安装包、Finder 中的 `.app` 和 Windows 可执行文件自身的图标仍是第 1 稿，无法由应用内设置动态改写。不要分别手工改动导出文件。
