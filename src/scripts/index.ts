import { ComponentSystem } from './system';

export type { Viewport, ComponentContext, ComponentDefinition, CleanupFn } from './system';

const system = new ComponentSystem();

export function defineComponent(
  name: string,
  def: import('./system').ComponentDefinition,
): void {
  system.register(name, def);
}
