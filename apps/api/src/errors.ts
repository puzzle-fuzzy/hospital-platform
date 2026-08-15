/** HTTP 层可安全返回给客户端的业务错误；message 不允许携带 provider 原文。 */
export class HttpError extends Error {
	readonly statusCode: number;
	readonly code: string;

	constructor(statusCode: number, code: string, message: string) {
		super(message);
		this.name = "HttpError";
		this.statusCode = statusCode;
		this.code = code;
	}
}
