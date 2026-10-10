/** 与 videoToEmoji 对齐的内置角色分类（稳定 id + 中文名） */
export const BUILTIN_CATEGORIES = [
  { id: 'spongebob', name: '海绵宝宝', builtin: true },
  { id: 'doraemon', name: '哆啦A梦', builtin: true },
  { id: 'kuromi', name: '库洛米', builtin: true },
  { id: 'shinchan', name: '蜡笔小新', builtin: true },
];

export const CATEGORY_FILTER_ALL = 'all';
export const CATEGORY_FILTER_UNCATEGORIZED = 'uncategorized';

export { categoryTagStyle, metaTagStyle } from '~/utils/theme';
