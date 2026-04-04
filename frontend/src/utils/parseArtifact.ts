import type { Artifact, ArtifactType } from '../types'

const ARTIFACT_REGEX = /<antArtifact\s([^>]*)>([\s\S]*?)<\/antArtifact>/i

function parseAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? match[1] : ''
}

export function parseArtifact(text: string): { cleanText: string; artifact: Artifact | null } {
  const match = text.match(ARTIFACT_REGEX)
  if (!match) return { cleanText: text, artifact: null }

  const [fullMatch, attrs, content] = match

  const identifier = parseAttr(attrs, 'identifier')
  const type = parseAttr(attrs, 'type') as ArtifactType
  const title = parseAttr(attrs, 'title')
  const language = parseAttr(attrs, 'language') || undefined
  const src = parseAttr(attrs, 'src') || undefined

  if (!type) return { cleanText: text, artifact: null }
  if (type !== 'image/surface' && !content.trim()) return { cleanText: text, artifact: null }

  const artifact: Artifact = {
    identifier,
    type,
    title,
    content: content.trim(),
    language,
    src,
  }

  const cleanText = text.replace(fullMatch, '').trim()

  return { cleanText, artifact }
}
