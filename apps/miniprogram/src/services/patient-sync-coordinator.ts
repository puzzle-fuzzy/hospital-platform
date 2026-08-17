import type { Patient } from "../types";
import { createSingleFlight } from "./single-flight";

/**
 * 小程序进程级患者同步协调器。
 *
 * 首页、我的、预约记录和选择页是不同的页面实例，页面级 single-flight
 * 不能互相看见对方的 Promise。若每个页面都带自己的幂等键调用同步接口，
 * 服务端会正确拒绝同一 owner/provider 的并发操作，但用户只会看到加载失败。
 * 这里把同步提升到进程级；跨进程、重启和最终状态仍由服务端 owner、幂等键
 * 和持久化租约负责，前端协调器不能替代服务端保护。
 */
const patientSyncFlight = createSingleFlight<Array<Patient>>();

/** 让不同页面复用同一条在途患者同步请求。 */
export function runPatientSync(
	factory: () => Promise<Array<Patient>>,
): Promise<Array<Patient>> {
	return patientSyncFlight.run(factory);
}

/** 导航入口用它判断是否应等待当前快照收敛后再进入选择页。 */
export function isPatientSyncInFlight(): boolean {
	return patientSyncFlight.isRunning();
}
