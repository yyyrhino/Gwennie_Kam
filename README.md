# Gwennie_Kam

金佐寧 Gwendoline Cho-ning Kam 的独立作品集网站，包含作品、媒体文章、关于页面与 Longlati 收藏委员会项目。

- [公开浏览网站](https://yyyrhino.github.io/Gwennie_Kam/)
- [作品目录](https://yyyrhino.github.io/Gwennie_Kam/work/)
- [Longlati 收藏委员会](https://yyyrhino.github.io/Gwennie_Kam/w06/)

浏览无需登录。图片、字体、三段视频及全部视频片段保存在仓库内。

## 本地预览

需要 Node.js，在仓库目录运行：

```text
node scripts/serve.cjs
```

打开 http://127.0.0.1:4187/。不需要安装依赖。

## 编辑与生成

修改 `content/<页面>.html`、页面样式 `content/<页面>.css`，以及 `content/pages.json` 中的页面信息。随后使用 Python 3 与 Node.js 生成：

```text
python scripts/build.py
node scripts/prepare-sites.cjs
```

GitHub Pages 工作流在每次推送到 `main` 后自动执行这两步，并仅发布生成的 `dist/`。也可在 Actions 中手动执行 Publish Gwennie_Kam。

作品详情沿用原 Readymag 网站的布局。手机版保留整体画布缩放。原站的 Readymag 平台追踪脚本没有复制。

素材属于相应艺术家与机构；藏品图片保留作品及作者署名，字体和播放器保留各自许可证。GitHub 上传不代表授予第三方素材的再使用授权。

来源参考：https://readymag.website/5653771
