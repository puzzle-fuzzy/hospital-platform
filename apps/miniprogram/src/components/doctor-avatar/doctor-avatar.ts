export {};

const DEFAULT_DOCTOR_AVATAR = "/assets/legacy-user/default-doctor-avatar.png";

type DoctorAvatarComponent = {
	data: { imageSrc: string };
	setData(data: { imageSrc: string }): void;
};

Component({
	properties: {
		src: {
			type: String,
			value: "",
			observer(this: DoctorAvatarComponent, src: string) {
				this.setData({ imageSrc: src.trim() || DEFAULT_DOCTOR_AVATAR });
			},
		},
		label: {
			type: String,
			value: "医生照片",
		},
	},
	data: {
		imageSrc: DEFAULT_DOCTOR_AVATAR,
	},
	methods: {
		onImageError(
			this: DoctorAvatarComponent,
			event: WechatMiniprogram.CustomEvent,
		) {
			const failedSrc = event.currentTarget.dataset.src;
			if (
				failedSrc !== this.data.imageSrc ||
				failedSrc === DEFAULT_DOCTOR_AVATAR
			) {
				return;
			}
			this.setData({ imageSrc: DEFAULT_DOCTOR_AVATAR });
		},
	},
});
