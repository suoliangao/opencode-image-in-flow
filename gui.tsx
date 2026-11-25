// image-in-flow GUI part: render ```image fences as <img>.
import { CodeBlock, Plugin } from "@opencode/plugin/gui"

function extractImageRef(code: string): string | undefined {
  const line = code.trim()
  const md = line.match(/^!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)$/)
  if (md) return md[1]
  if (/^(https?:\/\/|file:\/\/|data:)/.test(line)) return line
  return undefined
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(CodeBlock, {
      languages: ["image"],
      render: (props) => {
        const url = extractImageRef(props.code)
        if (!url) return undefined
        return (
          <img
            src={url}
            alt=""
            style={{ "max-width": "100%", "max-height": "480px", display: "block", "border-radius": "4px" }}
          />
        )
      },
    })
  },
})
