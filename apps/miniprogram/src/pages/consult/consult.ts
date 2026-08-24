/**
	“就诊”是旧端四个主 Tab 之一。实时陪诊依赖独立的消息/队列 contract，
	尚未冻结前只提供稳定迁移状态，不调用旧 WebSocket、不猜测排队状态。
*/
type ConsultPageData = Record<string, never>;

Page<ConsultPageData, {}>({ data: {} });
