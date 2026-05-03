# 下载平台凭证配置

该文件用于按平台管理下载登录态。当前支持的平台：

- `bilibili`
- `youtube`
- `douyin`
- `tiktok`

每个平台可配置两种输入：

- `cookiesFilePath`
- `cookiesFromBrowser`

运行时优先级：

1. 平台级 `cookiesFilePath`
2. 平台级 `cookiesFromBrowser`
3. 请求级 `cookiesFilePath`
4. 请求级 `cookiesFromBrowser`
5. 配置文件 `global.cookiesFilePath`
6. 配置文件 `global.cookiesFromBrowser`

建议：

- `bilibili`、`douyin`、`tiktok` 优先填 `cookies.txt`
- `youtube` 只有在年龄限制、会员或受限格式场景下再补登录态
