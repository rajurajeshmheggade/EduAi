import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

/** Contains a render crash to one panel/page instead of blanking the whole app. Give it a `key` to reset on change. */
export class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error contained by ErrorBoundary', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="grid h-full min-h-40 place-items-center p-6 text-center">
        <div className="max-w-sm">
          <TriangleAlert className="mx-auto mb-2 h-8 w-8 text-warn" />
          <p className="font-medium text-fg">{this.props.title ?? 'Something went wrong here'}</p>
          <p className="mt-1 text-sm text-ink-300">{this.state.error.message || 'Please try again.'}</p>
          <button onClick={() => this.setState({ error: null })} className="mt-3 cursor-pointer text-sm font-medium text-brand-600 hover:underline">Try again</button>
        </div>
      </div>
    )
  }
}
