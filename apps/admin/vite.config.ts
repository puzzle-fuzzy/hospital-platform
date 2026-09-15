import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	base: process.env.INSURANCE_QUERY_PUBLIC_BASE?.trim() || "/",
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
	},
});
