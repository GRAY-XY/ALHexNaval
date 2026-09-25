# AL HEX NAVAL 工作区

这个目录把游戏工程与完整的 AL 小人素材库放在同一个 Git 工作区，方便通过 GitHub 协作。

## 目录

- `ALHexGame/`：TypeScript / PixiJS 六角海战工程，包含当前游戏实际使用的12艘代表舰和战斗素材。
- `ALChibiAssets/`：完整小人、Spine、战斗贴图、索引与本地素材浏览器，用于后续扩充舰船和效果。
- `GitHub上传说明.md`：首次提交、Git LFS 和协作命令。

## 本地运行

直接运行 `ALHexGame/启动海图.bat`。需要重新构建时运行 `ALHexGame/重新构建海图.bat`。

从 GitHub 克隆的工作区不包含 `ALHexGame/dist/`。首次运行前，在 `ALHexGame/` 执行 `npm ci` 和 `npm run build`，之后再运行启动脚本。

素材库可运行 `ALChibiAssets/启动素材库.bat` 独立查看。

当前仓库不包含约4.8GB的原始提取中间目录 `ChibiAssets_20260917`，游戏和最终素材库均不需要它。只有重新从原始提取结果生成整个素材库时，才需要通过环境变量 `AL_CHIBI_EXTRACT_DIR` 指向该目录。

详细玩法、开发状态和验证记录见 `ALHexGame/README.md` 与 `ALHexGame/PLAN.md`。
