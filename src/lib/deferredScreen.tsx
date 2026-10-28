import { createElement, lazy, useState, type ComponentType } from "react";

/** A lazy screen that renders synchronously once its background preload has completed. */
export function deferredScreen(importScreen: () => Promise<{ default: ComponentType }>) {
  let loaded: ComponentType | null = null;
  let pending: Promise<{ default: ComponentType }> | null = null;
  const preload = () => {
    pending ??= importScreen().then((module) => {
      loaded = module.default;
      return module;
    }).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  const LazyScreen = lazy(preload);
  function Screen() {
    // Keep the component type stable if an early user action took the cold Suspense path.
    const [Component] = useState(() => loaded ?? LazyScreen);
    return createElement(Component);
  }
  return { Screen, preload, isLoaded: () => loaded !== null };
}
