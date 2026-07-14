import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DirectiveContent } from '@/components/assistant-ui/directive-text'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { $connection } from '@/store/session'
import type { SessionMessage } from '@/types/hermes'

// End-to-end check for issue #11: a screenshot attached earlier must reappear
// when the thread is reloaded from gateway history. We drive the exact reload
// path — stored gateway content → toChatMessages → DirectiveContent — and
// observe the rendered DOM (an <img> with the bytes the fs bridge returns),
// which is what /chrome would show visually.

const REMOTE_DATA_URL = 'data:image/png;base64,cmVuZGVyZWQ='

const STORED_DESCRIPTION_MESSAGE: SessionMessage = {
  role: 'user',
  timestamp: 5000,
  content: [
    '[The user attached an image:',
    'This is a screenshot of an AI assistant chat interface, with a bracketed [note].]',
    '[You can examine it with vision_analyze using image_url: /home/u/.hermes/images/upload_1.png]',
    '',
    'clipboard test on safari'
  ].join('\n')
}

function mockRemoteFsBridge() {
  const api = vi.fn(async ({ path }: { path: string }) => {
    if (path.startsWith('/api/fs/read-data-url?')) {
      return REMOTE_DATA_URL
    }

    throw new Error(`unexpected path ${path}`)
  })

  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
  $connection.set({ baseUrl: 'https://gw', mode: 'remote', token: 'secret' } as never)

  return api
}

describe('reloaded user message with an attached screenshot (#11)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    $connection.set(null)
    delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
  })

  it('renders the screenshot inline and drops the raw vision description', async () => {
    const api = mockRemoteFsBridge()

    const [message] = toChatMessages([STORED_DESCRIPTION_MESSAGE])
    const text = chatMessageText(message)

    // Sanity: the reload pipeline turned the marker into a directive and kept
    // the user's real words, without leaking the model-facing description.
    expect(text).toContain('@image:/home/u/.hermes/images/upload_1.png')
    expect(text).toContain('clipboard test on safari')
    expect(text).not.toContain('The user attached an image')

    render(<DirectiveContent text={text} />)

    // The user's actual message is visible; the description wall is gone.
    expect(screen.getByText('clipboard test on safari')).toBeTruthy()
    expect(screen.queryByText(/This is a screenshot of an AI assistant/)).toBeNull()

    // The screenshot itself renders as an <img> fed by the fs-bridge bytes.
    const img = await screen.findByRole('img')
    await waitFor(() => expect(img.getAttribute('src')).toBe(REMOTE_DATA_URL))

    expect(api).toHaveBeenCalledWith({
      path: '/api/fs/read-data-url?path=%2Fhome%2Fu%2F.hermes%2Fimages%2Fupload_1.png'
    })
  })
})
