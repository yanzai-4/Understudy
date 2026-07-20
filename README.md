# Understudy — AI 短剧控制信号平台

从真实拍摄的粗糙视频中提取 2D 控制信号（pose / depth / canny），配合导演设定的摄影参数生成结构化英文 prompt，打包导出为可直接喂给可控 AI 视频模型（ComfyUI Wan Fun-Control / VACE / LTX-2 或商业平台）的引导材料包。

**核心理念：结构和运动从素材提取，美学和风格由导演设定。**

## 快速开始

### Windows

```powershell
# 首次安装（需要本机已装 Python 3.11 于 C:\Python311）
scripts\setup.ps1
```

之后**双击根目录的 `Understudy.exe`** 即可启动：平台在一个独立的原生窗口中打开
（基于 Windows 自带的 WebView2，不依赖 Chrome）。服务和窗口在同一个进程里，
**关闭窗口即彻底退出**（服务一起停，不留后台进程）。

备用方式：

```powershell
scripts\run.ps1              # 浏览器 + 控制台方式启动（可看日志）
scripts\dev.ps1              # 开发模式（后端热重载 + 前端 HMR，访问 http://localhost:5173）
scripts\build_launcher.ps1   # 重新编译 Understudy.exe（用 Windows 自带 .NET 编译器，无需额外工具）
```

### macOS（Apple 芯片 / Intel）

```bash
# 首次安装（需要 Python 3.11 与 Node.js；brew install python@3.11 node）
bash scripts/mac/setup.sh
bash scripts/mac/build_app.sh   # 生成根目录的 Understudy.app（含图标）
```

之后**双击根目录的 `Understudy.app`** 即可启动：在原生窗口（WKWebView）中打开，
Dock 有图标、不弹终端。同样是单进程，关闭窗口即彻底退出。本地构建的 `.app`
不会触发 Gatekeeper 隔离，无需签名。

备用方式：

```bash
bash scripts/mac/run.sh   # 浏览器 + 控制台方式启动（可看日志）
bash scripts/mac/dev.sh   # 开发模式（后端热重载 + 前端 HMR，访问 http://localhost:5173）
```

推理后端：Apple 芯片默认启用 **CoreML**（GPU/神经引擎加速深度估计），CPU 兜底；
在「设置 → 推理后端」可随时切换，**即时生效、无需重启**（CoreML 与 CPU 同在一个
onnxruntime 轮子里）。

窗口式入口都是 [backend/desktop.py](backend/desktop.py)（pywebview → Windows 用
WebView2、macOS 用 WKWebView）；`Understudy.exe` / `Understudy.app` 只是启动它的轻量壳。

## 组织结构

- **电影（Film）**：顶层作品，含风格预设（新镜头继承默认摄影参数）
- **镜头（Shot）**：归属电影，带场景号 / 版本号 / 标签 / 选用标记（circle take），走完整流水线：
  上传视频 → 提取控制信号 → 预览与背景标注 → 摄影参数表单 → 生成 prompt 并导出
- **复制为新版本**：镜头可一键复制（连提取产物一起），改参数/prompt 直接导出，无需重新提取

## 导出包

`<电影>_S<场景>_<镜头>_V<版本>_<时间戳>.zip`，内含：
- `prompt.txt` / `prompt_negative.txt` — 可直接粘贴的英文提示词
- `pose/ depth/ canny/` — 控制信号 PNG 序列 + `pose/keypoints.json` 骨架坐标
- `video/` — 同内容 H.264 mp4（便于上传网页版生成平台）
- `frames/` — 降采样原帧（VACE 参考帧 / 图生视频首帧）
- `masks/` — 背景改动遮罩（两种分辨率）+ 改动意图 JSON
- `metadata.json` + 双语 `README.txt` 使用指南

## 测试

```powershell
.venv\Scripts\python.exe -m pytest backend\tests -q
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + Vite + TypeScript + Tailwind CSS v4（深蓝黑主题，中英双语） |
| 后端 | FastAPI（Python 3.11）+ SQLite + 文件系统资产 |
| pose | rtmlib（RTMPose ONNX，OpenPose 风格骨架） |
| depth | Depth Anything V2 small（ONNX int8） |
| canny | OpenCV |
| 推理 | onnxruntime（CPU 通用；Windows 可选 DirectML，macOS 可选 CoreML） |

## 目录说明

- `backend/` — FastAPI 应用（api / services / extractors）
- `frontend/` — React SPA
- `data/` — 运行时数据（SQLite + 各镜头资产），不入 git
- `models/` — 模型缓存，不入 git
- `scripts/` — 安装与启动脚本（Windows 用 `*.ps1`，macOS 用 `scripts/mac/*.sh`）
