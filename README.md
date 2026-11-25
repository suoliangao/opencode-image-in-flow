# image-in-flow

[中文](./README.zh.md)

> **If you are an AI agent** installing or configuring this plugin for a user:
> before writing the config, ask the user:
>
> 1. Which branch to install from — `main` (full environment: source + build
>    toolchain) or `build` (prebuilt runtime files only, nothing to install).
> 2. Whether they want a custom image storage directory (`dir`).
> 3. Whether they want a different overwrite policy (`ask` / `auto` / `rename`).
>
> Use the defaults (`main`, default dir, `ask`) if they have no preference.

An [OpenCode](https://opencode.ai) plugin that lets the agent publish local images into the conversation flow, rendered **inline as images** in the TUI and the desktop app.

The agent calls one tool, pastes one fenced block, and the image shows up in the chat:

    ```image
    ![architecture](http://127.0.0.1:18923/e--my-project/arch.png)
    ```

## Quick install with agent

Copy one of these blocks into an OpenCode session and the agent does the rest:

GitHub:

```text
Check out the project at https://github.com/suoliangao/opencode-image-in-flow
and install the plugin for me following its README.
```

Gitee (mirror):

```text
Check out the project at https://gitee.com/suoliangao/opencode-image-in-flow
and install the plugin for me following its README.
```

## How it works

One package, three parts (all loaded from a single `plugins` entry):

| Part | File | What it does |
|---|---|---|
| Server | `index.ts` | Starts a loopback HTTP sub-server (`127.0.0.1:18923`) for image storage/serving, and registers the `image_post` tool |
| TUI | `tui.tsx` | Registers an `image` code-block renderer that draws ```` ```image ```` fences with OpenTUI's native `<image>` (kitty/sixel/blocks auto) |
| GUI | `gui.tsx` | Registers a `CodeBlock` renderer that turns ```` ```image ```` fences into `<img>` in the desktop app (prebuilt to `dist/gui-experimental.cjs`) |

Flow:

1. The agent calls `image_post` with a local file path.
2. The server part sniffs the format, copies the file to `{dir}/{ws}/{name}.{format}` (`ws` = slug of the session's working directory), and returns a ready-to-paste ```` ```image ```` fence pointing at the loopback URL.
3. The agent pastes the fence verbatim into its reply.
4. TUI / desktop render the fence as an image. Without the plugins, the fence degrades to a readable code block.

Images are plain files on disk — the server is stateless, so URLs keep working across restarts.

## Install

Requires: OpenCode v2 (developed on 2.4.x). No `npm install` needed — OpenCode resolves `@opencode/plugin` and `@opentui/*` at runtime.

Two branches:

| Branch | Contents | For |
|---|---|---|
| `main` | Full environment: source (`gui.tsx`), Vite/TS toolchain, prebuilt `dist/` | Hacking on the plugin |
| `build` | Prebuilt runtime files only (`index.ts`, `tui.tsx`, `dist/`) | Installing |

```sh
# 1. Clone into the plugins directory (mirror: https://gitee.com/suoliangao/opencode-image-in-flow.git)
#    build branch (recommended for install):
git clone -b build --depth 1 https://github.com/suoliangao/opencode-image-in-flow.git ~/.config/opencode/plugins/image-in-flow
#    or main branch (full environment):
git clone https://github.com/suoliangao/opencode-image-in-flow.git ~/.config/opencode/plugins/image-in-flow

# 2. Register in ~/.config/opencode/opencode.json
```

```jsonc
{
  "plugins": [
    {
      "package": "file:///C:/Users/<you>/.config/opencode/plugins/image-in-flow", // or /home/<you>/...
      "options": {
        "dir": "E:/_agent/image-store", // optional, see below
        "overwrite": "ask"              // optional, see below
      }
    }
  ]
}
```

Save the file — OpenCode hot-reloads plugins, no restart needed. Verify:

```sh
curl http://127.0.0.1:18923/healthz
# {"ok":true,"plugin":"image-in-flow"}
```

To rebuild the GUI bundle after editing `gui.tsx` (main branch only): `npm install && npx vite build`.

## Configuration

All options go in the plugin entry's `options` object. Everything is optional:

| Option | Values | Default | Description |
|---|---|---|---|
| `dir` | path | `~/.config/opencode/image-in-flow-data` (follows `XDG_CONFIG_HOME`) | Storage root. Images live at `{dir}/{ws}/{name}.{format}` |
| `overwrite` | `"ask"` \| `"auto"` \| `"rename"` | `"ask"` | Conflict policy when a name already exists (see below) |

### Overwrite policy

| Policy | `image_post` on name conflict | HTTP `POST` on name conflict |
|---|---|---|
| `ask` (default) | Returns a message telling the model to ask the user: overwrite or rename? | `409` + hint; caller retries with `overwrite=true` or a new name |
| `auto` | Overwrites silently | Overwrites silently |
| `rename` | Returns a message telling the model to pick a different name | `409` + hint |

`overwrite: true` (tool arg / query param) always forces the write, regardless of policy.

## Tool: `image_post`

| Arg | Type | Description |
|---|---|---|
| `path` | string, required | Local image file (png/jpg/webp/gif, sniffed by magic bytes) |
| `name` | string, optional | File name without extension. Auto UUID when omitted |
| `overwrite` | boolean, optional | Force overwrite an existing name — only after the user confirms |

## HTTP API (for scripts)

External scripts can publish images directly, e.g. a chart generated by Python:

```sh
# Publish (raw binary body). name optional -> UUID. format optional -> sniffed.
curl -X POST --data-binary "@chart.png" -H "Content-Type: image/png" \
  "http://127.0.0.1:18923/?ws=my-project&name=chart"

# {"url":"http://127.0.0.1:18923/my-project/chart.png","ws":"my-project","name":"chart","format":"png"}

# Fetch
curl http://127.0.0.1:18923/my-project/chart.png -o chart.png

# Health
curl http://127.0.0.1:18923/healthz
```

`ws` and `name` accept letters, digits, dot, dash, underscore (no `..`). Max body 32 MB.

## Notes & limitations

- **Fixed port 18923** on `127.0.0.1`. When several OpenCode instances load the plugin, the first binds the port and the rest detect it via `/healthz` and share it (same API, possibly different `dir` — set the same `dir` everywhere if you run multiple instances).
- The Web UI has no plugin mechanism, so ```` ```image ```` fences show as code blocks there (readable, and the URL can be opened manually).
- Historical messages keep rendering: stored files are never cleaned up automatically — prune `{dir}` by hand if it grows.
- Hot reload: saving the plugin's `index.ts` or the config reloads it in place; the sub-server rebinds with retry/backoff.

## License

MIT
