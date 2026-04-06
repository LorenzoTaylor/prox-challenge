import type { Artifact, ArtifactType } from '../types'

const ARTIFACT_REGEX = /<(?:ant)?[Aa]rtifact\s([^>]*)>([\s\S]*?)<\/(?:ant)?[Aa]rtifact>/i
// <function_calls><invoke name="antArtifact"><parameter name="...">val</parameter>...</invoke></function_calls>
const INVOKE_REGEX = /<function_calls>\s*<invoke\s+name="antArtifact">([\s\S]*?)<\/invoke>\s*<\/function_calls>/i

function parseAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? match[1] : ''
}

function parseParam(body: string, name: string): string {
  const match = body.match(new RegExp(`<parameter\\s+name="${name}">([\s\S]*?)<\/parameter>`, 'i'))
  return match ? match[1].trim() : ''
}

export function parseArtifact(text: string): { cleanText: string; artifact: Artifact | null } {
  // Try <antArtifact> format first
  const antMatch = text.match(ARTIFACT_REGEX)
  if (antMatch) {
    const [fullMatch, attrs, content] = antMatch
    const identifier = parseAttr(attrs, 'identifier')
    const type = parseAttr(attrs, 'type') as ArtifactType
    const title = parseAttr(attrs, 'title')
    const language = parseAttr(attrs, 'language') || undefined
    const src = parseAttr(attrs, 'src') || undefined

    if (!type) return { cleanText: text, artifact: null }
    if (type !== 'image/surface' && !content.trim()) return { cleanText: text, artifact: null }

    return {
      cleanText: text.replace(fullMatch, '').trim(),
      artifact: { identifier, type, title, content: content.trim(), language, src },
    }
  }

  // Try <function_calls><invoke name="antArtifact"> format
  const invokeMatch = text.match(INVOKE_REGEX)
  if (invokeMatch) {
    const [fullMatch, body] = invokeMatch
    const identifier = parseParam(body, 'identifier')
    const type = parseParam(body, 'type') as ArtifactType
    const title = parseParam(body, 'title')
    const language = parseParam(body, 'language') || undefined
    const src = parseParam(body, 'src') || undefined
    const content = parseParam(body, 'content')

    if (!type) return { cleanText: text, artifact: null }
    if (type !== 'image/surface' && !content) return { cleanText: text, artifact: null }

    return {
      cleanText: text.replace(fullMatch, '').trim(),
      artifact: { identifier, type, title, content, language, src },
    }
  }

  // Detect a truncated artifact — opening tag present but no closing tag.
  // Return empty cleanText so the caller can show a banner instead of raw XML.
  const OPEN_TAG = /<(?:ant)?[Aa]rtifact[\s>]/
  if (OPEN_TAG.test(text)) {
    return { cleanText: '', artifact: null }
  }

  return { cleanText: text, artifact: null }
}
