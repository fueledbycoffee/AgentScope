import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup)

// jsdom does not implement the native dialog methods. These mocks only toggle
// the open state: modality, Escape and focus trapping are browser behaviour,
// verified by the Playwright smoke test (#12), not here.
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })

// The chat library observes element sizes; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom implements neither element scrolling nor scrollIntoView; the chat viewport calls them.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
}
