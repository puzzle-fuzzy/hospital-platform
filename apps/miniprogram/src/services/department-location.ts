import departmentLocations from "../data/department-location";
import type { DepartmentLocationView } from "../types";

function removeOutpatient(text: string): string {
	return text.replace(/门诊/g, "").trim();
}

/**
 * 旧端“院内导航”只查询已审核的静态科室位置，不是实时路线规划。
 * 匹配不到时返回空结果，不能把科室名称拼接成未经审核的楼层或诊室。
 */
export function searchDepartmentLocation(
	department: string,
): DepartmentLocationView[] {
	const cleanedDepartment = removeOutpatient(department);
	if (!cleanedDepartment) return [];

	const results: DepartmentLocationView[] = [];
	for (const [name, location] of Object.entries(departmentLocations)) {
		const cleanedName = removeOutpatient(name);
		if (
			cleanedName === cleanedDepartment ||
			cleanedName.includes(cleanedDepartment) ||
			cleanedDepartment.includes(cleanedName)
		) {
			results.push({ department: name, location });
		}
	}

	return results.sort((left, right) => {
		const leftName = removeOutpatient(left.department);
		const rightName = removeOutpatient(right.department);
		if (leftName === cleanedDepartment && rightName !== cleanedDepartment)
			return -1;
		if (leftName !== cleanedDepartment && rightName === cleanedDepartment)
			return 1;
		return leftName.length - rightName.length;
	});
}
