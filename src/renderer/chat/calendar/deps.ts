import type { CalendarSituation } from '../../../core/calendar/situation';
import type {
  AddEventInput,
  CalendarConfig,
  CalendarEvent,
  CalendarRange,
  UpdateEventPatch
} from '../../../core/calendar/types';
import type { Config, TishkaEvent } from '../../../core/types';
import type { CalendarSyncResult } from '../../../main/ipc-calendar';
import type { ConfigView, ConnectionView } from '../../../main/ipc-settings';

export interface CalendarApi {
  events(range?: CalendarRange): Promise<CalendarEvent[]>;
  add(event: AddEventInput): Promise<CalendarEvent>;
  update(id: string, patch: UpdateEventPatch): Promise<CalendarEvent | undefined>;
  remove(id: string): Promise<boolean>;
  free(day: string | undefined, durationMinutes: number): Promise<{ start: string; end: string }[]>;
  situation(): Promise<CalendarSituation>;
  sync?(enable?: boolean): Promise<CalendarSyncResult>;
}

export interface CalendarConfigApi {
  get(): Promise<ConfigView>;
  save(config: Config): Promise<void>;
}

export interface CalendarScreenDeps {
  api?: CalendarApi;
  config?: CalendarConfigApi;
  connections?: () => Promise<ConnectionView[]>;
  onEvent?: (listener: (event: TishkaEvent) => void) => () => void;
  now?: () => Date;
}

export type WorkHours = CalendarConfig['workHours'];
