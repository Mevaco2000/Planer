export type Status = 'todo' | 'doing' | 'done';

/** 1 = pilne, 2 = wysoki, 3 = średni, 4 = brak */
export type Priority = 1 | 2 | 3 | 4;

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

/** Od czego liczyć następny termin: od terminu (stały rytm) albo od dnia zrobienia (np. fryzjer 2 tygodnie po ostatniej wizycie). */
export type RepeatFrom = 'due' | 'done';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  /** null = Skrzynka */
  projectId: string | null;
  /** etap projektu (poziom między projektem a zadaniem); null = bez etapu */
  stageId: string | null;
  /** większe zadania, na które to zadanie wpływa (może być kilka – np. jeden zakup potrzebny w dwóch sprawach) */
  parentIds: string[];
  status: Status;
  priority: Priority;
  /** termin: RRRR-MM-DD; null = bez terminu */
  due: string | null;
  /** godzina: GG:MM; null = cały dzień */
  time: string | null;
  /** czas trwania w minutach (plan dnia); null = nie podano */
  duration: number | null;
  /** przypomnienie: ile minut przed terminem (0 = w momencie); null = bez */
  remind: number | null;
  repeat: Repeat | null;
  /** co ile jednostek powtarzania: co 2 dni, co 3 tygodnie; 1 = każdy */
  every: number;
  /** powtarzanie co tydzień: dni tygodnia (0 = pon … 6 = nd); puste = dzień tygodnia terminu */
  repeatDays: number[];
  repeatFrom: RepeatFrom;
  subtasks: Subtask[];
  /** kolejność kroków w planie projektu (rosnąco) */
  order: number;
  createdAt: number;
  updatedAt: number;
  /** kiedy zrobione; null = otwarte */
  completedAt: number | null;
  /** kiedy ostatnio odhaczone (także zadanie powtarzane, które wraca z nowym terminem) */
  lastDone: number | null;
  /** ile razy zrobiono zadanie powtarzane */
  doneCount: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: number;
  /** grupa projektów; null = bez grupy */
  groupId: string | null;
  /** zadania po kolei: następny krok dopiero po zrobieniu poprzedniego */
  sequential: boolean;
}

/** Etap projektu – poziom między projektem a zadaniem (np. „Przygotowanie”, „Wykonanie”, „Odbiór”). */
export interface Stage {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: number;
  /** termin etapu; null = bez terminu */
  due: string | null;
}

export interface Group {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface Settings {
  /** godzina przypomnień dla zadań bez godziny */
  morningHour: number;
  /** domyślne przypomnienie dla nowych zadań z godziną (minuty przed); null = bez */
  defaultRemind: number | null;
  /** przypomnienia push włączone na co najmniej jednym urządzeniu – wtedy aplikacja wysyła je do Workera */
  remindersOn: boolean;
  /** pary zadań/podzadań potwierdzone jako różne – aplikacja nie pyta o nie drugi raz */
  distinct: string[];
}
