# GitHub 上传与协作

本工作区已经初始化为 Git 仓库，并通过 `.gitattributes` 将 PNG、Spine 骨骼、Unity bundle 和原生战斗数据交给 Git LFS 管理。

## 首次提交

在 PowerShell 中运行：

```powershell
Set-Location D:\ALHexNaval
git lfs install
git add .
git commit -m "Initial AL HEX NAVAL workspace"
git remote add origin https://github.com/GRAY-XY/ALHexNaval.git
git push -u origin main
```

如果 GitHub 仓库已经包含提交，先按该仓库的实际分支和合并方式处理，不要直接覆盖远端历史。

## 其他协作者

```powershell
git lfs install
git clone https://github.com/GRAY-XY/ALHexNaval.git
```

克隆后进入 `ALHexGame` 执行 `npm ci`、`npm run build`，然后运行 `启动海图.bat`。`dist/` 是本地构建输出，不纳入 Git。

## 日常开发

```powershell
git switch -c feature/功能名称
git add .
git commit -m "说明本次修改"
git push -u origin feature/功能名称
```

通过 GitHub Pull Request 合并到 `main`，避免多人直接修改同一分支。
