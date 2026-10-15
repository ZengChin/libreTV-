import type { DoubanItem, DoubanOverviewCategory, DoubanOverviewRow } from './types';
import { fetchDoubanCollection, fetchDoubanRecommend } from './douban';
import { getCache, setCache } from './fetch-utils';

/**
 * 首页综合推荐：按「电影 / 电视剧 / 动漫 / 综艺」四大分类组织，
 * 每个分类下按题材分行（热门、格斗、科幻、惊悚……），前端顶部分类导航切换。
 *
 * 数据源两种，按行配置二选一：
 * - collection：豆瓣 rexxar 合集，数据全（每类 20 条）且带评分，优先使用；
 * - type/tag：豆瓣 search_subjects 标签接口，补充合集未覆盖的题材/地区。
 */

const CACHE_TTL = 10 * 60 * 1000;

/** 每个题材行拉取的条目数（横向滚动，18 张封面足够浏览） */
const ROW_PAGE_SIZE = 18;

export interface DoubanRowSpec {
  id: string;
  /** 题材行标题（展示用） */
  title: string;
  /** rexxar 合集 id（数据更全、带评分），与 type/tag 二选一 */
  collection?: string;
  /** search_subjects 标签接口的类型，与 tag 成对出现 */
  type?: 'movie' | 'tv';
  /** search_subjects 标签 */
  tag?: string;
}

export interface DoubanCategorySpec {
  id: 'movie' | 'tv' | 'anime' | 'variety';
  /** 顶部分类导航名 */
  name: string;
  rows: readonly DoubanRowSpec[];
}

/**
 * 分类与题材行配置。tag 均经实测有数据；
 * 科幻/喜剧/动作/爱情在 search_subjects 标签接口数据极少（2-6 条），
 * 故这些行走 rexxar 合集（movie_scifi 等，20 条带评分）。
 */
export const OVERVIEW_CATEGORIES: readonly DoubanCategorySpec[] = [
  {
    id: 'movie',
    name: '电影',
    rows: [
      { id: 'movie-hot', title: '热门', collection: 'movie_hot' },
      { id: 'movie-showing', title: '正在热映', collection: 'movie_showing' },
      { id: 'movie-latest', title: '最新', collection: 'movie_latest' },
      { id: 'movie-top', title: '豆瓣高分', collection: 'movie_top250' },
      { id: 'movie-action', title: '动作', collection: 'movie_action' },
      { id: 'movie-fighting', title: '格斗', type: 'movie', tag: '格斗' },
      { id: 'movie-comedy', title: '喜剧', collection: 'movie_comedy' },
      { id: 'movie-romance', title: '爱情', collection: 'movie_love' },
      { id: 'movie-scifi', title: '科幻', collection: 'movie_scifi' },
      { id: 'movie-thriller', title: '惊悚', type: 'movie', tag: '惊悚' },
      { id: 'movie-crime', title: '犯罪', type: 'movie', tag: '犯罪' },
      { id: 'movie-fantasy', title: '奇幻', type: 'movie', tag: '奇幻' },
      { id: 'movie-adventure', title: '冒险', type: 'movie', tag: '冒险' },
    ],
  },
  {
    id: 'tv',
    name: '电视剧',
    rows: [
      { id: 'tv-hot', title: '热门', type: 'tv', tag: '热门' },
      { id: 'tv-chinese', title: '国产剧', type: 'tv', tag: '国产剧' },
      { id: 'tv-american', title: '美剧', collection: 'tv_american' },
      { id: 'tv-korean', title: '韩剧', collection: 'tv_korean' },
      { id: 'tv-japanese', title: '日剧', collection: 'tv_japanese' },
      { id: 'tv-british', title: '英剧', type: 'tv', tag: '英剧' },
      { id: 'tv-hongkong', title: '港剧', type: 'tv', tag: '港剧' },
    ],
  },
  {
    id: 'anime',
    name: '动漫',
    rows: [
      { id: 'anime-bangumi', title: '日本番剧', type: 'tv', tag: '日本动画' },
      { id: 'anime-chinese', title: '国漫', type: 'movie', tag: '国漫' },
      { id: 'anime-movie', title: '动画电影', type: 'movie', tag: '动画' },
    ],
  },
  {
    id: 'variety',
    name: '综艺',
    rows: [
      { id: 'variety-show', title: '热门综艺', type: 'tv', tag: '综艺' },
      { id: 'variety-documentary', title: '纪录片', type: 'tv', tag: '纪录片' },
    ],
  },
] as const;

export function findCategorySpec(id: string): DoubanCategorySpec | undefined {
  return OVERVIEW_CATEGORIES.find((c) => c.id === id);
}

async function fetchRow(spec: DoubanRowSpec): Promise<DoubanOverviewRow> {
  try {
    let items: DoubanItem[];
    if (spec.collection) {
      items = (await fetchDoubanCollection(spec.collection)).slice(0, ROW_PAGE_SIZE);
    } else if (spec.type && spec.tag) {
      items = await fetchDoubanRecommend(spec.type, spec.tag, 0, ROW_PAGE_SIZE);
    } else {
      throw new Error(`推荐行配置无效: ${spec.id}`);
    }
    return { id: spec.id, title: spec.title, ok: true, items };
  } catch {
    // 单个题材失败只拖垮该行（ok=false，前端隐藏），不影响分类内其他行
    return { id: spec.id, title: spec.title, ok: false, items: [] };
  }
}

/** 按分类 id 拉取该分类下全部题材行；分类 id 不存在时抛错 */
export async function fetchDoubanCategory(categoryId: string): Promise<DoubanOverviewCategory> {
  const spec = findCategorySpec(categoryId);
  if (!spec) throw new Error(`未知推荐分类: ${categoryId}`);

  const cacheKey = `douban:category:${spec.id}`;
  const cached = getCache<DoubanOverviewCategory>(cacheKey);
  if (cached) return cached;

  const rows = await Promise.all(spec.rows.map(fetchRow));

  // 全部失败：不写缓存，直接抛错（接口层返回 502，前端走错误态重试）
  if (rows.every((r) => !r.ok)) {
    throw new Error('豆瓣推荐获取失败');
  }
  // 部分失败也不写缓存：让后续请求有机会补全失败的题材行
  if (rows.some((r) => !r.ok)) {
    return { id: spec.id, name: spec.name, rows };
  }

  setCache(cacheKey, { id: spec.id, name: spec.name, rows }, CACHE_TTL);
  return { id: spec.id, name: spec.name, rows };
}
