import { useRef, useEffect } from 'react'
import type { Artifact } from '../types'

interface Annotation {
  number: number
  x: number
  y: number
  label: string
}

interface Props {
  artifact: Artifact
}

function ImageSurface({ artifact }: { artifact: Artifact }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  let annotations: Annotation[] = []
  try {
    if (artifact.content) annotations = JSON.parse(artifact.content)
  } catch {}

  useEffect(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return

    function draw() {
      if (!img || !canvas) return
      canvas.width = img.offsetWidth
      canvas.height = img.offsetHeight
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const ann of annotations) {
        const cx = ann.x * canvas.width
        const cy = ann.y * canvas.height
        const r = 14

        // Circle
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = '#1d4ed8'
        ctx.fill()

        // Number
        ctx.fillStyle = 'white'
        ctx.font = 'bold 13px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(ann.number), cx, cy)

        // Label
        if (ann.label) {
          ctx.font = '11px system-ui, sans-serif'
          const m = ctx.measureText(ann.label)
          const pad = 5
          const onRight = ann.x <= 0.65
          const boxX = onRight ? cx + r + 8 : cx - r - 8 - m.width - pad * 2
          const textX = onRight ? boxX + pad : boxX + m.width + pad

          ctx.fillStyle = 'rgba(0,0,0,0.72)'
          ctx.beginPath()
          ctx.roundRect(boxX, cy - 11, m.width + pad * 2, 22, 4)
          ctx.fill()

          ctx.fillStyle = 'white'
          ctx.textAlign = onRight ? 'left' : 'right'
          ctx.textBaseline = 'middle'
          ctx.fillText(ann.label, textX, cy)
        }
      }
    }

    if (img.complete) draw()
    else img.addEventListener('load', draw)
    return () => img.removeEventListener('load', draw)
  }, [artifact])

  // Normalize page numbers — Claude may zero-pad (page_024) but files are page_24
  const src = artifact.src?.replace(/page_0*(\d+)\.png/, 'page_$1.png')

  return (
    <div className="h-full flex flex-col">
      {artifact.title && (
        <div className="text-sm font-medium text-gray-500 mb-2">{artifact.title}</div>
      )}
      <div className="flex-1 overflow-auto flex items-start justify-center p-2">
        <div className="relative inline-block">
          <img
            ref={imgRef}
            src={src}
            alt={artifact.title}
            className="max-w-full block"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
          />
        </div>
      </div>
    </div>
  )
}

export function ArtifactPanel({ artifact }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    function handleLoad() {
      iframe!.contentWindow?.postMessage(
        { type: 'RENDER_ARTIFACT', content: artifact.content, artifactType: artifact.type },
        '*'
      )
    }

    iframe.addEventListener('load', handleLoad)
    return () => iframe.removeEventListener('load', handleLoad)
  }, [artifact])

  if (artifact.type === 'image/surface') {
    return <ImageSurface artifact={artifact} />
  }

  if (artifact.type === 'application/vnd.ant.code') {
    return (
      <div className="h-full flex flex-col">
        {artifact.title && <div className="text-sm font-medium text-gray-500 mb-2">{artifact.title}</div>}
        <pre className="flex-1 overflow-auto p-4 bg-gray-50 rounded text-sm font-mono m-0"><code>{artifact.content}</code></pre>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {artifact.title && <div className="text-sm font-medium text-gray-500 mb-2">{artifact.title}</div>}
      <iframe
        ref={iframeRef}
        src="/artifact-sandbox.html"
        sandbox="allow-scripts"
        title={artifact.title || 'Artifact'}
        className="flex-1 w-full border-0"
      />
    </div>
  )
}
