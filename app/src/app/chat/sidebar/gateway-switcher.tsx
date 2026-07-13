import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router-dom'

import { SETTINGS_ROUTE } from '@/app/routes'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeGatewayId, $gateways, setActiveGateway } from '@/web-bridge/gateways'

const GATEWAY_SETTINGS_ROUTE = `${SETTINGS_ROUTE}?tab=gateway`

/**
 * Compact strip of saved gateway connections in the sidebar footer, above the
 * profile rail. A gateway is a whole Hermes server (personal vs company), which
 * sits ABOVE profiles (agent personas inside one gateway) in scope. Selecting a
 * different gateway reloads the app against it (setActiveGateway). Adding and
 * managing gateways lives in Settings -> Gateway.
 *
 * The rail hides itself when there is only one gateway and it has never been
 * named/pointed elsewhere, so single-gateway users get no extra chrome; the
 * moment a second gateway exists it appears as a switcher.
 */
export function GatewayRail() {
  const { t } = useI18n()
  const g = t.gateways
  const navigate = useNavigate()
  const gateways = useStore($gateways)
  const activeId = useStore($activeGatewayId)

  const soleDefault = gateways.length === 1 && !gateways[0].url && gateways[0].id === 'default'

  if (soleDefault) {
    return null
  }

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto">
      {gateways.map(gateway => {
        const active = gateway.id === activeId
        const initial = gateway.name.replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '?'

        return (
          <Tip key={gateway.id} label={active ? `${gateway.name} (${g.active})` : `${g.switchTo}: ${gateway.name}`}>
            <button
              aria-label={active ? `${gateway.name} (${g.active})` : `${g.switchTo}: ${gateway.name}`}
              aria-pressed={active}
              className={cn(
                'flex min-w-0 shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-foreground',
                active && 'bg-(--ui-control-active-background) text-foreground'
              )}
              onClick={() => setActiveGateway(gateway.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="grid size-4 shrink-0 place-items-center rounded-[3px] bg-(--ui-bg-quaternary) text-[0.5rem] font-semibold leading-none"
              >
                {initial}
              </span>
              <span className="max-w-24 truncate">{gateway.name}</span>
            </button>
          </Tip>
        )
      })}
      <Tip label={g.manage}>
        <button
          aria-label={g.manage}
          className="grid size-5 shrink-0 place-items-center rounded-[3px] text-(--ui-text-tertiary) opacity-55 transition hover:bg-(--ui-control-hover-background) hover:text-foreground hover:opacity-100"
          onClick={() => navigate(GATEWAY_SETTINGS_ROUTE)}
          type="button"
        >
          <Codicon name="add" size="0.75rem" />
        </button>
      </Tip>
    </div>
  )
}
