import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { isChunkLoadError, resetFailedImports } from '@/lib/lazyWithRetry'

/** Contains a render crash to one panel/page instead of blanking the whole app. Give it a `key` to reset on change.
 * "Try again" re-renders the children and re-downloads any page whose code failed to load. */
export class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error contained by ErrorBoundary', error, info.componentStack)
  }

  retry = () => {
    resetFailedImports()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const offline = isChunkLoadError(this.state.error) || /took too long/.test(this.state.error.message)
    return (
      <div role="alert" className="grid h-full min-h-40 place-items-center p-6 text-center">
        <div className="max-w-sm">
          <TriangleAlert className="mx-auto mb-2 h-8 w-8 text-warn" />
          <p className="font-medium text-fg">{offline ? 'This page could not be loaded' : this.props.title ?? 'Something went wrong here'}</p>
          <p className="mt-1 text-sm text-ink-300">{offline ? 'Check your internet connection, then try again.' : this.state.error.message || 'Please try again.'}</p>
          <button onClick={this.retry} className="mt-3 cursor-pointer text-sm font-medium text-brand-600 hover:underline">Try again</button>
        </div>
      </div>
    )
  }
}
