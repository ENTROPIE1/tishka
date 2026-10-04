import type { SkillOverview } from '../../../core/skills/overview';
import type { PresetInfo } from '../../../core/skills/presets';
import type { ConnectionView } from '../../../main/ipc-settings';
import { clear, el } from '../../settings/dom';
import { renderMyTab } from './my-tab';
import { renderPresetsTab } from './presets-tab';

export interface AutomationsScreen {
  refresh(): Promise<void>;
}

type TabName = 'my' | 'presets';

function tabButton(label: string, name: TabName): HTMLButtonElement {
  const node = el('button', 'automations-tab', label);
  node.type = 'button';
  node.dataset['tab'] = name;
  return node;
}

const RELOAD_EVENTS = new Set(['background.tick', 'skill.saved', 'skill.removed']);

export function mountAutomationsScreen(root: HTMLElement): AutomationsScreen {
  clear(root);
  const header = el('header', 'automations-header');
  const title = el('h1', 'automations-title', 'Автоматизации');
  const tabs = el('div', 'automations-tabs');
  const myButton = tabButton('Мои', 'my');
  const presetsButton = tabButton('Готовые', 'presets');
  tabs.append(myButton, presetsButton);
  header.append(title, tabs);
  const body = el('div', 'automations-body');
  root.append(header, body);

  let active: TabName = 'my';
  let overview: SkillOverview[] = [];
  let presets: PresetInfo[] = [];
  let connections: ConnectionView[] = [];

  function markTabs(): void {
    myButton.classList.toggle('active', active === 'my');
    presetsButton.classList.toggle('active', active === 'presets');
  }

  function paint(): void {
    markTabs();
    clear(body);
    if (active === 'my') {
      renderMyTab(body, overview, connections, {
        api: window.tishka.automations,
        confirm: (message) => window.confirm(message),
        onChanged: () => {
          void refresh();
        }
      });
      return;
    }
    renderPresetsTab(body, presets, {
      api: window.tishka.automations,
      connections,
      onChanged: () => {
        void refresh();
      }
    });
  }

  async function refresh(): Promise<void> {
    try {
      const [nextOverview, nextPresets, nextConnections] = await Promise.all([
        window.tishka.automations.overview(),
        window.tishka.automations.presets(),
        window.tishka.connections.status()
      ]);
      overview = nextOverview;
      presets = nextPresets;
      connections = nextConnections;
    } catch {
      overview = [];
      presets = [];
      connections = [];
    }
    paint();
  }

  function highlight(skillId: string): void {
    const card = body.querySelector<HTMLElement>(`.skill-card[data-skill="${skillId}"]`);
    if (card === null) {
      return;
    }
    card.scrollIntoView?.({ block: 'center' });
    card.classList.add('flash');
    window.setTimeout(() => card.classList.remove('flash'), 2000);
  }

  document.addEventListener('tishka:automations-highlight', (event) => {
    const skillId = (event as CustomEvent<{ skillId?: unknown }>).detail?.skillId;
    if (typeof skillId !== 'string') {
      return;
    }
    active = 'my';
    paint();
    highlight(skillId);
  });

  myButton.addEventListener('click', () => {
    active = 'my';
    paint();
  });
  presetsButton.addEventListener('click', () => {
    active = 'presets';
    paint();
  });

  window.tishka.onEvent((event) => {
    if (RELOAD_EVENTS.has(event.type)) {
      void refresh();
    }
  });

  void refresh();
  return { refresh };
}
