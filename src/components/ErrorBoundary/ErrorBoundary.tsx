import { Component, type ErrorInfo, type ReactNode } from 'react'
import { STORAGE_KEYS } from '@/lib/storageKeys'
import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App failed to render:', error, info.componentStack)
  }

  private handleResetStorage = (): void => {
    localStorage.removeItem(STORAGE_KEYS.settings)
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const devUrl = `${window.location.protocol}//${window.location.host}/`

    return (
      <div className={styles.wrap}>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.message}>
          The app hit an error while loading. This is often caused by outdated browser data or
          visiting the wrong local URL.
        </p>
        <ul className={styles.list}>
          <li>
            Dev server running? In the project folder run <code>npm run dev</code>
          </li>
          <li>
            Open <a href={devUrl}>{devUrl}</a>
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code> and set your Google Maps API
            key
          </li>
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
            Reload
          </button>
          <button type="button" className={styles.secondary} onClick={this.handleResetStorage}>
            Clear saved data &amp; reload
          </button>
        </div>
        {import.meta.env.DEV ? (
          <pre className={styles.details}>{this.state.error.message}</pre>
        ) : null}
      </div>
    )
  }
}
