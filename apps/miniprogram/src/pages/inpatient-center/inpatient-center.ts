import { registerClinicalSurfacePage } from "../../services/clinical-entry-surface";

/** 住院信息当前只迁移页面外壳，真实 episode 查询等待独立 Provider contract。 */
registerClinicalSurfacePage("inpatient-center");
