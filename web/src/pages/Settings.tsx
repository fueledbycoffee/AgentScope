import { useId, useState } from 'react'
import { Notice, ThemeToggle } from '../components'
import { formatDate, formatExactText, num } from '../format'
import { useSettings } from '../settingsContext'
import {
  DATE_FORMATS, VIEWER_ZONE, localeOptions, readDiagnostics, resetSettings, resolveTimeZone, setSettings,
  timeZoneOptions, viewerZone,
} from '../settings'
import type { DateFormatId } from '../settings'
import { useFileBar } from '../shellHooks'

/**
 * The choices that belong to the viewer, not to the data. Everything here is
 * stored in this browser and never sent to the server, every control writes
 * immediately (so the samples on this page are themselves the proof that a
 * change reaches a rendered surface with no reload), and a live region
 * announces each change for a reader who cannot see the samples move.
 */

/** A fixed instant, so the samples describe the setting rather than the time of day. */
const SAMPLE_INSTANT = '2026-09-08T14:05:00Z'
const SAMPLE_NUMBER = 1234567.89
const SAMPLE_EXACT = '9007199254740993'

export default function SettingsPage() {
  const settings = useSettings()
  const diagnostics = readDiagnostics()
  const [announcement, setAnnouncement] = useState('')
  const zoneId = useId()
  const localeId = useId()
  const relativeId = useId()
  useFileBar('Settings', [])

  const zone = resolveTimeZone(settings)
  const say = (message: string) => setAnnouncement(message)
  const sample = (dateFormat: DateFormatId) =>
    formatDate(SAMPLE_INSTANT, { ...settings, dateFormat }, { now: Date.parse(SAMPLE_INSTANT) }).absolute

  return <>
    <div className="page-head">
      <h1>Settings</h1>
      <span className="sub">stored in this browser only, never on the server</span>
    </div>

    <div className="settings-form">
      <section className="panel" aria-label="Dates and times">
        <div className="panel-head"><h2>Dates and times</h2></div>

        <fieldset>
          <legend>Date format</legend>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {DATE_FORMATS.map(format => (
              <label key={format.id} className="row" style={{ gap: 'var(--sp-2)' }}>
                <input type="radio" name="dateFormat" value={format.id} checked={settings.dateFormat === format.id}
                  onChange={() => { setSettings({ dateFormat: format.id }); say(`Date format ${format.label}`) }} />
                <span>{format.label}</span>
                <span className="sample">{sample(format.id)}</span>
              </label>
            ))}
          </div>
          <p className="hint">Shown in {zone}. Month abbreviations are always English; the number locale
            below governs digits, not language.</p>
        </fieldset>

        {diagnostics.timeZone && <Notice kind="warn" title={`The saved time zone ${diagnostics.timeZone.stored} is not one this browser knows.`}>
          <p>Times are shown in {zone} until another zone is chosen.</p>
        </Notice>}

        <div className="field">
          <label htmlFor={zoneId}>Time zone</label>
          <select id={zoneId} value={settings.timeZone}
            onChange={event => { setSettings({ timeZone: event.target.value }); say(`Time zone ${event.target.value}`) }}>
            {timeZoneOptions(settings.timeZone).map(option => (
              <option key={option} value={option}>
                {option === VIEWER_ZONE ? `This browser's zone (${viewerZone()})` : option}
              </option>
            ))}
          </select>
          <p className="hint">Every timestamp is converted to this zone; session pages also print the offset.</p>
        </div>

        <div className="field">
          <label className="row" style={{ gap: 'var(--sp-2)' }} htmlFor={relativeId}>
            <input id={relativeId} type="checkbox" checked={settings.relativeTimes}
              onChange={event => { setSettings({ relativeTimes: event.target.checked }); say(`Relative times ${event.target.checked ? 'on' : 'off'}`) }} />
            <span>Relative times</span>
          </label>
          <p className="hint">Times under seven days old read as “3 h ago”. The exact time stays in the
            tooltip and is copied on click, whichever way this is set.</p>
        </div>
      </section>

      <section className="panel" aria-label="Numbers">
        <div className="panel-head"><h2>Numbers</h2></div>
        {diagnostics.numberLocale && <Notice kind="warn" title={`The saved number locale ${diagnostics.numberLocale.stored} is not one this browser can format with.`}>
          <p>Numbers are shown as {settings.numberLocale} until another locale is chosen.</p>
        </Notice>}
        <div className="field">
          <label htmlFor={localeId}>Number locale</label>
          <select id={localeId} value={settings.numberLocale}
            onChange={event => { setSettings({ numberLocale: event.target.value }); say(`Number locale ${event.target.value}`) }}>
            {localeOptions(settings.numberLocale).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <dl className="facts" style={{ marginTop: 'var(--sp-2)' }}>
            <dt>Counts and measures</dt><dd className="sample">{num(SAMPLE_NUMBER, settings)}</dd>
            <dt>Exact values</dt><dd className="sample">{formatExactText(SAMPLE_EXACT, settings)}</dd>
          </dl>
          <p className="hint">Exact values travel as text so nothing is rounded; only their grouping follows
            this choice.</p>
        </div>
      </section>

      <section className="panel" aria-label="Theme">
        <div className="panel-head"><h2>Theme</h2></div>
        <ThemeToggle label="Theme" />
        <p className="hint">The toggle in the top bar is a shortcut to this choice.</p>
      </section>

      <section className="panel" aria-label="Defaults">
        <div className="panel-head"><h2>Defaults</h2></div>
        <p className="hint">Restores the ISO date format, this browser's zone, relative times, the system
          theme and the en-US number locale.</p>
        <div className="actions" style={{ marginTop: 'var(--sp-3)' }}>
          <button type="button" className="btn small" onClick={() => { resetSettings(); say('Every display choice reset to its default, theme included') }}>
            Reset to defaults
          </button>
        </div>
      </section>
    </div>

    <p role="status" aria-live="polite" className="visually-hidden">{announcement}</p>
  </>
}
