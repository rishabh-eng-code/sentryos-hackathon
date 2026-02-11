import * as Sentry from '@sentry/nextjs'

/**
 * Safe wrapper for Sentry metrics that works on both client and server
 * Falls back to custom events if metrics API is not available
 */
export const sentryMetrics = {
  increment: (metricName: string, value: number = 1, tags?: { tags?: Record<string, string> }) => {
    try {
      // Try to use metrics API if available (server-side)
      if (typeof Sentry.metrics?.increment === 'function') {
        Sentry.metrics.increment(metricName, value, tags)
      } else {
        // Fallback: send as custom event with tags
        Sentry.captureEvent({
          message: metricName,
          level: 'info',
          tags: {
            metric_type: 'counter',
            metric_value: value.toString(),
            ...tags?.tags
          }
        })
      }
    } catch (error) {
      // Silently fail to avoid breaking the app
      console.debug('Sentry metrics error:', error)
    }
  },

  gauge: (metricName: string, value: number, tags?: { tags?: Record<string, string> }) => {
    try {
      if (typeof Sentry.metrics?.gauge === 'function') {
        Sentry.metrics.gauge(metricName, value, tags)
      } else {
        Sentry.captureEvent({
          message: metricName,
          level: 'info',
          tags: {
            metric_type: 'gauge',
            metric_value: value.toString(),
            ...tags?.tags
          }
        })
      }
    } catch (error) {
      console.debug('Sentry metrics error:', error)
    }
  },

  timing: (metricName: string, value: number, tags?: { tags?: Record<string, string> }) => {
    try {
      if (typeof Sentry.metrics?.timing === 'function') {
        Sentry.metrics.timing(metricName, value, tags)
      } else {
        Sentry.captureEvent({
          message: metricName,
          level: 'info',
          tags: {
            metric_type: 'timing',
            metric_value: value.toString(),
            ...tags?.tags
          }
        })
      }
    } catch (error) {
      console.debug('Sentry metrics error:', error)
    }
  }
}

/**
 * Safe wrapper for Sentry logger
 */
export const sentryLogger = {
  info: (message: string, data?: { context?: Record<string, any>; error?: Error }) => {
    try {
      Sentry.addBreadcrumb({
        message,
        level: 'info',
        data: data?.context
      })
    } catch (error) {
      console.debug('Sentry logger error:', error)
    }
  },

  warn: (message: string, data?: { context?: Record<string, any>; error?: Error }) => {
    try {
      Sentry.addBreadcrumb({
        message,
        level: 'warning',
        data: data?.context
      })
    } catch (error) {
      console.debug('Sentry logger error:', error)
    }
  },

  error: (message: string, data?: { context?: Record<string, any>; error?: Error }) => {
    try {
      if (data?.error) {
        Sentry.captureException(data.error, {
          tags: { custom_message: message },
          contexts: { details: data.context || {} }
        })
      } else {
        Sentry.captureMessage(message, {
          level: 'error',
          contexts: { details: data?.context || {} }
        })
      }
    } catch (error) {
      console.debug('Sentry logger error:', error)
    }
  },

  debug: (message: string, data?: { context?: Record<string, any> }) => {
    try {
      Sentry.addBreadcrumb({
        message,
        level: 'debug',
        data: data?.context
      })
    } catch (error) {
      console.debug('Sentry logger error:', error)
    }
  }
}
