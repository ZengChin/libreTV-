import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';

/**
 * 豆瓣推荐数据获取（服务端直连，带内存缓存与降级链）。
 * 旧版在浏览器里经公共 CORS 代理请求豆瓣（隐私差且不稳定），
 * 重构后由服务端直连，仅在直连被拒时降级到公共代理。
 */

const DOUBAN_API = 'https://movie.douban.com/j/search_subjects';
/** 豆瓣 App 同款合集接口：按题材/地区组织的榜单，每类 20 条且带评分 */
const REXXAR_API = 'https://m.douban.com/rexxar/api/v2/subject_collection';
const CACHE_TTL = 10 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

interface DoubanRawSubject {
  id: string;
  title: string;
  cover: string;
  rate: string;
  url?: string;
}

/** rexxar 合集条目：cover 是对象、评分在 rating.value（与 search_subjects 结构不同） */
interface DoubanCollectionSubject {
  id: string;
  title: string;
  cover?: { url?: string };
  rating?: { value?: number };
}

/** 合集 id 白名单字符（防路径穿越/注入；配置之外的 id 一律拒绝） */
const COLLECTION_ID_RE = /^[a-z0-9_]+$/;

function fallbackProxies(): string[] {
  const proxies: string[] = [];
  if (process.env.FALLBACK_CORS_PROXY) proxies.push(process.env.FALLBACK_CORS_PROXY);
  return proxies;
}

/**
 * 拉取豆瓣 JSON：先服务端直连，失败再降级到 FALLBACK_CORS_PROXY。
 * 直连返回非 2xx 或抛错时都走降级；两条路都失败返回 undefined。
 */
async function fetchDoubanJson<T>(target: string): Promise<T | undefined> {
  // 1) 服务端直连
  try {
    const res = await fetchUpstream(target, {
      timeoutMs: 8000,
      headers: { 'User-Agent': UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
    });
    if (res.ok) return (await res.json()) as T;
  } catch {
    // 忽略，走降级
  }

  // 2) 降级：经 FALLBACK_CORS_PROXY
  for (const proxy of fallbackProxies()) {
    try {
      const res = await fetchUpstream(proxy + encodeURIComponent(target), {
        timeoutMs: 8000,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) return (await res.json()) as T;
    } catch {
      // 继续尝试下一个
    }
  }
  return undefined;
}

export async function fetchDoubanRecommend(
  type: 'movie' | 'tv',
  tag: string,
  pageStart: number,
  pageSize: number
): Promise<DoubanItem[]> {
  const cacheKey = `douban:${type}:${tag}:${pageStart}:${pageSize}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const target = `${DOUBAN_API}?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;

  const data = await fetchDoubanJson<{ subjects?: DoubanRawSubject[] }>(target);
  const raw = data?.subjects;
  if (!raw) throw new Error('豆瓣推荐获取失败');

  const items: DoubanItem[] = raw.map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    rating: s.rate && s.rate !== '0' ? s.rate : undefined,
    isTv: type === 'tv',
  }));

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}

/**
 * 豆瓣 rexxar 合集（movie_scifi / tv_american / movie_top250 等）。
 * 相比 search_subjects 的标签接口：数据更全（每类固定 20 条，热门题材
 * 如科幻/喜剧在标签接口只有寥寥数条）且自带评分，首页题材行优先用它。
 */
export async function fetchDoubanCollection(collectionId: string): Promise<DoubanItem[]> {
  if (!COLLECTION_ID_RE.test(collectionId)) throw new Error(`非法的豆瓣合集 id: ${collectionId}`);

  const cacheKey = `douban:collection:${collectionId}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const target = `${REXXAR_API}/${collectionId}/items?start=0&count=20`;

  const data = await fetchDoubanJson<{
    subject_collection_items?: DoubanCollectionSubject[];
    subjects?: DoubanCollectionSubject[];
  }>(target);

  const raw = data?.subject_collection_items ?? data?.subjects;
  if (!raw) throw new Error('豆瓣合集获取失败');

  const items: DoubanItem[] = raw
    .filter((s) => s && s.id && s.title)
    .map((s) => ({
      id: String(s.id),
      title: s.title,
      cover: s.cover?.url ?? '',
      rating: s.rating?.value ? String(s.rating.value) : undefined,
    }));

  setCache(cacheKey, items, CACHE_TTL);
  return items;
}
