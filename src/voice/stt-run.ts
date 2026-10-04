export interface RunToken {
  id: number;
  cancelled: boolean;
  failure: string | undefined;
  wake: (() => void) | undefined;
}

// Ожидание, прерываемое отменой запуска или ранним выходом процесса.
export function delayOrWake(run: RunToken, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      run.wake = undefined;
      resolve();
    }, ms);
    run.wake = () => {
      clearTimeout(timer);
      run.wake = undefined;
      resolve();
    };
  });
}

export function reasonFromExit(code: number | null, tail: string): string {
  const reason = code === null ? 'процесс завершён' : `код выхода ${code}`;
  const output = tail.trim();
  return output === '' ? reason : `${reason}; вывод: ${output}`;
}

// Каждый start() получает номер запуска; новый запуск отменяет предыдущий.
export class RunController {
  private current: RunToken | undefined;

  begin(): RunToken {
    if (this.current !== undefined) {
      this.current.cancelled = true;
      this.current.wake?.();
    }
    this.current = {
      id: (this.current?.id ?? 0) + 1,
      cancelled: false,
      failure: undefined,
      wake: undefined
    };
    return this.current;
  }

  cancel(): void {
    if (this.current !== undefined) {
      this.current.cancelled = true;
      this.current.wake?.();
    }
  }
}
