import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { WakeFlow } from '../src/voice/wake-flow';

const listeners = new Map<string, (...args: unknown[]) => void>();

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (...args: unknown[]) => void) => void listeners.set(channel, fn)
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

import { registerChatTalk } from '../src/main/chat-talk';
import { CHAT_TALK_PHRASE_CHANNEL } from '../src/main/ipc-channels';
import { voice } from './wake-test-helpers';

function flowStub(): { flow: WakeFlow; phrases: Uint8Array[] } {
  const phrases: Uint8Array[] = [];
  const flow = {
    conversationOwner: () => 'chat' as const,
    isLeavingSoon: () => false,
    handlePhrase: (wav: Uint8Array) => void phrases.push(wav),
    toggleConversation: vi.fn(),
    escape: vi.fn(),
    onKeyboardInput: vi.fn()
  } as unknown as WakeFlow;
  return { flow, phrases };
}

describe('registerChatTalk: пауза', () => {
  it('фраза во время паузы не доходит до ядра, после — снова доходит', () => {
    const { flow, phrases } = flowStub();
    const talk = registerChatTalk({
      flow,
      bus: createEventBus(),
      getVoice: () => voice(),
      isReady: () => true
    });
    const send = listeners.get(CHAT_TALK_PHRASE_CHANNEL);
    expect(send).toBeDefined();

    send?.({}, new Uint8Array([1]));
    expect(phrases).toHaveLength(1);

    talk.setPaused(true);
    send?.({}, new Uint8Array([2]));
    expect(phrases).toHaveLength(1);

    talk.setPaused(false);
    send?.({}, new Uint8Array([3]));
    expect(phrases).toHaveLength(2);

    talk.dispose();
  });
});
