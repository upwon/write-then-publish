# 手机上编辑框末尾内容被预览区盖住

## 背景

用户反馈：在手机浏览器里打开写了就发，粘贴或输入一篇较长的正文后，编辑框
"一直往下滑，但滑不到最下面"，导致最后一部分内容既看不见也没法把光标定位
上去继续编辑。截图显示编辑框停在某一行（例如"……转"字）就再也滑不下去，
但没有弹出手机键盘——排除了"键盘挡住输入框"这个最直觉的猜测。

## 排查过程（含两次错误方向）

### 第一次尝试：怀疑 viewport meta 没声明键盘行为（错误）

`.editor-panel` 在移动端用 `78vh` / `78dvh` 固定高度，而 viewport meta 标签
没有声明 `interactive-widget`。部分浏览器在键盘弹出时默认只收缩"视觉视口"
（`window.visualViewport`），不收缩布局视口（`dvh` 依据的正是布局视口），
理论上会导致编辑框底部被键盘盖住。于是加了：

```html
<meta name="viewport" content="... interactive-widget=resizes-content" />
```

用户实测后反馈依然复现，且**截图里根本没有弹出键盘**——说明这个方向从一
开始就没有命中真正的场景。

### 第二次尝试：怀疑 `body` 外壳没跟着可见高度收缩（不完整）

进一步发现整个应用外壳 `body` 本身也是 `height: 100vh; height: 100dvh;
overflow: hidden;`，怀疑这层最外层容器在某些移动端浏览器（尤其是国产定制
内核）上不会正确避让键盘/地址栏，导致外壳比实际可见区域高，底部内容被
物理遮挡却显示"已经到底"。于是引入了一个用 `window.visualViewport` 实测
高度维护的 CSS 变量 `--app-vh`，键盘/地址栏变化时通过 `resize` 事件重算，
不依赖浏览器对 `dvh` / `interactive-widget` 的支持程度。

用 Playwright 模拟"可见高度收缩 300px"这个场景验证过 `--app-vh` 确实会
同步更新、`body` 高度也确实跟着收缩——但这只证明了"外壳能响应可见高度变化"，
**没有验证用户实际复现的场景**（用户的截图里没有键盘）。用户再次反馈依然
复现，并且明确指出"你自己去试试""改了要验证"。

### 第三次：不再猜，直接用 Playwright 复现真实症状

放弃"键盘导致视口计算错误"这条线，改用 Playwright 在移动端 viewport 下
真实打开部署好的线上页面，填入一篇几十段的长文，用 Chrome DevTools
Protocol 的 `Input.synthesizeScrollGesture` 合成**真实触摸滚动手势**
（而不是用 JS 直接设置 `scrollTop`），逐次滑动后读取
`textarea.scrollTop` / `scrollHeight` / `clientHeight`。

结果：`textarea` 自己的 `scrollTop` 很快就顶到了 `scrollHeight -
clientHeight`（浏览器认为"已经到底"），但同时发现 `.editor-panel` 的
`scrollHeight`（629px）比它的实际渲染高度（567px）大了 62px，且
`.editor-panel` 的 `overflow-y` 计算值是 `visible`。

进一步用 `document.elementFromPoint` 对文本框底部往上做逐像素命中测试
（这是能直接证伪"到底了但看不到"这个悖论的关键手段）：

| 距文本框底部 | 实际命中的元素 |
|---|---|
| 5px | `#statusText`（预览区状态文字） |
| 20px | 预览区标题所在 `div` |
| 40px | 预览区 `h2` |
| 60px | `.preview-topbar` |
| 80px 以上 | `#contentInput`（文本框本身） |

**证据确凿**：文本框底部大约 62～80px 的区域，鼠标/手指点上去命中的根本
不是文本框，而是紧挨着的"预览与下载"区块。也就是说文本框本身的滚动没有
问题，问题是它最后几行文字**被相邻的兄弟元素盖住了**，滚动条显示"到底"
也没有意义——因为被遮住的内容原本就不属于可滚动区域，滚多少次都不会露出来。

## 根因

`.editor-panel`（移动端 `max-width: 680px` 断点）被锁死为固定高度
`78vh`/`78dvh`，但它内部实际需要的高度更高：

- `.brand-row`（头像、昵称等信息行）约 190px
- `.editor-controls`（工具栏，窄屏下会折成两行）约 145px
- `#contentInput`（文本框，CSS 设了 `min-height`）至少 260px
- 加上 padding、gap

几项加起来的最小高度会超过 `78vh` 算出来的面板高度（差值随屏幕尺寸从
十几像素到六十多像素不等）。而 `.editor-panel` 自身没有设置
`overflow`，计算值是默认的 `visible`——多出来的部分不会被裁剪，而是
正常地溢出到 `.editor-panel` 的可视边界之外，被 CSS 网格里排在下一行的
`.preview-panel`（预览与下载区）**在视觉上覆盖绘制**。

另外还有一个独立的隐藏坑：`@media (max-width: 620px)` 里还有一条更靠后的
`.editor-panel { height: 78vh; min-height: 560px; }` 规则，覆盖了
`680px` 断点里写的所有内容（包括第一、二次尝试加的 `dvh` / `--app-vh`）。
用户的手机宽度恰好落在这个更窄的断点里，所以前两次修复对他来说是完全不
生效的死代码——这也是"改了要验证"这条反馈里最该被吸取的教训：**没有在
命中真实断点的尺寸下重新跑一遍验证，就不能认为修复生效**。

## 修复

1. `.editor-panel` 在两个移动端断点（`680px`、`620px`）下都加上
   `overflow-y: auto`，让面板自身在内容溢出时可以滚动，露出原本被遮挡的
   末尾内容，而不是任由其溢出并被兄弟元素盖住。
2. `620px` 断点下的 `.editor-panel` 高度补上 `--app-vh` 变量兜底，与
   `680px` 断点保持一致，避免同一段 CSS 出现"改了但被更靠后的规则覆盖"
   的情况。

对应改动文件：`src/styles.css`（`.editor-panel` 相关规则）。此前两次尝试
引入的 `interactive-widget=resizes-content`（`index.html`）和
`--app-vh` 机制（`index.html` + `src/styles.css`）予以保留——它们本身没
有副作用，只是不足以解决这个具体症状，作为通用的移动端视口健壮性改进
继续留着。

## 验证方法

验证脚本基于仓库自带的 `cli/`（Playwright 自动化导出工具）搭建，核心手段：

1. **多尺寸命中测试**：在 320×568 / 360×640 / 375×667 / 393×420（模拟
   矮视口）/ 393×727 / 412×780 六种视口下，填入长文后用
   `document.elementFromPoint` 对文本框底部逐像素探测，统计"点到的不是
   文本框本身"的像素数，确认修复后六种尺寸下均为 0。
2. **真实触摸手势**：用 CDP 的 `Input.synthesizeScrollGesture`（
   `gestureSourceType: "touch"`）在文本框内合成真实的手指滑动，而不是
   直接赋值 `scrollTop`，避免验证结果与用户实际操作方式脱节。
3. **候选方案对比测试**：在下结论前，并列测试了"调小文本框
   `min-height`""让文本框 `flex-basis` 改为 `auto`""面板整体不设高度按
   内容撑开"等几种方案，在同一组视口尺寸下批量跑一遍，用数据淘汰了效果
   不彻底的方案，最终选定"面板自身可滚动"这一种在所有尺寸下都通过的方案。
4. **回归检查**：确认 `overflow-y: auto` 不会裁剪同一面板内工具栏的
   `absolute` 定位下拉浮层（`.tool-popover`）。
5. **端到端截图**：滑动到底后截图确认文末标记文字完整可见、未被裁切。

## 相关文件

- `index.html`：viewport meta 的 `interactive-widget`、`--app-vh`
  同步脚本。
- `src/styles.css`：`body`、`.editor-panel`（`680px` 与 `620px` 两个
  断点）、`.crop-stage`（裁剪弹窗的类似遮挡问题，同一批修复中一并处理）。
- `cli/`：验证过程中复用的 Playwright 自动化工具，未来排查类似移动端
  布局问题可以参考同样的"多尺寸 + 命中测试 + 真实触摸手势"方法论。
