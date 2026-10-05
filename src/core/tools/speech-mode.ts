import type { Reply, SpeechMode, ToolDef, ToolRegistry, ToolResult } from '../types';

export interface SpeechModeDeps {
  setEnabled(enabled: boolean): Promise<void>;   // сохранить и применить настройку voice.tts.enabled
  stopSpeaking(): void;
  voiceAvailable(): Promise<boolean>;
}

export const SPEECH_MODE_TOOL = 'speech_mode';

const speechMode: ToolDef = {
  name: SPEECH_MODE_TOOL,
  description:
    'Переключает, отвечать вслух или только текстом, по явной просьбе человека: «говори голосом», «отвечай вслух», «озвучивай» — mode=voice; «пиши текстом», «не говори вслух», «помолчи», «без звука» — mode=text.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['voice', 'text'],
        description: 'voice — отвечать вслух и текстом, text — только текстом'
      }
    },
    required: ['mode'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

function readMode(value: unknown): SpeechMode | undefined {
  return value === 'voice' || value === 'text' ? value : undefined;
}

function ok(content: string, reply: Reply): ToolResult {
  return { ok: true, content, reply };
}

export function registerSpeechModeTool(registry: ToolRegistry, deps: SpeechModeDeps): void {
  registry.register(speechMode, async (args): Promise<ToolResult> => {
    const mode = readMode(args.mode);
    if (mode === undefined) {
      return { ok: false, content: '', error: 'Режим должен быть voice или text' };
    }

    if (mode === 'text') {
      // Сначала глушим звучащую речь, потом выключаем синтез: подтверждение вслух не звучит.
      deps.stopSpeaking();
      await deps.setEnabled(false);
      return ok(
        'Режим ответа: только текстом, вслух не говорю.',
        { say: 'Хорошо, пишу молча', mood: 'neutral' }
      );
    }

    await deps.setEnabled(true);
    if (!(await deps.voiceAvailable())) {
      // Настройка включается, но честно сообщаем, что звука сейчас не будет.
      return ok(
        'Режим ответа включён, но служба синтеза недоступна — отвечаю текстом.',
        { say: 'Голос сейчас недоступен, пишу текстом', mood: 'confused' }
      );
    }
    return ok('Режим ответа: вслух и текстом.', { say: 'Хорошо, говорю вслух', mood: 'happy' });
  });
}
