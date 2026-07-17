import { Component, type ReactNode } from 'react';

interface SoftViewBoundaryProps {
  /** The hardcoded-switch rendering of the same view — used if the soft view throws. */
  fallback: ReactNode;
  children: ReactNode;
}

interface SoftViewBoundaryState {
  hasError: boolean;
}

/**
 * Per-view crash isolation for the soft-coded component path
 * (`VITE_SOFT_COMPONENTS`). `buildComponentRegistry` already degrades
 * gracefully when a component/item is *missing* (see `componentLoader.ts`,
 * `onMissing`) — this covers the other failure mode: a component that
 * *resolves* but throws while rendering (e.g. because it hasn't been
 * migrated to the host state contract yet and expects different props). One
 * panel's soft view crashing must not take down the rest of Studio, so it
 * catches and falls back to the same hardcoded view the flag-off path uses.
 */
export class SoftViewBoundary extends Component<SoftViewBoundaryProps, SoftViewBoundaryState> {
  state: SoftViewBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SoftViewBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn('[soft-components] view failed to render, falling back to hardcoded view', error);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
