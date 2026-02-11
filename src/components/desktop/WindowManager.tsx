'use client'

import { useState, useCallback, createContext, useContext, ReactNode } from 'react'
import { WindowState } from './types'
import * as Sentry from '@sentry/nextjs'

interface WindowManagerContextType {
  windows: WindowState[]
  openWindow: (window: Omit<WindowState, 'zIndex' | 'isFocused'>) => void
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  focusWindow: (id: string) => void
  updateWindowPosition: (id: string, x: number, y: number) => void
  updateWindowSize: (id: string, width: number, height: number) => void
  topZIndex: number
}

const WindowManagerContext = createContext<WindowManagerContextType | null>(null)

export function useWindowManager() {
  const context = useContext(WindowManagerContext)
  if (!context) {
    throw new Error('useWindowManager must be used within WindowManagerProvider')
  }
  return context
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [topZIndex, setTopZIndex] = useState(100)

  const openWindow = useCallback((window: Omit<WindowState, 'zIndex' | 'isFocused'>) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => {
        const existing = prev.find(w => w.id === window.id)
        if (existing) {
          if (existing.isMinimized) {
            Sentry.metrics.increment('window.restored', 1, {
              tags: { window_type: window.id }
            })
            Sentry.logger.debug('Window restored from minimized', {
              context: { windowId: window.id, windowTitle: window.title }
            })

            return prev.map(w =>
              w.id === window.id
                ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
                : { ...w, isFocused: false }
            )
          }

          Sentry.logger.debug('Window focused', {
            context: { windowId: window.id, windowTitle: window.title }
          })

          return prev.map(w =>
            w.id === window.id
              ? { ...w, isFocused: true, zIndex: newZ }
              : { ...w, isFocused: false }
          )
        }

        Sentry.metrics.increment('window.opened', 1, {
          tags: { window_type: window.id }
        })
        Sentry.metrics.gauge('window.total_count', prev.length + 1)

        Sentry.logger.info('New window opened', {
          context: {
            windowId: window.id,
            windowTitle: window.title,
            totalWindows: prev.length + 1
          }
        })

        return [
          ...prev.map(w => ({ ...w, isFocused: false })),
          { ...window, zIndex: newZ, isFocused: true }
        ]
      })
      return newZ
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.metrics.increment('window.closed', 1, {
          tags: { window_type: id }
        })
        Sentry.metrics.gauge('window.total_count', prev.length - 1)

        Sentry.logger.info('Window closed', {
          context: {
            windowId: id,
            windowTitle: window.title,
            totalWindows: prev.length - 1
          }
        })
      }

      return prev.filter(w => w.id !== id)
    })
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        Sentry.metrics.increment('window.minimized', 1, {
          tags: { window_type: id }
        })
        Sentry.logger.debug('Window minimized', {
          context: { windowId: id, windowTitle: window.title }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, isMinimized: true, isFocused: false } : w
      )
    })
  }, [])

  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const window = prev.find(w => w.id === id)
      if (window) {
        const isMaximizing = !window.isMaximized

        Sentry.metrics.increment('window.maximize_toggled', 1, {
          tags: { window_type: id, action: isMaximizing ? 'maximize' : 'restore' }
        })
        Sentry.logger.debug('Window maximize toggled', {
          context: {
            windowId: id,
            windowTitle: window.title,
            isMaximizing
          }
        })
      }

      return prev.map(w =>
        w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
      )
    })
  }, [])

  const restoreWindow = useCallback((id: string) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isMinimized: false, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const focusWindow = useCallback((id: string) => {
    setTopZIndex(currentZ => {
      const newZ = currentZ + 1
      setWindows(prev => prev.map(w =>
        w.id === id
          ? { ...w, isFocused: true, zIndex: newZ }
          : { ...w, isFocused: false }
      ))
      return newZ
    })
  }, [])

  const updateWindowPosition = useCallback((id: string, x: number, y: number) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, x, y } : w
    ))
  }, [])

  const updateWindowSize = useCallback((id: string, width: number, height: number) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, width, height } : w
    ))
  }, [])

  return (
    <WindowManagerContext.Provider value={{
      windows,
      openWindow,
      closeWindow,
      minimizeWindow,
      maximizeWindow,
      restoreWindow,
      focusWindow,
      updateWindowPosition,
      updateWindowSize,
      topZIndex
    }}>
      {children}
    </WindowManagerContext.Provider>
  )
}
