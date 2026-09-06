package com.hospital.platform.medicalinsurance;

import com.tencent.mip.DataHandler;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Small stdin/stdout bridge for the official Tencent medical-insurance SDK.
 *
 * The Bun service keeps the existing relay and business orchestration. This
 * process only turns a plaintext JSON request into the SDK envelope, or opens
 * one provider response. Credentials are read from the child process
 * environment and never appear in command arguments or stdout.
 */
public final class OfficialFsiSdkCli {
    private OfficialFsiSdkCli() {}

    public static void main(String[] args) {
        try {
            if (args.length != 1 || (!"seal".equals(args[0]) && !"open".equals(args[0]))) {
                fail("operation must be seal or open");
            }

            String input = readStdin();
            if (input.trim().isEmpty()) {
                fail("stdin payload is empty");
            }

            DataHandler handler = DataHandler.newInstance(
                requiredEnv("MBS_APP_ID"),
                requiredEnv("MBS_APP_SECRET"),
                requiredEnv("MBS_SM2_PLATFORM_PUBLIC_B64"),
                requiredEnv("MBS_SM2_PRIVATE_KEY_B64")
            );
            handler.setVersion(envOrDefault("MBS_JAVA_SDK_VERSION", "2.0.1"));
            handler.setStringValue(booleanEnv("MBS_JAVA_SDK_STRING_VALUE", true));
            if ("open".equals(args[0])) {
                // The API's existing compatibility flag is explicit. In
                // non-strict test mode the SDK still decrypts the payload but
                // does not claim that the platform signature was verified.
                handler.setSkipVerify(!booleanEnv("MBS_SM2_VERIFY_STRICT", false));
            }

            String result = "seal".equals(args[0])
                ? handler.buildReqData(input)
                : handler.processRspData(input);
            System.out.print(result);
        } catch (Exception error) {
            // Do not print the SDK exception message: some SDK versions log
            // signed parameter strings and may include the app secret.
            System.err.println("official medical-insurance SDK failed");
            System.exit(2);
        }
    }

    private static String readStdin() throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int length;
        while ((length = System.in.read(buffer)) != -1) {
            output.write(buffer, 0, length);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.trim().isEmpty()) {
            fail(name + " is required");
        }
        return value.trim();
    }

    private static String envOrDefault(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static boolean booleanEnv(String name, boolean fallback) {
        String value = System.getenv(name);
        if (value == null || value.trim().isEmpty()) return fallback;
        return "1".equals(value) || "true".equalsIgnoreCase(value) || "yes".equalsIgnoreCase(value);
    }

    private static void fail(String message) {
        throw new IllegalArgumentException(message);
    }
}
