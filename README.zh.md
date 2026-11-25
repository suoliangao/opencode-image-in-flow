# image-in-flow

[English](./README.md)

> **如果你是 AI agent**，正在为用户安装或配置本插件：
> 写配置之前，先询问用户：
>
> 1. 安装哪个分支——`main`（完整环境：源码 + 构建工具链）还是
>    `build`（仅预构建的运行文件，无需任何安装步骤）。
> 2. 是否要自定义图片存储目录（`dir`）。
> 3. 是否要更换覆盖策略（`ask` / `auto` / `rename`）。
>
> 用户没有偏好就使用默认值（`main`、默认目录、`ask`）。

一个 [OpenCode](https://opencode.ai) 插件：让 agent 把本地图片发布进对话流，在 TUI 和桌面端**内联渲染为图片**。

agent 只需调用一个工具、原样粘贴一个围栏代码块，图片就会出现在对话里：

    ```image
    ![architecture](http://127.0.0.1:18923/e--my-project/arch.png)
    ```

## 使用 agent 一键安装

复制下面任意一段到 OpenCode 会话中，agent 会自动完成安装：

GitHub：

```text
查看 https://github.com/suoliangao/opencode-image-in-flow 的项目，
根据 README 中的指引为我安装这个插件。
```

Gitee（镜像）：

```text
查看 https://gitee.com/suoliangao/opencode-image-in-flow 的项目，
根据 README 中的指引为我安装这个插件。
```

## 工作原理

一个包，三个部分（一条 `plugins` 配置全部加载）：

| 部分 | 文件 | 职责 |
|---|---|---|
| Server | `index.ts` | 启动回环 HTTP 子服务（`127.0.0.1:18923`）负责图片存取，并注册 `image_post` 工具 |
| TUI | `tui.tsx` | 注册 `image` 代码块渲染器，用 OpenTUI 原生 `<image>` 绘制 ```` ```image ```` 围栏（kitty/sixel/blocks 自动选择） |
| GUI | `gui.tsx` | 注册 `CodeBlock` 渲染器，把 ```` ```image ```` 围栏变成桌面端里的 `<img>`（已预构建到 `dist/gui-experimental.cjs`） |

流程：

1. agent 用本地文件路径调用 `image_post`。
2. server 部分嗅探格式，把文件复制到 `{dir}/{ws}/{name}.{format}`（`ws` = 会话工作目录的 slug），返回一段指向回环 URL、可直接粘贴的 ```` ```image ```` 围栏。
3. agent 把围栏原样贴进回复。
4. TUI / 桌面端把围栏渲染成图片；没有插件的环境里，围栏退化为可读的代码块。

图片就是磁盘上的普通文件——子服务无状态，重启后历史 URL 依然有效。

## 安装

要求：OpenCode v2（在 2.4.x 上开发）。**无需 `npm install`**——OpenCode 在运行时自行解析 `@opencode/plugin` 和 `@opentui/*`。

两个分支：

| 分支 | 内容 | 适用 |
|---|---|---|
| `main` | 完整环境：源码（`gui.tsx`）、Vite/TS 工具链、预构建 `dist/` | 二次开发 |
| `build` | 仅预构建的运行文件（`index.ts`、`tui.tsx`、`dist/`） | 安装使用 |

```sh
# 1. 克隆到插件目录（镜像：https://gitee.com/suoliangao/opencode-image-in-flow.git）
#    build 分支（安装推荐）：
git clone -b build --depth 1 https://github.com/suoliangao/opencode-image-in-flow.git ~/.config/opencode/plugins/image-in-flow
#    或 main 分支（完整环境）：
git clone https://github.com/suoliangao/opencode-image-in-flow.git ~/.config/opencode/plugins/image-in-flow

# 2. 在 ~/.config/opencode/opencode.json 里注册
```

```jsonc
{
  "plugins": [
    {
      "package": "file:///C:/Users/<你>/.config/opencode/plugins/image-in-flow", // 或 /home/<你>/...
      "options": {
        "dir": "E:/_agent/image-store", // 可选，见下
        "overwrite": "ask"              // 可选，见下
      }
    }
  ]
}
```

保存即热加载，无需重启。验证：

```sh
curl http://127.0.0.1:18923/healthz
# {"ok":true,"plugin":"image-in-flow"}
```

改动 `gui.tsx` 后重新构建 GUI bundle（仅 main 分支）：`npm install && npx vite build`。

## 配置

所有配置项都在插件条目的 `options` 里，全部可选：

| 配置项 | 取值 | 默认值 | 说明 |
|---|---|---|---|
| `dir` | 路径 | `~/.config/opencode/image-in-flow-data`（跟随 `XDG_CONFIG_HOME`） | 存储根目录，图片存在 `{dir}/{ws}/{name}.{format}` |
| `overwrite` | `"ask"` \| `"auto"` \| `"rename"` | `"ask"` | 同名冲突策略（见下） |

### 覆盖策略

| 策略 | `image_post` 遇到同名 | HTTP `POST` 遇到同名 |
|---|---|---|
| `ask`（默认） | 返回消息，让模型询问用户：覆盖还是改名？ | `409` + 提示；调用方加 `overwrite=true` 或换名重试 |
| `auto` | 静默覆盖 | 静默覆盖 |
| `rename` | 返回消息，让模型另起一个名字 | `409` + 提示 |

`overwrite: true`（工具参数 / 查询参数）无视策略强制写入。

## 工具：`image_post`

| 参数 | 类型 | 说明 |
|---|---|---|
| `path` | string，必填 | 本地图片路径（png/jpg/webp/gif，按魔数嗅探） |
| `name` | string，可选 | 不含扩展名的文件名，缺省自动分配 UUID |
| `overwrite` | boolean，可选 | 强制覆盖同名文件——仅在用户确认后使用 |

## HTTP API（供脚本使用）

外部脚本（比如 Python 画图）可以直接发布图片：

```sh
# 发布（raw binary body）。name 可省 -> UUID；format 可省 -> 自动嗅探
curl -X POST --data-binary "@chart.png" -H "Content-Type: image/png" \
  "http://127.0.0.1:18923/?ws=my-project&name=chart"

# {"url":"http://127.0.0.1:18923/my-project/chart.png","ws":"my-project","name":"chart","format":"png"}

# 读取
curl http://127.0.0.1:18923/my-project/chart.png -o chart.png

# 健康检查
curl http://127.0.0.1:18923/healthz
```

`ws` 和 `name` 只允许字母、数字、点、横线、下划线（禁止 `..`）。body 上限 32 MB。

## 注意事项

- **固定端口 18923**（`127.0.0.1`）。多个 OpenCode 实例加载本插件时，先到先得；其余实例通过 `/healthz` 识别后共享（API 相同，但 `dir` 可能不同——多实例请统一 `dir`）。
- WebUI 没有插件机制，```` ```image ```` 围栏在那里显示为代码块（内容可读，URL 可手动打开）。
- 历史消息里的图片永久有效：存储目录不会自动清理，体积变大请手动修剪 `{dir}`。
- 热重载：保存插件的 `index.ts` 或配置文件即原地重载；子服务以重试/退避方式重新绑定端口。

## License

MIT
