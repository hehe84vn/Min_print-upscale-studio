# Print Upscale Studio

Ứng dụng desktop local dành cho workflow thiết kế và in ấn:

- **AI Upscale**: gọi backend `upscayl-bin` NCNN/Vulkan do người dùng cung cấp.
- **Restore Safe**: khử nhiễu, phục hồi tương phản/màu và làm nét có kiểm soát.
- **Vector Logo**: chuyển logo màu, logo một màu, con dấu hoặc line art sang SVG bằng VTracer.
- **Text Print Safe**: tăng độ nét chữ raster mà không OCR, không thay font và không sửa nội dung.

Đây là code clean-room mới hoàn toàn. Dự án không chứa code, license key hoặc tài sản của FD Advertising.

## Trạng thái bản 0.1.0

Bản này là MVP dùng được:

- Windows 10/11 x64.
- macOS 12 trở lên, tạo cả Intel x64 và Apple Silicon arm64.
- Xử lý ảnh chạy local.
- Nếu chưa cấu hình NCNN, module Upscale dùng Lanczos + sharpening dự phòng.
- Vector Logo hỗ trợ màu phẳng và đơn sắc; vẫn cần kiểm tra node/màu trước khi đưa vào artwork in.
- Restore Safe không phải generative restoration; không tự bịa chi tiết khuôn mặt hoặc vùng ảnh mất.

## Chạy ở chế độ phát triển

Yêu cầu Node.js 22.

```bash
npm install
npm start
```

Kiểm tra cú pháp và chạy smoke test cho bốn pipeline local:

```bash
npm run check
```

## Cấu hình Upscayl NCNN

Cài Upscayl chính thức hoặc tự tải/build `upscayl-bin` từ dự án chính thức. Trong ứng dụng:

1. Bấm **Tự tìm** để dò bản Upscayl đã cài.
2. Nếu không tìm thấy, bấm **Chọn binary** và chọn `upscayl-bin.exe` trên Windows hoặc `upscayl-bin` trên macOS.
3. Bấm **Chọn model** và trỏ tới thư mục có từng cặp file `.param` + `.bin`.

Tên model được hỗ trợ:

- `upscayl-standard-4x`
- `upscayl-lite-4x`
- `high-fidelity-4x`
- `remacri-4x`
- `ultramix-balanced-4x`
- `ultrasharp-4x`
- `digital-art-4x`

## Build file cài đặt

### Windows

```bash
npm ci
npm run dist:win
```

Kết quả trong `release/`:

- NSIS installer `.exe`
- Portable `.exe` (tên file riêng, không ghi đè bản Setup)

### macOS

```bash
npm ci
npm run dist:mac:arm64
# hoặc trên Mac Intel
npm run dist:mac:x64
```

Kết quả trong `release/`:

- `.dmg` và `.zip` đúng theo kiến trúc máy build
- GitHub Actions build riêng Apple Silicon arm64 và Intel x64

## GitHub Actions

Workflow `.github/workflows/build-desktop.yml`:

- kiểm tra cú pháp trên Ubuntu;
- build Windows trên `windows-latest`;
- build Apple Silicon trên `macos-15` và Intel trên `macos-15-intel`;
- upload installer vào mục **Actions → Artifacts**;
- khi push tag `v*`, tự tạo GitHub Release và đính kèm installer.

Ví dụ phát hành:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Chưa ký số

Workflow mặc định xuất file **unsigned**:

- Windows có thể hiện SmartScreen “Unknown publisher”.
- macOS có thể chặn Gatekeeper; dùng chuột phải → **Open** để mở lần đầu.

Để phát hành thương mại, cần bổ sung Windows code-signing certificate và Apple Developer ID/notarization secrets.

## License

Code ứng dụng: MIT. Xem `THIRD_PARTY_NOTICES.md` trước khi phân phối, đặc biệt với Potrace, Upscayl backend và từng model weight.
