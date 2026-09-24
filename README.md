# 液态玻璃 Liquid Glass

一个基于 **WebGL 着色器** 实现 iOS 26 / macOS "Liquid Glass"(液态玻璃)视觉效果的前端演示项目。

纯静态、零依赖、无需构建:一个 `index.html` + 一个 `liquid-glass.js`,打开即用。

玻璃内的画面不是 CSS 模糊,而是把**页面真实内容**(背景、文字、图片、渐变、甚至鼠标光标层)实时绘制到 2D Canvas 再作为纹理上传给 WebGL,由片元着色器完成 SDF 圆角形状、色散折射、动态光斑、边缘高光与抖动量化,因此滚动时能看到内容真实地"流动"穿过玻璃。

---

## 效果预览

| 折射内容 | 演示素材 |
| --- | --- |
| 页面内容、图片、文字经玻璃折射与色散 | `img/26-Tahoe-Beach-Day.png`、`img/iPhoneXSMaxGold.png` |

演示页包含:

- **浮动玻璃 Header**——可鼠标拖拽移动,可用左下角控制面板实时调整宽 / 高 / 圆角。
- **玻璃弹窗**——点击右下角按钮打开,观察内容穿过玻璃时的折射。
- **滚动折射**——滚动页面看背景、卡片、图片在玻璃中的色散变化。

## 核心特性

| 特性 | 说明 |
| --- | --- |
| **色散折射** | RGB 三通道以不同偏移量采样背景纹理,模拟光线穿过玻璃时的色散;偏移量随 `disp` / 玻璃半径变化。 |
| **SDF 距离场** | 用有符号距离场计算圆角矩形边缘与法线,得到准确的折射方向与边缘过渡。 |
| **动态光斑 (Orb)** | 5 个彩色光斑纹理随时间飘移,通过径向渐变叠加产生流动的光影。 |
| **Bayer 抖动** | 8×8 Bayer 矩阵 + `GRAD` 量化,在有限精度下消除色带,得到平滑渐变。 |
| **边缘高光 / 阴影** | 依据光照角度与距离计算内侧高光与外侧柔和阴影,形成玻璃厚度感。 |
| **DOM 内容镜像** | 递归读取真实元素盒模型、渐变、文字排版(逐字 `Range` 测量换行)与图片 `object-fit`,高保真还原到纹理。 |
| **多实例支持** | 一个着色器程序渲染多个玻璃宿主,按中心距离排序并限制最大实例数(桌面 64 / 移动 1)。 |
| **性能自适应** | 移动端或粗指针设备自动进入 lite 模式(降帧、降 DPR、限制实例数)。 |

## 快速开始

### 方式一:直接打开(功能受限)

直接双击 `index.html` 也能看到玻璃效果,但在 `file://` 协议下浏览器会污染 Canvas,项目会自动降级为**占位色块**而不是真实内容折射。

### 方式二:本地 HTTP 服务器(推荐,效果完整)

```bash
# Python 3
python -m http.server 8000

# 或 Node.js
npx serve .
```

然后访问 <http://localhost:8000>。

## 目录结构

```
liquid-glass/
├── index.html          # 演示页:样式、玻璃宿主结构、控制面板与拖拽逻辑
├── liquid-glass.js     # 核心:着色器 + DOM 采集 + WebGL 渲染循环
├── img/                # 演示图片素材
│   ├── 26-Tahoe-Beach-Day.png
│   └── iPhoneXSMaxGold.png
└── README.md
```

## 使用方式

在任意元素上放一个玻璃画布,并给宿主元素加上 `data-liquid-glass` 属性即可:

```html
<div class="my-glass" data-liquid-glass>
  <canvas class="liquid-glass-canvas" aria-hidden="true"></canvas>
  <!-- 玻璃内的正常 DOM 内容,会被折射显示 -->
</div>
```

```css
.my-glass {
  position: relative;
  border-radius: 24px;   /* 圆角会被读取为玻璃形状 */
  isolation: isolate;
}
.my-glass > .liquid-glass-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  border-radius: inherit;
  z-index: 1;            /* 内容放在 z-index 更高的层级 */
}
```

### 配置项

| 属性 / 事件 | 作用域 | 说明 |
| --- | --- | --- |
| `data-liquid-glass` | 宿主元素 | 标记该元素使用液态玻璃,`liquid-glass.js` 会自动查找其中的 `.liquid-glass-canvas`。 |
| `data-glass-blur` | 宿主元素 | 玻璃折射模糊半径(px),默认 `20`。 |
| `data-glass-alpha` | 宿主元素 | 玻璃整体不透明度倍数,默认 `1`。 |
| `data-glass-isolate="true"` | 宿主元素 | 隔离模式:只采集与宿主相交的内容,适合弹窗等悬浮面板。 |
| `data-glass-capture` | `<html>` | 采集范围选择器;`all` / `*` 表示全页面,也可写自定义选择器(如 `.hero *`)。 |
| `data-glass-backdrop="snapshot"` | `<html>` | 启用**快照背景**(见下);不写则使用默认的镜像重绘。任何失败都会自动回退并打印一条 info 日志。 |
| `data-theme="dark"` | `<html>` | 切换深色配色,影响背景色、阴影与光斑。 |
| `data-liquid-glass` 上的 `border-radius` | CSS | 决定玻璃圆角;高度的一半即为胶囊形。 |
| `pdaim:liquid-refresh` | 自定义事件 | 在 `document` 上派发该事件可强制刷新纹理缓存(动态增删内容后调用)。 |

计算样式、`MutationObserver` 与图片 / 字体的加载完成事件已自动处理大部分 DOM 变化;内容结构大改时可手动派发刷新事件。

### 两种背景来源

| | 镜像重绘(默认) | 快照背景 `data-glass-backdrop="snapshot"` |
| --- | --- | --- |
| 原理 | 读取计算样式,手工把盒模型 / 渐变 / 文字画到 2D Canvas | `foreignObject` 序列化静态内容,**交给浏览器自己渲染**成位图 |
| 覆盖范围 | 需要逐条实现 CSS 文字规范 | 伪元素(`::before/::after`)、渐变文字、`text-decoration`、`white-space`、`writing-mode`、逐角圆角、`box-shadow`、`filter`、`transform` 全部原生正确 |
| 代价 | — | 一次光栅化约 25ms(DPR 1),结构 / 尺寸 / 主题变化后防抖重建;滚动只做一次 blit |
| 自动回退 | — | CSS 不可读、CSS 含外链 `url()`、XML / 加载失败、快照被污染、纹理超 4096×8192 时自动回退 |

快照只负责**静态层**;图片、`<video>`、`<canvas>`、`position: fixed` 子树、文本选区、光标仍由覆盖层每帧绘制。踩过的三个 Chrome 坑(避免重复踩):必须用 `XMLSerializer`(否则 `<br>`/`<img>` 让整个 SVG 解析失败)、必须用 `data:` URL(用 `blob:` 会被判定跨源,canvas / WebGL 全读不了)、SVG 内不能有外链资源(会污染快照)。另外快照必须按**布局视口** `documentElement.clientWidth` 排版(用 `innerWidth` 会多算滚动条,居中内容整体偏移半个滚动条宽)。

## 技术原理简述

1. **背景纹理**——离屏 2D Canvas 按视口尺寸绘制:底色 → 模糊光晕 → 采集到的 DOM 盒模型 / 渐变 / 图片 / 文字 → 光标层;随后上传为 WebGL 纹理。
2. **顶点阶段**——全屏两个三角形,把像素坐标与纹理坐标传给片元着色器。
3. **片元阶段**——`sdRoundBox` 求有符号距离与法线 → `liquidRel` 计算折射率曲线 → 按折射率偏移量多次采样背景纹理,分别取 R / G / B 合成色散 → 计算边缘高光与外侧阴影 → Bayer 抖动 + 量化输出。
4. **渲染循环**——`requestAnimationFrame` 驱动,配合滚动 / 尺寸 / 内容签名比对,内容未变化时跳过重绘。

## 兼容性与性能

- 需要支持 **WebGL 1.0** 与 `backdrop-filter` 现代浏览器(Chrome / Edge / Safari / Firefox 近期版本)。
- 移动端(`max-width: 720px` 或 `pointer: coarse`)自动启用 lite 模式:约 24fps、DPR 上限 0.85、最多 1 个玻璃实例。
- 桌面端 DPR 上限 1.25,最多 64 个玻璃实例,超出部分按屏幕中心距离裁剪。
- 大尺寸玻璃 + 高 DPR 时片元着色器开销较高,可通过 `data-glass-blur`、实例数量与尺寸控制成本。

## 说明

- 本项目为效果研究与学习用途,`iPhone`、`Tahoe` 等为演示素材,相关商标与图片版权归原权利人所有。
- 仓库暂未附带开源许可证,如需商用或二次分发请先联系作者。

## 更新日志

- **文字排版修复**——`splitWrapUnits()` 之前只看"有没有空格",中西混排(如 `RGB 三通道…`)会把整段中文当成不可断行的单元,导致换行位置与浏览器不一致,超宽的行还会被 `fillText` 的 `maxWidth` 横向压扁。现在中文逐字断行、西文按单词断行,折行文本改走 `Range` 逐字测量还原浏览器真实行盒,并去掉 `maxWidth` 压缩。
- **文本选中态还原**——原生选区不在 DOM 也不在计算样式里(Chrome 的 `::selection` 默认值是 `transparent`),新增选区层用 `Range.getClientRects()` 取几何 + 系统高亮色(`Highlight` 系统色关键字),并在 `selectionchange` 时重绘。
- **新增快照背景**——`data-glass-backdrop="snapshot"` 让浏览器自己渲染静态层,解决伪元素 / 渐变文字 / 装饰线 / `white-space` / 阴影 / `transform` 等镜像重绘覆盖不到的 CSS;图片、视频、canvas、固定定位子树、选区、光标仍由覆盖层绘制,失败自动回退。
- **视频与普通 canvas**——不再被画成空盒子(`drawMediaElement`),播放中的视频会驱动背景重绘,玻璃里能跟着动。
- **修复:拖拽玻璃经过图片时不显示真实图片**——背景纹理的帧签名只覆盖滚动 / 尺寸 / 主题 / 配色,图片在首次绘制时若尚未加载完成,就会被 `drawImageFallback` 的占位图画进纹理并永久缓存。现在监听图片的 `load` / `error` 与 `document.fonts.ready`,资源异步到达后自动失效缓存并重绘。
- **初始版本**——液态玻璃 Header、玻璃弹窗、尺寸控制面板、拖拽移动、色散折射与 Bayer 抖动着色器。
