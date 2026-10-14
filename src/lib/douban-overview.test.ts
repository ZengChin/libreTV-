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
}));

import { fetchDoubanOverview, OVERVIEW_GROUPS, OVERVIEW_ROWS } from './douban-overview';
import { fetchDoubanRecommend } from './douban';

const mockedFetch = vi.mocked(fetchDoubanRecommend);

function items(n: number): DoubanItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    title: `片名-${i}`,
    cover: `https://img.example/${i}.jpg`,
  }));
}

describe('OVERVIEW_ROWS 行配置', () => {
  it('行 id 唯一、标题非空、type/tag/group 合法', () => {
    const ids = new Set(OVERVIEW_ROWS.map((r) => r.id));
    expect(ids.size).toBe(OVERVIEW_ROWS.length);
    for (const row of OVERVIEW_ROWS) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(['movie', 'tv']).toContain(row.type);
      expect(row.tag.length).toBeGreaterThan(0);
      expect(OVERVIEW_GROUPS.map((g) => g.id)).toContain(row.group);
    }
  });

  it('覆盖用户要求的电影 / 电视剧 / 动漫分类', () => {
    const groups = new Set(OVERVIEW_ROWS.map((r) => r.group));
    expect(groups.has('movie')).toBe(true);
    expect(groups.has('tv')).toBe(true);
    expect(groups.has('anime')).toBe(true);
    // 动漫同时覆盖番剧（tv/日本动画）与动画电影（movie/动画）
    expect(OVERVIEW_ROWS.some((r) => r.group === 'anime' && r.type === 'tv')).toBe(true);
    expect(OVERVIEW_ROWS.some((r) => r.group === 'anime' && r.type === 'movie')).toBe(true);
  });
});

describe('fetchDoubanOverview', () => {
  beforeEach(() => {
    cacheStore.clear();
    mockedFetch.mockReset();
  });

  it('按行配置并行抓取，携带 type/tag 与固定分页参数', async () => {
    mockedFetch.mockResolvedValue(items(3));

    const rows = await fetchDoubanOverview();

    expect(rows).toHaveLength(OVERVIEW_ROWS.length);
    expect(mockedFetch).toHaveBeenCalledTimes(OVERVIEW_ROWS.length);
    for (const row of rows) {
      expect(row.ok).toBe(true);
      expect(row.items).toHaveLength(3);
    }
    // 每个分类一次请求，取首页固定条数
    for (const spec of OVERVIEW_ROWS) {
      expect(mockedFetch).toHaveBeenCalledWith(spec.type, spec.tag, 0, 18);
    }
  });

  it('单个分类失败只拖垮该行，其余行照常返回', async () => {
    mockedFetch.mockImplementation(async (_type, tag) => {
      if (tag === '综艺') throw new Error('boom');
      return items(2);
    });

    const rows = await fetchDoubanOverview();

    const failed = rows.filter((r) => !r.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0].items).toEqual([]);
    expect(rows.filter((r) => r.ok)).toHaveLength(OVERVIEW_ROWS.length - 1);
  });

  it('全部失败时抛错（接口层返回 502），不写缓存', async () => {
    mockedFetch.mockRejectedValue(new Error('douban down'));

    await expect(fetchDoubanOverview()).rejects.toThrow('douban down');
    expect(cacheStore.size).toBe(0);

    // 未写缓存：修好 mock 后重试应立即成功
    mockedFetch.mockResolvedValue(items(1));
    const rows = await fetchDoubanOverview();
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it('整体结果带缓存：连续调用不重复抓取', async () => {
    mockedFetch.mockResolvedValue(items(1));

    await fetchDoubanOverview();
    const callsAfterFirst = mockedFetch.mock.calls.length;
    await fetchDoubanOverview();

    expect(mockedFetch.mock.calls.length).toBe(callsAfterFirst);
  });
});
