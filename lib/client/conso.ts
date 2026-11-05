// Conso grouping, sort order, and calm 10-colour palette for VTech BOQ views.

export interface ConsoGroupMeta {
  name: string;
  color: string;      // 10 calm palette colours (left stripe / dots)
  light: string;      // subtle background for badges / chips
  text: string;       // contrasting text color
  border: string;     // border color
  sort: number;
}

export const CONSO_GROUPS: Record<string, ConsoGroupMeta> = {
  'User interface': {
    name: 'User interface',
    color: '#3B82F6', // Blue
    light: '#EFF6FF',
    text: '#1D4ED8',
    border: '#BFDBFE',
    sort: 1,
  },
  'Backend': {
    name: 'Backend',
    color: '#64748B', // Slate
    light: '#F8FAFC',
    text: '#334155',
    border: '#CBD5E1',
    sort: 10,
  },
  'AV Rack location': {
    name: 'AV Rack location',
    color: '#0284C7', // Sky
    light: '#F0F9FF',
    text: '#0369A1',
    border: '#BAE6FD',
    sort: 20,
  },
  'Curtain': {
    name: 'Curtain',
    color: '#D97706', // Amber
    light: '#FFFBEB',
    text: '#B45309',
    border: '#FDE68A',
    sort: 30,
  },
  'Audio': {
    name: 'Audio',
    color: '#059669', // Emerald
    light: '#ECFDF5',
    text: '#047857',
    border: '#A7F3D0',
    sort: 40,
  },
  'Door lock': {
    name: 'Door lock',
    color: '#E11D48', // Rose
    light: '#FFF1F2',
    text: '#BE123C',
    border: '#FECDD3',
    sort: 50,
  },
  'Camera': {
    name: 'Camera',
    color: '#7C3AED', // Purple
    light: '#F5F3FF',
    text: '#6D28D9',
    border: '#DDD6FE',
    sort: 61,
  },
  'Network': {
    name: 'Network',
    color: '#0D9488', // Teal
    light: '#F0FDFA',
    text: '#0F766E',
    border: '#99F6E4',
    sort: 80,
  },
  'Misc': {
    name: 'Misc',
    color: '#4F46E5', // Indigo
    light: '#EEF2FF',
    text: '#3730A3',
    border: '#C7D2FE',
    sort: 90,
  },
  'Other': {
    name: 'Other',
    color: '#94A3B8', // Neutral grey
    light: '#F1F5F9',
    text: '#475569',
    border: '#E2E8F0',
    sort: 999,
  },
};

export const CONSO_ORDER = [
  'User interface',
  'Backend',
  'AV Rack location',
  'Curtain',
  'Audio',
  'Door lock',
  'Camera',
  'Network',
  'Misc',
  'Other',
] as const;

export function getConsoGroupMeta(groupName?: string | null): ConsoGroupMeta {
  if (!groupName) return CONSO_GROUPS['Other'];
  return CONSO_GROUPS[groupName] || CONSO_GROUPS['Other'];
}

