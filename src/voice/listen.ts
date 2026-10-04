export type ListenCommand = 'start' | 'stop' | 'cancel';

export type ListenResult =
  | { kind: 'wav'; data: Uint8Array }
  | { kind: 'nospeech' }
  | { kind: 'error'; message: string }
  | { kind: 'cancel' };
