export const QUERY_STATUSES = [
	"found",
	"explicit_denied",
	"not_found",
	"captcha_required",
	"session_expired",
	"ui_changed",
	"upstream_error",
	"unknown",
] as const;

export type QueryStatus = (typeof QUERY_STATUSES)[number];

export type NetworkObservation = {
	method: string;
	url: string;
	status: number;
	contentType: string;
	resourceType: string;
	body?: unknown;
};

export type QueryCapture = {
	query: string;
	status: QueryStatus;
	title: string;
	pageUrl: string;
	capturedAt: string;
	visibleText: string;
	resultLabels: readonly string[];
	matchedResultCount: number;
	network: readonly NetworkObservation[];
	notes: readonly string[];
};

export type QueryConfig = {
	portalUrl: string;
	query: string;
	profileDir: string;
	outputDir: string;
	headless: boolean;
	searchSelector?: string;
	resultSelector?: string;
	authenticatedSelector?: string;
	executablePath?: string;
	allowedHosts: readonly string[];
	timeoutMs: number;
	writeIntake: boolean;
};
