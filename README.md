# Astro Component System

A minimal, library-agnostic component orchestration system for Astro projects focused on animation. Handles DOM detection, dependency-ordered initialization, event coordination, and cleanup — so component authors focus only on animation logic.

## Features

- **Automatic DOM detection** — scans for `data-component` attributes on page load
- **Dependency-ordered initialization** — Kahn's topological sort ensures components init in the right order
- **Async readiness signaling** — dependents wait for async `init()` to resolve before starting
- **Multiple instances** — every matching element gets its own isolated instance and `AbortController`
- **Global event coordination** — throttled resize, `prefers-reduced-motion`, view transitions, unload
- **Single-file component authoring** — define components directly in `.astro` `<script>` tags
- **Resilient error handling** — a failed `init()` warns and continues; dependents are never permanently blocked

## Setup

Add `<ClientRouter />` to your layout's `<head>`. This enables `astro:page-load` events for both the initial page load and view transitions. A `window load` fallback is built in for sites that omit it.

```astro
---
import { ClientRouter } from "astro:transitions";
---
<html>
  <head>
    <ClientRouter />
  </head>
  <body>
    <slot />
  </body>
</html>
```

## Commands

| Command           | Action                                      |
| :---------------- | :------------------------------------------ |
| `npm run dev`     | Start local dev server at `localhost:4321`  |
| `npm run build`   | Build to `./dist/`                          |
| `npm run preview` | Preview the production build locally        |
| `npm test`        | Run unit tests with Vitest                  |

## Usage

### Marking elements in HTML

Add `data-component` to any element to register it with the system. Use `data-ref` to name child elements for easy access inside `init()`.

```html
<div data-component="accordion">
  <button data-ref="trigger">Open</button>
  <div data-ref="panel">Content</div>
</div>
```

### Defining a component

Call `defineComponent` in any `.astro` file's `<script>` tag. Astro deduplicates scripts automatically — if a component is rendered 50 times, `defineComponent` is called once and 50 instances are created during scan.

```astro
<script>
  import { defineComponent } from '../scripts';

  defineComponent('accordion', {
    init({ ref, find, ac, system, viewport, prefersReducedMotion, log }) {
      const trigger = ref<HTMLButtonElement>('trigger');
      const panel   = ref<HTMLElement>('panel');

      log('init', { viewport, prefersReducedMotion });

      trigger?.addEventListener('click', () => {
        panel?.toggleAttribute('hidden');
      }, { signal: ac.signal });

      system.on('resize', ({ viewport: v }) => {
        log('resize', v);
      }, { signal: ac.signal });

      // ac.abort() is called automatically on destroy —
      // return a cleanup fn only for non-listener teardown
      return () => {
        panel?.removeAttribute('hidden'); // reset state
      };
    },
  });
</script>
```

### Declaring dependencies

Use `deps` to declare that a component must wait for another to finish `init()` before it starts.

```astro
<script>
  import { defineComponent } from '../scripts';

  defineComponent('hero', {
    deps: ['nav'],  // waits for all 'nav' instances to resolve init()
    init({ ref, log }) {
      const title = ref<HTMLElement>('title');
      log('init');
      // nav is guaranteed to be initialized here
    },
  });
</script>
```

A dependency absent from the current page DOM is silently ignored — no blocking.

## Component Context

Every `init()` call receives a context object:

| Property               | Type                                              | Description                                               |
| :--------------------- | :------------------------------------------------ | :-------------------------------------------------------- |
| `element`              | `Element`                                         | The DOM element for this instance                         |
| `viewport`             | `Readonly<Viewport>`                              | Live reference — always reflects current dimensions       |
| `prefersReducedMotion` | `boolean`                                         | Value of `prefers-reduced-motion` at time of init         |
| `system`               | `ComponentSystem`                                 | System reference for `on` / `off` event subscriptions     |
| `ac`                   | `AbortController`                                 | Aborted automatically on destroy — pass `ac.signal` to listeners |
| `find`                 | `<T extends Element>(selector: string) => T \| null` | `querySelector` scoped to `element`                  |
| `findAll`              | `<T extends Element>(selector: string) => T[]`   | `querySelectorAll` scoped to `element`, returns array     |
| `ref`                  | `<T extends Element>(name: string) => T \| null` | Finds `[data-ref="name"]` within `element`                |
| `log`                  | `(msg: string, ...args: unknown[]) => void`       | Dev-only logger prefixed with component name and element  |

### Viewport

```typescript
interface Viewport {
  width: number;   // window.innerWidth
  height: number;  // window.innerHeight
}
```

The `viewport` object is updated in-place on every throttled resize event. Because it's a live reference, components holding onto it always read the current dimensions without needing to re-subscribe.

## Cleanup and the AbortController lifecycle

The system creates one `AbortController` per instance before calling `init()`. On `destroy()`:

1. `ac.abort()` fires — removes all listeners registered with `{ signal: ac.signal }`
2. The cleanup function returned from `init()` is called, if any

Returning a cleanup function is only necessary for non-listener teardown (resetting animation state, canceling a timeline, etc.). Components that use `ac.signal` for all listeners need not return anything.

```typescript
// All three are cleaned up by one ac.abort():
trigger.addEventListener('click', onClick, { signal: ac.signal });
window.addEventListener('keydown', onKey,  { signal: ac.signal });
system.on('resize', onResize, { signal: ac.signal });
```

## System events

Subscribe to global system events via `system.on`. Pass `ac.signal` to auto-unsubscribe on destroy.

```typescript
system.on(event, callback, { signal?: AbortSignal })
system.off(event, callback)
```

| Event          | Callback payload                      | Trigger                                     |
| :------------- | :------------------------------------ | :------------------------------------------ |
| `resize`       | `{ viewport: Viewport }`              | Throttled 250 ms after `window resize`      |
| `motionchange` | `{ prefersReducedMotion: boolean }`   | `matchMedia('prefers-reduced-motion')` change |

## Global events (auto-wired at construction)

| Event                              | Action                                         |
| :--------------------------------- | :--------------------------------------------- |
| `window resize`                    | Throttled 250 ms → updates `viewport`, emits `resize` |
| `matchMedia('prefers-reduced-motion')` change | Updates `prefersReducedMotion`, emits `motionchange` |
| `astro:page-load`                  | `destroy()` all instances → `scan()` DOM       |
| `window beforeunload`              | `destroy()` all instances                      |
| `window load` *(fallback)*         | Triggers initial `scan()` if `astro:page-load` never fired |

## Dependency ordering

Components declare `deps: string[]`. The system builds initialization **waves** using Kahn's BFS topological sort:

```
Wave 0: ['footer', 'nav']    — no deps
Wave 1: ['hero']             — deps: ['nav']
Wave 2: ['carousel']         — deps: ['hero']
```

- Waves are processed sequentially
- All components within a wave initialize concurrently (`Promise.all`)
- Circular dependencies throw: `Circular dependency detected among: hero, carousel`

## Log helper

`log` is a no-op in production (`import.meta.env.DEV === false`). In development it prefixes output with the component name and element:

```
[hero] init { width: 1440, height: 900 }  <div data-component="hero">
[hero] resize { width: 768, height: 900 }
```

## File structure

```
src/scripts/
  index.ts         — Singleton + defineComponent() export
  system.ts        — ComponentSystem class (exported for testing)
  script.test.ts   — Unit tests (42 cases)
```

## Tech stack

- Astro 5, TypeScript (strict), Tailwind CSS 4
- Vitest + happy-dom for unit tests
