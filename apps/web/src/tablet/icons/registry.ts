import { GlyphName } from './Glyph';
import { IconName } from './Icon';

export interface GlyphEntry {
  id: GlyphName;
  label: string;
  group: 'routine' | 'cleaning' | 'creative' | 'active' | 'misc';
}

export interface IconEntry {
  id: IconName;
  label: string;
}

/**
 * Enumerable list driving the admin icon picker. Keep order stable so the
 * picker UI doesn't reshuffle between sessions.
 */
export const LISTED_GLYPHS: GlyphEntry[] = [
  { id: 'tooth', label: 'Brush teeth', group: 'routine' },
  { id: 'bed', label: 'Make bed', group: 'routine' },
  { id: 'breakfast', label: 'Breakfast', group: 'routine' },
  { id: 'backpack', label: 'Pack school bag', group: 'routine' },
  { id: 'book', label: 'Read', group: 'routine' },
  { id: 'homework', label: 'Homework', group: 'routine' },
  { id: 'piano', label: 'Practice piano', group: 'routine' },
  { id: 'moon', label: 'Bedtime', group: 'routine' },
  { id: 'sun', label: 'Morning', group: 'routine' },

  { id: 'vacuum', label: 'Vacuum', group: 'cleaning' },
  { id: 'dish', label: 'Dishes', group: 'cleaning' },
  { id: 'trash', label: 'Take out trash', group: 'cleaning' },
  { id: 'clean', label: 'Tidy / clean', group: 'cleaning' },

  { id: 'draw', label: 'Draw', group: 'creative' },
  { id: 'blocks', label: 'Build / Lego', group: 'creative' },
  { id: 'spark', label: 'Spark / surprise', group: 'creative' },
  { id: 'edit', label: 'Practice / edit', group: 'creative' },

  { id: 'plant', label: 'Water plants', group: 'active' },
  { id: 'cat', label: 'Feed pet', group: 'active' },
  { id: 'snack', label: 'Snack', group: 'active' },
  { id: 'walk', label: 'Walk / outdoors', group: 'active' },

  { id: 'trophy', label: 'Achievement', group: 'misc' },
  { id: 'umbrella', label: 'Vacation', group: 'misc' },
  { id: 'cube', label: 'Cube', group: 'misc' },
  { id: 'gamepad', label: 'Games', group: 'misc' },
  { id: 'tv', label: 'Entertainment', group: 'misc' },
  { id: 'wifi', label: 'Internet', group: 'misc' },
  { id: 'fire', label: 'Streak', group: 'misc' },
  { id: 'coin', label: 'Points / cash', group: 'misc' },
  { id: 'wand', label: 'Adjustment / magic', group: 'misc' },
];

export const GLYPH_GROUP_LABELS: Record<GlyphEntry['group'], string> = {
  routine: 'Routine',
  cleaning: 'Cleaning',
  creative: 'Creative',
  active: 'Active',
  misc: 'Misc',
};

export const LISTED_ICONS: IconEntry[] = [
  { id: 'check', label: 'Check' },
  { id: 'clock', label: 'Clock' },
  { id: 'alert', label: 'Alert' },
  { id: 'lock', label: 'Lock' },
  { id: 'unlock', label: 'Unlock' },
  { id: 'coin', label: 'Coin' },
  { id: 'fire', label: 'Fire' },
  { id: 'user', label: 'User' },
  { id: 'filter', label: 'Filter' },
  { id: 'away', label: 'Away' },
  { id: 'home', label: 'Home' },
  { id: 'wifi', label: 'Wifi' },
  { id: 'chevron-l', label: 'Chevron left' },
  { id: 'chevron-r', label: 'Chevron right' },
  { id: 'chevron-d', label: 'Chevron down' },
  { id: 'send', label: 'Send' },
  { id: 'edit', label: 'Edit' },
  { id: 'plus', label: 'Plus' },
  { id: 'minus', label: 'Minus' },
  { id: 'x', label: 'Close' },
];
