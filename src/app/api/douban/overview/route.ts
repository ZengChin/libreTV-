import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchDoubanOverview } from '@/lib/douban-overview';

export const runtime = 'nodejs';

/** 综合推荐：一次返回多个豆瓣分类（电影/剧集/动漫/综艺），服务端并行抓取 + 整体缓存 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  try {
    const rows = await fetchDoubanOverview();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '豆瓣推荐获取失败' },
      { status: 502 }
    );
  }
}
