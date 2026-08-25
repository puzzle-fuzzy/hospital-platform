import { registerClinicalSurfacePage } from "../../services/clinical-entry-surface";

/** 门诊病历当前只迁移页面外壳，真实 HIS/EMR 读取等待独立 contract。 */
registerClinicalSurfacePage("medical-record");
