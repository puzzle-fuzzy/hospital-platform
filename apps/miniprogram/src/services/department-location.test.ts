import { expect, test } from "bun:test";
import { searchDepartmentLocation } from "./department-location";

test("院内导航按已审核科室名称匹配并优先返回精确结果", () => {
	const results = searchDepartmentLocation("内科诊区专家门诊");

	expect(results[0]).toEqual({
		department: "内科诊区专家门诊",
		location: "门诊楼 门诊二楼 内科诊区 13号诊室、14号诊室、15号诊室",
	});
});

test("院内导航对未匹配科室返回空结果，不猜测位置", () => {
	expect(searchDepartmentLocation("不存在的科室")).toEqual([]);
	expect(searchDepartmentLocation("")).toEqual([]);
});
