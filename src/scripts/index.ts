import { ComponentSystem } from './system';

export type { Viewport, ComponentContext, ComponentDefinition, CleanupFn } from './system';

declare global {
  interface Window {
    __componentSystem?: ComponentSystem;
  }
}

const system = new ComponentSystem();

if (import.meta.env.DEV) {
  window.__componentSystem = system;
}

export function defineComponent(
  name: string,
  def: import('./system').ComponentDefinition,
): void {
  system.register(name, def);
}
