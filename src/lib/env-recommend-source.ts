export type RecommendSourceValue = 'overview' | 'douban' | 'bangumi' | 'hot-list';

/**
 * 部署者通过 DEFAULT_RECOMMEND_SOURCE 环境变量指定的首页推荐数据源默认值。
 * 可选值：overview（综合推荐，多分类一屏）/ douban（豆瓣热门）/ bangumi（Bangumi 新番放送）/ hot-list（影视热榜）。
 * 未配置返回 undefined（沿用内置默认 overview）；取值非法时告警并忽略，不影响站点运行。
 */
export function getEnvRecommendSource(): RecommendSourceValue | undefined {
  const raw = process.env.DEFAULT_RECOMMEND_SOURCE?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'douban' || raw === 'bangumi' || raw === 'hot-list' || raw === 'overview') return raw;
  console.warn(
    '[LibreTV] DEFAULT_RECOMMEND_SOURCE 取值无效，已忽略（可选 overview / douban / bangumi / hot-list）：',
    raw
  );
  return undefined;
}
