import type { DoubanItem, DoubanOverviewRow } from './types';
import { fetchDoubanRecommend } from './douban';
import { getCache, setCache } from './fetch-utils';

/**
 * 首页综合推荐：一次拉取多个豆瓣分类（电影 / 剧集 / 动漫 / 综艺），
 * 每个分类一行横向滚动展示，替代旧版「单个标签 + 网格」的固定首屏。
 *
 * 与 /api/douban 单标签接口的关系：
 * - 本模块面向「首页一屏看全部分类」，服务端并行抓取 + 整体缓存；
 * - 单标签接口保留给设置中选择「豆瓣」数据源时的分类浏览视图。
 */

const CACHE_TTL = 10 * 60 * 1000;

/** 每个分类拉取的条目数：横向滚动一行 15-18 张封面，兼顾首屏体积与可浏览性 */
const ROW_PAGE_SIZE = 18;

export interface DoubanOverviewRowSpec {
  id: string;
  /** 行标题（展示用） */
  title: string;
  type: 'movie' | 'tv';
  tag: string;
  /** 所属分组（前端按分组渲染大标题） */
  group: 'movie' | 'tv' | 'anime' | 'variety';
}

/**
 * 综合推荐行配置。tag 均经过豆瓣 /j/search_subjects 实测有数据
 * （电影：热门/最新/豆瓣高分/动画；剧集：热门/国产剧/美剧/韩剧/日本动画/综艺）。
 */
export const OVERVIEW_ROWS: readonly DoubanOverviewRowSpec[] = [
  // —— 电影 ——
  { id: 'movie-hot', title: '正在热映', type: 'movie', tag: '热门', group: 'movie' },
  { id: 'movie-latest', title: '最新电影', type: 'movie', tag: '最新', group: 'movie' },
  { id: 'movie-top', title: '豆瓣高分', type: 'movie', tag: '豆瓣高分', group: 'movie' },
  // —— 电视剧 ——
  { id: 'tv-hot', title: '热门剧集', type: 'tv', tag: '热门', group: 'tv' },
  { id: 'tv-chinese', title: '国产剧', type: 'tv', tag: '国产剧', group: 'tv' },
  { id: 'tv-american', title: '美剧', type: 'tv', tag: '美剧', group: 'tv' },
  { id: 'tv-korean', title: '韩剧', type: 'tv', tag: '韩剧', group: 'tv' },
  // —— 动漫 ——
  { id: 'tv-anime', title: '日本番剧', type: 'tv', tag: '日本动画', group: 'anime' },
  { id: 'movie-anime', title: '动画电影', type: 'movie', tag: '动画', group: 'anime' },
  // —— 综艺 ——
  { id: 'tv-variety', title: '热门综艺', type: 'tv', tag: '综艺', group: 'variety' },
] as const;

/** 分组展示顺序与标题（前端渲染用，缺失分组不回退到行自身） */
export const OVERVIEW_GROUPS: readonly { id: DoubanOverviewRowSpec['group']; title: string }[] = [
  { id: 'movie', title: '电影' },
  { id: 'tv', title: '电视剧' },
  { id: 'anime', title: '动漫' },
  { id: 'variety', title: '综艺' },
] as const;

export async function fetchDoubanOverview(): Promise<DoubanOverviewRow[]> {
  const cacheKey = 'douban:overview';
  const cached = getCache<DoubanOverviewRow[]>(cacheKey);
  if (cached) return cached;

  // 并行抓取全部分类；单个分类失败不影响其余行（该行以空 items + ok=false 返回）
  const settled = await Promise.allSettled(
    OVERVIEW_ROWS.map(async (spec) => {
      const items = await fetchDoubanRecommend(spec.type, spec.tag, 0, ROW_PAGE_SIZE);
      return { ...spec, ok: true, items };
    })
  );

  const rows: DoubanOverviewRow[] = settled.map((res, i) => {
    const spec = OVERVIEW_ROWS[i];
    if (res.status === 'fulfilled') return res.value;
    return { ...spec, ok: false, items: [] as DoubanItem[] };
  });

  // 全部失败时不写缓存，让下次请求重试（并让接口返回 502）；
  // 透出首个底层错误信息，便于排查（接口层原样返回给客户端）
  if (rows.every((r) => !r.ok)) {
    const firstRejection = settled.find((res) => res.status === 'rejected');
    const reason =
      firstRejection && firstRejection.status === 'rejected' && firstRejection.reason instanceof Error
        ? firstRejection.reason.message
        : null;
    throw new Error(reason || '豆瓣推荐获取失败');
  }

  setCache(cacheKey, rows, CACHE_TTL);
  return rows;
}
