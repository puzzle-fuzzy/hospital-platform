/** “就诊”是旧端四个主 Tab 之一；实时陪诊 contract 未冻结前保持迁移状态。 */

type ConsultPageData = Record<string, never>;
type ConsultPageMethods = Record<never, never>;

Page<ConsultPageData, ConsultPageMethods>({
	data: {},
});
