export type QueryMode =
	| "identity-card"
	| "electronic-credential"
	| "social-security-card";

export type LoginValues = {
	username: string;
	password: string;
	captcha?: string;
};

export type QueryValues = {
	mode: QueryMode;
	name: string;
	identityNumber: string;
	credentialNumber?: string;
	cardSerialNumber?: string;
	expectedPsnNo?: string;
};

export type CaptchaState = {
	enabled: boolean;
	key: string;
	image: string;
};

export type Session = {
	accessToken: string;
	refreshToken: string;
	tokenType: string;
	expiresIn: number;
	username: string;
};

export type ProviderRecord = Record<string, unknown>;

export type InsuranceRecord = {
	key: string;
	index: number;
	psnNo: string;
	insuranceType: string;
	balance: string;
	status: string;
	insuredArea: string;
	employerName: string;
	personType: string;
	raw: ProviderRecord;
};

export type Normalized1101Result = {
	baseInfo: ProviderRecord;
	insuranceRecords: InsuranceRecord[];
	identityRecords: ProviderRecord[];
	raw: unknown;
};
