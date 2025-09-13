# core-template

打包用模板（模块级），包含 `app/` 目录。使用方式：

1. 将本目录下的 `app/` 覆盖（或拷贝）到你的打包仓库 `Packaging-warehouse/app/`。
2. 提交代码，触发 GitHub Actions 自动打包。
3. 产物 APK 位于 Actions artifacts 或 `app/build/outputs/apk/...`。

注意：本模板内含 `app/build.gradle` 与 `src/main/AndroidManifest.xml`，
若你的打包仓库也有同名文件，请以模板版本为准或合并配置。