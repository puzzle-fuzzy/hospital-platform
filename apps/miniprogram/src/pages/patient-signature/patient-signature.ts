import { registerPatientContractSurfacePage } from "../../services/patient-contract-surface";

/** 患者签名只迁移安全入口，不复用旧端假患者和未知外部小程序。 */
registerPatientContractSurfacePage("patient-signature");
