#!/usr/bin/env python3
"""Render the README system-interaction architecture directly to PNG.

The historical FineBI Next image informs the three-column composition only.
Current connections are checked against Electron IPC, SessionManager, the
Personal Analysis client, DataCommandService, workflow-plan validation,
DuckDB/SQLite stores, and the configured model/MCP/remote integrations.

Run: python3 scripts/draw-readme-architecture.py  (requires Pillow)
No SVG or other vector intermediate is created.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "resources" / "sophron-architecture.png"
SCALE = 2
WIDTH, HEIGHT = 1850, 1250

C = {
    "bg": "#ffffff",
    "ink": "#182b3b",
    "muted": "#526778",
    "faint": "#edf2f6",
    "line": "#7891a2",
    "blue": "#2368a8",
    "blue_border": "#98bddb",
    "blue_fill": "#f4f9fd",
    "green": "#187b5b",
    "green_border": "#9ccdb8",
    "green_fill": "#f3faf7",
    "purple": "#6547a1",
    "purple_border": "#b8a8d6",
    "purple_fill": "#f8f6fc",
    "orange": "#a65923",
    "orange_border": "#e4b894",
    "orange_fill": "#fff9f3",
    "slate_border": "#bacbd6",
    "slate_fill": "#f8fafc",
}

FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
canvas = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE), C["bg"])
draw = ImageDraw.Draw(canvas)


def p(x: float, y: float) -> tuple[int, int]:
    return round(x * SCALE), round(y * SCALE)


def f(size: int, *, latin_bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if latin_bold else FONT, size * SCALE)


def txt(
    x: int,
    y: int,
    value: str,
    size: int = 16,
    *,
    color: str = "ink",
    center: bool = False,
    latin_bold: bool = False,
) -> None:
    chosen = f(size, latin_bold=latin_bold)
    if center:
        x -= round(draw.textlength(value, font=chosen) / (2 * SCALE))
    draw.text(p(x, y), value, font=chosen, fill=C[color])


def rect(
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    *,
    fill: str,
    border: str,
    radius: int = 12,
    stroke: int = 2,
) -> None:
    draw.rounded_rectangle(
        (*p(x0, y0), *p(x1, y1)),
        radius=radius * SCALE,
        fill=C[fill],
        outline=C[border],
        width=stroke * SCALE,
    )


def dashline(a: tuple[int, int], b: tuple[int, int], *, color: str, dash: int = 10, gap: int = 7) -> None:
    dx, dy = b[0] - a[0], b[1] - a[1]
    distance = math.hypot(dx, dy)
    if distance == 0:
        return
    ux, uy = dx / distance, dy / distance
    offset = 0.0
    while offset < distance:
        end = min(offset + dash, distance)
        draw.line(
            [p(a[0] + ux * offset, a[1] + uy * offset), p(a[0] + ux * end, a[1] + uy * end)],
            fill=C[color],
            width=2 * SCALE,
        )
        offset = end + gap


def boundary(x0: int, y0: int, x1: int, y1: int, *, color: str) -> None:
    for a, b in (
        ((x0, y0), (x1, y0)),
        ((x1, y0), (x1, y1)),
        ((x1, y1), (x0, y1)),
        ((x0, y1), (x0, y0)),
    ):
        dashline(a, b, color=color)


def arrow(points: list[tuple[int, int]], *, color: str = "blue", stroke: int = 3) -> None:
    draw.line([p(*point) for point in points], fill=C[color], width=stroke * SCALE, joint="curve")
    tip = points[-1]
    before = points[-2]
    angle = math.atan2(tip[1] - before[1], tip[0] - before[0])
    length, half = 10, 5
    base = (tip[0] - length * math.cos(angle), tip[1] - length * math.sin(angle))
    left = (base[0] + half * math.sin(angle), base[1] - half * math.cos(angle))
    right = (base[0] - half * math.sin(angle), base[1] + half * math.cos(angle))
    draw.polygon([p(*tip), p(*left), p(*right)], fill=C[color])


def badge(x: int, y: int, value: str, *, color: str) -> None:
    draw.ellipse((*p(x - 14, y - 14), *p(x + 14, y + 14)), fill=C[color])
    txt(x, y - 11, value, 16, color="bg", center=True)


# Overall title and relationship map.
txt(55, 30, "九思助理：产品架构与外部系统交互", 36)
txt(55, 82, "当前代码实现  ·  左：可选云表服务  /  中：本地桌面应用  /  右：外部入口与本地数据源", 17, color="muted")
boundary(55, 145, 405, 1015, color="blue_border")
boundary(455, 145, 1395, 1015, color="purple_border")
boundary(1435, 145, 1795, 1015, color="orange_border")


# LEFT: a historical FineBI Next deployment is a reference scenario. The
# repository's concrete integration is a configurable Personal Analysis API.
txt(80, 166, "云端数据系统（可选）", 24, color="blue")
txt(80, 204, "历史图：FineBI Next 场景", 16, color="muted")
txt(80, 229, "当前实现：可配置 Personal Analysis API", 15, color="muted")

rect(75, 268, 385, 365, fill="blue_fill", border="blue_border")
txt(97, 285, "Personal Analysis API", 22, color="blue", latin_bold=True)
txt(97, 324, "账号令牌或 API Key 连接", 16, color="muted")
txt(97, 344, "按配置的服务地址访问", 14, color="muted")

rect(75, 397, 385, 550, fill="blue_fill", border="blue_border")
txt(97, 415, "云端表目录", 22, color="blue")
txt(97, 452, "空间  /  项目  /  数据表", 17)
txt(97, 481, "浏览 · 搜索 · 预览", 16, color="muted")
txt(97, 511, "云表导出 Csv 后可导入本地", 16, color="muted")

rect(75, 647, 385, 837, fill="slate_fill", border="slate_border")
txt(97, 665, "云侧分析与可视化", 21, color="blue")
txt(97, 704, "由所连接的外部系统负责", 17)
txt(97, 735, "例如图表、看板、报表、发布", 16, color="muted")
txt(97, 775, "九思仅上传本地表数据；", 16, color="muted")
txt(97, 801, "不把云侧产品能力计入本应用", 16, color="muted")

txt(80, 891, "云表双向通路", 20, color="blue")
txt(80, 930, "读取：云表 → Csv → 本地输入表", 16)
txt(80, 958, "回写：本地表 → Csv → 云表", 16)
txt(80, 986, "回写可选 CREATE / REPLACE", 15, color="muted")


# CENTER: renderer and IPC reach main services. External ingress and local
# inputs reach DataCommandService, not the renderer or an imaginary Python loop.
txt(485, 166, "九思助理 / sophron cowork", 29, color="purple")
txt(485, 207, "本地 Electron 桌面应用；数据处理与 Agent 执行由主进程装配", 17, color="muted")

rect(485, 255, 1365, 355, fill="purple_fill", border="purple_border")
txt(505, 271, "用户与任务入口", 19, color="purple")
txt(505, 307, "桌面聊天 / 数据工作台 / 云端数据页", 17)
txt(1030, 307, "授权远程消息 / 本机定时", 17)

rect(485, 390, 750, 477, fill="purple_fill", border="purple_border")
rect(790, 390, 1055, 477, fill="purple_fill", border="purple_border")
rect(1095, 390, 1365, 477, fill="purple_fill", border="purple_border")
txt(505, 407, "React Renderer", 21, latin_bold=True)
txt(505, 445, "工作台 UI", 16, color="muted")
txt(810, 407, "Preload IPC", 21, latin_bold=True)
txt(810, 445, "受控 window.electronAPI", 16, color="muted")
txt(1115, 407, "Electron Main", 21, latin_bold=True)
txt(1115, 445, "IPC 与服务装配", 16, color="muted")
arrow([(617, 355), (617, 390)], color="purple")
arrow([(1210, 355), (1210, 390)], color="purple")
arrow([(750, 434), (790, 434)], color="purple")
arrow([(1055, 434), (1095, 434)], color="purple")

rect(485, 515, 1365, 665, fill="green_fill", border="green_border")
txt(505, 530, "会话与 Agent 运行时", 23, color="green")
rect(505, 578, 770, 644, fill="bg", border="green_border", radius=8)
rect(790, 578, 1055, 644, fill="bg", border="green_border", radius=8)
rect(1075, 578, 1345, 644, fill="bg", border="green_border", radius=8)
txt(520, 590, "SessionManager", 18, latin_bold=True)
txt(520, 618, "队列 · Trace · 权限", 15, color="muted")
txt(805, 590, "模型路由与记忆", 18)
txt(805, 618, "云模型或本地 Ollama", 15, color="muted")
txt(1090, 590, "工具 / Skills / MCP", 18)
txt(1090, 618, "文件、数据与外部工具", 15, color="muted")
arrow([(1230, 477), (1230, 495), (650, 495), (650, 515)], color="green")
arrow([(1115, 477), (1115, 485), (468, 485), (468, 695), (530, 695), (530, 715)], color="purple")

rect(485, 715, 1365, 861, fill="blue_fill", border="blue_border")
txt(505, 730, "结构化数据工作台：UI 与 Agent 数据工具共用命令服务", 21, color="blue")
txt(505, 760, "2  GUI / Prep DSL / AI 计划统一构建并校验后执行；本地文件与云表经同一输入表通路", 15, color="muted")
rect(505, 792, 765, 845, fill="bg", border="blue_border", radius=8)
rect(785, 792, 1055, 845, fill="bg", border="blue_border", radius=8)
rect(1075, 792, 1345, 845, fill="bg", border="blue_border", radius=8)
txt(520, 802, "DataCommandService", 17, latin_bold=True)
txt(520, 825, "导入、预览与数据任务", 14, color="muted")
txt(800, 802, "类型化计划校验", 17)
txt(800, 825, "build → graph → schema", 14, color="muted")
txt(1090, 802, "DuckDB 执行", 17)
txt(1090, 825, "输入 · 中间 · 输出表", 14, color="muted")
arrow([(765, 819), (785, 819)], color="blue")
arrow([(1055, 819), (1075, 819)], color="blue")
arrow([(925, 665), (925, 695), (610, 695), (610, 715)], color="green")
txt(962, 673, "Agent 数据工具", 14, color="muted")
txt(500, 681, "DataView IPC", 14, color="purple")

rect(485, 889, 1365, 993, fill="slate_fill", border="slate_border")
txt(505, 902, "本地状态与工作区", 19, color="blue")
txt(505, 936, "会话和数据元信息与实际表数据分开存储；工作区文件留在本机", 16, color="muted")
txt(505, 960, "SQLite：会话 / Trace / 元信息", 15)
txt(800, 960, "DuckDB：实际表数据", 15)
txt(1078, 960, "工作区文件：本机保存", 15)
arrow([(1210, 845), (1210, 889)], color="blue")


# RIGHT: system ingress is distinctly separate from local source files.
txt(1460, 166, "其他系统与本地数据源", 24, color="orange")
txt(1460, 205, "仅在启用或配置时发生交互", 16, color="muted")

rect(1455, 263, 1775, 380, fill="orange_fill", border="orange_border")
txt(1477, 279, "远程消息平台", 21, color="orange")
txt(1477, 319, "飞书 · 钉钉 · 企微 · Slack", 16)
txt(1477, 347, "鉴权 / 网关 → 本地会话", 15, color="muted")
arrow([(1455, 321), (1415, 321), (1415, 459), (1365, 459)], color="orange")

rect(1455, 507, 1775, 652, fill="orange_fill", border="orange_border")
txt(1477, 523, "可选模型与外部工具", 21, color="orange")
txt(1477, 563, "配置的模型 API / 账号服务", 16)
txt(1477, 591, "Ollama（可为本机服务）", 16)
txt(1477, 619, "MCP 服务 / GUI 操作 MCP", 15, color="muted")
arrow([(1365, 584), (1455, 584)], color="orange")

rect(1455, 718, 1775, 864, fill="orange_fill", border="orange_border")
txt(1477, 734, "本地数据源", 21, color="orange")
txt(1477, 775, "Csv / TSV、Excel (.xls/.xlsx)", 16)
txt(1477, 807, "及上述文件的文件夹", 16)
txt(1477, 834, "导入为数据工作台输入表", 15, color="muted")
arrow([(1455, 808), (1410, 808), (1410, 771), (1365, 771)], color="orange")

txt(1460, 907, "本地文件与外部 API 是两种来源", 16)
txt(1460, 936, "模型调用不等于云表上传", 16, color="muted")
txt(1460, 966, "远程 / 定时任务需要主机运行", 15, color="muted")


# Cross-column Csv import. Paths run in gutters so they never imply direct
# renderer-to-cloud or renderer-to-local-file access.
arrow([(385, 493), (426, 493), (426, 819), (485, 819)], color="blue")
badge(426, 599, "1", color="blue")
txt(80, 575, "1  云表 Csv 导入 → 本地输入表", 16, color="blue")


# Bottom results and optional cloud write-back. Output tables are native data
# workbench results; agent-created file deliverables are a separate path.
rect(55, 1039, 1795, 1192, fill="bg", border="slate_border", radius=14)
txt(80, 1053, "本地结果与可选数据闭环", 23, color="blue")
txt(80, 1096, "4  可选云表回写", 18, color="green")
txt(80, 1126, "输出表 Csv → CREATE / REPLACE", 16, color="muted")

rect(470, 1083, 988, 1155, fill="blue_fill", border="blue_border")
txt(493, 1095, "数据任务输出表（DuckDB）", 20, color="blue")
txt(493, 1126, "本地预览、复用；可显式上传为云表", 16, color="muted")
arrow([(1160, 993), (1160, 1025), (730, 1025), (730, 1083)], color="blue")
badge(1174, 1025, "3", color="blue")

rect(1021, 1083, 1775, 1155, fill="green_fill", border="green_border")
txt(1045, 1095, "Agent 与 Skills 的文件交付（并行能力）", 20, color="green")
txt(1045, 1126, "可创建 PPTX / DOCX / PDF / XLSX 等文件，不受数据表输出形式限制", 16, color="muted")

# A gutter/bottom-margin route makes the return direction visually explicit.
arrow([(650, 1155), (650, 1176), (35, 1176), (35, 319), (75, 319)], color="green")
badge(33, 1041, "4", color="green")

txt(58, 1200, "实线箭头＝当前实现的数据 / 请求方向；虚线框＝系统边界。旧图中的 FineBI Next 是历史场景，不等同于代码中的硬编码服务。", 12, color="muted")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT, format="PNG", optimize=True)
print(f"{OUTPUT}  ({canvas.width}×{canvas.height})")
