# CardiacCycle 3D · 微信小程序

心动周期教学模型 [kuaiyu.site/cardiac_cycle](https://www.kuaiyu.site/cardiac_cycle/) 的微信小程序版。小程序直接运行网站本身的代码：生理模型、二维心脏、同步曲线和三维心脏都与网站同源，只外加一层小程序适配。

## 目录结构

| 路径 | 内容 | 来源 |
|---|---|---|
| `pages/lab/` | 唯一页面（布局按网站手机版重建） | 手写 |
| `engine/` | 网站的模型、二维心脏 `heart2d.js`、曲线 `charts.js` | `tools/sync-from-web.mjs` 复制，**勿手改** |
| `engine/mp-dom.js`、`engine/svg-canvas.js` | DOM 替身、SVG→canvas 绘制器 | 手写 |
| `data/` | 网站 `content/` 的 JSON 转成的 JS 模块 | `tools/sync-from-web.mjs` 生成，**勿手改** |
| `vendor/atlas3d.js`、`vendor/atlas-asset.js` | 网站三维心脏 + three.js 打包 | `tools/build-vendor.mjs` 生成，**勿手改** |
| `vendor/atlas-shim.js` | 三维心脏的浏览器替身 | 手写 |

三维心脏模型（约 2.3 MB）不在包里，首次使用时从 kuaiyu.site 下载并缓存在手机上。

## 从网站同步

网站仓库默认放在本目录的 `../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle`；在别处时，把路径作为参数传给下面两个脚本。需要 Node.js 18+，网站目录里已执行过 `npm install`。

1. 同步模型、二维心脏、曲线和文案（网站 `content/`、`js/` 更新后执行）：

   ```bash
   node tools/sync-from-web.mjs
   ```

2. 重新打包三维心脏（网站三维相关代码或模型更新后执行）。先在网站目录执行 `npm run build`，脚本要从网站的 `dist/` 读取模型文件名：

   ```bash
   node tools/build-vendor.mjs
   ```

   模型文件名带哈希，网站重新部署后若模型变了，必须重跑这一步，否则小程序会下载旧地址而失败。

## 编译与预览

1. 用微信开发者工具打开本目录（AppID 已在 `project.config.json`）。
2. 点「编译」。`vendor/` 已在 `project.config.json` 中排除 Babel 转译，`tools/` 不打包上传。
3. 开发阶段需在「详情 → 本地设置」勾选「不校验合法域名」，否则无法下载三维模型。
4. 模拟器里 canvas 会画在其他内容之上、也不受滚动区裁剪（开发者工具的已知差异）。重叠与三维效果请以「真机调试」或「预览」扫码为准。

## 发布前

- 小程序后台「开发管理 → 开发设置 → 服务器域名」的 **request 合法域名** 加上 `https://www.kuaiyu.site`。
- 「设置 → 服务内容声明 → 用户隐私保护指引」勾选 **剪切板**（帮助窗口里的复制邮箱 / 网址用到）。
- 主包须小于 2 MB（目前约 1.4 MB）。

## 与网站的差异

- 去掉了顶部标题与介绍、小测、临床联系、外链和行为统计；作者信息只在「?」帮助窗口底部。
- 默认二维心脏；三维心脏选中后始终固定在顶部（只有一块 WebGL 画布）。
- 三维运动计算按耗时自动降频，拖动旋转时暂停变形；每拍相同的情景换拍时不重算曲线。

## 许可

MIT，见 [LICENSE](LICENSE)。心脏网格来自 Z-Anatomy / BodyParts3D（CC BY-SA），已修改，详见网站说明。
