/**
 * 页面读请求的“最后一次请求获胜”守卫。
 *
 * 微信小程序不能保证所有 wx.request 都立即停止；患者切换、下拉刷新和
 * tab 切换时，旧请求仍可能晚于新请求返回。页面必须阻止旧请求回写，
 * 否则旧患者的报告、挂号记录或费用会覆盖新患者。
 */
export type LatestRequestGuard = {
	/** 开始一次新的页面读操作，并使之前的操作失效。 */
	begin(): number;
	/** 判断某个异步操作是否仍有资格回写页面。 */
	isCurrent(token: number): boolean;
};

export function createLatestRequestGuard(): LatestRequestGuard {
	let latestToken = 0;
	return {
		begin(): number {
			latestToken += 1;
			return latestToken;
		},
		isCurrent(token: number): boolean {
			return token === latestToken;
		},
	};
}
