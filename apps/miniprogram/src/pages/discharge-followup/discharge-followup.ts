import { registerClinicalContentSurfacePage } from "../../services/clinical-content-surface";

/** 出院随访先接入原生页面外壳；真实业务 contract 完成前保持关闭态，不复制旧端数据。 */
registerClinicalContentSurfacePage("discharge-followup");
