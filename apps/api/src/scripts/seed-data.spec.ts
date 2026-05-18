import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Validates the starter-household JSON under seed-data/ without a database.
 * The seed script only discovers a dangling reference (a routine naming an
 * unknown Trackee, a goal naming an unknown category) halfway through a run;
 * these checks catch the drift at test time instead. They also pin the
 * example devices to documentation address ranges so real network details
 * can't creep into the fixtures.
 */

const SEED_DIR = resolve(__dirname, 'seed-data');
const load = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(SEED_DIR, file), 'utf-8')) as T;

interface SeedUser {
  displayName: string;
  username?: string;
  password?: string;
  isAdmin: boolean;
  presence:
    | { kind: 'none' | 'full_time' }
    | { kind: 'n_week_grid'; nWeeks: number; epochDate: string; cells: unknown[][] };
  devices?: { displayName: string; ipAddress: string | null; macAddress: string | null }[];
}
interface SeedGoal {
  name: string;
  category: string;
  kind: 'flat' | 'tiered';
  points?: number;
  tierValues?: number[];
}
interface SeedTask {
  name: string;
  kind: string;
  ladderRef: string;
  assignees: string[];
}

const { users } = load<{ users: SeedUser[] }>('users.json');
const { categories } = load<{ categories: { name: string }[] }>('categories.json');
const { goals } = load<{ goals: SeedGoal[] }>('goals.json');
const routines = load<Record<string, unknown> & { tasks: SeedTask[] }>('routines.json');

const dupes = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);

// RFC 5737 IPv4 documentation ranges and the RFC 7042 documentation MAC block.
const DOC_IPV4 = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;
const DOC_MAC = /^00:00:5e:00:53:[0-9a-f]{2}$/i;

describe('seed data', () => {
  it('has unique user display names, category names and task names', () => {
    expect(dupes(users.map((u) => u.displayName))).toEqual([]);
    expect(dupes(categories.map((c) => c.name))).toEqual([]);
    expect(dupes(routines.tasks.map((t) => t.name))).toEqual([]);
  });

  it('gives every admin a username and password', () => {
    for (const u of users.filter((u) => u.isAdmin)) {
      expect({ user: u.displayName, username: !!u.username, password: !!u.password }).toEqual({
        user: u.displayName,
        username: true,
        password: true,
      });
    }
  });

  it('shapes every N-week grid as nWeeks rows of 7 days', () => {
    for (const u of users) {
      if (u.presence.kind !== 'n_week_grid') continue;
      expect(u.presence.cells).toHaveLength(u.presence.nWeeks);
      for (const week of u.presence.cells) expect(week).toHaveLength(7);
      expect(u.presence.epochDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('uses only documentation addresses for example devices', () => {
    for (const d of users.flatMap((u) => u.devices ?? [])) {
      expect(d.ipAddress !== null || d.macAddress !== null).toBe(true);
      if (d.ipAddress !== null) expect(d.ipAddress).toMatch(DOC_IPV4);
      if (d.macAddress !== null) expect(d.macAddress).toMatch(DOC_MAC);
    }
  });

  it('points every goal at a known category with values for its kind', () => {
    const known = new Set(categories.map((c) => c.name));
    expect(goals.filter((g) => !known.has(g.category)).map((g) => g.name)).toEqual([]);
    for (const g of goals) {
      if (g.kind === 'tiered') expect(g.tierValues?.length ?? 0).toBeGreaterThan(0);
      else expect(typeof g.points).toBe('number');
    }
  });

  it('points every routine at known Trackees and a known ladder', () => {
    const known = new Set(users.map((u) => u.displayName));
    for (const t of routines.tasks) {
      expect(t.kind).toBe('recurring');
      expect(t.assignees.filter((a) => !known.has(a))).toEqual([]);
      expect(Array.isArray(routines[t.ladderRef])).toBe(true);
    }
  });
});
