import { registerProviderEntrySurfacePage } from "../../services/provider-entry-surface";

/** 采血预约先接入原生页面外壳；真实业务 contract 完成前保持关闭态，不复制旧端数据。 */
registerProviderEntrySurfacePage("blood-appointment");
