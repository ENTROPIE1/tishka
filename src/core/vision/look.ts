import type { ChatMessage, ChatRequest, ChatResponse, ContentPart } from '../llm/client';
import { LlmError } from '../llm/client';
import { replyFromText } from '../agent/reply';
import type { ToolResult } from '../types';

export type ScreenTarget = 'screen' | 'window';

export interface CaptureOk {
  ok: true;
  png: Uint8Array;
  jpeg?: Uint8Array;   // сжатая копия для отправки модели; нет — модель получает png
  width: number;
  height: number;
  source: string;
}

export interface CaptureFail {
  ok: false;
  error: string;
}

export type CaptureResult = CaptureOk | CaptureFail;

export const SCREEN_SYSTEM_PROMPT =
  'Ты — ёжик Тишка, настольный помощник, живёшь на экране компьютера. ' +
  'Добродушный и деловитый, говоришь с человеком на «ты», о себе — в мужском роде, без канцелярита и смайликов. ' +
  'Ты смотришь на снимок экрана человека. Отвечай по-русски, только о том, что видно на снимке, коротко: ' +
  'одного-двух предложений достаточно. Текст с экрана переписывай точно. ' +
  'Если чего-то не видно или не разобрать — так и скажи, не додумывай';

export const DEFAULT_SCREEN_QUESTION =
  'Что на экране? Опиши коротко: какое приложение, что открыто, есть ли ошибки или предупреждения';

export const VISION_TIMEOUT_MS = 60_000;
export const MAX_IMAGE_SIDE = 1600;

// Длинная сторона снимка уменьшается до maxSide; маленькие не увеличиваются.
export function fitSize(
  width: number,
  height: number,
  maxSide: number = MAX_IMAGE_SIDE
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) {
    return { width, height };
  }
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function toDataUrl(bytes: Uint8Array): string {
  const mime = isJpeg(bytes) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export interface LookOptions {
  answerDirectly?: boolean;   // true — ответ можно отдать человеку сразу, без второго шага основной модели
}

export interface VisionLookDeps {
  capture(target: ScreenTarget): Promise<CaptureResult>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  visionModel: string | (() => string);
  timeoutMs?: number;
}

export interface VisionLook {
  look(question: string | undefined, target: ScreenTarget, opts?: LookOptions): Promise<ToolResult>;
}

class VisionTimeoutError extends Error {
  constructor() {
    super('Модель не ответила за минуту');
    this.name = 'VisionTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new VisionTimeoutError());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function visionError(error: unknown): string {
  if (error instanceof VisionTimeoutError) {
    return error.message;
  }
  if (error instanceof LlmError) {
    if (error.kind === 'network') {
      return 'Не удалось связаться со шлюзом моделей';
    }
    if (error.kind === 'auth') {
      return 'Ключ шлюза моделей отклонён';
    }
    if (error.kind === 'limit') {
      return 'Шлюз моделей просит подождать';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Не получилось разобрать снимок';
}

export function createVisionLook(deps: VisionLookDeps): VisionLook {
  const timeoutMs = deps.timeoutMs ?? VISION_TIMEOUT_MS;
  const visionModel = (): string =>
    typeof deps.visionModel === 'function' ? deps.visionModel() : deps.visionModel;

  return {
    async look(question, target, opts) {
      const shot = await deps.capture(target);
      if (!shot.ok) {
        return { ok: false, content: '', error: shot.error };
      }
      const text = question !== undefined && question.trim() !== '' ? question.trim() : DEFAULT_SCREEN_QUESTION;
      const content: ContentPart[] = [
        { type: 'text', text },
        { type: 'image', dataUrl: toDataUrl(shot.jpeg ?? shot.png) }
      ];
      const messages: ChatMessage[] = [
        { role: 'system', content: SCREEN_SYSTEM_PROMPT },
        { role: 'user', content }
      ];
      try {
        const response = await withTimeout(deps.chat({ model: visionModel(), messages }), timeoutMs);
        const answer = (response.text ?? '').trim();
        if (answer === '') {
          return { ok: false, content: '', error: 'Модель не разобрала снимок' };
        }
        // png остаётся в data: инструмент экрана сохраняет снимок в файл и кладёт
        // его в ленту, а основной модели уходит только текст разбора.
        const result: ToolResult = { ok: true, content: answer, data: { source: shot.source, png: shot.png } };
        // Готовый ответ человеку прикладывается только по явной просьбе
        // отвечать напрямую: иначе разбор уходит основной модели, и она
        // достраивает составную просьбу или шаг навыка.
        if (opts?.answerDirectly === true) {
          result.reply = replyFromText(answer);
        }
        return result;
      } catch (error) {
        return { ok: false, content: '', error: visionError(error) };
      }
    }
  };
}
