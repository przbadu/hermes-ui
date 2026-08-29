import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as hermes from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { $activeGatewayProfile, $profiles } from '@/store/profile'
import {
  _resetSessionProfileHintsForTests,
  rememberedSessionProfile,
  setSessionProfileHint,
  setSessions
} from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import {
  chatMessageArraysEquivalent,
  isSessionGoneError,
  reconcileResumeMessages,
  resolveStoredSession,
  sessionMatchesStoredId,
  sessionShouldHaveTranscript,
  toBranchMessages
} from './utils'

const msg = (id: string, role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, parts: [{ type: 'text', text }], ...extra }) as ChatMessage

const session = (over: Partial<SessionInfo>): SessionInfo => over as SessionInfo

describe('isSessionGoneError', () => {
  it('is true for 404 / session-not-found, false otherwise', () => {
    expect(isSessionGoneError(new Error('Request failed 404'))).toBe(true)
    expect(isSessionGoneError(new Error('Session not found'))).toBe(true)
    expect(isSessionGoneError(new Error('ECONNREFUSED'))).toBe(false)
    expect(isSessionGoneError(null)).toBe(false)
  })
})

describe('sessionMatchesStoredId', () => {
  it('matches on live id or lineage root', () => {
    expect(sessionMatchesStoredId(session({ id: 'a' }), 'a')).toBe(true)
    expect(sessionMatchesStoredId(session({ id: 'live', _lineage_root_id: 'root' }), 'root')).toBe(true)
    expect(sessionMatchesStoredId(session({ id: 'a' }), 'b')).toBe(false)
  })
})

describe('sessionShouldHaveTranscript', () => {
  it('is true only when the session has messages', () => {
    expect(sessionShouldHaveTranscript(session({ message_count: 3 }))).toBe(true)
    expect(sessionShouldHaveTranscript(session({ message_count: 0 }))).toBe(false)
    expect(sessionShouldHaveTranscript(undefined)).toBe(false)
  })
})

describe('toBranchMessages', () => {
  it('keeps only user/assistant turns that carry text', () => {
    const out = toBranchMessages([
      msg('u', 'user', 'hi'),
      msg('blank', 'assistant', '   '),
      msg('sys', 'system', 'ignored'),
      msg('a', 'assistant', 'hello')
    ])

    expect(out.map(b => b.source.id)).toEqual(['u', 'a'])
    expect(out[0]).toMatchObject({ content: 'hi', role: 'user' })
  })
})

describe('chatMessageArraysEquivalent', () => {
  it('compares length and per-message equivalence', () => {
    const a = [msg('1', 'user', 'x'), msg('2', 'assistant', 'y')]
    expect(chatMessageArraysEquivalent(a, [msg('1', 'user', 'x'), msg('2', 'assistant', 'y')])).toBe(true)
    expect(chatMessageArraysEquivalent(a, [msg('1', 'user', 'x')])).toBe(false)
    expect(chatMessageArraysEquivalent(a, [msg('1', 'user', 'x'), msg('2', 'assistant', 'changed')])).toBe(false)
  })
})

describe('reconcileResumeMessages', () => {
  it('returns next untouched when there is no previous transcript', () => {
    const next = [msg('1', 'user', 'hi')]
    expect(reconcileResumeMessages(next, [])).toBe(next)
  })

  it('re-grafts reasoning parts onto a matching assistant turn', () => {
    const next = [msg('a', 'assistant', 'answer')]

    const previous = [
      msg('a', 'assistant', 'answer', {
        parts: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'answer' }
        ]
      } as Partial<ChatMessage>)
    ]

    const [out] = reconcileResumeMessages(next, previous)
    expect(out.parts.some(p => p.type === 'reasoning')).toBe(true)
  })
})

describe('resolveStoredSession profile routing', () => {
  beforeEach(() => {
    _resetSessionProfileHintsForTests({ storage: true })
    setSessions([])
    $activeGatewayProfile.set('labmanager')
    $profiles.set([
      {
        has_env: true,
        is_default: true,
        model: null,
        name: 'default',
        path: '/profiles/default',
        provider: null,
        skill_count: 0
      },
      {
        has_env: true,
        is_default: false,
        model: null,
        name: 'labmanager',
        path: '/profiles/labmanager',
        provider: null,
        skill_count: 0
      }
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _resetSessionProfileHintsForTests({ storage: true })
    setSessions([])
    $profiles.set([])
    $activeGatewayProfile.set('default')
  })

  it('queries a hidden session on its explicit owner before unscoped REST', async () => {
    setSessionProfileHint('bot-chat', 'labmanager')

    const getSession = vi.spyOn(hermes, 'getSession').mockImplementation(async (id, profile) => {
      expect(id).toBe('bot-chat')

      if (profile === 'labmanager') {
        return session({ id, message_count: 34 })
      }

      throw new Error('404')
    })

    const resolved = await resolveStoredSession('bot-chat')

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(getSession).toHaveBeenCalledWith('bot-chat', 'labmanager')
    expect(resolved).toMatchObject({ id: 'bot-chat', message_count: 34, profile: 'labmanager' })
    expect(rememberedSessionProfile('bot-chat')).toBe('labmanager')
  })

  it('still probes the active socket profile after unscoped REST misses', async () => {
    const getSession = vi.spyOn(hermes, 'getSession').mockImplementation(async (id, profile) => {
      if (profile === 'labmanager') {
        return session({ id, message_count: 34, profile })
      }

      throw new Error('404')
    })

    const resolved = await resolveStoredSession('bot-chat')

    expect(getSession.mock.calls).toEqual([
      ['bot-chat', undefined],
      ['bot-chat', 'default'],
      ['bot-chat', 'labmanager']
    ])
    expect(resolved?.profile).toBe('labmanager')
  })
})
