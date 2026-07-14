import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { Check, Plus, X } from '@/lib/icons'
import {
  $activeGatewayId,
  $gateways,
  addGateway,
  normalizeBase,
  removeGateway,
  setActiveGateway,
  updateGateway
} from '@/web-bridge/gateways'

import { Pill } from './primitives'

/**
 * The editable name for one saved gateway. Kept in local state while focused so
 * the field can be fully cleared and retyped - the store guards against an empty
 * name, so binding the input straight to it would snap a deleted name back on
 * every keystroke. The typed value is committed on blur (trimmed); left empty,
 * it reverts to the current name rather than persisting a blank. Focusing the
 * field selects all text so a tap replaces the name in one go.
 */
function GatewayNameField({
  id,
  label,
  name,
  placeholder
}: {
  id: string
  label: string
  name: string
  placeholder: string
}) {
  const [value, setValue] = useState(name)

  // Resync when the stored name changes from elsewhere (switching, sanitize).
  useEffect(() => {
    setValue(name)
  }, [name])

  return (
    <Input
      aria-label={label}
      className="h-7 text-[length:var(--conversation-caption-font-size)]"
      onBlur={() => {
        const next = value.trim()

        if (next) {
          if (next !== name) {updateGateway(id, { name: next })}
        } else {
          setValue(name)
        }
      }}
      onChange={event => setValue(event.target.value)}
      onFocus={event => event.target.select()}
      placeholder={placeholder}
      value={value}
    />
  )
}

/**
 * Manage the list of gateway connections (personal, company, ...). A gateway is
 * a whole Hermes server, distinct from a profile (an agent persona inside one
 * gateway). This panel owns the list: rename, switch active, add, remove. The
 * connection form below it edits the ACTIVE gateway's URL and auth (with test /
 * sign-in), so there is exactly one editor per concern.
 *
 * Switching active reloads the app against the chosen gateway. Adding creates a
 * blank gateway and switches to it, so the form below is ready to configure its
 * URL and authentication.
 */
export function GatewayManager() {
  const { t } = useI18n()
  const g = t.gateways
  const gateways = useStore($gateways)
  const activeId = useStore($activeGatewayId)

  const addAndConfigure = () => {
    const id = addGateway({ name: 'New gateway', url: '', authMode: 'oauth' })
    setActiveGateway(id)
  }

  return (
    <div className="mb-5 grid gap-2">
      <div className="text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
        {g.saved}
      </div>

      <div className="grid gap-1.5">
        {gateways.map(gateway => {
          const active = gateway.id === activeId
          const summary = gateway.url.trim() || normalizeBase('')

          return (
            <div
              className="flex items-center gap-2 rounded-lg border border-(--ui-stroke-tertiary) px-2.5 py-2"
              key={gateway.id}
            >
              <div className="grid min-w-0 flex-1 gap-1">
                <GatewayNameField
                  id={gateway.id}
                  label={g.name}
                  name={gateway.name}
                  placeholder={g.namePlaceholder}
                />
                <div className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                  {summary}
                </div>
              </div>

              {active ? (
                <Pill tone="primary">{g.current}</Pill>
              ) : (
                <Button onClick={() => setActiveGateway(gateway.id)} size="xs" variant="secondary">
                  <Check className="size-3.5" />
                  {g.switchTo}
                </Button>
              )}

              {!active && gateways.length > 1 ? (
                <Button
                  aria-label={g.remove}
                  onClick={() => {
                    if (window.confirm(g.removeConfirm)) {removeGateway(gateway.id)}
                  }}
                  size="icon-xs"
                  variant="ghost"
                >
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div>
        <Button onClick={addAndConfigure} size="xs" variant="secondary">
          <Plus className="size-3.5" />
          {g.add}
        </Button>
      </div>
    </div>
  )
}
