import { describe, expect, it, vi } from 'vitest'
import {
  bindMapPopupWheelScroll,
  bindMapPopupInteractionGuard,
  closeAllMapPopups,
  isInsideMapInfoWindow,
  MAP_CLOSE_POPUPS_EVENT,
  releaseInfoWindowCloseReset,
  shouldSuppressInfoWindowCloseReset,
  suppressInfoWindowCloseReset,
} from '@/lib/mapPopups'

describe('mapPopups close reset suppress', () => {
  it('tracks suppress flag for nested calls', () => {
    while (shouldSuppressInfoWindowCloseReset()) releaseInfoWindowCloseReset()

    expect(shouldSuppressInfoWindowCloseReset()).toBe(false)
    suppressInfoWindowCloseReset()
    expect(shouldSuppressInfoWindowCloseReset()).toBe(true)
    releaseInfoWindowCloseReset()
    expect(shouldSuppressInfoWindowCloseReset()).toBe(false)
  })

  it('always dispatches close popups event', () => {
    const listener = vi.fn()
    window.addEventListener(MAP_CLOSE_POPUPS_EVENT, listener)
    closeAllMapPopups()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(MAP_CLOSE_POPUPS_EVENT, listener)
  })
})

describe('isInsideMapInfoWindow', () => {
  it('detects elements inside the info window shell', () => {
    document.body.innerHTML =
      '<div class="gm-style-iw-c"><div class="iw-body">text</div></div><div id="map"></div>'
    const body = document.querySelector('.iw-body')
    const map = document.getElementById('map')
    expect(isInsideMapInfoWindow(body)).toBe(true)
    expect(isInsideMapInfoWindow(map)).toBe(false)
  })
})

describe('bindMapPopupWheelScroll', () => {
  it('stops wheel events from bubbling to the map', () => {
    const shell = document.createElement('div')
    document.body.appendChild(shell)
    bindMapPopupWheelScroll(shell)

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true })
    const stopSpy = vi.spyOn(wheel, 'stopPropagation')
    shell.dispatchEvent(wheel)
    expect(stopSpy).toHaveBeenCalled()
    document.body.removeChild(shell)
  })
})

describe('bindMapPopupInteractionGuard', () => {
  it('stops mousedown from bubbling so the map does not start a pan', () => {
    const shell = document.createElement('div')
    const button = document.createElement('button')
    button.type = 'button'
    shell.appendChild(button)
    document.body.appendChild(shell)
    bindMapPopupInteractionGuard(shell, null)

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const stopSpy = vi.spyOn(down, 'stopPropagation')
    button.dispatchEvent(down)
    expect(stopSpy).toHaveBeenCalled()
    document.body.removeChild(shell)
  })

  it('still delivers click to a popup button before stopping bubble', () => {
    const shell = document.createElement('div')
    const button = document.createElement('button')
    button.type = 'button'
    shell.appendChild(button)
    document.body.appendChild(shell)
    bindMapPopupInteractionGuard(shell, null)

    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).toHaveBeenCalledTimes(1)
    document.body.removeChild(shell)
  })
})
