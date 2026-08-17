/**
 * 平台内部 opaque 标识的长度上限。
 *
 * HTTP schema 会执行同样的限制，但服务层也可能被 worker、组合测试或
 * 未来内部任务直接调用；因此不能把这个边界只放在 Elysia 路由层。
 */
export const MAX_OPAQUE_IDENTIFIER_LENGTH = 128;

/**
 * 只校验 opaque 标识的形状，不代表它已经通过 owner、TTL 或 provider 映射。
 *
 * 前后空白和控制字符会破坏查询语义或日志检索；其它字符仍保持开放，避免
 * 在尚未冻结 provider 标识字符集前擅自增加正则白名单，造成合法 ID 被拒绝。
 */
export function isBoundedOpaqueIdentifier(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_OPAQUE_IDENTIFIER_LENGTH &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}
