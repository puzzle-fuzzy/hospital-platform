import {
	downloadOutpatientInvoiceResource,
	getCurrentUser,
	issueOutpatientElectronicInvoice,
} from "../../services/api-client";
import {
	formatOutpatientAmountLabel,
	loadCurrentPatientForOwner,
	loadOutpatientElectronicInvoices,
} from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	readOutpatientInvoiceResourceType,
	removeOutpatientInvoiceResource,
} from "../../services/outpatient-invoice-resource";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	isCurrentSelectedPatient,
	isPatientSelectionError,
	patientContextErrorMessage,
	preservedPatientForReload,
	registerPatientSelectionChangedListener,
	shouldClearPatientContextAfterError,
} from "../../services/patient-selection-service";
import { assertSessionGeneration } from "../../services/session-boundary";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
	registerSessionChangedListener,
} from "../../services/session-events";
import { getSessionGeneration } from "../../services/session-generation";
import {
	hasPlatformSession,
	sessionStateAfterAuthenticatedReadError,
} from "../../services/session-service";
import type {
	OutpatientElectronicInvoice,
	OutpatientElectronicInvoicePageData,
	OutpatientElectronicInvoiceView,
	Patient,
	ViewKeyEvent,
} from "../../types";

type InvoicePreviewRuntime = {
	files: Set<string>;
	unsubscribe: Array<() => void>;
};
const invoicePreviews = new WeakMap<object, InvoicePreviewRuntime>();
let previewSequence = 0;

function previewRuntime(page: object): InvoicePreviewRuntime {
	let runtime = invoicePreviews.get(page);
	if (!runtime) {
		runtime = { files: new Set(), unsubscribe: [] };
		invoicePreviews.set(page, runtime);
	}
	return runtime;
}

function clearInvoicePreviews(page: object): void {
	getPageLatestRequestGuard(page, "outpatient-electronic-invoice-view").begin();
	for (const file of previewRuntime(page).files)
		removeOutpatientInvoiceResource(file);
	previewRuntime(page).files.clear();
}

function findInvoice(
	items: readonly OutpatientElectronicInvoiceView[],
	viewKey: unknown,
): OutpatientElectronicInvoiceView | undefined {
	if (typeof viewKey !== "string" || !viewKey) return undefined;
	return items.find((item) => item.viewKey === viewKey);
}

function isIssued(invoice: OutpatientElectronicInvoice): boolean {
	return Boolean(invoice.billBatchCode && invoice.billNo);
}

function invoiceImageBase64(
	invoice: OutpatientElectronicInvoiceView,
): string | undefined {
	for (const candidate of [
		invoice.pictureNetUrl,
		invoice.pictureUrl,
		invoice.billQrCode,
	]) {
		if (typeof candidate !== "string") continue;
		const normalized = candidate.trim();
		const dataUrl =
			/^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(
				normalized,
			);
		const base64 = dataUrl?.[1] ?? normalized;
		if (
			base64.length >= 4 &&
			base64.length <= 8_000_000 &&
			base64.length % 4 === 0 &&
			/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)
		) {
			return base64;
		}
	}
	return undefined;
}

function hospitalInvoiceLink(
	invoice: OutpatientElectronicInvoiceView,
): string | undefined {
	return [invoice.pictureNetUrl, invoice.pictureUrl].find(
		(value) =>
			typeof value === "string" &&
			value.length <= 32_768 &&
			/^https?:\/\/[^\s<>"'@]+$/iu.test(value),
	);
}

function toView(
	invoice: OutpatientElectronicInvoice,
	index: number,
	renderGeneration: number,
): OutpatientElectronicInvoiceView {
	return {
		...invoice,
		viewKey: `outpatient-electronic-invoice-${renderGeneration}-${index}`,
		issueState: isIssued(invoice) ? "issued" : "ready",
		...(invoice.amountFen === undefined
			? {}
			: { amountLabel: formatOutpatientAmountLabel(invoice.amountFen) }),
	};
}

type OutpatientElectronicInvoicePageMethods = {
	loadPage(): Promise<void>;
	onChangePatient(): void;
	onRetry(): void;
	onIssue(event: ViewKeyEvent): void;
	onView(event: ViewKeyEvent): void;
	openInvoice(
		invoice: OutpatientElectronicInvoiceView,
		patient: Patient,
		expectedSessionGeneration: number,
	): Promise<void>;
	issueInvoice(
		invoice: OutpatientElectronicInvoiceView,
		patient: Patient,
		expectedSessionGeneration: number,
	): Promise<void>;
	onPullDownRefresh(): void;
	onUnload(): void;
};

Page<
	OutpatientElectronicInvoicePageData,
	OutpatientElectronicInvoicePageMethods
>({
	data: {
		hasShown: false,
		sessionState: "checking",
		selectedPatient: null,
		patientSessionGeneration: -1,
		items: [],
		loading: true,
		issuingViewKey: "",
		openingViewKey: "",
		error: "",
		canSelectPatient: false,
	},

	onLoad(): void {
		this.setData({ hasShown: false });
		const runtime = previewRuntime(this);
		const invalidatePreview = () => {
			clearInvoicePreviews(this);
			this.setData({ openingViewKey: "" });
		};
		runtime.unsubscribe.push(
			registerSessionChangedListener(invalidatePreview),
			registerPatientSelectionChangedListener(({ patientId }) => {
				if (this.data.selectedPatient?.id !== patientId) invalidatePreview();
			}),
		);
		registerPageSessionResetListener(
			this,
			() => {
				this.setData({
					sessionState: "checking",
					selectedPatient: null,
					patientSessionGeneration: -1,
					items: [],
					loading: true,
					issuingViewKey: "",
					openingViewKey: "",
					error: "",
					canSelectPatient: false,
				});
			},
			() => this.loadPage(),
		);
		void this.loadPage();
	},

	onShow(): void {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.loadPage();
	},

	/** 发票列表与开具命令都只绑定当前 owner、当前患者和当前会话代际。 */
	loadPage(): Promise<void> {
		clearInvoicePreviews(this);
		const guard = getPageLatestRequestGuard(
			this,
			"outpatient-electronic-invoice",
		);
		const token = guard.begin();
		let expectedSessionGeneration = -1;
		const preservedPatient = preservedPatientForReload(
			this.data.selectedPatient,
		);
		this.setData({
			loading: true,
			error: "",
			sessionState: "checking",
			selectedPatient: preservedPatient,
			patientSessionGeneration: -1,
			items: [],
			issuingViewKey: "",
			openingViewKey: "",
			canSelectPatient: false,
		});
		return getCurrentUser()
			.then((currentUser) => {
				if (!guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = getSessionGeneration();
				this.setData({ sessionState: "valid" });
				return loadCurrentPatientForOwner(currentUser.data.user.id);
			})
			.then((patientContext) => {
				if (!patientContext || !guard.isCurrent(token)) return undefined;
				expectedSessionGeneration = patientContext.sessionGeneration;
				const { patient } = patientContext;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Electronic invoice session changed before patient context was confirmed",
				);
				if (!isCurrentSelectedPatient(patient.id)) return undefined;
				this.setData({
					selectedPatient: patient,
					patientSessionGeneration: expectedSessionGeneration,
				});
				return loadOutpatientElectronicInvoices(
					patient.id,
					expectedSessionGeneration,
				);
			})
			.then((payload) => {
				if (!payload || !guard.isCurrent(token)) return;
				assertSessionGeneration(
					expectedSessionGeneration,
					"Electronic invoice session changed before records were committed",
				);
				const patientId = this.data.selectedPatient?.id;
				if (!patientId || !isCurrentSelectedPatient(patientId)) return;
				this.setData({
					items: payload.items.map((invoice, index) =>
						toView(invoice, index, token),
					),
					error: "",
					canSelectPatient: false,
				});
			})
			.catch((error: unknown) => {
				if (!guard.isCurrent(token)) return;
				const canSelectPatient = isPatientSelectionError(error);
				const clearPatient =
					shouldClearPatientContextAfterError(error, hasPlatformSession()) ||
					canSelectPatient;
				this.setData({
					sessionState: sessionStateAfterAuthenticatedReadError(
						error,
						this.data.sessionState,
						hasPlatformSession(),
					),
					selectedPatient: clearPatient
						? null
						: preservedPatientForReload(this.data.selectedPatient),
					patientSessionGeneration: -1,
					items: [],
					issuingViewKey: "",
					canSelectPatient,
					error: errorMessageWithCode(
						error,
						patientContextErrorMessage(
							error,
							"门诊电子发票暂时无法获取，请稍后重试",
						),
					),
				});
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onChangePatient(): void {
		if (this.data.sessionState !== "valid") {
			wx.showToast({ title: "请先完成登录验证", icon: "none" });
			return;
		}
		navigateToPatientSelector(this.data.sessionState);
	},

	onRetry(): void {
		void this.loadPage();
	},

	onIssue(event: ViewKeyEvent): void {
		if (
			this.data.issuingViewKey ||
			this.data.openingViewKey ||
			this.data.loading
		)
			return;
		const patient = this.data.selectedPatient;
		const invoice = findInvoice(
			this.data.items,
			event.currentTarget?.dataset?.viewKey,
		);
		if (
			!patient ||
			!invoice ||
			invoice.issueState === "issued" ||
			this.data.patientSessionGeneration !== getSessionGeneration() ||
			!isCurrentSelectedPatient(patient.id)
		) {
			return;
		}
		wx.showModal({
			title: "确认开具电子发票",
			content: "确认后将向医院开具个人抬头电子发票，开具后不能重复操作。",
			confirmText: "确认开具",
			success: ({ confirm }) => {
				if (!confirm) return;
				void this.issueInvoice(
					invoice,
					patient,
					this.data.patientSessionGeneration,
				);
			},
		});
	},

	/**
	 * 查看只读取原票据，不复用开票命令。网页由服务端受控解析为影像，
	 * 不把医院的任意 URL 直接传给 WebView 或 downloadFile。
	 */
	onView(event: ViewKeyEvent): void {
		if (
			this.data.loading ||
			this.data.openingViewKey ||
			this.data.issuingViewKey
		)
			return;
		const patient = this.data.selectedPatient;
		const invoice = findInvoice(
			this.data.items,
			event.currentTarget?.dataset?.viewKey,
		);
		if (
			!patient ||
			invoice?.issueState !== "issued" ||
			this.data.sessionState !== "valid" ||
			this.data.patientSessionGeneration !== getSessionGeneration() ||
			!isCurrentSelectedPatient(patient.id)
		)
			return;
		void this.openInvoice(invoice, patient, this.data.patientSessionGeneration);
	},

	async openInvoice(
		invoice,
		patient,
		expectedSessionGeneration,
	): Promise<void> {
		clearInvoicePreviews(this);
		const guard = getPageLatestRequestGuard(
			this,
			"outpatient-electronic-invoice-view",
		);
		const token = guard.begin();
		const current = () =>
			guard.isCurrent(token) &&
			expectedSessionGeneration === getSessionGeneration() &&
			this.data.patientSessionGeneration === expectedSessionGeneration &&
			this.data.selectedPatient?.id === patient.id &&
			isCurrentSelectedPatient(patient.id) &&
			findInvoice(this.data.items, invoice.viewKey)?.recordId ===
				invoice.recordId;
		if (!current()) return;
		this.setData({ openingViewKey: invoice.viewKey });
		let filePath = "";
		try {
			let kind: "image" | "pdf" = "image";
			const base64 = invoiceImageBase64(invoice);
			if (base64) {
				// 不含姓名、患者号和票据密文；不同会话、页面及操作不会覆盖文件。
				filePath = `${wx.env.USER_DATA_PATH}/invoice-${expectedSessionGeneration}-${Date.now()}-${++previewSequence}.png`;
				previewRuntime(this).files.add(filePath);
				try {
					wx.getFileSystemManager().writeFileSync(filePath, base64, "base64");
					if (!readOutpatientInvoiceResourceType(filePath).startsWith("image/"))
						throw new Error("Inline invoice is not an image");
				} catch {
					removeOutpatientInvoiceResource(filePath);
					previewRuntime(this).files.delete(filePath);
					filePath = "";
				}
			}
			if (!filePath) {
				const resource = await downloadOutpatientInvoiceResource(
					patient.id,
					invoice.recordId,
					expectedSessionGeneration,
				);
				filePath = resource.tempFilePath;
				kind = resource.kind;
				previewRuntime(this).files.add(filePath);
			}
			if (!current()) return;
			await new Promise<void>((resolve, reject) => {
				if (kind === "pdf") {
					wx.openDocument({
						filePath,
						fileType: "pdf",
						showMenu: true,
						success: () => resolve(),
						fail: reject,
					});
				} else {
					wx.previewImage({
						urls: [filePath],
						current: filePath,
						success: () => resolve(),
						fail: reject,
					});
				}
			});
		} catch (error) {
			if (!current()) return;
			if (filePath) {
				removeOutpatientInvoiceResource(filePath);
				previewRuntime(this).files.delete(filePath);
			}
			const link = hospitalInvoiceLink(invoice);
			const message = errorMessageWithCode(
				error,
				"票据影像暂时无法获取，请稍后重试",
			);
			wx.showModal({
				title: "票据暂时无法打开",
				content: link
					? `${message}。也可复制医院提供的票据链接，粘贴到浏览器查看；若仍无法打开，请联系医院核实。`
					: `${message}。本次操作未重新开票，请稍后刷新票据记录。`,
				showCancel: Boolean(link),
				confirmText: link ? "复制链接" : "知道了",
				success: ({ confirm }) => {
					if (!confirm || !link || !current()) return;
					wx.setClipboardData({
						data: link,
						fail: () => {
							if (current())
								wx.showToast({ title: "链接复制失败，请重试", icon: "none" });
						},
					});
				},
			});
		} finally {
			if (!current() && filePath) {
				removeOutpatientInvoiceResource(filePath);
				previewRuntime(this).files.delete(filePath);
			}
			if (guard.isCurrent(token)) this.setData({ openingViewKey: "" });
		}
	},

	async issueInvoice(
		invoice: OutpatientElectronicInvoiceView,
		patient: Patient,
		expectedSessionGeneration: number,
	): Promise<void> {
		if (
			this.data.issuingViewKey ||
			!isCurrentSelectedPatient(patient.id) ||
			expectedSessionGeneration !== getSessionGeneration()
		) {
			return;
		}
		const guard = getPageLatestRequestGuard(
			this,
			"outpatient-electronic-invoice",
		);
		const token = guard.begin();
		this.setData({ issuingViewKey: invoice.viewKey, error: "" });
		try {
			const result = await issueOutpatientElectronicInvoice(
				invoice.recordId,
				patient.id,
			);
			assertSessionGeneration(
				expectedSessionGeneration,
				"Electronic invoice session changed while issuing",
			);
			if (!guard.isCurrent(token) || !isCurrentSelectedPatient(patient.id))
				return;
			this.setData({
				items: this.data.items.map((item) =>
					item.viewKey !== invoice.viewKey
						? item
						: {
								...item,
								issueState: "issued" as const,
								...(result.data.invoice.billBatchCode === undefined
									? {}
									: { billBatchCode: result.data.invoice.billBatchCode }),
								...(result.data.invoice.billNo === undefined
									? {}
									: { billNo: result.data.invoice.billNo }),
								...(result.data.invoice.createTime === undefined
									? {}
									: { invoiceTime: result.data.invoice.createTime }),
								...(result.data.invoice.pictureNetUrl === undefined
									? {}
									: { pictureNetUrl: result.data.invoice.pictureNetUrl }),
								...(result.data.invoice.pictureUrl === undefined
									? {}
									: { pictureUrl: result.data.invoice.pictureUrl }),
								...(result.data.invoice.billQrCode === undefined
									? {}
									: { billQrCode: result.data.invoice.billQrCode }),
								...(result.data.invoice.random === undefined
									? {}
									: { random: result.data.invoice.random }),
							},
				),
			});
			wx.showToast({ title: "电子发票已开具", icon: "success" });
		} catch (error) {
			if (guard.isCurrent(token)) {
				this.setData({
					error: errorMessageWithCode(
						error,
						patientContextErrorMessage(error, "电子发票开具失败，请稍后重试"),
					),
				});
			}
		} finally {
			if (guard.isCurrent(token)) this.setData({ issuingViewKey: "" });
		}
	},

	onPullDownRefresh(): void {
		void this.loadPage().finally(() => wx.stopPullDownRefresh());
	},

	onUnload(): void {
		clearInvoicePreviews(this);
		for (const unsubscribe of previewRuntime(this).unsubscribe) unsubscribe();
		invoicePreviews.delete(this);
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
