/** “互联网医院”主 Tab 目前只承载迁移边界，不复制未验收的外部 web-view。 */

type HospitalPageData = Record<string, never>;
type HospitalPageMethods = Record<never, never>;

Page<HospitalPageData, HospitalPageMethods>({
	data: {},
});
