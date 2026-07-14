import { describe, expect, it } from 'vitest'

import { attachedImagePaths, extractEmbeddedImages, rewriteAttachedImageMarkers } from './embedded-images'

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(120)

const DESCRIPTION_BLOCK = [
  '[The user attached an image:',
  'This is a screenshot of an AI assistant chat interface.',
  '### Layout',
  'It has a list item [1] and a bracketed note [see here].]',
  '[You can examine it with vision_analyze using image_url: /home/u/.hermes/images/upload_1.png]',
  '',
  'clipboard test on safari'
].join('\n')

const LEGACY_BLOCK = [
  "I'm still getting this error.",
  '',
  '[Image attached at: /home/u/.hermes/images/clip_1.png]',
  '[screenshot]'
].join('\n')

describe('extractEmbeddedImages', () => {
  it('returns text untouched when no data URL is present', () => {
    expect(extractEmbeddedImages('describe this')).toEqual({ cleanedText: 'describe this', images: [] })
  })

  it('lifts a bare data:image URL out of prose', () => {
    const result = extractEmbeddedImages(`describe this ${SAMPLE_PNG_DATA_URL}`)

    expect(result.cleanedText).toBe('describe this')
    expect(result.images).toEqual([SAMPLE_PNG_DATA_URL])
  })

  it('lifts a JSON-wrapped image_url envelope out of prose', () => {
    const result = extractEmbeddedImages(
      `describe this{"type":"image_url","image_url":{"url":"${SAMPLE_PNG_DATA_URL}"}}`
    )

    expect(result.cleanedText).toBe('describe this')
    expect(result.images).toEqual([SAMPLE_PNG_DATA_URL])
  })

  it('extracts multiple embedded images', () => {
    const second = 'data:image/jpeg;base64,' + 'B'.repeat(96)
    const result = extractEmbeddedImages(`first ${SAMPLE_PNG_DATA_URL} mid ${second} tail`)

    expect(result.cleanedText).toBe('first  mid  tail')
    expect(result.images).toEqual([SAMPLE_PNG_DATA_URL, second])
  })

  it('handles multi-megabyte data URLs without overflowing the JS stack', () => {
    const hugeDataUrl = 'data:image/png;base64,' + 'A'.repeat(8_000_000)
    const result = extractEmbeddedImages(`describe this ${hugeDataUrl} thanks`)

    expect(result.cleanedText).toBe('describe this  thanks')
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toHaveLength(hugeDataUrl.length)
  })
})

describe('attachedImagePaths', () => {
  it('returns nothing for text without markers', () => {
    expect(attachedImagePaths('just a normal message')).toEqual([])
  })

  it('extracts the path from a vision description block, ignoring inner brackets', () => {
    expect(attachedImagePaths(DESCRIPTION_BLOCK)).toEqual(['/home/u/.hermes/images/upload_1.png'])
  })

  it('extracts the path from the legacy "Image attached at" marker', () => {
    expect(attachedImagePaths(LEGACY_BLOCK)).toEqual(['/home/u/.hermes/images/clip_1.png'])
  })

  it('dedupes repeated paths', () => {
    const text = `${LEGACY_BLOCK}\n[Image attached at: /home/u/.hermes/images/clip_1.png]`

    expect(attachedImagePaths(text)).toEqual(['/home/u/.hermes/images/clip_1.png'])
  })
})

describe('rewriteAttachedImageMarkers', () => {
  it('leaves marker-free text untouched', () => {
    expect(rewriteAttachedImageMarkers('hello world')).toBe('hello world')
  })

  it('drops the vision description and appends an @image directive', () => {
    const result = rewriteAttachedImageMarkers(DESCRIPTION_BLOCK)

    expect(result).not.toContain('The user attached an image')
    expect(result).not.toContain('vision_analyze')
    expect(result).toContain('clipboard test on safari')
    expect(result).toContain('@image:/home/u/.hermes/images/upload_1.png')
  })

  it('rewrites the legacy marker and strips the [screenshot] tag', () => {
    const result = rewriteAttachedImageMarkers(LEGACY_BLOCK)

    expect(result).not.toContain('[screenshot]')
    expect(result).not.toContain('Image attached at')
    expect(result).toContain("I'm still getting this error.")
    expect(result).toContain('@image:/home/u/.hermes/images/clip_1.png')
  })

  it('quotes paths that contain spaces so the directive parser keeps them intact', () => {
    const result = rewriteAttachedImageMarkers('[Image attached at: /home/u/my screenshots/a.png]')

    expect(result).toContain('@image:`/home/u/my screenshots/a.png`')
  })

  it('renders only the directive when there is no other text', () => {
    const result = rewriteAttachedImageMarkers(
      '[The user attached an image:\ndesc]\n[You can examine it with vision_analyze using image_url: /a/b.png]'
    )

    expect(result).toBe('@image:/a/b.png')
  })
})
