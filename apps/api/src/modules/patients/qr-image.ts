import qrcode from "qrcode-generator";

/**
 * 生成就诊卡二维码图片数据。
 *
 * qrcode-generator 在服务端内存中生成 GIF data URL，不把卡号交给第三方
 * 图片服务；调用方应在返回 data URL 后立刻丢弃完整卡号。
 */
export function createPatientCardQrImageDataUrl(cardNumber: string): string {
	if (
		typeof cardNumber !== "string" ||
		!cardNumber.trim() ||
		cardNumber.length > 64 ||
		Array.from(cardNumber).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new Error("Patient card number is invalid for QR generation");
	}
	const code = qrcode(0, "M");
	code.addData(cardNumber, "Byte");
	code.make();
	const imageDataUrl = code.createDataURL(6, 4);
	if (!/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/u.test(imageDataUrl)) {
		throw new Error("Patient QR image generation returned an invalid data URL");
	}
	return imageDataUrl;
}
