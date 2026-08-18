import type { Patient } from "../types";
import { ApiError } from "./api-client";
import { createSingleFlight } from "./single-flight";
import { getSessionGeneration } from "./session-generation";

/**
 * 小程序进程级患者同步协调器。
 *
 * 首页、我的、预约记录和选择页是不同的页面实例，页面级 single-flight
 * 不能互相看见对方的 Promise。若每个页面都带自己的幂等键调用同步接口，
 * 服务端会正确拒绝同一 owner/provider 的并发操作，但用户只会看到加载失败。
 * 这里把同步提升到“当前会话代际”的进程级；不同会话不会共享 Promise。
 * 跨进程、重启和最终状态仍由服务端 owner、幂等键和持久化租约负责，前端
 * 协调器不能替代服务端保护。
 */
const patientSyncFlights = new Map<
	number,
	ReturnType<typeof createSingleFlight<Array<Patient>>>
>();

function currentPatientSyncFlight() {
	const sessionGeneration = getSessionGeneration();
	const existing = patientSyncFlights.get(sessionGeneration);
	if (existing) return existing;
	const created = createSingleFlight<Array<Patient>>();
	patientSyncFlights.set(sessionGeneration, created);
	return created;
}

/** 让不同页面复用同一条在途患者同步请求。 */
export function runPatientSync(
	factory: () => Promise<Array<Patient>>,
): Promise<Array<Patient>> {
	const sessionGeneration = getSessionGeneration();
	const flight = currentPatientSyncFlight();
	const promise = flight.run(async () => {
		const patients = await factory();
		if (getSessionGeneration() !== sessionGeneration) {
			// 旧账号请求即使在网络层成功返回，也不能把患者快照交给新账号；
			// 统一错误码让页面走安全兜底，不把旧响应内容展示出来。
			throw new ApiError("Session changed while patient sync was pending", {
				code: "session-changed",
			});
		}
		return patients;
	});
	// 完成后删除当前代际的协调器，避免长期保留旧账号的闭包；失败也必须
	// 释放，下一次点击才能在同一会话内重试。不同代际的在途请求互不影响。
	void promise.then(
		() => {
			if (
				!flight.isRunning() &&
				patientSyncFlights.get(sessionGeneration) === flight
			) {
				patientSyncFlights.delete(sessionGeneration);
			}
		},
		() => {
			if (
				!flight.isRunning() &&
				patientSyncFlights.get(sessionGeneration) === flight
			) {
				patientSyncFlights.delete(sessionGeneration);
			}
		},
	);
	return promise;
}

/** 导航入口用它判断是否应等待当前快照收敛后再进入选择页。 */
export function isPatientSyncInFlight(): boolean {
	return patientSyncFlights.get(getSessionGeneration())?.isRunning() ?? false;
}
