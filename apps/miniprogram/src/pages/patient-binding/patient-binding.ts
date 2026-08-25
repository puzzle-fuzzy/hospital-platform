import { registerPatientContractSurfacePage } from "../../services/patient-contract-surface";

/** 添加就诊人先迁移入口和安全关闭态，实名绑定 contract 确认后再接入写入。 */
registerPatientContractSurfacePage("patient-binding");
