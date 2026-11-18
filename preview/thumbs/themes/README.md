# 多主题插画

2026-11-18 起启用三套房间主题：`pokemon`、`pixel`、`immortal`。
`royal` 只保留为大厅与未知主题回退，不再出现在建房选择中；`ai` 停用，
但保留 `ai.jpg` 供后续恢复。

## 当前图集

- `pokemon.jpg`：432×432，3×3，每格 144px。皮卡丘、妙蛙种子、杰尼龟、小火龙、伊布、可达鸭、卡比兽、快龙、耿鬼。
- `pixel.jpg`：576×432，4×3，每格 144px。前 9 格沿用红白机像素图集；新增第 10–12 格为森林猎手、迷宫法师、机械飞龙。
- `immortal.jpg`：576×432，4×3，每格 144px。韩立、南宫婉、紫灵、银月、乐上师、仲神师、元瑶、啼魂、慕沛灵、宋玉、梅凝、董萱儿。

`cyberpunk.jpg` 与 `ai.jpg` 仅作为停用主题的历史素材保留，不进入当前构建。

## 凡人修仙传 Q版图集

最终版按用户确认改为 2D Q版。此前“真人 / 官方截帧”方案因 144px 下缩图发糊而废弃，
不再作为当前素材。

- 12 张 1024×1024 角色立绘由 9Router `ag/gemini-3.1-flash-image` 生成；统一提示词为 2D chibi sticker、粗描边、平涂、大头小身、淡紫背景、无文字 / 水印。
- 生成顺序（也是牌库顺序）：韩立、南宫婉、紫灵、银月、乐上师、仲神师、元瑶、啼魂、慕沛灵、宋玉、梅凝、董萱儿。
- 工程外脚本按固定方形裁切后合成 `immortal.jpg`（576×432，4×3，每格 144px）；JPEG quality 65、4:2:0、`optimize=True`，成品 59844 字节。
- 角色 IP 归原作；Q版立绘为本项目生成的主题演绎，仅用于主题演示。早期写实二创 / 官方截帧来源不再使用，仅保留在 git 历史中。

## 压缩与构建

- 全部图集统一为每格 144px；`pixel` / `immortal` 为 4×3、576×432。
- `pixel` JPEG quality 52；`immortal` quality 65；均使用 4:2:0、`optimize=True`，避免主包 base64 内联后超过 2MiB。
- `preview/theme-art.js` 将图集一次性内嵌到各主题的独立样式文件，再通过背景位置映射到卡牌、贵族、头像和主题预览。
- `preview/prepare-theme-art.py` 继续处理 `pixel` 等规则网格；`immortal` 的最终合成使用工程外脚本 `build_qatlas.py` 按 12 个裁切框完成，源图与脚本不进入主包。

常规构建：

```sh
node preview/art.js
node preview/build.js
```

仅重建图集样式时：

```sh
uv run --with pillow python preview/prepare-theme-art.py SOURCE_DIRECTORY pixel immortal
```
