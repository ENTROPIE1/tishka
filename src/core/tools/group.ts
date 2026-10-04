import type { ToolRegistry } from '../types';
import type { MutableToolRegistry } from './registry';

// Группа инструментов, которую можно включать и выключать на ходу: при выключении
// её инструменты исчезают из реестра, при включении регистрируются заново.
export interface ToolGroup {
  setEnabled(enabled: boolean): void;
}

export function createToolGroup(
  registry: MutableToolRegistry,
  register: (target: ToolRegistry) => void
): ToolGroup {
  const names = new Set<string>();
  const recorder: ToolRegistry = {
    register(def, handler) {
      names.add(def.name);
      registry.register(def, handler);
    },
    unregisterSource(source) {
      registry.unregisterSource(source);
    },
    list() {
      return registry.list();
    },
    call(name, args, opts) {
      return registry.call(name, args, opts);
    }
  };

  return {
    setEnabled(enabled: boolean): void {
      for (const name of names) {
        registry.remove(name);
      }
      names.clear();
      if (enabled) {
        register(recorder);
      }
    }
  };
}
