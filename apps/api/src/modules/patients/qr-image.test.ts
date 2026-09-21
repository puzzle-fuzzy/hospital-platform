import { expect, test } from "bun:test";
import { createPatientCardQrImageDataUrl } from "./qr-image";

test("就诊卡二维码由服务端本地生成 GIF data URL", () => {
	const imageDataUrl = createPatientCardQrImageDataUrl("000012345678");

	expect(imageDataUrl).toMatch(/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/u);
	expect(imageDataUrl.length).toBeGreaterThan(500);
});

test("就诊卡二维码拒绝空值和控制字符", () => {
	expect(() => createPatientCardQrImageDataUrl("")).toThrow();
	expect(() => createPatientCardQrImageDataUrl("card\n001")).toThrow();
});
