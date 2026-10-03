declare module 'httpntlm' {
  interface HttpNtlmOptions {
    url: string;
    username?: string;
    password?: string;
    domain?: string;
    workstation?: string;
    body?: string;
    headers?: Record<string, string>;
    timeout?: number;
    agent?: unknown;
  }

  interface HttpNtlmResponse {
    statusCode: number;
    body: string | Buffer;
    headers: Record<string, unknown>;
  }

  const httpntlm: {
    post(
      options: HttpNtlmOptions,
      callback: (error: Error | null, response: HttpNtlmResponse) => void
    ): void;
  };

  export = httpntlm;
}
