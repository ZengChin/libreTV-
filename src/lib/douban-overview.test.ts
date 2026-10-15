import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoubanItem } from './types';

// 可控的内存缓存替身：用例间隔离，避免模块级缓存串味
const cacheStore = new Map<string, { value: unknown; expiresAt: number }>();
vi.mock('./fetch-utils', () => ({
  fetchUpstream: vi.fn(),
  getCache: vi.fn((key: string) => {
    const entry = cacheStore.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      cacheStore.delete(key);
      return undefined;
    }
    return entry.value;
  }),
  setCache: vi.fn((key: string, value: unknown, ttlMs: number) => {
    cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
  }),
}));

vi.mock('./douban', () => ({
  fetchDoubanRecommend: vi.fn(),
  fetchDoubanCollection: vi.fn(),
}));

import {
  fetchDoubanCategory,
  findCategorySpec,
  OVERVIEW_CATEGORIES,
} from './douban-overview';
import { fetchDoubanCollection, fetchDoubanRecommend } from './douban';

const mockedRecommend = vi.mocked(fetchDoubanRecommend);
const mockedCollection = vi.mocked(fetchDoubanCollection);

function items(n: number): DoubanItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    title: `片名-${i}`,
    cover: `https://img.example/${i}.jpg`,
  }));
}

/** 全部行默认成功：合集 20 条、标签 18 条 */
function mockAllOk() {
  mockedCollection.mockResolvedValue(items(20));
  mockedRecommend.mockResolvedValue(items(18));
}

describe('OVERVIEW_CATEGORIES 分类配置', () => {
  it('分类 id 唯一、名称非空、每类至少一个题材行', () => {
    const ids = new Set(OVERVIEW_CATEGORIES.map((c) => c.id));
    expect(ids.size).toBe(OVERVIEW_CATEGORIES.length);
    for (const category of OVERVIEW_CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(0);
      expect(category.rows.length).toBeGreaterThan(0);
    }
  });

  it('行 id 全局唯一，且每行恰好使用一种数据源', () => {
    const ids = OVERVIEW_CATEGORIES.flatMap((c) => c.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of OVERVIEW_CATEGORIES) {
      for (const row of category.rows) {
        const hasCollection = Boolean(row.collection);
        const hasTag = Boolean(row.type && row.tag);
        expect(hasCollection !== hasTag).toBe(true);
        expect(row.title.length).toBeGreaterThan(0);
      }
    }
  });

  it('合集 id 只含白名单字符', () => {
    for (const category of OVERVIEW_CATEGORIES) {
      for (const row of category.rows) {
        if (row.collection) expect(row.collection).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it('覆盖电影 / 电视剧 / 动漫分类，且含用户点名的科幻/惊悚/格斗等题材', () => {
    const ids = OVERVIEW_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('movie');
    expect(ids).toContain('tv');
    expect(ids).toContain('anime');

    const movieRows = OVERVIEW_CATEGORIES.find((c) => c.id === 'movie')!.rows.map((r) => r.title);
    expect(movieRows).toContain('科幻');
    expect(movieRows).toContain('惊悚');
    expect(movieRows).toContain('格斗');
    expect(movieRows).toContain('热门');

    const animeRows = OVERVIEW_CATEGORIES.find((c) => c.id === 'anime')!.rows.map((r) => r.title);
    expect(animeRows).toContain('日本番剧');
  });
});

describe('findCategorySpec', () => {
  it('命中返回配置，未命中返回 undefined', () => {
    expect(findCategorySpec('movie')?.name).toBe('电影');
    expect(findCategorySpec('不存在的分类')).toBeUndefined();
  });
});

describe('fetchDoubanCategory', () => {
  beforeEach(() => {
    cacheStore.clear();
    mockedRecommend.mockReset();
    mockedCollection.mockReset();
  });

  it('未知分类直接抛错，不发任何上游请求', async () => {
    await expect(fetchDoubanCategory('nope')).rejects.toThrow('未知推荐分类');
    expect(mockedCollection).not.toHaveBeenCalled();
    expect(mockedRecommend).not.toHaveBeenCalled();
  });

  it('合集行走合集接口，标签行走标签接口（各一次请求）', async () => {
    mockAllOk();

    const result = await fetchDoubanCategory('movie');

    expect(result.id).toBe('movie');
    expect(result.name).toBe('电影');
    expect(result.rows).toHaveLength(13);
    expect(result.rows.every((r) => r.ok && r.items.length > 0)).toBe(true);

    const movieCategory = findCategorySpec('movie')!;
    const collectionRows = movieCategory.rows.filter((r) => r.collection);
    const tagRows = movieCategory.rows.filter((r) => r.tag);
    expect(collectionRows).toHaveLength(8);
    expect(tagRows).toHaveLength(5);

    expect(mockedCollection).toHaveBeenCalledTimes(8);
    for (const row of collectionRows) {
      expect(mockedCollection).toHaveBeenCalledWith(row.collection);
    }
    expect(mockedRecommend).toHaveBeenCalledTimes(5);
    for (const row of tagRows) {
      expect(mockedRecommend).toHaveBeenCalledWith(row.type, row.tag, 0, 18);
    }
  });

  it('合集行截取到 18 条，标签行保持 18 条', async () => {
    mockAllOk();

    const result = await fetchDoubanCategory('movie');

    for (const row of result.rows) {
      expect(row.items).toHaveLength(18);
    }
  });

  it('单个题材失败只拖垮该行，其余行照常返回', async () => {
    mockedCollection.mockResolvedValue(items(20));
    mockedRecommend.mockImplementation(async (_type, tag) => {
      if (tag === '格斗') throw new Error('boom');
      return items(18);
    });

    const result = await fetchDoubanCategory('movie');

    const failed = result.rows.filter((r) => !r.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('movie-fighting');
    expect(failed[0].items).toEqual([]);
    expect(result.rows.filter((r) => r.ok)).toHaveLength(12);
  });

  it('全部失败时抛错且不写缓存；修好后重试立即成功', async () => {
    mockedCollection.mockRejectedValue(new Error('douban down'));
    mockedRecommend.mockRejectedValue(new Error('douban down'));

    await expect(fetchDoubanCategory('tv')).rejects.toThrow('豆瓣推荐获取失败');
    expect(cacheStore.size).toBe(0);

    mockAllOk();
    const result = await fetchDoubanCategory('tv');
    expect(result.rows.every((r) => r.ok)).toBe(true);
  });

  it('部分失败不写缓存：再次调用会重试失败的题材行', async () => {
    mockedCollection.mockResolvedValue(items(20));
    mockedRecommend.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(items(18));

    // 第一次：综艺分类的纪录片行走标签接口，失败
    await fetchDoubanCategory('variety');
    expect(cacheStore.size).toBe(0);

    // 第二次：重试后成功，此时才写缓存
    const result = await fetchDoubanCategory('variety');
    expect(result.rows.every((r) => r.ok)).toBe(true);
    expect(cacheStore.size).toBe(1);
  });

  it('分类结果按分类分别缓存：切走再切回不重复抓取', async () => {
    mockAllOk();

    await fetchDoubanCategory('anime');
    const animeCalls = mockedCollection.mock.calls.length + mockedRecommend.mock.calls.length;

    await fetchDoubanCategory('tv');
    await fetchDoubanCategory('anime');

    const totalCalls = mockedCollection.mock.calls.length + mockedRecommend.mock.calls.length;
    // 第二次 anime 走缓存，不再发请求
    expect(totalCalls).toBe(animeCalls + 7); // tv 分类 7 行
  });
});
