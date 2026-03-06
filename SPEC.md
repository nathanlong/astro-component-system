# Astro Component Orchestration System — Specification

## Objective

A minimal, library-agnostic component orchestration system for Astro projects focused on animation. Handles DOM detection, dependency-ordered initialization, event coordination, and cleanup — so component authors focus only on animation logic.

---

## Key Features

- **Automatic DOM detection** via `data-component` attributes
- **Dependency-ordered initialization** using Kahn's topological sort (BFS)
- **Async readiness signaling** — a component is "ready" when its `init()` resolves
- **Global event coordination** — resize, prefers-reduced-motion, view transitions, unload
- **Multiple instances** — every matching element gets its own isolated instance
- **Single-file Astro component editing** — define components in `.astro` `<script>` tags
- **Resilient error handling** — failed `init()` logs a warning, never crashes the system

---

## Tech Stack

- Astro 5, TypeScript (strict), Tailwind CSS 4
- Vitest + happy-dom for unit tests

---

## HTML Markup Convention

```html
<div data-component="hero">
  <span class="title">...</span>
</div>
```

One component name per element. The value of `data-component` is matched against registered component definitions.

---

## Public API

### `defineComponent(name, definition)`

Registers a component definition with the system singleton.

```typescript
import { defineComponent } from '../scripts';

defineComponent('hero', {
  deps: ['nav'],           // optional — wait for 'nav' instances to finish init
  async init({ element, viewport, prefersReducedMotion, system }) {
    const title = element.querySelector('.title');

    // React to resize
    const onResize = ({ viewport }) => { /* update layout */ };
    system.on('resize', onResize);

    // Return cleanup
    return () => {
      system.off('resize', onResize);
    };
  }
});
```

### Component Context

Each `init()` call receives:

| Property | Type | Description |
|----------|------|-------------|
| `element` | `Element` | The DOM element bound to this instance |
| `viewport` | `Readonly<Viewport>` | Live reference — always current dimensions |
| `prefersReducedMotion` | `boolean` | Value at time of init |
| `system` | `ComponentSystem` | System reference for `on`/`off` event subscription |

### Viewport

```typescript
interface Viewport {
  width: number;   // window.innerWidth
  height: number;  // window.innerHeight
}
```

Updated in place on every throttled resize event.

### `system.on(event, callback)` / `system.off(event, callback)`

Opt-in subscription to global system events. Always clean up in the returned cleanup function.

| Event | Callback payload |
|-------|-----------------|
| `'resize'` | `{ viewport: Viewport }` |
| `'motionchange'` | `{ prefersReducedMotion: boolean }` |

---

## Component Definition Shape

```typescript
interface ComponentDefinition {
  deps?: string[];
  init(ctx: ComponentContext): void | CleanupFn | Promise<void | CleanupFn>;
}

type CleanupFn = () => void;
```

`deps` defaults to `[]`. A component listed as a dep but not present in the current DOM is silently ignored — no blocking.

---

## Global Events (auto-wired at construction)

| Event | Behavior |
|-------|----------|
| `window resize` | Throttled 250ms → updates `viewport`, emits `'resize'` to subscribers |
| `matchMedia('prefers-reduced-motion')` change | Updates `prefersReducedMotion`, emits `'motionchange'` |
| `astro:page-load` | `destroy()` all instances, re-`scan()` DOM |
| `window beforeunload` | `destroy()` all instances |

`astro:page-load` covers both initial page load and view transitions in Astro 5.

---

## Dependency Ordering — Kahn's Topological Sort

Components declare `deps: string[]`. The system computes initialization waves:

```
Wave 0: ['footer', 'nav']       // no deps
Wave 1: ['hero']                // deps: ['nav']
Wave 2: ['carousel']            // deps: ['hero']
```

- Waves are processed sequentially
- All components within a wave are initialized concurrently (`Promise.all`)
- A component only starts after all its declared deps have resolved `init()`
- Circular dependencies throw: `"Circular dependency detected among: hero, carousel"`

---

## Initialization Flow

```
1. Module import
   └─ new ComponentSystem()
        ├─ Measure viewport
        ├─ Read prefersReducedMotion
        └─ Wire global event listeners

2. .astro <script> tags execute
   └─ defineComponent('name', def) × N  →  stored in definitions map

3. astro:page-load fires
   └─ destroy() → clear all instances
   └─ scan()
        ├─ querySelectorAll('[data-component]')
        ├─ Build subgraph from present names
        ├─ Kahn's BFS → waves: string[][]
        └─ For each wave:
             ├─ Create ComponentInstance per element
             └─ Promise.all(init(ctx) per instance)
                  ├─ On resolve: store cleanup, mark "ready"
                  └─ On reject: console.warn, mark failed, continue
```

---

## Error Handling

If `init()` throws or rejects:

```
[ComponentSystem] 'hero' init failed on <div data-component="hero">
Error: Cannot read properties of null (reading 'animate')
```

- The component instance is marked failed
- Its `readyPromise` still resolves (so dependents are not permanently blocked)
- All other components initialize normally

---

## File Structure

```
src/scripts/
  index.ts         — Singleton + defineComponent() export
  system.ts        — ComponentSystem class (exported for testing)
  script.test.ts   — Unit tests
```

---

## Testing Strategy

Tests import `ComponentSystem` directly from `system.ts` (not the singleton). Each test creates a fresh instance.

### `matchMedia` stub (required for happy-dom)

```typescript
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});
```

### Test Coverage

| Group | Cases |
|-------|-------|
| Registration | Store definition; duplicate overwrites |
| DOM scan | Find all `[data-component]` elements; ignore undefined |
| Init order | Wave 0 before Wave 1; async dep blocks dependent |
| Multi-instance | Multiple same-name elements all get `init` |
| Circular dep | A→B→A throws with names in message |
| Cleanup | Returned fn called on `destroy()`; `undefined` return safe |
| Async readiness | Dependent waits for dep's `init()` to resolve |
| Context values | `element`, `viewport`, `prefersReducedMotion` correct |
| Viewport update | Object mutated after resize event |
| Error resilience | Throwing `init()` warns, others still init |
| Page load | `astro:page-load` destroys + re-scans; inits fire again |
| Missing dep | Dep absent from DOM → component inits without blocking |
| system.on/off | Resize callback fires; `off()` stops firing |

---

## Implementation Order

1. `src/scripts/system.ts` — full `ComponentSystem` class
2. `src/scripts/script.test.ts` — all test cases (red phase)
3. Implement `scan()` + Kahn's sort → ordering tests green
4. Implement `destroy()` / cleanup → cleanup tests green
5. Implement global event wiring → event tests green
6. `src/scripts/index.ts` — singleton + `defineComponent` export
7. Verify: `npx vitest run` all pass, `npm run build` clean
8. Add demo element to `src/pages/index.astro` for browser smoke test
