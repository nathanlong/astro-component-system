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

Use `data-ref` to name structural child elements within a component, accessed via the `ref()` context helper:

```html
<div data-component="accordion">
  <button data-ref="trigger">Open</button>
  <div data-ref="panel">...</div>
</div>
```

---

## Public API

### `defineComponent(name, definition)`

Registers a component definition with the system singleton.

```typescript
import { defineComponent } from '../scripts';

defineComponent('hero', {
  deps: ['nav'],  // optional — wait for 'nav' instances to finish init
  init({ find, ref, ac, system, viewport, prefersReducedMotion, log }) {
    const title   = ref<HTMLElement>('title');
    const buttons = findAll<HTMLButtonElement>('.btn');

    log('init', { viewport, prefersReducedMotion });

    // system.on and DOM listeners share the same AbortController
    system.on('resize', ({ viewport }) => {
      log('resize', viewport);
    }, { signal: ac.signal });

    buttons.forEach(btn =>
      btn.addEventListener('click', handleClick, { signal: ac.signal })
    );

    function handleClick() { /* ... */ }

    // ac.abort() called automatically on destroy — return only needed for
    // non-listener cleanup (e.g. resetting animation state)
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
| `ac` | `AbortController` | System-managed controller — aborted on destroy |
| `find` | `<T extends Element>(selector: string) => T \| null` | `querySelector` scoped to `element` |
| `findAll` | `<T extends Element>(selector: string) => T[]` | `querySelectorAll` scoped to `element`, returns array |
| `ref` | `<T extends Element>(name: string) => T \| null` | Finds `[data-ref="name"]` within `element` |
| `log` | `(msg: string, ...args: unknown[]) => void` | Dev-only logger prefixed with component name |

### Viewport

```typescript
interface Viewport {
  width: number;   // window.innerWidth
  height: number;  // window.innerHeight
}
```

Updated in place on every throttled resize event.

### `system.on(event, callback, options?)` / `system.off(event, callback)`

Opt-in subscription to global system events.

```typescript
system.on(event, callback, { signal?: AbortSignal })
system.off(event, callback)
```

When a `signal` is provided, the listener is automatically removed when the signal aborts — no `system.off()` call needed. This allows a single `AbortController` to clean up both DOM listeners and system event listeners together.

| Event | Callback payload |
|-------|-----------------|
| `'resize'` | `{ viewport: Viewport }` |
| `'motionchange'` | `{ prefersReducedMotion: boolean }` |

**Without signal** (manual cleanup):
```typescript
const onResize = ({ viewport }) => { /* ... */ };
system.on('resize', onResize);
return () => system.off('resize', onResize);
```

**With signal** (recommended — pairs with DOM listeners):
```typescript
const ac = new AbortController();
system.on('resize', ({ viewport }) => { /* ... */ }, { signal: ac.signal });
element.addEventListener('click', handler, { signal: ac.signal });
return () => ac.abort(); // cleans up both at once
```

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

### Cleanup and `ac` lifecycle

The system creates one `AbortController` per instance before calling `init()`. On `destroy()`:

1. `ac.abort()` fires — removes all listeners registered with `ac.signal`
2. The cleanup function returned from `init()` is called (if any)

Returning a cleanup function is only necessary for non-listener teardown (e.g. canceling animations, resetting DOM state). Components that only use `ac.signal` for all listeners need no return value.

### `log` helper

`log` is a no-op in production (`import.meta.env.DEV === false`). In development it prefixes output with the component name and element:

```
[hero] init { width: 1440, height: 900 }  <div data-component="hero">
[hero] resize { width: 768, height: 900 }
```

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

### Phase 1 — Registration (runs once at module load)

Astro bundles all component `<script>` blocks into a single Vite module. When the browser loads it:

```
<script type="module" src="bundle.js"> executes
  ├─ index.ts: new ComponentSystem()
  │    ├─ Measure viewport (window.innerWidth/Height)
  │    ├─ Read prefersReducedMotion
  │    └─ Attach bound handlers to window/document
  │         (throttled resize, matchMedia change, astro:page-load, beforeunload)
  │
  └─ Each component's defineComponent('name', def) runs — once per component TYPE
       └─ Stored in definitions Map
```

**Astro script deduplication:** If `Card.astro` is rendered 50 times, its `<script>` runs **once**. `defineComponent('card', def)` is called once; 50 instances are created during `scan()`.

**ES module caching:** All imports of `'../scripts'` resolve to the same cached module — the singleton is shared across every component file automatically.

### Phase 2 — Scan (runs on every astro:page-load)

`astro:page-load` fires on the initial page load and after every view transition. No separate `DOMContentLoaded` listener needed.

```
astro:page-load fires
  └─ if already scanning: return  ← concurrent scan guard
  └─ destroy() — abort all instance ACs, run cleanup fns, clear instances
  └─ querySelectorAll('[data-component]')
  └─ Filter to names present in definitions (unknown names silently skipped)
  └─ Kahn's BFS → waves: string[][]
  └─ For each wave (sequential between waves):
       └─ Promise.all — init all instances in wave concurrently:
            ├─ Create AbortController per instance
            ├─ Build context object (element, viewport, ac, find, findAll, ref, log, system...)
            ├─ try { cleanup = await def.init(ctx) } catch → console.warn, continue
            ├─ Store cleanup fn + register in instanceMap (WeakMap<Element, Instance>)
            └─ Resolve readyPromise → unblocks next wave
```

### System lifecycle

| Event | Action |
|-------|--------|
| `astro:page-load` | `destroy()` instances → `scan()` |
| `beforeunload` | `destroy()` instances |
| Test `afterEach` | `dispose()` — `destroy()` + remove global listeners |

`destroy()` cleans up component instances and keeps the system ready for the next scan. `dispose()` is a full teardown that additionally removes global event listeners — used only in tests to prevent ghost handlers accumulating across test runs.

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
| Multi-instance | 50 same-name elements → all 50 init concurrently |
| Circular dep | A→B→A throws with names in message |
| Cleanup | `ac.abort()` fires before cleanup fn; `undefined` return safe |
| Async readiness | Dependent waits for dep's `init()` to resolve |
| Context values | `element`, `viewport`, `prefersReducedMotion`, `ac`, helpers correct |
| Viewport update | Object mutated after resize event |
| Error resilience | Throwing `init()` warns, others still init |
| Page load | `astro:page-load` destroys + re-scans; inits fire again |
| Concurrent scan | Second `astro:page-load` mid-scan is ignored |
| Missing dep | Dep absent from DOM → component inits without blocking |
| system.on/off | Resize callback fires; `off()` stops firing |
| AbortController | `signal` passed to `system.on` auto-removes listener on abort |
| Mixed cleanup | One `ac.abort()` removes both DOM and system listeners |
| `find` / `findAll` | Returns elements scoped to component element |
| `ref` | Finds `[data-ref="name"]` within component element |
| `log` | No-op in production; logs with component name prefix in dev |
| `dispose()` | Removes global listeners; no ghost handlers after teardown |

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
