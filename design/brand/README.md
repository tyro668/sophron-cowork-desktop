# 九思助手标识

已采用第 1 稿「九思印记」：深松绿的抽象“九”字形，中央留出思维火花负形，浅薄荷色方圆图标底。

- `jiusi-logo-source.png`：应用图标母版。
- `jiusi-tray-mark-source.png`：同字形的单色托盘母版。
- `logo-concepts/`：探索稿，不参与构建。

运行 `python3 scripts/generate-brand-icons.py`（需要 Pillow）统一导出应用内、网站、Windows `.ico`、macOS `.icns`、Linux PNG、favicon、托盘和网站分享图。产品内侧栏使用没有底块的透明字形，颜色由浅色/深色主题中的 `--color-brand-mark` 决定；macOS Dock/ICNS 版本将图形缩至 94%，留出与其他应用相近的外边距。其他平台保留原始比例。不要分别手工改动导出文件。
