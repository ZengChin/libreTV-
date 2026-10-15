import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchDoubanCategory, OVERVIEW_CATEGORIES } from '@/lib/douban-overview';

export const runtime = 'nodejs';

/** 综合推荐：按分类返回题材行；响应同时带分类导航列表，客户端无需硬编码 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const category = new URL(req.url).searchParams.get('category') ?? OVERVIEW_CATEGORIES[0].id;
  if (!OVERVIEW_CATEGORIES.some((c) => c.id === category)) {
    return NextResponse.json({ error: `未知推荐分类: ${category}` }, { status: 400 });
  }

  try {
    const data = await fetchDoubanCategory(category);
    return NextResponse.json({
      categories: OVERVIEW_CATEGORIES.map((c) => ({ id: c.id, name: c.name })),
      category: data,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '豆瓣推荐获取失败' },
      { status: 502 }
    );
  }
}
