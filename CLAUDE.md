# Project Spec: Astro Component System

## Objective
- Build a component system to facilitate animation in Astro projects that is library agnostic and performant.

## Key Features
- Automatic DOM detection
- Dependency-ordered initialization
- Async readiness signaling
- Global event coordination
- Ensure multiple instances of the same component initialize properly
- Allows single-file Astro component editing
- Performant and minimal
- Animation library agnostic, doesn't dictate animation structure
- Works with Astro's basic events and concepts

## Tech Stack
- Astro, TypeScript, Tailwind
- Vitest

## Commands
- Build: `npm run build`
- Serve: `npm run dev`

## Project Structure
- `src` - Application source code
- `public` - Public, unprocessed assets

## Requirements
- Only the component system requires matching unit tests (`script.test.ts`)

## Boundaries
- ✅ Always: Run tests before commits, follow naming conventions
- ⚠️ Ask first: Database schema changes, adding dependencies
- 🚫 Never: Commit secrets, edit node_modules/, modify CI config

## API requirements

### Global Events

The system sets up these listeners automatically at construction to prevent common checks to have to be written for each component:

| Event | Notes |
|-------|---------|-------|
| `resize` | Throttled 250ms |
| `prefers-reduced-motion` change | `matchMedia` listener |
| `astro:page-load` |  Handles Astro view transitions |
| `beforeunload` |  Destroys all instances |

### Component Context

Each component receives some initial data:

- element: A reference to the element the component is attached to
- viewport: The globally measured and updated viewport measurements
- prefersReducedMotion: the initial state of whether the user prefers-reduced-motion
- And a reference to the component system itself

### Minimal API

Reduce as much boilerplate as possible.

Developers using this will be familiar with Vue, Stimulus.js, React, and Alpine.js. Draw inspiration from these examples.

### Common Tasks

- Querying for DOM elements
- Setting up event listeners and cleaning them up properly
- Debugging component state and animation flow

### Dependency Ordering

Components can declare dependencies.

Initialization order is computed with **Kahn's topological sort** (BFS). Components with no dependencies initialize first.

