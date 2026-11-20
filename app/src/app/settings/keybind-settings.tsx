import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd, KbdCombo } from '@/components/ui/kbd'
import { SearchField } from '@/components/ui/search-field'
import { useI18n } from '@/i18n'
import { Keyboard, RefreshCw } from '@/lib/icons'
import { KEYBIND_ACTIONS, KEYBIND_CATEGORIES, keybindAction } from '@/lib/keybinds/actions'
import { comboFromEvent } from '@/lib/keybinds/combo'
import { cn } from '@/lib/utils'
import { $bindings, conflictsFor, resetAllBindings, resetBinding, setBinding } from '@/store/keybinds'

import { SectionHeading, SettingsContent } from './primitives'

// Rebindable-hotkey settings, web-adapted from the desktop keybind panel:
// same actions/categories the composer and navigation actually dispatch (they
// live in lib/keybinds/actions.ts + hooks/use-keybinds), so a row here is
// always a hotkey the browser build honours — no Electron-only rows
// (screenshot, HUD gesture, tray) are offered.
export function KeybindSettings() {
  const { t } = useI18n()
  const bindings = useStore($bindings)
  const [query, setQuery] = useState('')
  const [capturing, setCapturing] = useState<null | string>(null)

  // One window-level capture listener while a row is armed: the next
  // non-modifier chord becomes that action's only binding. Escape cancels.
  // Registered in capture phase so the app's own hotkey dispatcher never
  // fires the very chord being recorded.
  useEffect(() => {
    if (!capturing) {
      return
    }

    const handler = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setCapturing(null)

        return
      }

      const combo = comboFromEvent(event)

      if (!combo) {
        return
      }

      setBinding(capturing, [combo])
      setCapturing(null)
    }

    window.addEventListener('keydown', handler, true)

    return () => window.removeEventListener('keydown', handler, true)
  }, [capturing])

  const labelFor = (actionId: string) => t.keybinds.actions[actionId] ?? actionId

  const needle = query.trim().toLowerCase()

  const groups = useMemo(
    () =>
      KEYBIND_CATEGORIES.map(category => ({
        category,
        actions: KEYBIND_ACTIONS.filter(action => {
          if (action.category !== category) {
            return false
          }

          if (!needle) {
            return true
          }

          return action.id.toLowerCase().includes(needle) || labelFor(action.id).toLowerCase().includes(needle)
        })
      })).filter(group => group.actions.length > 0),
    // labelFor depends on the active locale only through t; re-filter on query
    // and locale-driven label changes both land in the same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needle, t]
  )

  const anyCustom = Object.keys(bindings).length > 0

  return (
    <SettingsContent>
      <SectionHeading icon={Keyboard} title={t.keybinds.title} />

      <div className="flex items-center gap-2 px-1 pb-1">
        <SearchField
          containerClassName="min-w-0 flex-1"
          onChange={setQuery}
          placeholder={t.keybinds.search}
          value={query}
        />
        <Button
          disabled={!anyCustom}
          onClick={() => resetAllBindings()}
          size="sm"
          title={t.keybinds.resetAll}
          variant="outline"
        >
          <RefreshCw />
          {t.keybinds.resetAll}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t.keybinds.search}</p>
      ) : (
        groups.map(group => (
          <section className="grid gap-1" key={group.category}>
            <p className="px-1 pt-2 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
              {t.keybinds.categories[group.category] ?? group.category}
            </p>
            {group.actions.map(action => {
              const combos = bindings[action.id] ?? action.defaults
              const armed = capturing === action.id
              const conflicts = (combos ?? []).flatMap(combo => conflictsFor(action.id, combo))

              const conflictLabel = conflicts
                .map(id => keybindAction(id)?.id ?? id)
                .map(id => labelFor(id))
                .filter(Boolean)

              return (
                <div
                  className={cn(
                    'flex min-h-9 items-center gap-3 rounded-md px-2 py-1.5',
                    armed ? 'bg-(--ui-row-active-background)' : 'hover:bg-(--ui-row-hover-background)'
                  )}
                  key={action.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.78rem] font-medium text-foreground/85">{labelFor(action.id)}</p>
                    {conflictLabel.length > 0 ? (
                      <p className="truncate text-[0.66rem] text-amber-600 dark:text-amber-400">
                        {t.keybinds.conflictWith(conflictLabel.join(', '))}
                      </p>
                    ) : null}
                  </div>

                  {armed ? (
                    <Kbd size="sm" variant="capturing">
                      {t.keybinds.pressKey}
                    </Kbd>
                  ) : combos.length > 0 ? (
                    <span className="flex shrink-0 items-center gap-1">
                      {combos.map(combo => (
                        <KbdCombo combo={combo} key={combo} size="sm" />
                      ))}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[0.66rem] text-muted-foreground">—</span>
                  )}

                  <Button onClick={() => setCapturing(armed ? null : action.id)} size="sm" variant="ghost">
                    {t.keybinds.rebind}
                  </Button>
                  <Button
                    aria-label={t.keybinds.reset}
                    disabled={combos.join(' ') === action.defaults.join(' ')}
                    onClick={() => resetBinding(action.id)}
                    size="sm"
                    title={t.keybinds.reset}
                    variant="ghost"
                  >
                    <RefreshCw />
                  </Button>
                </div>
              )
            })}
          </section>
        ))
      )}
    </SettingsContent>
  )
}
