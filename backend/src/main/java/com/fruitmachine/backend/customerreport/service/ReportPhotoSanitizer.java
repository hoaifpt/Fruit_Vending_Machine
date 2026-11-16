package com.fruitmachine.backend.customerreport.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.springframework.stereotype.Component;

/**
 * Photos are trusted by content only: the magic bytes decide JPEG or PNG (the declared type and file name are ignored), the size is
 * checked before decoding, and the decoded pixels are re-encoded, which drops every metadata block (EXIF including GPS, comments,
 * ICC profiles, text chunks). Anything that does not decode is rejected.
 */
@Component
public class ReportPhotoSanitizer {
    public static final int MAX_PHOTOS = 3;
    public static final int MAX_BYTES = 2 * 1024 * 1024;
    public static final int MAX_DIMENSION = 4000;
    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};

    public record SanitizedPhoto(String contentType, byte[] data) {
    }

    public SanitizedPhoto sanitize(byte[] input) {
        if (input == null || input.length == 0) throw invalid("a photo is empty");
        if (input.length > MAX_BYTES) throw invalid("a photo is larger than 2 MB");
        String format = startsWith(input, JPEG) ? "jpeg" : startsWith(input, PNG) ? "png" : null;
        if (format == null) throw invalid("photos must be JPEG or PNG images");
        BufferedImage image = decode(input, format);
        byte[] output = encode(image, format);
        if (output.length > MAX_BYTES) throw invalid("a photo is larger than 2 MB after processing");
        return new SanitizedPhoto(format.equals("png") ? "image/png" : "image/jpeg", output);
    }

    private static BufferedImage decode(byte[] input, String format) {
        try (ImageInputStream stream = ImageIO.createImageInputStream(new ByteArrayInputStream(input))) {
            var readers = ImageIO.getImageReadersByFormatName(format);
            if (stream == null || !readers.hasNext()) throw invalid("the photo could not be read");
            ImageReader reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION)
                    throw invalid("photos must be at most 4000 x 4000 pixels");
                BufferedImage image = reader.read(0);
                if (image == null) throw invalid("the photo could not be read");
                return image;
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException ex) {
            if (ex instanceof BadRequestException bad) throw bad;
            throw invalid("the photo could not be read");
        }
    }

    private static byte[] encode(BufferedImage image, String format) {
        BufferedImage pixels = image;
        if (format.equals("jpeg") && (image.getColorModel().hasAlpha() || image.getType() == BufferedImage.TYPE_CUSTOM)) {
            // JPEG has no alpha; draw on an opaque RGB canvas (also normalises exotic colour models such as CMYK readers).
            pixels = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
            var graphics = pixels.createGraphics();
            graphics.drawImage(image, 0, 0, java.awt.Color.WHITE, null);
            graphics.dispose();
        }
        try (var out = new ByteArrayOutputStream()) {
            if (!ImageIO.write(pixels, format.equals("png") ? "png" : "jpg", out)) throw invalid("the photo could not be processed");
            return out.toByteArray();
        } catch (IOException ex) {
            throw invalid("the photo could not be processed");
        }
    }

    private static boolean startsWith(byte[] data, byte[] prefix) {
        return data.length >= prefix.length && Arrays.equals(Arrays.copyOf(data, prefix.length), prefix);
    }

    private static BadRequestException invalid(String message) {
        return new BadRequestException(message);
    }
}
