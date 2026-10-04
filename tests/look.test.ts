import { describe, expect, it, vi } from 'vitest';
import { LlmError, type ChatRequest, type ChatResponse } from '../src/core/llm/client';
import {
  DEFAULT_SCREEN_QUESTION,
  createVisionLook,
  fitSize,
  type CaptureResult
} from '../src/core/vision/look';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const VISION_MODEL = 'DKS-Vision';

function okCapture(): CaptureResult {
  return { ok: true, png: PNG, width: 1920, height: 1080, source: 'Монитор 1920×1080' };
}

function makeChat(text = 'На экране открыт редактор'): {
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  return {
    requests,
    chat: vi.fn(async (req: ChatRequest): Promise<ChatResponse> => {
      requests.push(req);
      return { text, toolCalls: [] };
    })
  };
}

function userParts(req: ChatRequest): { text: string; image: string } {
  const user = req.messages[1];
  if (user.role !== 'user' || typeof user.content === 'string') {
    throw new Error('Ожидалось сообщение пользователя с картинкой');
  }
  const textPart = user.content.find((part) => part.type === 'text');
  const imagePart = user.content.find((part) => part.type === 'image');
  if (textPart === undefined || textPart.type !== 'text' || imagePart === undefined) {
    throw new Error('Нет текста или картинки');
  }
  return { text: textPart.text, image: imagePart.dataUrl };
}

describe('fitSize', () => {
  it('уменьшает длинную сторону до 1920', () => {
    expect(fitSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
  });

  it('маленькую картинку не увеличивает', () => {
    expect(fitSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('вертикальный снимок тоже вписывает по длинной стороне', () => {
    expect(fitSize(1080, 3840)).toEqual({ width: 540, height: 1920 });
  });
});

describe('createVisionLook', () => {
  it('отправляет модель visionModel, картинку и вопрос человека', async () => {
    const { chat, requests } = makeChat();
    const look = createVisionLook({
      capture: async () => okCapture(),
      chat,
      visionModel: VISION_MODEL
    });

    const result = await look.look('Что за ошибка?', 'screen');

    expect(result.ok).toBe(true);
    expect(result.content).toBe('На экране открыт редактор');
    expect(requests[0].model).toBe(VISION_MODEL);
    expect(requests[0].messages[0].role).toBe('system');
    const parts = userParts(requests[0]);
    expect(parts.text).toBe('Что за ошибка?');
    expect(parts.image.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('без вопроса использует общий вопрос', async () => {
    const { chat, requests } = makeChat();
    const look = createVisionLook({ capture: async () => okCapture(), chat, visionModel: VISION_MODEL });

    await look.look(undefined, 'screen');

    expect(userParts(requests[0]).text).toBe(DEFAULT_SCREEN_QUESTION);
  });

  it('ошибка снимка возвращается как есть', async () => {
    const { chat } = makeChat();
    const look = createVisionLook({
      capture: async () => ({ ok: false, error: 'Не получилось сделать снимок экрана' }),
      chat,
      visionModel: VISION_MODEL
    });

    const result = await look.look(undefined, 'screen');

    expect(result).toEqual({ ok: false, content: '', error: 'Не получилось сделать снимок экрана' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('таймаут даёт понятную ошибку', async () => {
    const look = createVisionLook({
      capture: async () => okCapture(),
      chat: () => new Promise<ChatResponse>(() => undefined),
      visionModel: VISION_MODEL,
      timeoutMs: 10
    });

    const result = await look.look(undefined, 'screen');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('не ответила');
  });

  it('ошибка шлюза даёт понятную ошибку', async () => {
    const look = createVisionLook({
      capture: async () => okCapture(),
      chat: async () => {
        throw new LlmError('network', 'нет сети');
      },
      visionModel: VISION_MODEL
    });

    const result = await look.look(undefined, 'screen');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('связаться');
  });

  it('пустой ответ модели — ошибка разбора', async () => {
    const { chat } = makeChat('   ');
    const look = createVisionLook({ capture: async () => okCapture(), chat, visionModel: VISION_MODEL });

    const result = await look.look(undefined, 'screen');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('не разобрала');
  });
});
