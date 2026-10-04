export interface MemoryRecord {
  id: string;
  text: string;            // один факт одной фразой
  tags: string[];          // короткие метки
  created: string;         // ISO
  updated: string;
  reviewAt?: string;       // когда предложить проверить; нет — не устаревает
  source: 'user' | 'skill';
}

export interface AddMemoryInput {
  text: string;
  tags?: string[];
  reviewDays?: number;
  source?: 'user' | 'skill';
}

export interface UpdateMemoryPatch {
  text?: string;
  tags?: string[];
  reviewDays?: number | null;
}

export interface MemoryStore {
  load(): Promise<void>;
  add(input: AddMemoryInput): Promise<MemoryRecord>;
  update(id: string, patch: UpdateMemoryPatch): Promise<MemoryRecord | undefined>;
  remove(id: string): Promise<boolean>;
  list(): MemoryRecord[];
  search(query: string, limit?: number): MemoryRecord[];
  due(): MemoryRecord[];
  confirm(id: string): Promise<MemoryRecord | undefined>;
  clear(): Promise<void>;
  lastReview(): string | undefined;
  setLastReview(iso: string): Promise<void>;
}
