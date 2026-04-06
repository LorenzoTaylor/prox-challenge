import { useRef, useEffect, useState } from 'react'
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
    // Only annotate user-uploaded images (data URLs), not surfaced page images
    const isUpload = artifact.src?.startsWith('data:')
    if (!img || !canvas || !isUpload) return

    function draw() {
      if (!img || !canvas) return
      canvas.width = img.offsetWidth
      canvas.height = img.offsetHeight
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const ann of annotations) {
        const tx = ann.x * canvas.width   // target point
        const ty = ann.y * canvas.height
        const r = 13
        const offset = 44

        // Push badge away from image center so it never obscures the target
        const pushRight = ann.x >= 0.5
        const pushDown = ann.y >= 0.5
        const bx = tx + (pushRight ? offset : -offset)
        const by = ty + (pushDown ? offset : -offset)

        // Crosshair at target point
        const ch = 7
        ctx.strokeStyle = '#1d4ed8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(tx - ch, ty); ctx.lineTo(tx + ch, ty)
        ctx.moveTo(tx, ty - ch); ctx.lineTo(tx, ty + ch)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(tx, ty, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = '#1d4ed8'
        ctx.fill()

        // Leader line from badge to crosshair
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(tx, ty)
        ctx.strokeStyle = '#1d4ed8'
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.5
        ctx.stroke()
        ctx.globalAlpha = 1

        // Badge circle
        ctx.beginPath()
        ctx.arc(bx, by, r, 0, Math.PI * 2)
        ctx.fillStyle = '#1d4ed8'
        ctx.fill()

        // Number
        ctx.fillStyle = 'white'
        ctx.font = 'bold 12px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(ann.number), bx, by)

        // Label — always faces outward (same direction as badge offset)
        if (ann.label) {
          ctx.font = '11px system-ui, sans-serif'
          const m = ctx.measureText(ann.label)
          const pad = 5
          const boxX = pushRight ? bx + r + 6 : bx - r - 6 - m.width - pad * 2
          const textX = pushRight ? boxX + pad : boxX + m.width + pad

          ctx.fillStyle = 'rgba(0,0,0,0.75)'
          ctx.beginPath()
          ctx.roundRect(boxX, by - 11, m.width + pad * 2, 22, 4)
          ctx.fill()

          ctx.fillStyle = 'white'
          ctx.textAlign = pushRight ? 'left' : 'right'
          ctx.textBaseline = 'middle'
          ctx.fillText(ann.label, textX, by)
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
      <div className="flex-1 overflow-auto flex items-start justify-center p-2 pr-0">
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

const generatedImageCache = new Map<string, string>()

function ImageGenerated({ artifact }: { artifact: Artifact }) {
  const [url, setUrl] = useState<string | null>(() => generatedImageCache.get(artifact.identifier) ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (generatedImageCache.has(artifact.identifier)) {
      setUrl(generatedImageCache.get(artifact.identifier)!)
      return
    }
    const controller = new AbortController()
    setUrl(null)
    setError(null)
    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: artifact.content }),
      signal: controller.signal,
    })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then((data: { url: string }) => {
        generatedImageCache.set(artifact.identifier, data.url)
        setUrl(data.url)
      })
      .catch(e => {
        if (e instanceof Error && e.name === 'AbortError') return
        setError(String(e))
      })
    return () => controller.abort()
  }, [artifact.identifier])

  return (
    <div className="h-full flex flex-col">
      {artifact.title && (
        <div className="text-sm font-medium text-gray-500 mb-2">{artifact.title}</div>
      )}
      <div className="flex-1 flex items-center justify-center overflow-auto">
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : url ? (
          <img src={url} alt={artifact.title} className="max-w-full max-h-full object-contain rounded-lg" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Generating image...</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function ArtifactPanel({ artifact }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Send artifact content to iframe on load
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

  // Handle GENERATE_IMAGE requests from sandboxed React components.
  // The component posts { type: 'GENERATE_IMAGE', id, prompt } and we respond
  // with { type: 'IMAGE_READY', id, url } or { type: 'IMAGE_ERROR', id, error }.
  useEffect(() => {
    async function handleMessage(e: MessageEvent) {
      if (e.data?.type !== 'GENERATE_IMAGE') return
      const { id, prompt } = e.data as { id: string; prompt: string }

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json() as { url: string }
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'IMAGE_READY', id, url: data.url },
          '*'
        )
      } catch (err) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'IMAGE_ERROR', id, error: String(err) },
          '*'
        )
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  if (artifact.type === 'image/surface') {
    return <ImageSurface artifact={artifact} />
  }

  if (artifact.type === 'image/generated') {
    return <ImageGenerated artifact={artifact} />
  }

  if (artifact.type === 'application/vnd.ant.code') {
    return (
      <div className="h-full flex flex-col">
        {artifact.title && <div className="text-sm font-medium text-gray-500 mb-2">{artifact.title}</div>}
        <pre className="flex-1 overflow-auto p-4 pr-0 bg-gray-50 rounded text-sm font-mono m-0"><code>{artifact.content}</code></pre>
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
