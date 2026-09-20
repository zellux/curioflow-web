# Save to Curioflow

轻量 Chrome / Chromium 扩展：点击工具栏图标自动保存当前网页，popup 显示保存成功，并提供「打开文章」。支持自定义服务器地址，不包含高亮功能。

## 安装与使用

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录（包含 `manifest.json`）。无需 npm 安装或构建。
3. 将 **Save to Curioflow** 固定到工具栏。点击图标 →「设置服务器地址」。
4. 填写服务根地址，例如 `https://reader.example.com` 或 `http://192.168.3.30:3000`，保存并允许访问该服务器。
5. 点击「打开 Curioflow 登录」，在同一 Chrome 用户配置中登录。
6. 回到要保存的网页，点击扩展图标（或 `Alt+Shift+S`）。保存成功后点击「打开文章」。快捷键可在 `chrome://extensions/shortcuts` 修改。

服务地址保存在本机扩展存储中。更换服务可通过 popup 的「设置」，或扩展详情页的「扩展程序选项」。如果服务使用反向代理 HTTP Basic Auth，也须先在浏览器中通过该验证。

## 行为与权限

- 使用已有的 `POST /api/urls` 和会话 Cookie，不需修改服务器、复制令牌或在扩展中保存密码。
- 仅发送当前页面 URL；正文由服务器抓取。需要网页登录才能访问的正文可能无法提取。API 确认入库后即显示成功，正文解析在后台进行。
- `activeTab` 用于用户点击时读取当前网页地址；`storage` 存储服务器配置。仅向用户选定的服务器申请主机权限，不自动读取浏览历史或注入页面脚本。
- 保存请求在 service worker 内执行，关闭 popup 不会主动取消请求。重复点击会合并正在进行的相同请求，后端负责 URL 去重；重新打开 popup 会再次向服务器确认保存。
- 请求超过 25 秒会提示无法确认结果，可重试。浏览器退出或 worker 被系统终止时不能保证请求完成。
- 未登录时提供登录入口；浏览器 Cookie 限制可能影响登录状态共享。网络错误、权限拒绝、无效响应均不会显示保存成功。
- 浏览器内部页、`file:` 等非 HTTP(S) 页面不能保存。

## 验证

在仓库根目录运行：

```sh
npm run test:extension
npm run typecheck
npm run lint
```

自动测试覆盖 API 请求和错误、地址校验、后台并发合并以及 popup 成功和登录跳转。发布前还需在真实 Chrome 中加载扩展验证首次授权、登录 Cookie、关闭 popup 后继续保存、重启浏览器和切换服务器。

参考：[Readwise 保存流程](https://docs.readwise.io/reader/docs/saving-content)、[Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[扩展 Cookie 行为](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。
