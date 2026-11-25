// image-in-flow TUI part: render ```image fences as native images.
import { Plugin } from "@opencode/plugin/tui"
import { BoxRenderable, ImageRenderable, TextRenderable } from "@opentui/core"

const IMAGE_HEIGHT = 14

// Fence content is a standard markdown image line; a bare URL/path also works.
function extractImageRef(code: string): string | undefined {
  const line = code.trim()
  const md = line.match(/^!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)$/)
  if (md) return md[1]
  if (/^(https?:\/\/|file:\/\/|data:|\/|[a-zA-Z]:[\\/])/.test(line)) return line
  return undefined
}

export default Plugin.define({
  id: "image-in-flow",
  setup(ctx) {
    const renderer = ctx.renderer
    return ctx.markdown.registerCodeBlockRenderer("image", (block) => {
      const ref = extractImageRef(block.text)
      if (!ref) return undefined
      const box = new BoxRenderable(renderer, { width: "100%", height: IMAGE_HEIGHT, flexShrink: 0 })
      const image = new ImageRenderable(renderer, {
        source: ref,
        fit: "fit",
        protocol: "auto",
        width: "100%",
        height: "100%",
        onError: () => {
          if (box.isDestroyed) return
          image.destroyRecursively()
          box.add(new TextRenderable(renderer, { content: `[image] failed to load: ${ref}` }))
        },
      })
      box.add(image)
      return box
    })
  },
})
