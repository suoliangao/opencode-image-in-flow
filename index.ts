// image-in-flow server part: sub http server (GET/POST) + image_post tool.
// Storage: {dir}/{ws}/{name}.{format}; ws = slug of the session working directory.
import { Plugin } from "@opencode/plugin"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

const HOST = "127.0.0.1"
const PORT = 18923
const MAX_BYTES = 32 * 1024 * 1024

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

type OverwritePolicy = "auto" | "ask" | "rename"

// Same base as opencode's own config dir, so it follows XDG_CONFIG_HOME.
function defaultDir(): string {
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(config, "opencode", "image-in-flow-data")
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/:/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i
const validSegment = (s: string): boolean => SEGMENT.test(s) && !s.includes("..")

function sniffFormat(b: Buffer): string | undefined {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png"
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg"
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif"
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp"
  return undefined
}

function stripExt(name: string): string {
  return name.replace(/\.(png|jpe?g|webp|gif)$/i, "")
}

export default Plugin.define({
  id: "image-in-flow",
  async setup(ctx) {
    const options = ctx.options as { dir?: unknown; overwrite?: unknown }
    const dir = resolve(typeof options.dir === "string" && options.dir ? options.dir : defaultDir())
    const policy: OverwritePolicy =
      options.overwrite === "auto" || options.overwrite === "rename" ? options.overwrite : "ask"
    await mkdir(dir, { recursive: true })

    const snippetHint =
      "Paste the returned ```image fenced block verbatim into your reply - both TUI and GUI render it as an image."
    const snippet = (name: string, url: string): string => "```image\n![" + name + "](" + url + ")\n```"

    const baseUrl = `http://${HOST}:${PORT}`
    const target = (ws: string, name: string, format: string) => ({
      file: join(dir, ws, `${name}.${format}`),
      url: `${baseUrl}/${ws}/${name}.${format}`,
    })

    const json = (res: import("node:http").ServerResponse, status: number, body: unknown): void => {
      const data = Buffer.from(JSON.stringify(body))
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length })
      res.end(data)
    }

    const readBody = async (req: IncomingMessage): Promise<Buffer> => {
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of req) {
        const buf = chunk as Buffer
        total += buf.length
        if (total > MAX_BYTES) throw new Error("payload too large")
        chunks.push(buf)
      }
      return Buffer.concat(chunks)
    }

    const handleGet = async (url: URL, res: import("node:http").ServerResponse): Promise<void> => {
      if (url.pathname === "/healthz") return json(res, 200, { ok: true, plugin: "image-in-flow" })
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\.([a-z]+)$/i)
      if (!m) return json(res, 404, { error: "not_found" })
      const [, ws, name, ext] = m
      const format = ext.toLowerCase()
      if (!validSegment(ws) || !validSegment(name) || !MIME[format]) return json(res, 400, { error: "bad_request" })
      const file = join(dir, ws, `${name}.${format}`)
      if (!file.startsWith(dir + sep) || !existsSync(file)) return json(res, 404, { error: "not_found" })
      const data = await readFile(file)
      res.writeHead(200, {
        "content-type": MIME[format],
        "content-length": data.length,
        "cache-control": "no-cache",
      })
      res.end(data)
    }

    const handlePost = async (url: URL, req: IncomingMessage, res: import("node:http").ServerResponse): Promise<void> => {
      const ws = url.searchParams.get("ws") ?? ""
      let name = stripExt((url.searchParams.get("name") ?? "").trim())
      const overwrite = url.searchParams.get("overwrite") === "true"
      if (!validSegment(ws)) return json(res, 400, { error: "bad_request", message: "Invalid or missing ws." })
      if (name && !validSegment(name)) return json(res, 400, { error: "bad_request", message: "Invalid name." })

      let body: Buffer
      try {
        body = await readBody(req)
      } catch {
        return json(res, 413, { error: "too_large", message: `Body exceeds ${MAX_BYTES} bytes.` })
      }
      if (body.length === 0) return json(res, 400, { error: "bad_request", message: "Empty body." })

      const declared = (url.searchParams.get("format") ?? req.headers["content-type"]?.split("/")[1] ?? "")
        .toLowerCase()
        .replace("jpeg", "jpg")
      const format = sniffFormat(body) ?? (MIME[declared] ? declared : undefined)
      if (!format) return json(res, 415, { error: "unsupported_format", message: "Expected png/jpg/webp/gif." })

      if (!name) name = randomUUID()
      const { file, url: publicUrl } = target(ws, name, format)
      const exists = existsSync(file)
      if (exists && !overwrite && policy !== "auto") {
        return json(res, 409, {
          error: "conflict",
          name,
          hint: "Retry with overwrite=true or use a different name.",
        })
      }
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, body)
      json(res, 200, { url: publicUrl, ws, name, format, ...(exists ? { overwritten: true } : {}) })
    }

    // --- sub http server ---
    // Reload race: the old instance's port is not yet released when the new one binds,
    // so retry with backoff; share only when the occupant is another image-in-flow.
    let listening = false
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", baseUrl)
      const run =
        req.method === "GET" ? handleGet(url, res) : req.method === "POST" ? handlePost(url, req, res) : json(res, 405, { error: "method_not_allowed" })
      void Promise.resolve(run).catch((err) => json(res, 500, { error: "internal", message: String(err?.message ?? err) }))
    })

    const shared = async (): Promise<boolean> => {
      try {
        const r = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1000) })
        const d = (await r.json()) as { plugin?: string }
        return d?.plugin === "image-in-flow"
      } catch {
        return false
      }
    }

    const tryListen = (): Promise<boolean> =>
      new Promise((done) => {
        const onError = () => {
          server.removeListener("listening", onListening)
          done(false)
        }
        const onListening = () => {
          server.removeListener("error", onError)
          done(true)
        }
        server.once("error", onError)
        server.once("listening", onListening)
        server.listen(PORT, HOST)
      })

    for (let attempt = 0; attempt < 12 && !listening; attempt++) {
      listening = await tryListen()
      if (!listening && (await shared())) break // another instance serves the same API
      if (!listening) await new Promise((r) => setTimeout(r, 500))
    }
    if (!listening) console.error("[image-in-flow] could not bind 127.0.0.1:18923; endpoints unavailable")

    // --- agent tool ---
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "image_post",
        description:
          "Publish a local image to the image-in-flow server and display it inline in the conversation. " +
          snippetHint +
          " Args: path (local image file), name (optional, auto UUID when omitted), overwrite (force overwrite an existing name; use only after the user confirms).",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Local path of the image file (png/jpg/webp/gif)." },
            name: { type: "string", description: "File name without extension. Auto-generated UUID when omitted." },
            overwrite: {
              type: "boolean",
              description: "Force overwrite when the name already exists. Use only after the user confirms.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (raw, context) => {
          const input = raw as { path: string; name?: string; overwrite?: boolean }
          let bytes: Buffer
          try {
            bytes = await readFile(input.path)
          } catch {
            return { content: `Error: cannot read file: ${input.path}` }
          }
          const format = sniffFormat(bytes)
          if (!format) return { content: "Error: unsupported image format (expected png/jpg/webp/gif)." }

          let name = stripExt((input.name ?? "").trim())
          if (name && !validSegment(name))
            return { content: `Error: invalid name "${name}" (allowed: letters, digits, dot, dash, underscore).` }
          if (!name) name = randomUUID()

          const session = await ctx.session.get({ sessionID: context.sessionID }).catch(() => undefined)
          const directory =
            (session as { directory?: string } | undefined)?.directory ?? ctx.location?.directory ?? "unknown"
          const ws = slug(directory)

          const { file, url } = target(ws, name, format)
          const exists = existsSync(file)
          if (exists && !input.overwrite && policy !== "auto") {
            if (policy === "ask") {
              return {
                content: `"${name}.${format}" already exists. Ask the user: overwrite or rename? To overwrite, call again with overwrite: true; to rename, call again with a different name.`,
              }
            }
            return { content: `"${name}.${format}" already exists. Pick a different name and call again.` }
          }
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, bytes)
          return {
            content: `Published${exists ? " (overwrote existing)" : ""}: ${url}\n\n${snippetHint}\n\n${snippet(name, url)}`,
          }
        },
      })
    })

    return () => {
      if (listening) server.close()
    }
  },
})
