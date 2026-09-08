import { useTheme } from '../theme'
import type { Theme } from '../theme'
import { Icon } from './icons'
import type { IconName } from './icons'

const THEMES: [Theme, IconName, string][] = [
  ['light', 'sun', 'Light theme'],
  ['system', 'monitor', 'Follow the system theme'],
  ['dark', 'moon', 'Dark theme'],
]

/**
 * One theme control, rendered both in the rail (as a shortcut) and on the
 * settings page. It keeps the named pressed-button group the shell already
 * used rather than becoming a half-implemented radiogroup: each button carries
 * its accessible name and the same name as a visible tooltip.
 */
export function ThemeToggle({ label = 'Theme' }: { label?: string }) {
  const [theme, setTheme] = useTheme()
  return <div className="theme-toggle" role="group" aria-label={label}>
    {THEMES.map(([option, icon, name]) => (
      <button key={option} type="button" className="has-tip" aria-label={name} data-tip={name}
        aria-pressed={theme === option} onClick={() => setTheme(option)}>
        <Icon name={icon} />
      </button>
    ))}
  </div>
}
